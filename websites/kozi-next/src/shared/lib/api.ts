// Talks to Orbique's public booking API (api/public.js at the root of this repo). Until PUBLIC_KOZI_API is set, a
// sample API with the same answers stands in, so the whole flow can be tried in test mode. Both go through the same
// adapters below, which turn Orbique's answers into the shapes the pages use.
import { addDays, fmtDayYear, iso, fromIso, nights as countNights, todayKL } from './dates';

export type SuiteType = 'standard' | 'boutique' | 'premium';
export type Night = { date: string; member: number; public: number };
type Price = { nightly: number; total: number };
// one way to book a stay: Flexible, Weekly or Non-refundable
export type Rate = { plan: string; name: string; refundable: boolean; freeCancelUntil: string | null; nights: Night[]; member: Price; public: Price; cancellation: string };
export type Quote = {
  type: SuiteType; available: boolean; reason: string; short: string; nights: Night[];
  member: Price; public: Price; extraBed: number; currency: 'MYR';
  plan: string | null; refundable: boolean; rates: Rate[]; cancellation: string; taxNote: string;
};
export type Availability = { checkIn: string; checkOut: string; guests: number; quotes: Quote[] };
export type CalendarDay = { date: string; open: boolean; member: number; public: number; minStay: number; noArrival: boolean; noDeparture: boolean };
export type Member = { email: string; token: string; expires: number };

// ---------------------------------------------------------------- Orbique's answers (api/_lib/website.js)
type ApiOption = { plan: string; name: string; refundable: boolean; bookable: boolean; why: string | null; minStay?: number; nightly: Night[]; extraBed: number; memberTotal: number; publicTotal: number; freeCancelUntil: string | null };
type ApiType = { type: string; available: boolean; freeUnits: number; plan: string | null; options: ApiOption[] };
type ApiNotes = { tourismTax: string; cancellation: string; nonRefundable: string };
type ApiAvailability = { checkIn: string; checkOut: string; nights: number; guests: number; types: ApiType[]; notes: ApiNotes };
type ApiDay = { date: string; available: number; member: number | null; public: number | null; minStay: number; noArrival: boolean; noDeparture: boolean };

const API = (import.meta.env.PUBLIC_KOZI_API as string | undefined)?.replace(/\/$/, '');
export const TEST_MODE = !API;
const WS = 'kozi';

class ApiError extends Error { constructor(message: string, readonly code: string) { super(message); } }
async function call<T>(path: string, body?: object): Promise<T> {
  // a GET goes without headers, so the browser needn't ask the API's permission first
  const res = await fetch(`${API}/api/public/${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const out = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; message?: string };
  if (!res.ok || out.ok === false) throw new ApiError(out.message || 'Something went wrong. Please try again.', out.error || `http-${res.status}`);
  return out as T;
}

// ---------------------------------------------------------------- adapters
const sum = (ns: Night[], k: 'member' | 'public') => ns.reduce((s, n) => s + n[k], 0);
const per = (total: number, n: number) => Math.round((total / Math.max(1, n)) * 100) / 100;
// why a suite with a free apartment still can't be booked for these dates: [the short label, the sentence]
const WHY: Record<string, (o: ApiOption) => [string, string]> = {
  min_stay: (o) => [`${o.minStay ?? 2}+ nights`, `These dates need a stay of at least ${o.minStay ?? 2} nights.`],
  max_stay: () => ['Too long', 'That stay is longer than we take online. Please contact us.'],
  no_arrival: () => ['No check-in', 'Check-in is not possible on that date. Please pick another arrival day.'],
  no_departure: () => ['No check-out', 'Check-out is not possible on that date. Please pick another day to leave.'],
};
function toRate(o: ApiOption, notes: ApiNotes): Rate {
  const n = o.nightly.length, rooms = { member: sum(o.nightly, 'member'), public: sum(o.nightly, 'public') };
  const cancellation = !o.refundable ? notes.nonRefundable
    : o.freeCancelUntil ? `Free cancellation until ${fmtDayYear(fromIso(o.freeCancelUntil)!)}.`
    : 'Your arrival is too close for free cancellation.';
  return { plan: o.plan, name: o.name, refundable: o.refundable, freeCancelUntil: o.freeCancelUntil, nights: o.nightly, cancellation,
    member: { nightly: per(rooms.member, n), total: o.memberTotal }, public: { nightly: per(rooms.public, n), total: o.publicTotal } };
}
function toQuote(t: ApiType, notes: ApiNotes): Quote {
  const rates = t.options.filter((o) => o.bookable).map((o) => toRate(o, notes));
  const best = rates.find((r) => r.plan === t.plan) ?? rates[0];
  const blocked = t.options.find((o) => o.why && WHY[o.why]);
  const available = t.available && !!best;
  const [short, reason] = available ? ['', ''] : t.freeUnits > 0 && blocked ? WHY[blocked.why!](blocked) : ['Sold out', 'Sold out for these dates.'];
  const empty = { nightly: 0, total: 0 };
  return {
    type: t.type as SuiteType, available, reason, short, nights: best?.nights ?? [], member: best?.member ?? empty, public: best?.public ?? empty,
    extraBed: t.options[0]?.extraBed ?? 0, currency: 'MYR', plan: best?.plan ?? null, refundable: best?.refundable ?? false,
    rates: available ? rates : [], cancellation: best?.cancellation ?? notes.cancellation, taxNote: notes.tourismTax,
  };
}
const toDay = (d: ApiDay): CalendarDay => ({ date: d.date, open: d.available > 0 && d.member !== null, member: d.member ?? 0, public: d.public ?? 0, minStay: d.minStay || 1, noArrival: d.noArrival, noDeparture: d.noDeparture });
/** Is there a member saving here? (none while the non-member markup is 0) */
export const saving = (p: { member: number; public: number }) => p.public - p.member >= 0.01;
// with no member saving there is no member deal to talk about, so the pages hide their [data-deal] lines
const deal = (any: boolean) => document.documentElement.classList.toggle('no-deal', !any);

// ---------------------------------------------------------------- members
const MKEY = 'kozi-member';
export function getMember(): Member | null {
  try { const m = JSON.parse(localStorage.getItem(MKEY) || 'null') as Member | null; return m && m.expires > Date.now() ? m : null; } catch { return null; }
}
export function signOut() { try { localStorage.removeItem(MKEY); } catch { /* private mode */ } document.dispatchEvent(new CustomEvent('kozi:member', { detail: null })); }
function keep(m: Member) { try { localStorage.setItem(MKEY, JSON.stringify(m)); } catch { /* private mode */ } document.dispatchEvent(new CustomEvent('kozi:member', { detail: m })); }

export async function memberStart(email: string): Promise<void> {
  if (!API) { await wait(650); return; }
  await call('member/start', { ws: WS, email });
}
export async function memberVerify(email: string, code: string): Promise<Member> {
  let m: Member;
  if (!API) {
    await wait(600);
    if (!/^\d{6}$/.test(code)) throw new Error('That code has 6 digits.');
    m = { email, token: 'test-' + Math.random().toString(36).slice(2), expires: Date.now() + 30 * 864e5 };
  } else {
    const r = await call<{ email: string; token: string; expiresAt: string }>('member/verify', { ws: WS, email, code });
    m = { email: r.email, token: r.token, expires: Date.parse(r.expiresAt) };
  }
  keep(m);
  return m;
}

// ---------------------------------------------------------------- prices
export async function calendar(type: SuiteType, from: Date, to: Date): Promise<CalendarDay[]> {
  const r = API ? await call<{ days: ApiDay[] }>(`calendar?ws=${WS}&type=${type}&from=${iso(from)}&to=${iso(to)}`) : sampleCalendar(type, from, to);
  const days = r.days.map(toDay), open = days.filter((d) => d.open);
  if (open.length) deal(open.some(saving));
  return days;
}

export async function availability(checkIn: string, checkOut: string, guests: number): Promise<Availability> {
  const r = API ? await call<ApiAvailability>(`availability?ws=${WS}&in=${checkIn}&out=${checkOut}&guests=${guests}`) : (await wait(420), sampleAvailability(checkIn, checkOut, guests));
  const quotes = r.types.map((t) => toQuote(t, r.notes)), open = quotes.filter((q) => q.available);
  if (open.length) deal(open.some((q) => saving({ member: q.member.total, public: q.public.total })));
  return { checkIn: r.checkIn, checkOut: r.checkOut, guests: r.guests, quotes };
}

export type CheckoutInput = { type: SuiteType; checkIn: string; checkOut: string; guests: number; plan: string | null; name: string; email: string; phone: string; country: string; arrival?: string; notes?: string };
export type Booked = { ref: string; type: SuiteType; in: string; out: string; guests: number; name: string; total: number; test: boolean };
export const BOOKED_KEY = 'kozi-booked';
/** Holds the nights and opens Stripe's payment page. The confirmation page reads the stay back from this tab, so
 *  nothing about the guest travels in an address. */
export async function checkout(input: CheckoutInput): Promise<{ url: string }> {
  let url: string, ref: string, total: number;
  if (API) {
    const stay = new URLSearchParams({ type: input.type, in: input.checkIn, out: input.checkOut, guests: String(input.guests) });
    const r = await call<{ url: string; bookingId: string; total: number }>(`checkout?ws=${WS}`, {
      ws: WS, type: input.type, in: input.checkIn, out: input.checkOut, guests: input.guests, plan: input.plan ?? undefined,
      guest: { name: input.name, email: input.email, phone: input.phone, country: input.country === 'Other' ? '' : input.country },
      arrival: input.arrival, notes: input.notes, memberToken: getMember()?.token,
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
  const booked: Booked = { ref, type: input.type, in: input.checkIn, out: input.checkOut, guests: input.guests, name: input.name, total, test: !API };
  try { sessionStorage.setItem(BOOKED_KEY, JSON.stringify(booked)); } catch { /* private mode: the page still confirms, without the details */ }
  return { url };
}

/** RM230, or RM211.50 when there are sen. whole rounds to the ringgit, for tight spots like a calendar day. */
export function rm(n: number, whole = false) {
  const v = whole ? Math.round(n) : Math.round(n * 100) / 100;
  return `RM${v.toLocaleString('en-MY', Number.isInteger(v) ? undefined : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the sample API (test mode only)
// Member price = the plain nightly price; everyone else pays a parity markup that Arnob sets in Orbique.
// 15% here is only a placeholder. Non-refundable is 10% less, as in Orbique.
const PUBLIC_MARKUP = 0.15;
const BASE: Record<SuiteType, { week: number; weekend: number }> = {
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
  const b = BASE[type];
  const member = round2(((wkend ? b.weekend : b.week) + (d.getMonth() === 11 ? 20 : 0)) * f); // December costs more
  const open = hash(type + k) > 0.12;  // some nights already sold, so the calendar shows closed days
  return { date: k, available: open ? 1 : 0, member, public: round2(member * (1 + PUBLIC_MARKUP)), minStay: 1, noArrival: false, noDeparture: false };
}
function sampleCalendar(type: SuiteType, from: Date, to: Date) {
  const days: ApiDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(sampleNight(type, d));
  return { days };
}
function sampleAvailability(checkIn: string, checkOut: string, guests: number): ApiAvailability {
  const a = fromIso(checkIn)!, b = fromIso(checkOut)!;
  const n = countNights(a, b);
  const extraBed = guests > 4 ? 60 * n : 0;
  const until = iso(addDays(a, -7));
  const types = (['boutique', 'premium', 'standard'] as SuiteType[]).map((type): ApiType => {
    let free = 1;
    const options = ([['flexible', 'Flexible', 1], ['nonref', 'Non-refundable', 0.9]] as const).map(([plan, name, f]): ApiOption => {
      const nightly = Array.from({ length: n }, (_, i) => sampleNight(type, addDays(a, i), f));
      if (nightly.some((x) => !x.available)) free = 0;
      const ns = nightly.map((x) => ({ date: x.date, member: x.member!, public: x.public! }));
      return { plan, name, refundable: plan === 'flexible', bookable: true, why: null, nightly: ns, extraBed,
        memberTotal: round2(sum(ns, 'member') + extraBed), publicTotal: round2(sum(ns, 'public') + extraBed),
        freeCancelUntil: plan === 'flexible' && until > iso(todayKL()) ? until : null };
    });
    return { type, available: free > 0, freeUnits: free, plan: 'flexible', options };
  });
  return { checkIn, checkOut, nights: n, guests, types, notes: {
    tourismTax: 'Malaysia charges a tourism tax of RM10 per room per night to guests who are not Malaysian. It is paid at check-in and is not included in the price.',
    cancellation: 'Free cancellation until 7 days before arrival.',
    nonRefundable: 'Non-refundable: the lower price cannot be refunded if you cancel or change your dates.',
  } };
}
