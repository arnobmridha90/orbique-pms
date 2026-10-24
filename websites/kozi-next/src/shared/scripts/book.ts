// The booking card: every night's price on the calendar (the member price for members, the public
// price for everyone else), sold nights closed, and the total for your dates before you go on to pay.
import { Calendar, type Range } from '@shared/lib/calendar';
import { availability, calendar as fetchCalendar, getMember, rm, TEST_MODE, type CalendarDay, type Member, type Quote, type SuiteType } from '@shared/lib/api';
import { addDays, fmtDay, fmtShort, fromIso, iso, nights as countNights, todayKL } from '@shared/lib/dates';
import { loadSearch, saveSearch } from './search';
import { lenis } from './app';

const phone = matchMedia('(max-width: 760px)');
const wide = matchMedia('(min-width: 1200px)');

export function init(root: HTMLElement) {
  const type = root.dataset.book as SuiteType;
  const $ = <T extends Element = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const start = loadSearch();
  const state = { in: start.in, out: start.out, guests: start.guests };
  let days = new Map<string, CalendarDay>();
  let loaded = false;
  let member = !!getMember();
  let quote: Quote | null = null;
  let busy = false;
  let seq = 0;

  const card = $('[data-bk-card]'), pop = $('[data-bk-pop]'), fields = $('[data-bk-fields]'), sum = $('[data-bk-sum]');
  const calEl = pop.querySelector<HTMLElement>('[data-cal]')!;
  const openers = [...root.querySelectorAll<HTMLButtonElement>('[data-bk-open]')];
  const goBtn = $<HTMLButtonElement>('[data-bk-go]'), bar = $('[data-bk-bar]');
  const msg = (t: string) => { $('[data-bk-msg]').textContent = t; };
  $('[data-bk-test]').hidden = !TEST_MODE;

  const price = (c: CalendarDay) => (member ? c.member : c.public);
  let cal: Calendar;
  const makeCal = () => {
    cal = new Calendar(calEl, {
      months: wide.matches ? 2 : 1, stacked: phone.matches, onChange: onDates,
      price: (d) => { const c = days.get(iso(d)); return c?.open ? rm(price(c), true) : null; },
      closed: (d) => loaded && !days.get(iso(d))?.open,
    });
    cal.set({ start: fromIso(state.in), end: fromIso(state.out) });
  };
  makeCal();
  for (const m of [phone, wide]) m.addEventListener('change', () => { close(false); makeCal(); });

  // ------------------------------------------------------------ the calendar popover (a sheet on a phone)
  let open = false;
  let opener: HTMLButtonElement | null = null;
  function show(by?: HTMLButtonElement) {
    if (open) return;
    open = true;
    opener = by ?? openers[0];
    if (!phone.matches && !wide.matches) pop.style.setProperty('--bk-top', `${fields.offsetTop + fields.offsetHeight + 10}px`);
    root.dataset.open = '';
    pop.dataset.on = '';
    opener.setAttribute('aria-expanded', 'true');
    if (phone.matches) { document.documentElement.classList.add('sheet-open'); lenis?.stop(); }
    hint();
    requestAnimationFrame(() => cal.focus());
  }
  function close(refocus = true) {
    if (!open) return;
    open = false;
    delete root.dataset.open;
    delete pop.dataset.on;
    openers.forEach((o) => o.setAttribute('aria-expanded', 'false'));
    document.documentElement.classList.remove('sheet-open');
    lenis?.start();
    if (refocus) opener?.focus({ preventScroll: true });
  }
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const o = t.closest<HTMLButtonElement>('[data-bk-open]');
    if (o) { open ? close() : show(o); return; }
    if (t.closest('[data-bk-close], [data-bk-done], [data-bk-shade]')) { close(); return; }
    if (t.closest('[data-bk-clear]')) { state.in = state.out = null; cal.set({ start: null, end: null }); quote = null; keep(); paint(); hint(); cal.focus(); return; }
    if (t.closest('[data-dec]')) { state.guests = Math.max(1, state.guests - 1); keep(); requote(); return; }
    if (t.closest('[data-inc]')) { state.guests = Math.min(5, state.guests + 1); keep(); requote(); return; }
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); close(); } });
  document.addEventListener('pointerdown', (e) => { if (open && !phone.matches && !pop.contains(e.target as Node) && !fields.contains(e.target as Node)) close(false); });

  function hint() {
    const a = fromIso(state.in), b = fromIso(state.out);
    $('[data-bk-hint]').textContent = a && b ? 'Your dates' : a ? 'Now the day you leave' : 'Pick the day you arrive';
    $('[data-bk-line]').textContent = a && b ? `${countNights(a, b)} night${countNights(a, b) > 1 ? 's' : ''} · ${fmtDay(a)} to ${fmtDay(b)}` : member ? 'Member prices, per night' : 'Prices per night';
  }
  function onDates(r: Range) {
    state.in = r.start ? iso(r.start) : null;
    state.out = r.end ? iso(r.end) : null;
    msg(''); keep(); hint();
    if (r.start && r.end) { requote(); if (!phone.matches) setTimeout(() => close(), 260); }
    else { quote = null; paint(); }
  }
  const keep = () => saveSearch({ city: 'kuala-lumpur', in: state.in, out: state.out, guests: state.guests });

  // ------------------------------------------------------------ prices
  async function requote() {
    const a = fromIso(state.in), b = fromIso(state.out);
    if (!a || !b) { quote = null; paint(); return; }
    const my = ++seq;
    busy = true; sum.classList.add('loading'); paint();
    try {
      const av = await availability(state.in!, state.out!, state.guests);
      if (my !== seq) return;
      const q = av.quotes.find((x) => x.type === type) ?? null;
      if (q && !q.available) { msg(q.short === 'Sold out' ? 'Those dates are no longer open for this suite. Please pick others.' : q.reason); quote = null; }
      else quote = q;
    } catch (x) {
      if (my === seq) { quote = null; msg((x as Error).message || 'We could not get a price. Please try again.'); }
    } finally {
      if (my === seq) { busy = false; sum.classList.remove('loading'); paint(); }
    }
  }

  function fromPrice() {
    const today = todayKL();
    let best: CalendarDay | null = null;
    for (let i = 0; i < 60; i++) { const c = days.get(iso(addDays(today, i))); if (c?.open && (!best || c.public < best.public)) best = c; }
    return best;
  }

  function paint() {
    const a = fromIso(state.in), b = fromIso(state.out);
    root.classList.toggle('has-dates', !!(a && b));
    $('[data-bk-in]').textContent = a ? fmtDay(a) : 'Add date';
    $('[data-bk-out]').textContent = b ? fmtDay(b) : 'Add date';
    $<HTMLOutputElement>('[data-count]').value = String(state.guests);
    $('[data-bk-gword]').textContent = state.guests > 1 ? 'guests' : 'guest';
    $<HTMLButtonElement>('[data-dec]').disabled = state.guests <= 1;
    $<HTMLButtonElement>('[data-inc]').disabled = state.guests >= 5;

    const f = fromPrice();
    const nightly = quote ? (member ? quote.member.nightly : quote.public.nightly) : f ? price(f) : null;
    const mNightly = quote ? quote.member.nightly : f?.member ?? null;
    $('[data-bk-k]').textContent = quote ? '' : 'From';
    $('[data-bk-rate]').textContent = nightly ? rm(nightly) : loaded ? 'Sold out' : ' ';
    $('[data-bk-mrate]').textContent = mNightly ? rm(mNightly) : 'less';

    sum.hidden = !quote;
    if (quote) {
      const n = quote.nights.length;
      const side = member ? quote.member : quote.public;
      const rooms = side.total - quote.extraBed;
      $('[data-bk-nights]').textContent = `${rm(rooms / n)} × ${n} night${n > 1 ? 's' : ''}`;
      $('[data-bk-sub]').textContent = rm(rooms);
      $('[data-bk-extra]').hidden = !quote.extraBed;
      $('[data-bk-extra-k]').textContent = `Extra bed × ${n} night${n > 1 ? 's' : ''}`;
      $('[data-bk-extra-v]').textContent = rm(quote.extraBed);
      const save = quote.public.total - quote.member.total;
      const saveRow = $('[data-bk-save]');
      saveRow.hidden = save <= 0;
      saveRow.querySelector('dt')!.textContent = member ? 'Your member saving' : 'Members pay';
      $('[data-bk-save-v]').textContent = member ? `−${rm(save)}` : rm(quote.member.total);
      $('[data-bk-total]').textContent = rm(side.total);
    }
    const label = !a || !b ? 'Check dates' : busy ? 'Checking…' : quote ? 'Reserve' : 'Pick other dates';
    $('[data-bk-go-label]').textContent = label;
    goBtn.setAttribute('aria-busy', String(busy));
    // the phone bar
    $('[data-bk-bar-rate]').textContent = nightly ? rm(nightly) : ' ';
    $('[data-bk-bar-dates]').textContent = a && b ? `${fmtShort(a)} – ${fmtShort(b)} · ${state.guests} guest${state.guests > 1 ? 's' : ''}` : 'Add your dates';
    $('[data-bk-bar-label]').textContent = quote ? 'Reserve' : 'Check dates';
  }

  const go = () => {
    if (!quote) { show(); return; }
    const q = new URLSearchParams({ type, in: state.in!, out: state.out!, guests: String(state.guests) });
    location.href = `/book/?${q}`;
  };
  goBtn.addEventListener('click', go);
  $('[data-bk-bar-go]').addEventListener('click', go);
  $('[data-bk-bar-dates]').addEventListener('click', () => show());

  // the bar shows on a phone once the card itself has scrolled away
  new IntersectionObserver(([e]) => bar.classList.toggle('on', !e.isIntersecting), { threshold: 0 }).observe(card);

  document.addEventListener('kozi:member', (e) => { member = !!(e as CustomEvent<Member | null>).detail; cal.refresh(); hint(); paint(); });

  paint();
  fetchCalendar(type, todayKL(), addDays(todayKL(), 365)).then((list) => {
    days = new Map(list.map((c) => [c.date, c]));
    loaded = true;
    // dates carried over from a search may already be taken for this suite
    const a = fromIso(state.in), b = fromIso(state.out);
    if (a && b) {
      for (let d = a; d < b; d = addDays(d, 1)) if (!days.get(iso(d))?.open) { msg('Your dates are not open for this suite. Please pick others.'); state.in = state.out = null; break; }
    }
    cal.set({ start: fromIso(state.in), end: fromIso(state.out) });
    hint();
    if (state.in && state.out) requote(); else paint();
  }).catch(() => msg('We could not load prices. Please refresh the page.'));
}
