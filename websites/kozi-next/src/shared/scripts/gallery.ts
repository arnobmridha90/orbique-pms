// The photo viewer: opens on the photo you tapped, swipes or steps with the arrow keys,
// and keeps the page still behind it. The phone strip shows which photo you're on.
import { reduced, scroller } from './scroll';

export function init(root: HTMLElement) {
  const dlg = root.querySelector<HTMLDialogElement>('[data-lb]')!;
  const track = dlg.querySelector<HTMLElement>('[data-lb-track]')!;
  const slides = [...track.children] as HTMLElement[];
  const n = dlg.querySelector<HTMLElement>('[data-lb-n]')!;
  const prev = dlg.querySelector<HTMLButtonElement>('[data-lb-step="-1"]')!, next = dlg.querySelector<HTMLButtonElement>('[data-lb-step="1"]')!;
  let at = 0;

  const show = (i: number) => {
    at = i;
    n.textContent = String(i + 1);
    prev.disabled = i === 0; next.disabled = i === slides.length - 1;
  };
  const goTo = (i: number, smooth = true) => {
    const k = Math.max(0, Math.min(slides.length - 1, i));
    track.scrollTo({ left: slides[k].offsetLeft, behavior: smooth && !reduced() ? 'smooth' : 'instant' });
    show(k);
  };
  // which slide is in view after a swipe
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) show(slides.indexOf(e.target as HTMLElement)); }, { root: track, threshold: 0.6 });
  slides.forEach((s) => io.observe(s));

  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-open-at]');
    if (!b || dlg.contains(b)) return;
    dlg.showModal();
    scroller.lenis?.stop();
    document.documentElement.classList.add('sheet-open');
    requestAnimationFrame(() => { goTo(Number(b.dataset.openAt), false); track.focus({ preventScroll: true }); });
  });
  dlg.addEventListener('close', () => { scroller.lenis?.start(); document.documentElement.classList.remove('sheet-open'); });
  dlg.addEventListener('click', (e) => { const s = (e.target as HTMLElement).closest<HTMLElement>('[data-lb-step]'); if (s) goTo(at + Number(s.dataset.lbStep)); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(at + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(at - 1); }
    else if (e.key === 'Home') { e.preventDefault(); goTo(0); }
    else if (e.key === 'End') { e.preventDefault(); goTo(slides.length - 1); }
  });
  addEventListener('resize', () => { if (dlg.open) goTo(at, false); });

  // phone strip: "3 / 10" on the button follows the swipe
  const strip = root.querySelector<HTMLElement>('[data-strip]');
  const sn = root.querySelector<HTMLElement>('[data-strip-n]');
  if (strip && sn) {
    const items = [...strip.children] as HTMLElement[];
    const so = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) sn.textContent = String(items.indexOf(e.target as HTMLElement) + 1); }, { root: strip, threshold: 0.6 });
    items.forEach((s) => so.observe(s));
  }
}
