// The view finder (/views/): a tab per landmark. Choosing one flies the camera to look at it from our windows and
// lights its label in the city; the address keeps the choice (#petronas) so it can be shared, and a tap on a
// landmark in the city chooses it too (scripts/night.ts sets the hash).
import * as city from './city';

export function init(root: HTMLElement) {
  const off = new AbortController();
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  const panels = [...root.querySelectorAll<HTMLElement>('[data-panel]')];
  const ids = tabs.map((t) => t.dataset.v!);
  let now = '';
  const show = (v: string, focus = false) => {
    if (!ids.includes(v)) v = ids[0];
    tabs.forEach((t) => {
      const on = t.dataset.v === v;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    panels.forEach((p) => { p.hidden = p.dataset.panel !== v; });
    if (v === now) return;
    now = v;
    city.fly(`look-${v}`, 2.6);
    city.pinOn(v);
    if (location.hash.slice(1) !== v) history.replaceState(history.state, '', `#${v}`);
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => show(t.dataset.v!), { signal: off.signal });
    t.addEventListener('keydown', (e) => {
      const k = e.key;
      const to = k === 'ArrowRight' || k === 'ArrowDown' ? (i + 1) % tabs.length
        : k === 'ArrowLeft' || k === 'ArrowUp' ? (i - 1 + tabs.length) % tabs.length
        : k === 'Home' ? 0 : k === 'End' ? tabs.length - 1 : -1;
      if (to < 0) return;
      e.preventDefault();
      show(ids[to], true);
    }, { signal: off.signal });
  });
  addEventListener('hashchange', () => show(location.hash.slice(1)), { signal: off.signal });
  document.addEventListener('astro:before-swap', () => { off.abort(); city.pinOn(null); }, { once: true });
  show(location.hash.slice(1) || ids[0]);
  void city.ready.then((ok) => {
    const hint = root.querySelector<HTMLElement>('[data-drag-hint]');
    if (hint) hint.hidden = !ok;
    city.pinOn(now);
  });
}
