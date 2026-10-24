// "A day at Kozi": scrolling through the section runs the real KL sky from first light to night.
import { SkyGL } from '@shared/lib/sky-gl';
import { atClock, skyState } from '@shared/lib/sun';
import { applySky } from './sky';
import { gsap, reduced } from './app';

const klHour = (d: Date) => (((+d / 3.6e6 + 8) % 24) + 24) % 24; // Malaysia is UTC+8 all year
const fmt = (h: number) => {
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60 / 5) * 5;
  return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`;
};

export function init(sec: HTMLElement) {
  const pin = sec.querySelector<HTMLElement>('.dy-pin')!;
  const gl = new SkyGL(sec.querySelector<HTMLCanvasElement>('canvas[data-day-sky]')!, 0.5);
  const clock = sec.querySelector<HTMLElement>('[data-day-clock]')!;
  const bar = sec.querySelector<HTMLElement>('[data-day-bar]')!;
  const stops = [...sec.querySelectorAll<HTMLElement>('.dy-stop')];
  const shots = [...sec.querySelectorAll<HTMLElement>('.dy-shot')];

  // Each stop gets an equal share of the scroll, and the hours follow today's real sun:
  // first light until 8, morning, afternoon, golden hour around sunset, then night.
  // The clock runs faster through the long middle of the day, like a time-lapse.
  const { sunrise, sunset } = skyState(atClock(12)).times;
  const rise = klHour(sunrise), set = klHour(sunset);
  const H = [rise - 0.45, 8, 12, set - 0.75, set + 0.35, 22.4];
  const n = H.length - 1;
  const hourAt = (p: number) => { const x = Math.min(0.9999, Math.max(0, p)) * n, i = Math.floor(x); return H[i] + (H[i + 1] - H[i]) * (x - i); };
  let last = -1;

  const render = (p: number) => {
    const h = hourAt(p);
    const s = skyState(atClock(h));
    applySky(pin, s);
    sec.dataset.ink = s.ink;
    // the copy sits on the left, so the sun's arc runs through the middle of the sky here,
    // and the moon stays out of the way of the big clock
    const tall = pin.clientWidth < pin.clientHeight; // on a phone the copy fills the top, so the sun keeps lower
    const sun = tall ? { x: 0.2 + (s.sun.x - 0.08) * 0.714, y: 0.3 + (s.sun.y - 0.3) * 0.4 } : { x: 0.44 + (s.sun.x - 0.08) * 0.262, y: s.sun.y };
    gl.set({ ...s, sun: { ...s.sun, ...sun }, moon: { ...s.moon, vis: 0 } });
    clock.textContent = fmt(h);
    bar.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`;
    const k = Math.min(n - 1, Math.floor(Math.max(0, p) * n));
    if (k !== last) {
      last = k;
      stops.forEach((el, i) => el.classList.toggle('on', i === k));
      shots.forEach((el, i) => el.classList.toggle('on', i === k));
    }
  };

  if (reduced()) { render(0.7); return; }
  gl.loop();
  const st = { p: 0 };
  render(0);
  gsap.to(st, { p: 1, ease: 'none', onUpdate: () => render(st.p), scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: 0.6 } });
}
