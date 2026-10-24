// "The Kozi way": the idea that has passed the middle of the screen owns the photo frame. It is
// worked out from where the items are on every scroll, so a fast scroll or a jump still lands right.
export function init(root: HTMLElement) {
  const items = [...root.querySelectorAll<HTMLElement>('[data-way-item]')];
  const shots = [...root.querySelectorAll<HTMLElement>('[data-way-shot]')];
  let on = -1, raf = 0;
  const show = (i: number) => {
    if (i === on) return;
    on = i;
    shots.forEach((s, k) => s.classList.toggle('on', k === i));
    items.forEach((s, k) => s.classList.toggle('on', k === i));
  };
  const update = () => {
    raf = 0;
    const mid = innerHeight * 0.5;
    let i = 0;
    items.forEach((it, k) => { if (it.getBoundingClientRect().top < mid) i = k; });
    show(i);
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(update); };
  // only listen while the section is on screen
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting) { addEventListener('scroll', queue, { passive: true }); addEventListener('resize', queue); queue(); }
    else { removeEventListener('scroll', queue); removeEventListener('resize', queue); }
  }).observe(root);
  update();
}
