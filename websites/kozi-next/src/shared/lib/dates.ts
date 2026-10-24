// Stay dates are plain calendar dates ("2026-11-03"), never times, so a guest in any time zone
// picks the same nights. "Today" is today in Kuala Lumpur, which is the property's clock.
export const KL_TZ = 'Asia/Kuala_Lumpur';
const pad = (n: number) => String(n).padStart(2, '0');

export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function fromIso(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 ? dt : null;
}
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export const sameDay = (a: Date | null, b: Date | null) => !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const nights = (a: Date, b: Date) => Math.round((+new Date(b.getFullYear(), b.getMonth(), b.getDate()) - +new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);
export function todayKL(): Date {
  return fromIso(new Date().toLocaleDateString('en-CA', { timeZone: KL_TZ }))!;
}

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', o);
const short = fmt({ day: 'numeric', month: 'short' });
const weekdayShort = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const long = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtShort = (d: Date) => short.format(d);            // 3 Nov
export const fmtDay = (d: Date) => weekdayShort.format(d);       // Tue 3 Nov
export const fmtLong = (d: Date) => long.format(d);              // Tuesday 3 November 2026
const dayYear = fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDayYear = (d: Date) => dayYear.format(d);        // Tue 3 Nov 2026
export const fmtMonth = (d: Date) => fmt({ month: 'long', year: 'numeric' }).format(d);
export function fmtRange(a: Date | null, b: Date | null) {
  if (!a) return '';
  if (!b) return fmtShort(a);
  return `${fmtShort(a)} – ${fmtShort(b)}`;
}
