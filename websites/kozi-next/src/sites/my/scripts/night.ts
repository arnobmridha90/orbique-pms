// Runs once per visit on the Malaysia site, and sets up each page as Astro's ClientRouter swaps it in (astro:page-load):
// the city's camera and pins for the page, the header and menu, reveals, the logo, and the page's own pieces, which
// load only where they appear. The intro plays on the first visit to the home page; the 3D city is built once, after
// the page has painted and gone idle (scripts/city.ts), and stays behind every page after that.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { navigate } from 'astro:transitions/client';
import * as city from './city';
import { animateLogo, sunrise } from './logo';

gsap.registerPlugin(ScrollTrigger, SplitText);
// in development, tests can reach GSAP (to turn off lag smoothing under a software renderer)
if (import.meta.env.DEV) (window as unknown as { gsap: typeof gsap }).gsap = gsap;
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;
const seen = () => { try { return !!sessionStorage.getItem('kozi-intro'); } catch { return true; } };

/** The classes the first paint set on <html> (the router swaps its attributes for the new page's). */
function marks() {
  root.classList.add('js');
  root.classList.toggle('rm', reduced());
  if (reduced() || seen()) root.classList.add('no-intro');
}
(window as unknown as { __kozi: boolean }).__kozi = true;
marks();

let first = true;
let introDone: Promise<void> = Promise.resolve();
let pageCtx: gsap.Context | null = null;
// listeners that belong to one page are dropped when the next page comes in
let page = new AbortController();
const on = { get signal() { return page.signal; } };

document.addEventListener('astro:after-swap', marks);
document.addEventListener('astro:before-swap', () => {
  pageCtx?.revert(); pageCtx = null;
  page.abort(); page = new AbortController();
  ScrollTrigger.getAll().forEach((t) => t.kill());
  root.classList.remove('menu-open');
});
document.addEventListener('astro:page-load', () => {
  const main = document.querySelector<HTMLElement>('main')!;
  const d = main.dataset;
  root.classList.toggle('dim', d.dim !== undefined);
  city.setPage({ cam: d.cam || 'aerial', pins: (d.pins as city.Pins) || 'off', hi: d.hi ? d.hi.split(',').map(Number) : null, touch: d.touch !== undefined });
  pageCtx = gsap.context(() => {
    header(); menu(); reveals(); logos(); floors(); tilt(); copy();
  });
  if (first) {
    first = false;
    introDone = intro();
    const go = () => { void city.start(introDone); };
    const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(go, { timeout: 2500 }) : setTimeout(go, 600));
    if (document.readyState === 'complete') idle(); else addEventListener('load', idle, { once: true });
  } else {
    document.querySelector('[data-intro]')?.remove();
    if (document.querySelector('[data-rise]')) rise(0.15);
  }
  modules();
});

// a tap on a landmark in the city: its view in the view finder, or our building
document.addEventListener('kozi:pick', (e) => {
  const id = (e as CustomEvent<{ id: string }>).detail.id;
  const pin = document.querySelector<HTMLAnchorElement>(`[data-pin="${id}"]`);
  if (location.pathname === '/views/' && id !== 'vortex') { location.hash = id; return; }
  if (pin) void navigate(pin.href);
});

/** The page's own pieces, loaded only where they appear. */
function modules() {
  const each = (sel: string, load: () => Promise<{ init: (el: HTMLElement) => void }>) => {
    const els = document.querySelectorAll<HTMLElement>(sel);
    if (els.length) void load().then((m) => els.forEach((el) => m.init(el)));
  };
  each('[data-home]', () => import('./home'));
  each('[data-finder]', () => import('./finder'));
  each('[data-gallery]', () => import('@shared/scripts/gallery'));
  each('[data-book]', () => import('@shared/scripts/book'));
  each('[data-stays]', () => import('@shared/scripts/stays'));
  each('[data-checkout]', () => import('@shared/scripts/checkout'));
  each('[data-confirmed]', () => import('@shared/scripts/confirmed'));
  each('[data-guide]', () => import('@shared/scripts/guide'));
  each('[data-from]', () => import('@shared/scripts/from'));
  if (document.querySelector('form[data-search]')) void import('@shared/scripts/search').then((m) => m.initSearches());
}

/** The logo builds, the words come in, the overlay lifts and the city switches on. Once per visit, home only. */
function intro(): Promise<void> {
  const el = document.querySelector<HTMLElement>('[data-intro]');
  const brand = document.querySelector('[data-brand] [data-logo]');
  if (!el || root.classList.contains('no-intro')) {
    el?.remove();
    if (brand && !reduced()) animateLogo(brand, { speed: 1.3, delay: 0.2 });
    if (document.querySelector('[data-rise]')) rise(0.2);
    return Promise.resolve();
  }
  try { sessionStorage.setItem('kozi-intro', '1'); } catch { /* private mode */ }
  return new Promise((done) => {
    const tag = el.querySelector<HTMLElement>('[data-intro-tag]')!;
    tag.innerHTML = tag.textContent!.split(' ').map((w) => `<span>${w}</span>`).join(' ');
    el.classList.add('go');
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      el.classList.add('gone');
      setTimeout(() => el.remove(), 1200);
      if (brand) animateLogo(brand, { speed: 1.3, delay: 0.2 });
      rise(0.5);
      done();
    };
    const tl = gsap.timeline();
    tl.add(animateLogo(el.querySelector('[data-logo]')!), 0)
      .from(tag.children, { y: 18, opacity: 0, duration: 0.8, stagger: 0.08, ease: 'power3.out' }, 1.2)
      .to(el.firstElementChild, { opacity: 0, y: -14, duration: 0.5, ease: 'power2.in' }, '+=0.4')
      .add(end);
    // a tap or a key skips it
    const skip = () => { tl.kill(); end(); };
    el.addEventListener('click', skip, { once: true });
    addEventListener('keydown', skip, { once: true, signal: on.signal });
  });
}

/** The home headline rises line by line out of its masks. */
function rise(delay: number) {
  if (reduced()) return;
  gsap.from('[data-rise] .l > span', { yPercent: 110, duration: 1.1, stagger: 0.12, ease: 'power4.out', delay });
}

function header() {
  const hd = document.querySelector<HTMLElement>('[data-hd]');
  if (!hd) return;
  const set = () => hd.toggleAttribute('data-solid', scrollY > 24);
  addEventListener('scroll', set, { passive: true, signal: on.signal });
  set();
  const brand = hd.querySelector('[data-brand]');
  brand?.addEventListener('mouseenter', () => { if (!reduced()) sunrise(brand); });
}

function menu() {
  const btn = document.querySelector<HTMLButtonElement>('[data-menu-btn]');
  const nav = document.querySelector<HTMLElement>('[data-nav]');
  if (!btn || !nav) return;
  const set = (on: boolean) => { nav.classList.toggle('open', on); btn.setAttribute('aria-expanded', String(on)); root.classList.toggle('menu-open', on); };
  btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('a')) set(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { set(false); btn.focus(); } }, { signal: on.signal });
}

/** Fade-and-rise as things scroll into view ([data-reveal]); big headings ([data-split]) rise line by line. */
function reveals() {
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { e.target.classList.add('seen'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.12 });
  document.querySelectorAll('main [data-reveal]').forEach((el) => io.observe(el));
  if (reduced()) return;
  document.querySelectorAll<HTMLElement>('main [data-split]').forEach((el) => {
    SplitText.create(el, { type: 'lines', mask: 'lines', linesClass: 'split-line', autoSplit: true,
      onSplit: (s) => gsap.from(s.lines, { yPercent: 108, duration: 1.15, ease: 'expo.out', stagger: 0.085, scrollTrigger: { trigger: el, start: 'top 88%', once: true } }) });
  });
}

/** The footer logo builds itself when it comes into view. */
function logos() {
  const foot = document.querySelector('[data-foot-logo]');
  if (!foot || reduced()) return;
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); animateLogo(foot); } }, { threshold: 0.6 });
  io.observe(foot);
}

/** Pointing at a suite lights its floors on the tower. */
function floors() {
  const main = document.querySelector<HTMLElement>('main')!;
  const back = () => city.highlight(main.dataset.hi ? main.dataset.hi.split(',').map(Number) : null);
  document.querySelectorAll<HTMLElement>('[data-levels]').forEach((el) => {
    const lv = el.dataset.levels!.split(',').filter(Boolean).map(Number);
    el.addEventListener('mouseenter', () => city.highlight(lv));
    el.addEventListener('focusin', () => city.highlight(lv));
    el.addEventListener('mouseleave', back);
    el.addEventListener('focusout', back);
  });
}

/** Cards lean towards the pointer (a real mouse only). */
function tilt() {
  if (reduced() || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  document.querySelectorAll<HTMLElement>('[data-tilt]').forEach((c) => {
    c.addEventListener('mousemove', (e) => {
      const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      c.style.transform = `perspective(900px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateZ(0)`;
    });
    c.addEventListener('mouseleave', () => {
      c.style.transition = 'transform .6s cubic-bezier(.23,1,.32,1),border-color .3s';
      c.style.transform = '';
      setTimeout(() => { c.style.transition = ''; }, 600);
    });
  });
}

/** "Copy the address" buttons. */
function copy() {
  document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) => {
    const label = b.querySelector<HTMLElement>('[data-copy-label]')!;
    const was = label.textContent;
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy!); label.textContent = 'Copied'; }
      catch { label.textContent = b.dataset.copy!; }
      setTimeout(() => (label.textContent = was), 2000);
    });
  });
}

export { gsap, ScrollTrigger };
