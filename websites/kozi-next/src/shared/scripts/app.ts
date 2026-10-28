// Runs on every page: smooth scrolling, the header, the menu, reveals, the intro,
// the search bars and the live clock in the footer. Page pieces load only where they appear.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import { skyState, skyWords } from '@shared/lib/sun';
import { applySky, cacheSky } from './sky';
import { initSearches } from './search';
import { scroller } from './scroll';

gsap.registerPlugin(ScrollTrigger, SplitText);

export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export let lenis: Lenis | null = null;

export function boot() {
  (window as unknown as { __kozi: boolean }).__kozi = true;
  const root = document.documentElement;
  root.classList.remove('js-late');

  // smooth scroll on real pointers; touch keeps the phone's own scrolling
  if (!reduced() && matchMedia('(pointer: fine)').matches) {
    lenis = new Lenis({ lerp: 0.11, anchors: { offset: -80 }, prevent: (n) => !!(n as HTMLElement).closest?.('[data-lenis-prevent], .s-pop, .menu') });
    scroller.lenis = lenis;
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis!.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  pageSky();
  header();
  menu();
  initSearches();
  footerClock();
  reveals();
  words();

  const hero = document.querySelector<HTMLElement>('[data-hero]');
  const heroReady = hero ? import('./hero').then((m) => m.initHero(hero)) : Promise.resolve(null);
  intro(() => heroReady.then((h) => h?.enter()));
  // heavy sections further down the page start when they come within a screen or so of view
  for (const [sel, load] of [
    ['[data-views]', () => import('./views')],
    ['[data-day]', () => import('./day')],
    ['[data-gallery]', () => import('./gallery')],
    ['[data-way]', () => import('./way')],
  ] as const) {
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => near(el, () => load().then((m) => m.init(el))));
  }
  for (const [sel, load] of [
    ['[data-book]', () => import('./book')],
    ['[data-stays]', () => import('./stays')],
    ['[data-checkout]', () => import('./checkout')],
    ['[data-confirmed]', () => import('./confirmed')],
    ['[data-guide]', () => import('./guide')],
    ['[data-from]', () => import('./from')],
    ['[data-globe]', () => import('./globe')],
    ['[data-country]', () => import('./country')],
  ] as const) {
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => load().then((m) => m.init(el)));
  }
}

/** Run once the element is within about a screen and a half of the viewport (straight away if it already is). */
function near(el: HTMLElement, run: () => void) {
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); run(); } }, { rootMargin: '150% 0px 150% 0px' });
  io.observe(el);
}

/** Inner pages: paint the band at the top with the sky over Kuala Lumpur right now. */
function pageSky() {
  const el = document.querySelector<HTMLElement>('[data-page-hero]');
  if (!el) return;
  const s = skyState();
  const v = applySky(el, s);
  document.documentElement.dataset.ink = s.ink;
  cacheSky(v, s.ink);
}

/** The logo assembles, the sun rises in the O, the paper lifts. Once per visit; skippable. */
function intro(reveal: () => void) {
  const el = document.querySelector<HTMLElement>('[data-intro]');
  if (!el || document.documentElement.classList.contains('no-intro')) { el?.remove(); reveal(); return; }
  lenis?.stop();
  const L = '.intro .logo ';
  let revealed = false;
  const go = () => { if (!revealed) { revealed = true; reveal(); } };
  const tl = gsap.timeline({
    defaults: { overwrite: 'auto' },
    onComplete: () => { el.remove(); lenis?.start(); try { sessionStorage.setItem('kozi-intro', '1'); } catch { /* private mode */ } },
  });
  tl.set(L + '.lg-clip', { attr: { y: 302, height: 0 } })
    .from(L + '.lg-v', { scaleY: 0, transformOrigin: '50% 50%', duration: 0.8, ease: 'expo.inOut' })
    .from(L + '.lg-h', { scaleX: 0, transformOrigin: '50% 50%', duration: 0.8, ease: 'expo.inOut' }, '<0.08')
    .from([L + '.lg-k', L + '.lg-z', L + '.lg-i'], { opacity: 0, yPercent: 14, duration: 0.6, ease: 'power3.out', stagger: 0.08 }, '-=0.38')
    .from(L + '.lg-bar', { scaleX: 0, transformOrigin: '50% 50%', duration: 0.45, ease: 'power2.out' }, '-=0.28')
    .to(L + '.lg-clip', { attr: { y: -4, height: 306 }, duration: 0.95, ease: 'power2.inOut' }, '-=0.05')
    .add(go, '+=0.05')
    .to(el, { clipPath: 'inset(0% 0% 100% 0%)', duration: 1, ease: 'expo.inOut' }, '<')
    .to('.intro-mark', { yPercent: -40, opacity: 0, duration: 0.7, ease: 'power2.inOut' }, '<');
  const skip = () => { go(); tl.progress(1); };
  el.addEventListener('click', skip);
  addEventListener('keydown', skip, { once: true });
}

function header() {
  const hd = document.querySelector<HTMLElement>('[data-hd]');
  if (!hd) return;
  const over = hd.hasAttribute('data-over');
  const hero = document.querySelector<HTMLElement>('[data-hero], [data-page-hero]');
  let lastY = scrollY, ticking = false;
  const update = () => {
    ticking = false;
    const y = scrollY;
    const edge = over && hero ? hero.offsetHeight - hd.offsetHeight - 10 : 8;
    hd.toggleAttribute('data-solid', y > edge || !over);
    const menuOpen = document.documentElement.classList.contains('menu-open');
    const searching = !!document.querySelector('form[data-search][data-open]');
    if (!menuOpen && !searching) hd.toggleAttribute('data-hidden', y > Math.max(edge, 320) && y > lastY + 2);
    if (y < lastY - 2) hd.removeAttribute('data-hidden');
    lastY = y;
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

function menu() {
  const btn = document.querySelector<HTMLButtonElement>('[data-menu-btn]');
  const m = document.querySelector<HTMLElement>('[data-menu]');
  if (!btn || !m) return;
  const set = (on: boolean) => {
    btn.setAttribute('aria-expanded', String(on));
    m.toggleAttribute('data-on', on);
    m.inert = !on;
    document.documentElement.classList.toggle('menu-open', on);
    document.body.style.overflow = on ? 'hidden' : '';
    on ? lenis?.stop() : lenis?.start();
    if (on) m.querySelector<HTMLElement>('a, button')?.focus({ preventScroll: true });
  };
  btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
  m.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('a, button')) set(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && m.hasAttribute('data-on')) { set(false); btn.focus(); } });
}

function footerClock() {
  const all = (k: string) => [...document.querySelectorAll<HTMLElement>(`[data-kl-${k}]`)];
  const clocks = all('clock'), rises = all('rise'), sets = all('set'), lines = all('line');
  if (!clocks.length) return;
  const tick = () => {
    const w = skyWords(skyState());
    clocks.forEach((e) => (e.textContent = w.clock));
    rises.forEach((e) => (e.textContent = w.sunrise));
    sets.forEach((e) => (e.textContent = w.sunset));
    lines.forEach((e) => (e.textContent = w.line));
  };
  tick();
  setTimeout(() => { tick(); setInterval(tick, 60_000); }, 60_000 - (Date.now() % 60_000) + 50);
}

/** Fade-and-rise on scroll for [data-reveal]; big headings with [data-split] rise line by line. */
function reveals() {
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
  if (reduced()) return;
  document.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => {
    const split = SplitText.create(el, { type: 'lines', mask: 'lines', linesClass: 'split-line', autoSplit: true,
      onSplit: (s) => gsap.from(s.lines, { yPercent: 108, duration: 1.15, ease: 'expo.out', stagger: 0.085, scrollTrigger: { trigger: el, start: 'top 86%', once: true } }) });
    void split;
  });
}

/** A sentence that lights up word by word as it scrolls through the screen. */
function words() {
  document.querySelectorAll<HTMLElement>('[data-words]').forEach((el) => {
    if (reduced()) return;
    const s = SplitText.create(el, { type: 'words', wordsClass: 'w' });
    // each word ends in the colour it would have had unsplit: ink, or amber inside the <em>
    gsap.to(s.words, { color: (_: number, w: Element) => getComputedStyle(w.parentElement!).color, ease: 'none', stagger: 0.1,
      scrollTrigger: { trigger: el, start: 'top 78%', end: 'bottom 42%', scrub: true } });
  });
}

export { gsap, ScrollTrigger, SplitText };
