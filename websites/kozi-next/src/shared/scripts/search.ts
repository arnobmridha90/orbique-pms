// The search bar's popovers. On a wide screen each field opens a popover under the bar,
// scaled in from the field that opened it; on a phone the same panels rise as bottom sheets.
// The choice is kept for the session so the stays page and the suite pages start from it.
import { Calendar, type Range } from '@shared/lib/calendar';
import { fmtDay, fmtRange, fromIso, iso, nights } from '@shared/lib/dates';

export type Search = { city: string; in: string | null; out: string | null; guests: number };
const KEY = 'kozi-search';
export function loadSearch(): Search {
  const q = new URLSearchParams(location.search);
  let s: Partial<Search> = {};
  try { s = JSON.parse(sessionStorage.getItem(KEY) || '{}'); } catch { /* private mode */ }
  const pickIn = q.get('in') ?? s.in ?? null, pickOut = q.get('out') ?? s.out ?? null;
  const a = fromIso(pickIn), b = fromIso(pickOut);
  const ok = a && b && b > a;
  const g = Math.min(5, Math.max(1, Number(q.get('guests') ?? s.guests ?? 2) || 2));
  return { city: q.get('city') ?? s.city ?? 'kuala-lumpur', in: ok ? iso(a!) : null, out: ok ? iso(b!) : null, guests: g };
}
export function saveSearch(s: Search) {
  try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
  document.dispatchEvent(new CustomEvent('kozi:search', { detail: s }));
}

const phone = matchMedia('(max-width: 760px)');

export function initSearch(form: HTMLFormElement) {
  const $ = <T extends Element>(sel: string) => form.querySelector<T>(sel)!;
  const state = loadSearch();
  const fields = { in: $<HTMLInputElement>('input[name="in"]'), out: $<HTMLInputElement>('input[name="out"]'), guests: $<HTMLInputElement>('input[name="guests"]'), city: $<HTMLInputElement>('input[name="city"]') };
  const vWhen = $<HTMLElement>('[data-v="when"]'), vWho = $<HTMLElement>('[data-v="who"]'), vWhere = $<HTMLElement>('[data-v="where"]');
  const nightsEl = $<HTMLElement>('[data-nights]');
  const vSum = $<HTMLElement>('[data-v="sum"]'), vWherePhone = $<HTMLElement>('[data-v="where-phone"]');
  let open: string | null = null;
  let opener: HTMLButtonElement | null = null;

  // calendar: two months side by side, or a scrolling list on a phone. It is a few hundred buttons,
  // so it is built the first time someone opens it rather than with the page.
  const calEl = $<HTMLElement>('[data-cal]');
  let cal: Calendar | null = null;
  const makeCal = () => {
    cal = new Calendar(calEl, { months: 2, stacked: phone.matches, onChange: onDates });
    cal.set({ start: fromIso(state.in), end: fromIso(state.out) });
    return cal;
  };
  const getCal = () => cal ?? makeCal();
  phone.addEventListener('change', () => { if (cal) makeCal(); if (open) close(false); });

  function onDates(r: Range) {
    state.in = r.start ? iso(r.start) : null;
    state.out = r.end ? iso(r.end) : null;
    sync();
    if (r.start && r.end) setTimeout(() => show('who'), 220); // the next question
  }
  function sync() {
    const a = fromIso(state.in), b = fromIso(state.out);
    vWhen.textContent = a && b ? fmtRange(a, b) : a ? `${fmtDay(a)} –` : 'Add dates';
    form.classList.toggle('has-dates', !!(a && b));
    nightsEl.textContent = a && b ? `${nights(a, b)} night${nights(a, b) > 1 ? 's' : ''} · ${fmtDay(a)} to ${fmtDay(b)}` : a ? 'Now the day you leave' : 'Pick the day you arrive';
    fields.in.value = state.in ?? ''; fields.out.value = state.out ?? '';
    fields.in.disabled = !state.in; fields.out.disabled = !state.out; // no empty params in the URL
    fields.guests.value = String(state.guests);
    vWho.textContent = `${state.guests} guest${state.guests > 1 ? 's' : ''}`;
    vSum.textContent = `${a && b ? fmtRange(a, b) : 'Add dates'} · ${vWho.textContent}`;
    vWherePhone.textContent = vWhere.textContent;
    $<HTMLOutputElement>('[data-count]').value = String(state.guests);
    $<HTMLButtonElement>('[data-dec]').disabled = state.guests <= 1;
    $<HTMLButtonElement>('[data-inc]').disabled = state.guests >= 5;
    saveSearch({ ...state });
  }

  function show(name: string, by?: HTMLButtonElement) {
    if (open === name) return;
    if (open) close(false);
    const pop = $<HTMLElement>(`[data-pop="${name}"]`);
    if (name === 'when') getCal();
    opener = (by && by.dataset.open === name ? by : null) ?? (phone.matches ? $<HTMLButtonElement>('.s-phone') : $<HTMLButtonElement>(`.s-field [data-open="${name}"]`));
    // origin-aware: the popover grows from the field that opened it
    const fr = opener.getBoundingClientRect(), fo = form.getBoundingClientRect();
    pop.style.setProperty('--ox', `${fr.left + fr.width / 2 - fo.left}px`);
    if (!phone.matches) {
      const pw = pop.offsetWidth || 360;
      const left = Math.min(Math.max(0, fr.left - fo.left + fr.width / 2 - pw / 2), fo.width - pw);
      pop.style.left = `${Math.max(0, left)}px`;
      pop.style.setProperty('--ox', `${fr.left + fr.width / 2 - fo.left - Math.max(0, left)}px`);
    } else pop.style.left = '';
    open = name;
    form.dataset.open = name;
    opener.setAttribute('aria-expanded', 'true');
    pop.dataset.on = '';
    if (phone.matches) document.documentElement.classList.add('sheet-open');
    requestAnimationFrame(() => {
      if (name === 'when') getCal().focus();
      else (pop.querySelector<HTMLElement>('[aria-selected="true"], button:not([disabled])') ?? pop).focus({ preventScroll: true });
    });
  }
  function close(refocus = true) {
    if (!open) return;
    const pop = $<HTMLElement>(`[data-pop="${open}"]`);
    delete pop.dataset.on;
    opener?.setAttribute('aria-expanded', 'false');
    delete form.dataset.open;
    document.documentElement.classList.remove('sheet-open');
    if (refocus) opener?.focus({ preventScroll: true });
    open = null;
  }

  form.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const o = t.closest<HTMLButtonElement>('[data-open]');
    if (o) { const n = o.dataset.open!; open === n ? close() : show(n, o); return; }
    if (t.closest('[data-close]') || t.closest('[data-shade]')) { close(); return; }
    if (t.closest('[data-done]')) { close(); return; }
    if (t.closest('[data-clear]')) { state.in = state.out = null; getCal().set({ start: null, end: null }); sync(); getCal().focus(); return; }
    if (t.closest('[data-dec]')) { state.guests = Math.max(1, state.guests - 1); sync(); return; }
    if (t.closest('[data-inc]')) { state.guests = Math.min(5, state.guests + 1); sync(); return; }
    const d = t.closest<HTMLButtonElement>('[data-city]');
    if (d) {
      form.querySelectorAll('[data-city]').forEach((x) => x.setAttribute('aria-selected', String(x === d)));
      state.city = d.dataset.city!; fields.city.value = state.city; vWhere.textContent = d.dataset.name!;
      sync(); setTimeout(() => show('when'), 160);
    }
  });
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); close(); } });
  document.addEventListener('pointerdown', (e) => { if (open && !phone.matches && !form.contains(e.target as Node)) close(false); });
  form.addEventListener('focusout', (e) => {
    const to = e.relatedTarget as Node | null;
    if (open && to && !form.contains(to)) close(false);
  });
  form.addEventListener('submit', () => { saveSearch({ ...state }); });
  document.addEventListener('kozi:search', (e) => { // another search bar on the page changed
    const s = (e as CustomEvent<Search>).detail;
    if (s.in === state.in && s.out === state.out && s.guests === state.guests) return;
    Object.assign(state, s); cal?.set({ start: fromIso(s.in), end: fromIso(s.out) }); sync();
  });
  sync();
}

export function initSearches() {
  document.querySelectorAll<HTMLFormElement>('form[data-search]').forEach(initSearch);
}
