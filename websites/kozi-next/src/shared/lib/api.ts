// Talks to Orbique's public booking API (api/public.js at the root of this repo). Until PUBLIC_KOZI_API is set, a
// sample API with the same answers stands in, so the whole flow can be tried in test mode. Both go through the same
// adapters below, which turn Orbique's answers into the shapes the pages use.
import { addDays, fmtDayYear, iso, fromIso, nights as countNights, todayKL } from './dates';

// a booking type in Orbique ('boutique'), the bookType of a suite in the content
export type SuiteType = string;
export type Night = { date: string; public: number };
type Price = { nightly: number; total: number };
// one way to book a stay: Flexible, Weekly or Non-refundable
export type Rate = { plan: string; name: string; refundable: boolean; freeCancelUntil: string | null; nights: Night[]; public: Price; cancellation: string };
export type Quote = {
  type: SuiteType; available: boolean; reason: string; short: string; nights: Night[];
  public: Price; extraBed: number; currency: 'MYR';
  plan: string | null; refundable: boolean; rates: Rate[]; cancellation: string; taxNote: string;
};
export type Availability = { checkIn: string; checkOut: string; guests: number; quotes: Quote[] };
export type CalendarDay = { date: string; open: boolean; public: number; minStay: number; noArrival: boolean; noDeparture: boolean };

// ---------------------------------------------------------------- Orbique's answers (api/_lib/website.js)
type ApiOption = { plan: string; name: string; refundable: boolean; bookable: boolean; why: string | null; minStay?: number; nightly: Night[]; extraBed: number; publicTotal: number; freeCancelUntil: string | null };
type ApiType = { type: string; available: boolean; freeUnits: number; plan: string | null; options: ApiOption[] };
type ApiNotes = { tourismTax: string; cancellation: string; nonRefundable: string };
type ApiAvailability = { checkIn: string; checkOut: string; nights: number; guests: number; types: ApiType[]; notes: ApiNotes };
type ApiDay = { date: string; available: number; public: number | null; minStay: number; noArrival: boolean; noDeparture: boolean };

const API = (import.meta.env.PUBLIC_KOZI_API as string | undefined)?.replace(/\/$/, '');
export const TEST_MODE = !API;
const WS = 'kozi';

export class ApiError extends Error { constructor(message: string, readonly code: string) { super(message); } }
async function call<T>(path: string, body?: object): Promise<T> {
  // a GET goes without headers, so the browser needn't ask the API's permission first
  const res = await fetch(`${API}/api/public/${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const out = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; message?: string };
  if (!res.ok || out.ok === false) throw new ApiError(out.message || 'Something went wrong. Please try again.', out.error || `http-${res.status}`);
  return out as T;
}

// ---------------------------------------------------------------- adapters
const sum = (ns: Night[]) => ns.reduce((s, n) => s + n.public, 0);
const per = (total: number, n: number) => Math.round((total / Math.max(1, n)) * 100) / 100;
// why a suite with a free apartment still can't be booked for these dates: [the short label, the sentence]
const WHY: Record<string, (o: ApiOption) => [string, string]> = {
  min_stay: (o) => [`${o.minStay ?? 2}+ nights`, `These dates need a stay of at least ${o.minStay ?? 2} nights.`],
  max_stay: () => ['Too long', 'That stay is longer than we take online. Please contact us.'],
  no_arrival: () => ['No check-in', 'Check-in is not possible on that date. Please pick another arrival day.'],
  no_departure: () => ['No check-out', 'Check-out is not possible on that date. Please pick another day to leave.'],
};
function toRate(o: ApiOption, notes: ApiNotes): Rate {
  const nights = o.nightly.map((x) => ({ date: x.date, public: x.public })); // Orbique's member price, if sent, is left out
  const n = nights.length, rooms = sum(nights);
  const cancellation = !o.refundable ? notes.nonRefundable
    : o.freeCancelUntil ? `Free cancellation until ${fmtDayYear(fromIso(o.freeCancelUntil)!)}.`
    : 'Your arrival is too close for free cancellation.';
  return { plan: o.plan, name: o.name, refundable: o.refundable, freeCancelUntil: o.freeCancelUntil, nights, cancellation,
    public: { nightly: per(rooms, n), total: o.publicTotal } };
}
function toQuote(t: ApiType, notes: ApiNotes): Quote {
  const rates = t.options.filter((o) => o.bookable).map((o) => toRate(o, notes));
  const best = rates.find((r) => r.plan === t.plan) ?? rates[0];
  const blocked = t.options.find((o) => o.why && WHY[o.why]);
  const available = t.available && !!best;
  const [short, reason] = available ? ['', ''] : t.freeUnits > 0 && blocked ? WHY[blocked.why!](blocked) : ['Sold out', 'Sold out for these dates.'];
  const empty = { nightly: 0, total: 0 };
  return {
    type: t.type, available, reason, short, nights: best?.nights ?? [], public: best?.public ?? empty,
    extraBed: t.options[0]?.extraBed ?? 0, currency: 'MYR', plan: best?.plan ?? null, refundable: best?.refundable ?? false,
    rates: available ? rates : [], cancellation: best?.cancellation ?? notes.cancellation, taxNote: notes.tourismTax,
  };
}
const toDay = (d: ApiDay): CalendarDay => ({ date: d.date, open: d.available > 0 && d.public !== null, public: d.public ?? 0, minStay: d.minStay || 1, noArrival: d.noArrival, noDeparture: d.noDeparture });

// ---------------------------------------------------------------- prices
export async function calendar(type: SuiteType, from: Date, to: Date): Promise<CalendarDay[]> {
  const r = API ? await call<{ days: ApiDay[] }>(`calendar?ws=${WS}&type=${type}&from=${iso(from)}&to=${iso(to)}`) : sampleCalendar(type, from, to);
  return r.days.map(toDay);
}

/** types: the booking types the page shows, for the sample API in test mode (Orbique answers for all of them). */
export async function availability(checkIn: string, checkOut: string, guests: number, types: SuiteType[] = Object.keys(BASE)): Promise<Availability> {
  const r = API ? await call<ApiAvailability>(`availability?ws=${WS}&in=${checkIn}&out=${checkOut}&guests=${guests}`) : (await wait(420), sampleAvailability(checkIn, checkOut, guests, types));
  return { checkIn: r.checkIn, checkOut: r.checkOut, guests: r.guests, quotes: r.types.map((t) => toQuote(t, r.notes)) };
}

// unit: the suite's address in the site ('vortex-klcc/boutique'), so the way back from Stripe lands on the same suite
export type CheckoutInput = { type: SuiteType; unit?: string; suite?: string; checkIn: string; checkOut: string; guests: number; plan: string | null; name: string; email: string; phone: string; country: string; arrival?: string; notes?: string };
// suite: its name, for the thank-you page
export type Booked = { ref: string; type: SuiteType; suite?: string; in: string; out: string; guests: number; name: string; total: number; test: boolean };
export const BOOKED_KEY = 'kozi-booked';
/** Holds the nights and opens Stripe's payment page. The confirmation page gets the stay from Orbique and the guest's
 *  first name back from this tab, so nothing about the guest travels in an address. */
export async function checkout(input: CheckoutInput): Promise<{ url: string }> {
  let url: string, ref: string, total: number;
  if (API) {
    const stay = new URLSearchParams({ type: input.type, ...(input.unit ? { unit: input.unit } : {}), in: input.checkIn, out: input.checkOut, guests: String(input.guests) });
    const r = await call<{ url: string; bookingId: string; total: number }>(`checkout?ws=${WS}`, {
      ws: WS, type: input.type, in: input.checkIn, out: input.checkOut, guests: input.guests, plan: input.plan ?? undefined,
      guest: { name: input.name, email: input.email, phone: input.phone, country: input.country === 'Other' ? '' : input.country },
      arrival: input.arrival, notes: input.notes,
      successUrl: `${location.origin}/booking/confirmed/?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${location.origin}/book/?${stay}&back=1`,
    });
    ({ url, bookingId: ref, total } = r);
  } else {
    await wait(900);
    ref = 'KZ-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    url = '/booking/confirmed/?test=1';
    total = 0;
  }
  const booked: Booked = { ref, type: input.type, suite: input.suite, in: input.checkIn, out: input.checkOut, guests: input.guests, name: input.name, total, test: !API };
  try { sessionStorage.setItem(BOOKED_KEY, JSON.stringify(booked)); } catch { /* private mode: the page still confirms, without the details */ }
  return { url };
}

export type BookingStatus = {
  bookingId: string; status: 'paid' | 'waiting' | 'cancelled'; type: SuiteType | null; checkIn: string; checkOut: string;
  nights: number; guests: number; total: number; plan: string | null; refundable: boolean; freeCancelUntil: string | null;
};
/** Back from Stripe: the stay behind a payment session, and whether Orbique has it as paid yet (Stripe tells Orbique
 *  a few seconds after the guest lands). Only the stay comes back, never the guest's details. Live mode only. */
export const bookingStatus = (session: string) => call<BookingStatus>(`booking?ws=${WS}&session_id=${encodeURIComponent(session)}`);

/** RM230, or RM211.50 when there are sen. whole rounds up to the ringgit, for tight spots like a calendar day,
 *  so a rounded price is never below what the guest pays. */
export function rm(n: number, whole = false) {
  const v = whole ? Math.ceil(n - 0.001) : Math.round(n * 100) / 100;
  return `RM${v.toLocaleString('en-MY', Number.isInteger(v) ? undefined : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the sample API (test mode only)
// Made-up nightly prices per booking type. Non-refundable is 10% less, as in Orbique.
const BASE: Record<string, { week: number; weekend: number }> = {
  standard: { week: 230, weekend: 290 }, boutique: { week: 240, weekend: 300 }, premium: { week: 265, weekend: 330 },
};
const hash = (s: string) => { // FNV-1a, then a final mix so neighbouring dates don't land together
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
function sampleNight(type: SuiteType, d: Date, f = 1): ApiDay {
  const k = iso(d), wkend = d.getDay() === 5 || d.getDay() === 6;
  const b = BASE[type] ?? BASE.standard; // a type added in Orbique gets the Standard price here
  const price = round2(((wkend ? b.weekend : b.week) + (d.getMonth() === 11 ? 20 : 0)) * f); // December costs more
  const open = hash(type + k) > 0.12;  // some nights already sold, so the calendar shows closed days
  return { date: k, available: open ? 1 : 0, public: price, minStay: 1, noArrival: false, noDeparture: false };
}
function sampleCalendar(type: SuiteType, from: Date, to: Date) {
  const days: ApiDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(sampleNight(type, d));
  return { days };
}
function sampleAvailability(checkIn: string, checkOut: string, guests: number, types: SuiteType[]): ApiAvailability {
  const a = fromIso(checkIn)!, b = fromIso(checkOut)!;
  const n = countNights(a, b);
  const extraBed = guests > 4 ? 60 * n : 0;
  const until = iso(addDays(a, -7));
  const list = types.map((type): ApiType => {
    let free = 1;
    const options = ([['flexible', 'Flexible', 1], ['nonref', 'Non-refundable', 0.9]] as const).map(([plan, name, f]): ApiOption => {
      const nightly = Array.from({ length: n }, (_, i) => sampleNight(type, addDays(a, i), f));
      if (nightly.some((x) => !x.available)) free = 0;
      const ns = nightly.map((x) => ({ date: x.date, public: x.public! }));
      return { plan, name, refundable: plan === 'flexible', bookable: true, why: null, nightly: ns, extraBed,
        publicTotal: round2(sum(ns) + extraBed),
        freeCancelUntil: plan === 'flexible' && until > iso(todayKL()) ? until : null };
    });
    return { type, available: free > 0, freeUnits: free, plan: 'flexible', options };
  });
  return { checkIn, checkOut, nights: n, guests, types: list, notes: {
    tourismTax: 'Malaysia charges a tourism tax of RM10 per room per night to guests who are not Malaysian. It is paid at check-in and is not included in the price.',
    cancellation: 'Free cancellation until 7 days before arrival.',
    nonRefundable: 'Non-refundable: the lower price cannot be refunded if you cancel or change your dates.',
  } };
}
