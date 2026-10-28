// The stays page: live prices for every suite. With dates, each suite shows its nightly price,
// the total and whether it's open; without, its lowest price in the next two months. A suite that is
// not bookable online yet (a card with no data-type) keeps its "Email us to book" line.
import { availability, calendar, rm, TEST_MODE, type Quote } from '@shared/lib/api';
import { addDays, fmtShort, fromIso, nights, todayKL } from '@shared/lib/dates';
import { loadSearch, type Search } from './search';

export function init(root: HTMLElement) {
  const all = [...root.querySelectorAll<HTMLElement>('.sr')];
  const cards = all.filter((c) => c.dataset.type);
  const types = [...new Set(cards.map((c) => c.dataset.type!))];
  const list = root.querySelector<HTMLElement>('[data-sy-list]')!;
  const count = root.querySelector<HTMLElement>('[data-sy-count]')!;
  root.querySelector<HTMLElement>('[data-sy-test]')!.hidden = !TEST_MODE;
  let search = loadSearch();
  let quotes: Quote[] | null = null;
  let failed = false;
  const from = new Map<string, number>();
  let seq = 0;

  // text is only rewritten when it changes, so the live count isn't announced again and nothing repaints for no reason
  const text = (el: Node, t: string) => { if (el.textContent !== t) el.textContent = t; };
  const set = (c: HTMLElement, sel: string, t: string) => text(c.querySelector<HTMLElement>(sel)!, t);

  function paint() {
    const a = fromIso(search.in), b = fromIso(search.out);
    const n = a && b ? nights(a, b) : 0;
    let open = 0;
    for (const c of cards) {
      const type = c.dataset.type!;
      const href = c.dataset.href!;
      const go = c.querySelector<HTMLAnchorElement>('[data-sr-go]')!;
      const q = quotes?.find((x) => x.type === type);
      c.classList.toggle('sold', !!q && !q.available);
      if (q && q.available) {
        open++;
        set(c, '[data-sr-k]', '');
        set(c, '[data-sr-rate]', rm(q.public.nightly));
        set(c, '[data-sr-total]', `${rm(q.public.total)} for ${n} night${n > 1 ? 's' : ''}${q.refundable ? '' : ', non-refundable'}`);
        go.href = `/book/?${new URLSearchParams({ type, unit: c.dataset.unit!, in: search.in!, out: search.out!, guests: String(search.guests) })}`;
        text(go.firstChild!, 'Reserve ');
      } else if (q) {
        set(c, '[data-sr-k]', '');
        set(c, '[data-sr-rate]', q.short);
        set(c, '[data-sr-total]', q.short === 'Sold out' ? `for ${fmtShort(a!)} – ${fmtShort(b!)}` : q.reason);
        go.href = href; text(go.firstChild!, 'Try other dates ');
      } else {
        const f = from.get(type);
        set(c, '[data-sr-k]', 'From');
        set(c, '[data-sr-rate]', f ? rm(f) : ' ');
        set(c, '[data-sr-total]', '');
        go.href = href; text(go.firstChild!, 'See the suite ');
      }
    }
    // open suites first, then the order they were in
    if (quotes) {
      const sorted = [...all].sort((x, y) => Number(y.classList.contains('sold') === false) - Number(x.classList.contains('sold') === false));
      sorted.forEach((c) => list.appendChild(c));
    }
    text(count, failed ? 'We could not load prices. Please refresh the page.' : quotes
      ? open ? `${open} of ${cards.length} suites open for ${fmtShort(a!)} – ${fmtShort(b!)}` : `Nothing open for ${fmtShort(a!)} – ${fmtShort(b!)}. Try nearby dates.`
      : root.dataset.count!);
  }

  async function run() {
    const my = ++seq;
    failed = false;
    const a = fromIso(search.in), b = fromIso(search.out);
    cards.forEach((c) => c.classList.add('loading'));
    try {
      if (a && b) {
        const av = await availability(search.in!, search.out!, search.guests, types);
        if (my !== seq) return;
        quotes = av.quotes;
      } else {
        quotes = null;
        if (!from.size) {
          const t = todayKL();
          await Promise.all(types.map(async (type) => {
            const days = (await calendar(type, t, addDays(t, 60))).filter((d) => d.open);
            if (days.length) from.set(type, Math.min(...days.map((d) => d.public)));
          }));
        }
        if (my !== seq) return;
      }
    } catch {
      if (my === seq) { failed = true; quotes = null; } // no stale prices from an earlier search
    } finally {
      if (my === seq) { cards.forEach((c) => c.classList.remove('loading')); paint(); }
    }
  }

  let t = 0;
  document.addEventListener('kozi:search', (e) => {
    const s = (e as CustomEvent<Search>).detail;
    if (s.in === search.in && s.out === search.out && s.guests === search.guests) return;
    search = { ...s };
    clearTimeout(t); t = window.setTimeout(run, 250);
  });
  if (cards.length) run(); else paint();
}
