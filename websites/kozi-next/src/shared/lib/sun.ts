// The live sky: where the sun and moon are over a Kozi city right now, the colours of that sky,
// and the words we show for it. Runs in the browser (and at build time for the first paint).
import * as SunCalc from 'suncalc'; // v2: degrees in and out, and a civil day when given the UTC offset

export type City = { name: string; lat: number; lon: number; tz: string; utc: number };
export const KL: City = { name: 'Kuala Lumpur', lat: 3.151, lon: 101.706, tz: 'Asia/Kuala_Lumpur', utc: 480 }; // utc: minutes east of UTC

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const css = (c: RGB) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;

// Art-directed sky by sun altitude (degrees). Day sits in Kozi cream haze rather than a stock blue;
// sunset runs through amber and coral; night is a deep ink blue.
// zen = top of sky, hor = horizon, glow = light around the sun, sk = skyline layers far -> near.
const STOPS: { alt: number; zen: string; hor: string; glow: string; g: number; stars: number; sk: string[]; lit: number }[] = [
  { alt: -90, zen: '#070914', hor: '#141a33', glow: '#2a3361', g: 0.0, stars: 1.0, sk: ['#1b2240', '#161c36', '#11172c', '#0d1222', '#0a0d18'], lit: 1 },
  { alt: -14, zen: '#0a0e22', hor: '#1d2650', glow: '#3a4a86', g: 0.12, stars: 0.9, sk: ['#222b52', '#1b2346', '#151c3a', '#10162d', '#0b0f1e'], lit: 1 },
  { alt: -7, zen: '#17204a', hor: '#4b5390', glow: '#c98490', g: 0.35, stars: 0.4, sk: ['#3a4377', '#2e3666', '#232a54', '#1a1f40', '#12152a'], lit: 0.9 },
  { alt: -2.5, zen: '#2f3a72', hor: '#e08a6a', glow: '#f2a65a', g: 0.75, stars: 0.06, sk: ['#a1708a', '#7f5a78', '#5c4565', '#3c2f4a', '#231b2c'], lit: 0.6 },
  { alt: 1, zen: '#4b5f98', hor: '#f3ad72', glow: '#f7b860', g: 0.95, stars: 0, sk: ['#d89a85', '#b57c78', '#8a626b', '#57434f', '#2b2226'], lit: 0.3 },
  { alt: 5, zen: '#6d86b8', hor: '#f6cc93', glow: '#ffd79c', g: 0.75, stars: 0, sk: ['#dcb79e', '#bf9a8a', '#937a78', '#5e5059', '#2b2622'], lit: 0.08 },
  { alt: 12, zen: '#7fa1c8', hor: '#efdcc0', glow: '#ffe8c2', g: 0.5, stars: 0, sk: ['#c9c3bd', '#ada9a8', '#8b8b90', '#5d5f68', '#2b2622'], lit: 0 },
  { alt: 30, zen: '#83a8cd', hor: '#eee3d0', glow: '#fff1da', g: 0.35, stars: 0, sk: ['#cfcac2', '#b2b0ac', '#8f9196', '#5f636c', '#2b2622'], lit: 0 },
  { alt: 90, zen: '#7ea6cf', hor: '#efe6d6', glow: '#fff6e8', g: 0.3, stars: 0, sk: ['#d3cec6', '#b5b4b0', '#93959a', '#61656e', '#2b2622'], lit: 0 },
];

export type SkyState = {
  date: Date; alt: number; rising: boolean;
  zen: RGB; hor: RGB; glow: RGB; glowAmt: number; stars: number; sk: string[]; lit: number; dark: number;
  sun: { x: number; y: number; vis: number };
  moon: { x: number; y: number; vis: number; fraction: number; waxing: boolean; phase: number };
  ink: 'light' | 'dark'; bg: RGB;
  times: { sunrise: Date; sunset: Date; goldenHour: Date; dawn: Date; dusk: Date };
};

const HORIZON = 0.3; // horizon height in the hero, as a fraction from the bottom
const CREAM: RGB = hex('#f6efe4'), INK: RGB = hex('#2b2622');
const lum = (c: RGB) => { const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
export const contrast = (a: RGB, b: RGB) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

function arcX(now: number, rise: number, set: number) {
  // 0.08 at rise, 0.92 at set; past either end the body is below the horizon anyway
  return 0.08 + 0.84 * Math.min(1.1, Math.max(-0.1, (now - rise) / (set - rise)));
}

export function skyState(date = new Date(), city: City = KL): SkyState {
  const pos = SunCalc.getPosition(date, city.lat, city.lon);
  const alt = pos.altitude;
  const t = dayTimes(date, city);
  const later = SunCalc.getPosition(new Date(+date + 6e5), city.lat, city.lon);
  const rising = later.altitude > pos.altitude;

  let i = 0;
  while (i < STOPS.length - 2 && alt > STOPS[i + 1].alt) i++;
  const a = STOPS[i], b = STOPS[i + 1];
  const k = Math.min(1, Math.max(0, (alt - a.alt) / (b.alt - a.alt)));
  const sk = a.sk.map((c, j) => css(mix(hex(c), hex(b.sk[j]), k)));

  // The sun's path: rises on the left, sets on the right, height from its real altitude.
  // Which day's rise/set to use depends on whether we're before sunrise, in the day or after sunset.
  const rise = +t.sunrise, set = +t.sunset, now = +date;
  const sunX = now < rise ? 0.08 - 0.07 * Math.min(1, (rise - now) / 72e5)
    : now > set ? 0.92 + 0.07 * Math.min(1, (now - set) / 72e5) : arcX(now, rise, set);
  const sunY = HORIZON + Math.sin((Math.max(-15, alt) * Math.PI) / 180) * (0.92 - HORIZON) * 0.92;

  const mp = SunCalc.getMoonPosition(date, city.lat, city.lon);
  const mi = SunCalc.getMoonIllumination(date);
  const mt = SunCalc.getMoonTimes(date, city.lat, city.lon, city.utc);
  const malt = mp.altitude;
  let mx = 0.5;
  if (mt.rise && mt.set) {
    let r = +mt.rise, s = +mt.set;
    if (s < r) { if (+date < s) r -= 864e5 * 1.035; else s += 864e5 * 1.035; }
    mx = arcX(+date, r, s);
  } else mx = 0.3 + ((+date / 864e5) % 1) * 0.4;
  const moonY = HORIZON + Math.sin((Math.max(-10, malt) * Math.PI) / 180) * (0.92 - HORIZON) * 0.92;

  const dark = Math.min(1, Math.max(0, (2 - alt) / 10)); // 0 in daylight, 1 once the sun is 8 degrees down
  // the sky behind the headline (about two-thirds of the way up the gradient) decides the text colour
  const zen = mix(hex(a.zen), hex(b.zen), k), hor = mix(hex(a.hor), hex(b.hor), k);
  const bg = mix(hor, zen, 0.72);
  return {
    date, alt, rising,
    zen, hor, glow: mix(hex(a.glow), hex(b.glow), k),
    glowAmt: a.g + (b.g - a.g) * k, stars: a.stars + (b.stars - a.stars) * k, sk, lit: a.lit + (b.lit - a.lit) * k, dark,
    sun: { x: sunX, y: sunY, vis: Math.min(1, Math.max(0, (alt + 1.2) / 2)) },
    moon: { x: mx, y: moonY, vis: Math.min(1, Math.max(0, malt / 3)) * Math.min(1, dark * 1.4 + 0.15), fraction: mi.fraction, waxing: mi.waxing, phase: mi.phase },
    ink: contrast(bg, CREAM) > contrast(bg, INK) ? 'light' : 'dark', bg,
    times: { sunrise: t.sunrise, sunset: t.sunset, goldenHour: t.goldenHour, dawn: t.dawn, dusk: t.dusk },
  };
}

/** Sun times for the city's own calendar day (near the equator every event happens every day). */
function dayTimes(date: Date, city: City) {
  const t = SunCalc.getTimes(date, city.lat, city.lon, 0, city.utc);
  return { sunrise: t.sunrise!, sunset: t.sunset!, goldenHour: t.goldenHour!, dawn: t.dawn!, dusk: t.dusk! };
}

const fmtTime = (d: Date, tz: string) => d.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).replace(' ', ' ').toLowerCase();
const inMin = (a: Date, b: Date) => Math.round((+b - +a) / 6e4);
const span = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

/** The live words: clock, greeting and one true line about the sky right now. */
export function skyWords(s: SkyState, city: City = KL) {
  const tz = city.tz, now = s.date;
  const hour = +now.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: tz });
  const greet = hour < 5 ? 'Late night in' : hour < 12 ? 'Good morning from' : hour < 18 ? 'Good afternoon from' : 'Good evening from';
  const tom = dayTimes(new Date(+now + 864e5), city);
  const nextRise = +now < +s.times.sunrise ? s.times.sunrise : tom.sunrise;
  let line: string;
  if (s.alt < -6) line = s.rising || hour < 6 ? `The city is quiet. Sunrise is at ${fmtTime(nextRise, tz)}.` : 'The city lights are on and the night is young.';
  else if (s.alt < -0.8) line = s.rising ? `First light. Sunrise in ${span(Math.max(1, inMin(now, s.times.sunrise)))}.` : 'Blue hour. The city lights are coming on.';
  else if (s.alt < 6) line = s.rising ? 'The sun is coming up over the city.' : `Golden hour. Sunset in ${span(Math.max(1, inMin(now, s.times.sunset)))}.`;
  else if (s.rising && hour < 12) line = `Slow breakfast, city view. Sunset tonight is at ${fmtTime(s.times.sunset, tz)}.`;
  else line = `Golden hour starts at ${fmtTime(s.times.goldenHour, tz)}.`;
  return { clock: fmtTime(now, tz), greet, line, sunrise: fmtTime(nextRise, tz), sunset: fmtTime(s.times.sunset, tz) };
}

/** A sky at a given KL clock time today (used by the 24-hour scroll story). */
export function atClock(hours: number, city: City = KL, base = new Date()) {
  const ymd = base.toLocaleDateString('en-CA', { timeZone: city.tz }); // YYYY-MM-DD in the city
  const offset = city.utc / 60; // Malaysia has no daylight saving; UTC+8 all year
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0) + (hours - offset) * 3.6e6);
}

/** Where on Earth the sun is overhead right now, as [longitude, latitude] in degrees
 *  (the usual low-precision solar formulas: good to a fraction of a degree). */
export function subsolar(date = new Date()): [number, number] {
  const rad = Math.PI / 180;
  const d = date.getTime() / 864e5 - 10957.5; // days since noon UTC on 1 January 2000
  const g = (357.529 + 0.98560028 * d) * rad; // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * rad; // tilt of the Earth's axis
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / rad;
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24; // sidereal time at Greenwich, hours
  const lon = ((((ra - gmst * 15 + 180) % 360) + 360) % 360) - 180;
  return [lon, dec / rad];
}
