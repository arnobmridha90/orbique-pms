// The confirmation page. Back from Stripe, it asks Orbique whether the stay is paid (Stripe tells Orbique a few seconds
// after the guest lands here, so it asks again until then) and shows the stay as Orbique has it. The guest's first
// name, and the whole stay in test mode, come back from this tab (checkout kept them before payment). And a calendar file.
import { BOOKED_KEY, bookingStatus, rm, TEST_MODE, type Booked, type BookingStatus } from '@shared/lib/api';
import { fmtDayYear, fmtLong, fromIso, iso } from '@shared/lib/dates';

const NAMES: Record<string, string> = { standard: 'Standard Suite', boutique: 'Boutique Suite', premium: 'Premium Suite' };
const PLANS: Record<string, string> = { flexible: 'Flexible', weekly: 'Weekly stay', nonref: 'Non-refundable' };
// seconds before each new question while the payment is still being confirmed: quick at first, about four minutes in all
const AGAIN = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 30, 30, 30, 30];
const SLOW = 8; // after this many questions (about 25 seconds) the page says it is taking longer than usual

type Stay = { ref: string; type: string; in: string; out: string; guests: number; total: number; plan: string | null; refundable: boolean; freeCancelUntil: string | null };

export function init(root: HTMLElement) {
  const $ = (s: string) => root.querySelector<HTMLElement>(s)!;
  let k: Partial<Booked> = {};
  try { k = JSON.parse(sessionStorage.getItem(BOOKED_KEY) || '{}') as Partial<Booked>; } catch { /* private mode: Orbique's answer still fills the page */ }
  const first = String(k.name || '').trim().split(/\s+/)[0]?.slice(0, 40);
  const hi = (s: string) => `${s}${first ? `, ${first}` : ''}.`;
  const q = new URLSearchParams(location.search);
  const test = q.get('test') === '1' || !!k.test;
  const session = q.get('session_id') || '';
  const email = root.dataset.email!;
  let stay: Stay = { ref: k.ref || '', type: k.type || '', in: k.in || '', out: k.out || '', guests: Number(k.guests) || 0, total: 0, plan: null, refundable: true, freeCancelUntil: null };
  const ref = () => String(stay.ref).replace(/[^A-Z0-9-]/gi, '').slice(0, 32);

  function say(eyebrow: string, heading: string, ...status: (string | Node)[]) {
    $('[data-bc-k]').textContent = eyebrow;
    $('[data-bc-h]').textContent = heading;
    $('[data-bc-status]').replaceChildren(...status);
  }
  const mail = () => Object.assign(document.createElement('a'), { href: `mailto:${email}`, textContent: email });

  // paid: true or false once Orbique has answered (it says what was paid and on which terms), null before
  function fill(paid: boolean | null) {
    const a = fromIso(stay.in), b = fromIso(stay.out), g = Math.min(5, Math.max(1, stay.guests));
    $('[data-bc-ref]').textContent = ref() || '—';
    $('[data-bc-suite]').textContent = `${NAMES[stay.type] ?? 'Your suite'}, Kozi @ Vortex KLCC`;
    $('[data-bc-in]').textContent = a ? fmtLong(a) : '—';
    $('[data-bc-out]').textContent = b ? fmtLong(b) : '—';
    $('[data-bc-guests]').textContent = stay.guests ? `${g} guest${g > 1 ? 's' : ''}${g > 4 ? ' (one on the extra bed)' : ''}` : '—';
    $('[data-bc-paid-row]').hidden = paid === null || !(stay.total > 0);
    $('[data-bc-paid-k]').textContent = paid ? 'Paid' : 'Total';
    $('[data-bc-paid]').textContent = rm(stay.total);
    $('[data-bc-rate-row]').hidden = paid === null;
    $('[data-bc-rate]').textContent = (stay.plan && PLANS[stay.plan]) || (stay.refundable ? 'Flexible' : 'Non-refundable');
    const until = fromIso(stay.freeCancelUntil);
    $('[data-bc-terms]').textContent = !stay.refundable ? 'Not refundable if you cancel or change your dates.'
      : until ? `Free cancellation until ${fmtDayYear(until)}.` : 'Your arrival is too close for free cancellation.';
  }

  const unknown = () => say('Your booking', hi('Thank you'),
    "We couldn't check your booking just now. Please refresh this page in a minute, or email ", mail(), ' from the address you booked with.');

  let tries = 0;
  async function ask() {
    let r: BookingStatus | null = null, gone = false;
    try { r = await bookingStatus(session); } catch (e) { gone = (e as { code?: string }).code === 'no-booking'; }
    if (r) {
      stay = { ref: r.bookingId, type: r.type ?? stay.type, in: r.checkIn, out: r.checkOut, guests: r.guests, total: r.total, plan: r.plan, refundable: r.refundable, freeCancelUntil: r.freeCancelUntil };
      if (r.status === 'cancelled') {
        root.classList.remove('is-wait'); root.classList.add('is-off');
        fill(null);
        $('[data-bc-next]').hidden = true;
        $('[data-bc-again]').hidden = false;
        return say('Booking cancelled', 'This booking was cancelled.',
          'It is no longer held for you. If you were charged, email ', mail(), ' with your reference and we will sort it out straight away.');
      }
      fill(r.status === 'paid');
      if (r.status === 'paid') {
        root.classList.remove('is-wait');
        return say('Booking confirmed', hi("You're booked"), 'Your payment went through and your stay is confirmed.');
      }
    }
    if (gone || tries >= AGAIN.length) {
      root.classList.remove('is-wait');
      // still waiting after four minutes: the stay is on the page, the guest just can't see it confirmed yet
      return r ? say('Confirming your booking', 'Almost there.', "Your payment is still being confirmed. Please refresh this page in a few minutes, or email ", mail(), ' with your reference.') : unknown();
    }
    if (tries === SLOW) say('Confirming your booking', 'One moment.', 'This is taking a little longer than usual. Please keep this page open.');
    setTimeout(ask, AGAIN[tries++] * 1000);
  }

  fill(null);
  if (test) {
    say('Test booking', hi('Test booking made'));
    $('[data-bc-test]').hidden = false;
  } else if (!TEST_MODE) {
    if (/^cs_[A-Za-z0-9_]{1,200}$/.test(session)) {
      root.classList.add('is-wait');
      say('Confirming your booking', 'One moment.', 'Your payment is going through. This takes a few seconds.');
      ask();
    } else unknown();
  }

  root.querySelector('[data-bc-copy]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    try { await navigator.clipboard.writeText(ref()); btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = 'Copy'), 1600); } catch { /* not allowed */ }
  });

  root.querySelector('[data-bc-ics]')?.addEventListener('click', () => {
    const a = fromIso(stay.in), b = fromIso(stay.out);
    if (!a || !b) return;
    const d = (x: Date) => iso(x).replace(/-/g, '');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const suite = NAMES[stay.type] ?? 'Your suite';
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kozi//Booking//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      `UID:${ref() || stamp}@staykozi.com`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d(a)}`, `DTEND;VALUE=DATE:${d(b)}`,
      `SUMMARY:Kozi @ Vortex KLCC\\, ${suite}`, 'LOCATION:Vortex Suites KLCC\\, 56 Jalan Sultan Ismail\\, 50250 Kuala Lumpur',
      `DESCRIPTION:Booking ${ref()}. Check in from 3:00 pm\\, check out by 11:00 am. Questions: ${email}`,
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `kozi-${ref() || 'stay'}.ics` });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
}
