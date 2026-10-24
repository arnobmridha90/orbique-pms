// The live hero: paints the real KL sky now and every minute, lets guests preview the view
// at sunrise, midday, golden hour or night, and brings the skyline up on arrival.
import { SkyGL } from '@shared/lib/sky-gl';
import { atClock, skyState, skyWords, type SkyState } from '@shared/lib/sun';
import { applySky, cacheSky, moonName } from './sky';
import { gsap, reduced, ScrollTrigger, SplitText } from './app';

type At = 'now' | 'sunrise' | 'midday' | 'golden' | 'night';
const klHour = (d: Date) => { const [h, m] = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }).split(':').map(Number); return h + m / 60; };
const fmt = (d: Date) => d.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kuala_Lumpur' }).toLowerCase();

export function initHero(hero: HTMLElement) {
  const root = document.documentElement;
  const q = <T extends Element = HTMLElement>(s: string) => hero.querySelector<T>(s)!;
  // the shader sky starts once the page has painted; until then the CSS sky, in the same colours, shows
  let gl: SkyGL | null = null, last: SkyState | null = null;
  const startGL = () => {
    gl = new SkyGL(q<HTMLCanvasElement>('canvas[data-sky]'));
    if (!gl.ok) { hero.classList.add('no-gl'); return; }
    if (last) gl.set(last);
    gl.loop();
    hero.classList.add('gl-on');
  };
  if ('requestIdleCallback' in window) requestIdleCallback(startGL, { timeout: 800 }); else setTimeout(startGL, 120);
  const el = { greet: q('[data-greet]'), line: q('[data-line]'), clock: q('[data-clock]'), liveK: q('[data-live-k]'), rise: q('[data-rise]'), set: q('[data-set]'), moon: q('[data-moon]') };
  const chips = [...hero.querySelectorAll<HTMLButtonElement>('[data-at]')];

  let shown = klHour(new Date()); // the KL clock hour on screen (decimal; may run past 24 while previewing)
  let at: At = 'now';
  let tween: gsap.core.Tween | null = null;

  const paint = (s: SkyState) => { const v = applySky(hero, s); root.dataset.ink = s.ink; last = s; gl?.set(s); return v; };

  function live() {
    const s = skyState();
    const v = paint(s);
    cacheSky(v, s.ink);
    const w = skyWords(s);
    if (el.greet.textContent !== w.greet && !hero.classList.contains('entering')) el.greet.textContent = w.greet;
    el.line.textContent = w.line;
    el.clock.textContent = w.clock;
    el.rise.textContent = w.sunrise; el.set.textContent = w.sunset;
    el.moon.textContent = `${moonName(s.moon.phase)}, ${Math.round(s.moon.fraction * 100)}%`;
    shown = klHour(s.date);
  }

  // previews: where on today's KL clock each one sits
  const target = (a: At) => {
    const t = skyState(atClock(12)).times;
    if (a === 'sunrise') return klHour(t.sunrise) + 0.1;
    if (a === 'midday') return 13;
    if (a === 'golden') return klHour(t.sunset) - 0.42;
    if (a === 'night') return 21.5;
    return klHour(new Date());
  };
  const previewLine = (a: At) => {
    const t = skyState(atClock(12)).times;
    if (a === 'sunrise') return `Sunrise over the city at ${fmt(t.sunrise)}.`;
    if (a === 'midday') return 'Midday in the Golden Triangle, between KLCC and Bukit Bintang.';
    if (a === 'golden') return `Golden hour, then sunset at ${fmt(t.sunset)}.`;
    return 'After dark, the Petronas Twin Towers light up.';
  };

  function go(a: At) {
    at = a;
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.at === a)));
    hero.toggleAttribute('data-preview', a !== 'now');
    el.liveK.textContent = a === 'now' ? 'Live' : 'Preview';
    let to = target(a);
    const from = shown % 24;
    if (to < from) to += 24; // always move forward through the day, like the real sky
    const base = atClock(0);
    const dur = reduced() ? 0 : Math.min(2.4, 0.9 + (to - from) * 0.09);
    tween?.kill();
    const p = { h: from };
    tween = gsap.to(p, {
      h: to, duration: dur, ease: 'power2.inOut',
      onUpdate: () => {
        const d = new Date(+base + p.h * 3.6e6);
        paint(skyState(d));
        el.clock.textContent = fmt(d);
      },
      onComplete: () => {
        shown = to % 24;
        if (a === 'now') live(); else el.line.textContent = previewLine(a);
      },
    });
    if (a !== 'now') swapLine(previewLine(a));
  }
  function swapLine(text: string) {
    if (reduced()) { el.line.textContent = text; return; }
    gsap.timeline().to(el.line, { opacity: 0, y: -6, duration: 0.18, ease: 'power2.out' })
      .add(() => { el.line.textContent = text; }).fromTo(el.line, { opacity: 0, y: 8 }, { opacity: 0.88, y: 0, duration: 0.32, ease: 'power3.out' });
  }
  chips.forEach((c) => c.addEventListener('click', () => go(c.dataset.at as At)));

  live();
  // keep time with the real clock, on the minute
  setTimeout(() => { if (at === 'now') live(); setInterval(() => { if (at === 'now' && !tween?.isActive()) live(); }, 60_000); }, 60_000 - (Date.now() % 60_000) + 80);

  // parallax as the hero leaves: far layers drift slower than near ones, the sky slowest
  if (!reduced()) {
    const st = { trigger: hero, start: 'top top', end: 'bottom top', scrub: true } as ScrollTrigger.Vars;
    [22, 17, 12, 7, 2].forEach((d, i) => gsap.to(hero.querySelector(`.sk-layer${i}`), { yPercent: d, ease: 'none', scrollTrigger: st }));
    gsap.to(q('.hero-sky'), { yPercent: 30, ease: 'none', scrollTrigger: st });
    gsap.to(q('.hero-copy'), { yPercent: -18, ease: 'none', scrollTrigger: st });
  }

  /** Arrival: the headline rises line by line, the city comes up behind it, our window appears. */
  function enter() {
    if (reduced()) { hero.classList.add('entered'); gsap.set(hero.querySelectorAll('[data-enter], .hero-h, .sk-layer, .kozi-pin'), { opacity: 1 }); return; }
    hero.classList.add('entering');
    const h1 = q('.hero-h');
    const split = SplitText.create([el.greet, q('[data-city-name]')], { type: 'lines', mask: 'lines', linesClass: 'split-line', aria: 'none' }); // lines read fine as they are
    gsap.set(h1, { opacity: 1 });
    const tl = gsap.timeline({ onComplete: () => { split.revert(); hero.classList.remove('entering'); hero.classList.add('entered'); } });
    tl.from(split.lines, { yPercent: 110, duration: 1.25, ease: 'expo.out', stagger: 0.09 }, 0)
      .fromTo(hero.querySelectorAll('.sk-layer'), { opacity: 1, y: (i: number) => 40 + i * 26 }, { y: 0, duration: 1.8, ease: 'expo.out', stagger: 0.06 }, 0.05)
      .fromTo(hero.querySelectorAll('[data-enter]'), { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 1, ease: 'power3.out', stagger: 0.08 }, 0.35)
      .fromTo(q('.kozi-pin'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' }, 1.1)
      .from(q('.kp-line'), { scaleY: 0, duration: 0.7, ease: 'expo.out' }, 1.1);
  }
  return { enter };
}
