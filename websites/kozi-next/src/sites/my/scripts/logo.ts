// The logo builds itself (components/AnimLogo.astro): the crosshair draws out from the centre, the K, Z and I rise in,
// the horizon spreads, then the sun comes up in the O. As in the approved design: the origins go in the start state
// (smoothOrigin off), and every transform is cleared at the end, so the finished logo is the file itself.
import { gsap } from 'gsap';

export function animateLogo(el: Element, o: { speed?: number; delay?: number } = {}) {
  const q = (s: string) => el.querySelectorAll(s), sp = o.speed || 1;
  const parts = q('.kz-v, .kz-h, .kz-l, .kz-hz, .kz-sun');
  const tl = gsap.timeline({ delay: o.delay || 0, onComplete: () => { gsap.set(parts, { clearProps: 'transform,opacity' }); } });
  tl.fromTo(q('.kz-v'), { scaleY: 0, svgOrigin: '317 317', smoothOrigin: false }, { scaleY: 1, duration: 0.9 / sp, ease: 'power3.inOut' }, 0)
    .fromTo(q('.kz-h'), { scaleX: 0, svgOrigin: '317 317', smoothOrigin: false }, { scaleX: 1, duration: 0.9 / sp, ease: 'power3.inOut' }, 0)
    .fromTo(q('.kz-l'), { y: 70, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9 / sp, stagger: 0.12 / sp, ease: 'power4.out' }, 0.25 / sp)
    .fromTo(q('.kz-hz'), { scaleX: 0, svgOrigin: '484 288', smoothOrigin: false }, { scaleX: 1, duration: 0.6 / sp, ease: 'power3.out' }, 0.55 / sp)
    .fromTo(q('.kz-sun'), { y: 250 }, { y: 0, duration: 1.3 / sp, ease: 'expo.out' }, 0.85 / sp);
  return tl;
}

/** The sun rises again in the O (pointing at the header logo). */
export function sunrise(el: Element) {
  gsap.fromTo(el.querySelectorAll('.kz-sun'), { y: 250 }, { y: 0, duration: 1.1, ease: 'expo.out', overwrite: true, clearProps: 'transform' });
}
