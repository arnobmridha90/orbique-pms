// The confirmation page: the stay comes back from this tab (checkout kept it before payment), and a calendar file.
import { BOOKED_KEY, type Booked } from '@shared/lib/api';
import { fmtLong, fromIso, iso } from '@shared/lib/dates';

const NAMES: Record<string, string> = { standard: 'Standard Suite', boutique: 'Boutique Suite', premium: 'Premium Suite' };

export function init(root: HTMLElement) {
  const $ = (s: string) => root.querySelector<HTMLElement>(s)!;
  let k: Partial<Booked> = {};
  try { k = JSON.parse(sessionStorage.getItem(BOOKED_KEY) || '{}') as Partial<Booked>; } catch { /* private mode: a plain confirmation */ }
  const ref = String(k.ref || '').replace(/[^A-Z0-9-]/gi, '').slice(0, 32);
  const a = fromIso(k.in), b = fromIso(k.out);
  const suite = NAMES[k.type || ''] ?? 'Your suite';
  const guests = Math.min(5, Math.max(1, Number(k.guests) || 2));
  const first = String(k.name || '').trim().split(/\s+/)[0]?.slice(0, 40);
  const test = new URLSearchParams(location.search).get('test') === '1' || !!k.test;

  $('[data-bc-h]').textContent = test ? `Test booking made${first ? `, ${first}` : ''}.` : `You're booked${first ? `, ${first}` : ''}.`;
  if (test) $('[data-bc-k]').textContent = 'Test booking';
  $('[data-bc-test]').hidden = !test;
  $('[data-bc-ref]').textContent = ref || '—';
  $('[data-bc-suite]').textContent = `${suite}, Kozi @ Vortex KLCC`;
  $('[data-bc-in]').textContent = a ? fmtLong(a) : '—';
  $('[data-bc-out]').textContent = b ? fmtLong(b) : '—';
  $('[data-bc-guests]').textContent = k.guests ? `${guests} guest${guests > 1 ? 's' : ''}` : '—';

  root.querySelector('[data-bc-copy]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    try { await navigator.clipboard.writeText(ref); btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = 'Copy'), 1600); } catch { /* not allowed */ }
  });

  root.querySelector('[data-bc-ics]')?.addEventListener('click', () => {
    if (!a || !b) return;
    const d = (x: Date) => iso(x).replace(/-/g, '');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kozi//Booking//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      `UID:${ref || stamp}@staykozi.com`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d(a)}`, `DTEND;VALUE=DATE:${d(b)}`,
      `SUMMARY:Kozi @ Vortex KLCC\\, ${suite}`, 'LOCATION:Vortex Suites KLCC\\, 56 Jalan Sultan Ismail\\, 50250 Kuala Lumpur',
      `DESCRIPTION:Booking ${ref}. Check in from 3:00 pm\\, check out by 11:00 am. Questions: hello@staykozi.com`,
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `kozi-${ref || 'stay'}.ics` });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
}
