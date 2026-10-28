// Book: reads the stay from the address (booking type, suite, dates, guests), prices it, offers its rates (Flexible or
// Non-refundable), then sends the stay to our team: a WhatsApp chat with it written out, or an email when Orbique has no
// WhatsApp number. The team confirms the suite and how to pay, so nothing is held or charged from here.
import { availability, rm, TEST_MODE, type Quote, type Rate } from '@shared/lib/api';
import { fmtDayYear, fromIso, nights as countNights, todayKL } from '@shared/lib/dates';

export function init(root: HTMLElement) {
  const $ = <T extends Element = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const q = new URLSearchParams(location.search);
  const type = q.get('type') || '';
  // the suite: the one the address names, or else the first that books as this type
  const tpl = document.querySelector<HTMLTemplateElement>('template[data-co-photos]')!;
  const units = [...tpl.content.querySelectorAll<HTMLElement>('[data-for]')].filter((el) => el.dataset.type === type);
  const src = units.find((el) => el.dataset.for === q.get('unit')) ?? units[0];
  const a = fromIso(q.get('in')), b = fromIso(q.get('out'));
  const guests = Math.min(Number(src?.dataset.most) || 5, Math.max(1, Number(q.get('guests')) || 2));
  const ok = src && a && b && b > a && a >= todayKL() && countNights(a, b) <= 60;
  if (!ok) { root.classList.add('empty'); $('[data-co-gone]').hidden = false; return; }

  const n = countNights(a!, b!);
  const form = $<HTMLFormElement>('[data-co-form]');
  const go = $<HTMLAnchorElement>('[data-co-go]');
  const wa = root.dataset.wa || '';
  let quote: Quote | null = null;
  let plan: string | null = null;
  let closed = false; // these dates can't be booked for this suite
  $('[data-co-test]').hidden = !TEST_MODE;

  // the suite
  $('[data-co-where]').textContent = src.dataset.building!;
  $('[data-co-tin]').textContent = `from ${src.dataset.in}`;
  $('[data-co-tout]').textContent = `by ${src.dataset.out}`;
  $('[data-co-media]').append(...src.cloneNode(true).childNodes);
  $('[data-co-name]').textContent = src.dataset.name!;
  $('[data-co-level]').textContent = src.dataset.level!;
  $('[data-co-in]').textContent = fmtDayYear(a!);
  $('[data-co-out]').textContent = fmtDayYear(b!);
  const stay = `${n} night${n > 1 ? 's' : ''} · ${guests} guest${guests > 1 ? 's' : ''}${guests > 4 ? ' (one on the extra bed)' : ''}`;
  $('[data-co-who]').textContent = stay;
  const back = $<HTMLAnchorElement>('[data-co-back]');
  back.href = src.dataset.href!;
  $('[data-co-back-label]').textContent = `Back to the ${src.dataset.name}`;

  const rate = (): Rate | null => quote?.rates.find((r) => r.plan === plan) ?? quote?.rates[0] ?? null;

  // the rates, as a choice when there is one; a single non-refundable rate is still shown, so nobody misses it
  const rateSec = $('[data-co-rate-sec]'), rateList = $('[data-co-rates]');
  function rates() {
    const list = quote?.rates ?? [];
    rateSec.hidden = !(list.length > 1 || (list.length === 1 && !list[0].refundable));
    const flex = list.find((r) => r.refundable);
    rateList.replaceChildren(...list.map((r) => {
      const el = document.createElement('label');
      el.className = 'co-rate';
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'plan', value: r.plan, checked: r.plan === rate()?.plan });
      const t = document.createElement('span'), name = document.createElement('b'), note = document.createElement('small');
      t.className = 'co-rate-t';
      name.textContent = r.name;
      const less = flex && !r.refundable ? flex.public.total - r.public.total : 0;
      if (less >= 0.01) note.append(Object.assign(document.createElement('em'), { textContent: `${rm(less)} less. ` }));
      // the card's name already says "Non-refundable", so the note drops it from the front
      const why = r.cancellation.replace(/^non-refundable:\s*/i, '');
      note.append(why.charAt(0).toUpperCase() + why.slice(1));
      t.append(name, note);
      const p = Object.assign(document.createElement('span'), { className: 'co-rate-p', textContent: rm(r.public.total) });
      el.append(input, t, p);
      return el;
    }));
  }
  rateList.addEventListener('change', (e) => { plan = (e.target as HTMLInputElement).value; paint(); refresh(); });

  function paint() {
    const lines = $('[data-co-lines]');
    const r = rate();
    if (!quote || !r) { lines.innerHTML = closed ? '' : '<div><dt>Getting your price…</dt><dd></dd></div>'; return; }
    const total = r.public.total, rooms = total - quote.extraBed;
    const row = (k: string, v: string, cls = '') => `<div${cls ? ` class="${cls}"` : ''}><dt>${k}</dt><dd>${v}</dd></div>`;
    lines.innerHTML = [
      row(`${rm(rooms / n)} × ${n} night${n > 1 ? 's' : ''}`, rm(rooms)),
      quote.extraBed ? row(`Extra bed × ${n} night${n > 1 ? 's' : ''}`, rm(quote.extraBed)) : '',
      `<div class="total"><dt>Total<small>Malaysian ringgit</small></dt><dd>${rm(total)}</dd></div>`,
    ].join('');
    $('[data-co-cancel]').textContent = r.cancellation;
    $('[data-co-taxnote]').textContent = quote.taxNote;
  }
  paint();

  const errEl = $('[data-err]');
  function err(t: string) { errEl.textContent = t; }
  function shut(t: string) {
    closed = true;
    err(t);
    go.setAttribute('aria-disabled', 'true');
    paint(); refresh();
  }
  availability(q.get('in')!, q.get('out')!, guests, [type]).then((av) => {
    quote = av.quotes.find((x) => x.type === type) ?? null;
    if (!quote || !quote.available) { shut(quote && quote.short !== 'Sold out' ? quote.reason : 'Sorry, those dates have just gone for this suite. Please pick others.'); quote = null; }
    plan = quote?.plan ?? null;
    rates(); paint(); refresh();
  }).catch(() => {
    // the team can still price it: the message says the price is to be confirmed
    $('[data-co-lines]').innerHTML = '<div><dt>We will confirm your price.</dt><dd></dd></div>';
  });

  // keep what they typed if they go back and forth
  const KEY = 'kozi-guest';
  const FIELDS = ['name', 'arrival', 'notes'];
  const field = (k: string) => form.elements.namedItem(k) as HTMLInputElement;
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || '{}') as Record<string, string>;
    for (const k of FIELDS) { const f = field(k); if (f && saved[k] && !f.value) f.value = saved[k]; }
  } catch { /* private mode */ }
  form.addEventListener('change', () => refresh());
  form.addEventListener('input', (e) => {
    if ((e.target as HTMLInputElement).name === 'plan') return;
    refresh();
    let saved: Record<string, string> = {};
    try { saved = JSON.parse(sessionStorage.getItem(KEY) || '{}'); } catch { /* private mode */ }
    for (const k of FIELDS) saved[k] = field(k).value;
    try { sessionStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode */ }
  });

  // the stay, written out for the team
  function message() {
    const r = rate();
    const name = field('name').value.trim(), arrival = field('arrival').value, notes = field('notes').value.trim();
    return [
      'Hi Kozi, I would like to book this stay:',
      '',
      `${src.dataset.name}, ${src.dataset.building}`,
      `Check-in: ${fmtDayYear(a!)}`,
      `Check-out: ${fmtDayYear(b!)} (${n} night${n > 1 ? 's' : ''})`,
      `Guests: ${guests}${guests > 4 ? ' (one on the extra bed)' : ''}`,
      r ? `Rate: ${r.name}, ${rm(r.public.total)} in total` : 'Price: please confirm',
      name ? `Name: ${name}` : null,
      arrival ? `Arrival: ${arrival}` : null,
      notes ? `Note: ${notes}` : null,
      '',
      `From ${location.host}`,
    ].filter((line) => line !== null).join('\n');
  }

  // the button is a link to WhatsApp (or an email), so it opens as a link does, a new tab or a copied link included:
  // it always carries the stay as it stands, and has no address while these dates can't be booked
  function refresh() {
    if (closed) { go.removeAttribute('href'); go.setAttribute('role', 'link'); go.tabIndex = 0; return; }
    const text = message();
    go.href = wa
      ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}`
      : `mailto:${root.dataset.email}?subject=${encodeURIComponent(`Booking: ${src.dataset.name}, ${fmtDayYear(a!)} to ${fmtDayYear(b!)}`)}&body=${encodeURIComponent(text)}`;
  }
  refresh();
  go.addEventListener('click', (e) => {
    if (closed) { e.preventDefault(); return; }
    const f = field('name');
    f.removeAttribute('aria-invalid');
    if (f.value.trim().length < 2) {
      e.preventDefault();
      f.setAttribute('aria-invalid', 'true'); f.focus(); err('Please add your name.');
      return;
    }
    err('');
    refresh();
  });
  // Enter in a field sends it the same way
  form.addEventListener('submit', (e) => { e.preventDefault(); go.click(); });
}
