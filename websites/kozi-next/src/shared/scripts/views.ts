// "Pick your view" tabs: arrow keys move between landmarks; the chosen one lights up on the skyline.
export function init(root: HTMLElement) {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const select = (t: HTMLButtonElement, focus = false) => {
    const id = t.dataset.mark!;
    if (root.dataset.sel === id) return;
    root.dataset.sel = id;
    for (const x of tabs) {
      const on = x === t;
      x.setAttribute('aria-selected', String(on));
      x.tabIndex = on ? 0 : -1;
      const p = root.querySelector<HTMLElement>(`#${x.getAttribute('aria-controls')}`)!;
      p.hidden = !on;
      if (on) { p.classList.remove('swap'); void p.offsetWidth; p.classList.add('swap'); }
    }
    if (focus) t.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (e.key === 'Home') { e.preventDefault(); select(tabs[0], true); }
      else if (e.key === 'End') { e.preventDefault(); select(tabs[tabs.length - 1], true); }
      else if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
}
