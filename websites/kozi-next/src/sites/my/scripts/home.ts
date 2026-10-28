// The home page's choreography: the camera follows the chapters as they scroll by, the ring of photos turns with the
// scroll and with drags, and "A day at Kozi" runs its clock while the city's sky follows. All of it is torn down when
// the next page comes in (the router keeps the city, not this page).
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import * as city from './city';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function init(root: HTMLElement) {
  const off = new AbortController();
  const signal = off.signal;
  const stops: (() => void)[] = [];
  document.addEventListener('astro:before-swap', () => { off.abort(); stops.forEach((f) => f()); }, { once: true });

  // the "drag the city" hint only once there is a city to drag
  void city.ready.then((ok) => { const h = root.querySelector<HTMLElement>('[data-city-hint]'); if (h) h.hidden = !ok; });

  // the camera follows the chapters
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) city.fly((e.target as HTMLElement).dataset.cam!); }), { rootMargin: '-45% 0px -45% 0px' });
  root.querySelectorAll<HTMLElement>('[data-cam]').forEach((el) => io.observe(el));
  stops.push(() => io.disconnect());

  ring(root, signal, stops);
  day(root, stops);
}

/** A ring of real photos that turns with the scroll and with drags; a tap opens the photo (shared/scripts/gallery.ts). */
function ring(root: HTMLElement, signal: AbortSignal, stops: (() => void)[]) {
  const sec = root.querySelector<HTMLElement>('[data-ring]');
  if (!sec) return;
  const el = sec.querySelector<HTMLElement>('[data-ring-el]')!, stage = sec.querySelector<HTMLElement>('[data-ring-stage]')!;
  const items = [...el.children] as HTMLElement[];
  let r = 0, rot = 0, dragged = 0, shown = 0, moved = false, drag: { x: number; d: number } | null = null;
  const build = () => {
    const n = items.length, w = innerWidth < 700 ? 150 : 240, h = Math.round(w * 1.3);
    r = Math.round((w + 18) / (2 * Math.tan(Math.PI / n)));
    el.style.setProperty('--w', `${w}px`); el.style.setProperty('--h', `${h}px`);
    items.forEach((b, i) => { b.style.transform = `rotateY(${(360 / n) * i}deg) translateZ(${r}px)`; });
  };
  build();
  addEventListener('resize', build, { signal });
  stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, d: dragged }; moved = false; }, { signal });
  addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 6) moved = true; dragged = drag.d + dx * 0.25; }, { signal });
  addEventListener('pointerup', () => { drag = null; setTimeout(() => { moved = false; }, 0); }, { signal });
  // a drag is not a tap: keep the photo closed
  stage.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); } }, { capture: true, signal });
  const tick = () => {
    const t = rot + dragged + (reduced() ? 0 : performance.now() * 0.004);
    shown += (t - shown) * 0.08;
    el.style.transform = `translateZ(-${r}px) rotateX(-6deg) rotateY(${-shown}deg)`;
  };
  gsap.ticker.add(tick);
  stops.push(() => gsap.ticker.remove(tick));
  if (reduced()) return;
  ScrollTrigger.create({ trigger: sec, start: 'top top', end: '+=150%', pin: true, scrub: true, onUpdate: (st) => { rot = st.progress * 300; } });
  gsap.from(stage, { scale: 0.8, opacity: 0, scrollTrigger: { trigger: sec, start: 'top 85%', end: 'top 25%', scrub: 1 } });
}

/** A day at Kozi: the clock, the words and the photo change with the scroll (or a tap on the bar), and the sky over
 *  the city follows the time of day. */
function day(root: HTMLElement, stops: (() => void)[]) {
  const sec = root.querySelector<HTMLElement>('[data-day]');
  if (!sec) return;
  const steps = [...sec.querySelectorAll<HTMLElement>('[data-step]')];
  const photos = [...sec.querySelectorAll<HTMLImageElement>('.day-photos img')];
  const bars = [...sec.querySelectorAll<HTMLButtonElement>('[data-go]')];
  const n = steps.length;
  let at = -1;
  const sky = (i: number) => { const [d, k] = steps[i].dataset.sky!.split(',').map(Number); city.sky(d, k); };
  const set = (i: number, force = false) => {
    if (i === at && !force) return;
    at = i;
    steps.forEach((s, k) => s.classList.toggle('on', k === i));
    photos.forEach((p, k) => p.classList.toggle('on', k === i));
    bars.forEach((b, k) => b.classList.toggle('on', k <= i));
    sky(i);
    if (!reduced()) gsap.fromTo(steps[i].children, { opacity: 0.2, y: 14 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', stagger: 0.05 });
  };
  bars.forEach((b) => b.addEventListener('click', () => set(Number(b.dataset.go))));
  stops.push(() => city.sky(0, 0, 1));
  if (reduced()) {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) sky(Math.max(0, at)); else city.sky(0, 0); }, { threshold: 0.3 });
    io.observe(sec); stops.push(() => io.disconnect());
    set(0);
    return;
  }
  at = 0;
  ScrollTrigger.create({
    trigger: sec, start: 'top top', end: `+=${n * 70}%`, pin: true,
    onEnter: () => set(Math.max(0, at), true), onEnterBack: () => set(at, true),
    onLeave: () => city.sky(0, 0), onLeaveBack: () => city.sky(0, 0),
    onUpdate: (st) => set(Math.min(n - 1, Math.floor(st.progress * n))),
  });
}
