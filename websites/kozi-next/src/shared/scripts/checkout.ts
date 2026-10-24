// Checkout: reads the stay from the address (suite, dates, guests), prices it, offers its rates (Flexible or
// Non-refundable), checks the form, then hands over to payment. Members see and pay the member price.
import { availability, checkout, getMember, rm, TEST_MODE, type Member, type Quote, type Rate, type SuiteType } from '@shared/lib/api';
import { fmtDayYear, fromIso, nights as countNights, todayKL } from '@shared/lib/dates';

const TYPES: SuiteType[] = ['standard', 'boutique', 'premium'];

export function init(root: HTMLElement) {
  const $ = <T extends Element = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const q = new URLSearchParams(location.search);
  const type = q.get('type') as SuiteType;
  const a = fromIso(q.get('in')), b = fromIso(q.get('out'));
  const guests = Math.min(5, Math.max(1, Number(q.get('guests')) || 2));
  const ok = TYPES.includes(type) && a && b && b > a && a >= todayKL() && countNights(a, b) <= 60;
  if (!ok) { root.classList.add('empty'); $('[data-co-gone]').hidden = false; return; }
  $('[data-co-backnote]').hidden = q.get('back') !== '1';

  const n = countNights(a!, b!);
  const form = $<HTMLFormElement>('[data-co-form]');
  let member = !!getMember();
  let quote: Quote | null = null;
  let plan: string | null = null;
  $('[data-co-test]').hidden = !TEST_MODE;
  if (TEST_MODE) $('[data-co-go-label]').textContent = 'Make a test booking';

  // the suite
  const tpl = document.querySelector<HTMLTemplateElement>('template[data-co-photos]')!;
  const src = tpl.content.querySelector<HTMLElement>(`[data-for="${type}"]`)!;
  $('[data-co-media]').append(...src.cloneNode(true).childNodes);
  $('[data-co-name]').textContent = src.dataset.name!;
  $('[data-co-level]').textContent = src.dataset.level!;
  $('[data-co-in]').textContent = fmtDayYear(a!);
  $('[data-co-out]').textContent = fmtDayYear(b!);
  $('[data-co-who]').textContent = `${n} night${n > 1 ? 's' : ''} · ${guests} guest${guests > 1 ? 's' : ''}${guests > 4 ? ' (one on the extra bed)' : ''}`;
  const back = $<HTMLAnchorElement>('[data-co-back]');
  back.href = `/kuala-lumpur/vortex-klcc/${type}/`;
  $('[data-co-back-label]').textContent = `Back to the ${src.dataset.name}`;

  const rate = (): Rate | null => quote?.rates.find((r) => r.plan === plan) ?? quote?.rates[0] ?? null;
  const side = (r: Rate) => (member ? r.member : r.public);

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
      const less = flex && !r.refundable ? side(flex).total - side(r).total : 0;
      if (less >= 0.01) note.append(Object.assign(document.createElement('em'), { textContent: `${rm(less)} less. ` }));
      // the card's name already says "Non-refundable", so the note drops it from the front
      const why = r.cancellation.replace(/^non-refundable:\s*/i, '');
      note.append(why.charAt(0).toUpperCase() + why.slice(1));
      t.append(name, note);
      const p = Object.assign(document.createElement('span'), { className: 'co-rate-p', textContent: rm(side(r).total) });
      el.append(input, t, p);
      return el;
    }));
  }
  rateList.addEventListener('change', (e) => { plan = (e.target as HTMLInputElement).value; paint(); });

  function paint() {
    const lines = $('[data-co-lines]');
    const r = rate();
    if (!quote || !r) { lines.innerHTML = '<div><dt>Getting your price…</dt><dd></dd></div>'; return; }
    const total = side(r).total, rooms = total - quote.extraBed;
    const save = r.public.total - r.member.total;
    const row = (k: string, v: string, cls = '') => `<div${cls ? ` class="${cls}"` : ''}><dt>${k}</dt><dd>${v}</dd></div>`;
    lines.innerHTML = [
      row(`${rm(rooms / n)} × ${n} night${n > 1 ? 's' : ''}`, rm(rooms)),
      quote.extraBed ? row(`Extra bed × ${n} night${n > 1 ? 's' : ''}`, rm(quote.extraBed)) : '',
      member && save >= 0.01 ? row('Your member saving', `−${rm(save)}`, 'save') : '',
      `<div class="total"><dt>Total<small>Malaysian ringgit</small></dt><dd>${rm(total)}</dd></div>`,
    ].join('');
    $('[data-co-mem-line]').textContent = save >= 0.01 ? `Members pay ${rm(r.member.total)} for these dates, ${rm(save)} less.` : '';
    $('[data-co-cancel]').textContent = r.cancellation;
    $('[data-co-taxnote]').textContent = quote.taxNote;
    if (!TEST_MODE) $('[data-co-go-label]').textContent = `Pay ${rm(total)}`;
    rateList.querySelectorAll<HTMLElement>('.co-rate').forEach((el, i) => { el.querySelector('.co-rate-p')!.textContent = rm(side(quote!.rates[i]).total); });
  }
  paint();

  availability(q.get('in')!, q.get('out')!, guests).then((av) => {
    quote = av.quotes.find((x) => x.type === type) ?? null;
    if (!quote || !quote.available) {
      err(quote && quote.short !== 'Sold out' ? quote.reason : 'Sorry, those dates have just gone for this suite. Please pick others.');
      $<HTMLButtonElement>('[data-co-go]').disabled = true;
    }
    plan = quote?.plan ?? null;
    rates(); paint();
  }).catch((x) => err((x as Error).message || 'We could not get your price. Please refresh the page.'));

  document.addEventListener('kozi:member', (e) => { member = !!(e as CustomEvent<Member | null>).detail; rates(); paint(); prefill(); });

  // the tourism tax depends on nationality
  const country = form.elements.namedItem('country') as HTMLSelectElement;
  const tax = () => {
    const v = country.value;
    $('[data-co-tax]').textContent = !v ? '' : v === 'MY'
      ? 'Malaysian citizens pay no tourism tax.'
      : `Malaysia charges non-Malaysian guests a tourism tax of RM10 per room per night (${rm(10 * n)} for your stay). It is paid at check-in and is not included in this price.`;
  };
  country.addEventListener('change', tax);

  const prefill = () => {
    const m = getMember();
    const email = form.elements.namedItem('email') as HTMLInputElement;
    if (m && !email.value) email.value = m.email;
  };
  prefill();

  // keep what they typed if they go back and forth
  const KEY = 'kozi-guest';
  const FIELDS = ['name', 'email', 'phone', 'country', 'arrival', 'notes'];
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || '{}') as Record<string, string>;
    for (const k of FIELDS) { const f = form.elements.namedItem(k) as HTMLInputElement | null; if (f && saved[k] && !f.value) f.value = saved[k]; }
    tax();
  } catch { /* private mode */ }
  form.addEventListener('input', (e) => {
    if ((e.target as HTMLInputElement).name === 'plan') return;
    const d: Record<string, string> = {};
    for (const k of FIELDS) d[k] = (form.elements.namedItem(k) as HTMLInputElement).value;
    try { sessionStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode */ }
  });

  const errEl = $('[data-err]');
  function err(t: string) { errEl.textContent = t; }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = (k: string) => form.elements.namedItem(k) as HTMLInputElement;
    const checks: [string, boolean, string][] = [
      ['name', f('name').value.trim().length >= 2, 'Please add the name of the main guest.'],
      ['email', /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f('email').value.trim()), 'Please check the email address.'],
      ['phone', f('phone').value.replace(/\D/g, '').length >= 7, 'Please add a mobile number we can reach you on.'],
      ['country', !!f('country').value, 'Please choose a nationality.'],
      ['agree', f('agree').checked, 'Please agree to the house rules and the cancellation policy.'],
    ];
    for (const [k] of checks) f(k).removeAttribute('aria-invalid');
    const bad = checks.find(([, good]) => !good);
    if (bad) { f(bad[0]).setAttribute('aria-invalid', 'true'); f(bad[0]).focus(); err(bad[2]); return; }
    if (!quote?.available) { err('Those dates are not open any more. Please go back and pick others.'); return; }
    err('');
    const go = $<HTMLButtonElement>('[data-co-go]');
    go.setAttribute('aria-busy', 'true');
    try {
      const r = await checkout({ type, checkIn: q.get('in')!, checkOut: q.get('out')!, guests, plan: rate()?.plan ?? null, name: f('name').value.trim(), email: f('email').value.trim(), phone: f('phone').value.trim(), country: f('country').value, arrival: f('arrival').value || undefined, notes: f('notes').value.trim() || undefined });
      location.href = r.url;
    } catch (x) {
      err((x as Error).message || 'Something went wrong. Please try again.');
      go.setAttribute('aria-busy', 'false');
    }
  });
}
