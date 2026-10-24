// A guide page: the line along the top shows how far through the guide you are, and the
// contents beside it marks the section you're reading. Both follow the scroll, once a frame.
export function init(root: HTMLElement) {
  const prose = root.querySelector<HTMLElement>('[data-g-prose]')!;
  const bar = document.querySelector<HTMLElement>('[data-g-progress]');
  const links = new Map([...root.querySelectorAll<HTMLAnchorElement>('[data-g-toc]')].map((a) => [a.dataset.gToc!, a]));
  const heads = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
  let current = '';

  let queued = false;
  const draw = () => {
    queued = false;
    if (bar) {
      const r = prose.getBoundingClientRect();
      const span = Math.max(1, r.height - innerHeight * 0.6);
      bar.style.transform = `scaleX(${Math.min(1, Math.max(0, (innerHeight * 0.4 - r.top) / span))})`;
    }
    if (heads.length) {
      // the section you're in is the last heading that has passed the upper third of the screen
      let now = heads[0].id;
      for (const h of heads) if (h.getBoundingClientRect().top < innerHeight * 0.34) now = h.id;
      if (now !== current) {
        current = now;
        links.forEach((a, k) => (k === now ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current')));
      }
    }
  };
  const ask = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };
  addEventListener('scroll', ask, { passive: true });
  addEventListener('resize', ask);
  draw();
}
