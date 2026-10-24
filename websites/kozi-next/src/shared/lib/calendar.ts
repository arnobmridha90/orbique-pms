// A date-range calendar: pick check-in, then check-out. Keyboard works like a grid
// (arrows by day and week, Home/End, Page Up/Down by month, Enter to pick), and the
// nights in between preview as you hover. Days can carry a price and can be closed.
import { addDays, addMonths, fmtLong, fmtMonth, iso, nights, sameDay, todayKL } from './dates';

export type Range = { start: Date | null; end: Date | null };
type Opts = {
  months?: number;            // months shown side by side (desktop) or stacked (sheet)
  stacked?: boolean;          // a scrolling list of months, no arrows
  maxNights?: number;
  onChange?: (r: Range) => void;
  price?: (d: Date) => string | null;
  closed?: (d: Date) => boolean;
};

const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export class Calendar {
  range: Range = { start: null, end: null };
  private view: Date;
  private focusDay: Date;
  private min = todayKL();
  private max = addDays(this.min, 365);
  private o: Required<Pick<Opts, 'months' | 'stacked' | 'maxNights'>> & Opts;

  constructor(private el: HTMLElement, opts: Opts = {}) {
    this.o = { months: 2, stacked: false, maxNights: 90, ...opts };
    this.view = new Date(this.min.getFullYear(), this.min.getMonth(), 1);
    this.focusDay = this.min;
    el.classList.add('cal');
    if (this.o.stacked) el.classList.add('cal-stacked');
    el.addEventListener('click', (e) => this.onClick(e));
    el.addEventListener('keydown', (e) => this.onKey(e));
    el.addEventListener('pointerover', (e) => this.onHover(e));
    el.addEventListener('pointerleave', () => this.paint(null));
    this.render();
  }

  set(r: Range) {
    this.range = { ...r };
    if (r.start) { this.focusDay = r.start; if (!this.o.stacked) this.view = new Date(r.start.getFullYear(), r.start.getMonth(), 1); }
    this.render();
  }
  /** Re-render after prices or closures change. */
  refresh() { this.render(); }
  focus() {
    const b = this.el.querySelector<HTMLButtonElement>(`[data-d="${iso(this.focusDay)}"]`) ?? this.el.querySelector<HTMLButtonElement>('[data-d]:not([aria-disabled])');
    b?.focus({ preventScroll: !this.o.stacked });
    if (this.o.stacked) b?.scrollIntoView({ block: 'center' });
  }

  private isClosed(d: Date) { return d < this.min || d > this.max || !!this.o.closed?.(d); }

  private render() {
    const n = this.o.stacked ? 13 : this.o.months;
    const start = this.o.stacked ? new Date(this.min.getFullYear(), this.min.getMonth(), 1) : this.view;
    const canPrev = !this.o.stacked && this.view > new Date(this.min.getFullYear(), this.min.getMonth(), 1);
    const canNext = !this.o.stacked && addMonths(this.view, n - 1) < new Date(this.max.getFullYear(), this.max.getMonth(), 1);
    let html = this.o.stacked ? '' : `<div class="cal-nav"><button type="button" class="cal-arrow" data-step="-1" aria-label="Previous month" ${canPrev ? '' : 'disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><button type="button" class="cal-arrow" data-step="1" aria-label="Next month" ${canNext ? '' : 'disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button></div>`;
    html += '<div class="cal-months">';
    for (let m = 0; m < n; m++) {
      const first = addMonths(start, m);
      const title = fmtMonth(first);
      const lead = (first.getDay() + 6) % 7; // Monday first
      const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      html += `<div class="cal-m"><p class="cal-title" id="cal-${iso(first)}">${title}</p><table role="grid" aria-labelledby="cal-${iso(first)}"><thead><tr>${WEEK.map((w) => `<th scope="col" abbr="${w}">${w[0]}</th>`).join('')}</tr></thead><tbody><tr>`;
      for (let i = 0; i < lead; i++) html += '<td></td>';
      for (let d = 1; d <= days; d++) {
        const day = new Date(first.getFullYear(), first.getMonth(), d);
        const closed = this.isClosed(day);
        const p = !closed && this.o.price ? this.o.price(day) : null;
        const today = sameDay(day, this.min);
        html += `<td><button type="button" class="cal-d${today ? ' is-today' : ''}" data-d="${iso(day)}" tabindex="-1" data-label="${fmtLong(day)}${today ? ', today' : ''}"${closed ? ` data-closed="${day < this.min ? 'past' : 'sold'}"` : ''}><span>${d}</span>${p ? `<small>${p}</small>` : ''}</button></td>`;
        if ((lead + d) % 7 === 0 && d < days) html += '</tr><tr>';
      }
      html += '</tr></tbody></table></div>';
    }
    html += '</div>';
    this.el.innerHTML = html;
    this.paint(null);
  }

  /** Mark the start, end and the nights between (or the hover preview). */
  private paint(hover: Date | null) {
    const { start, end } = this.range;
    const until = end ?? (start && hover && hover > start ? hover : null);
    const co = start && !end ? this.firstClosedAfter(start) : null; // the morning after the last open night
    const fk = iso(this.focusDay);
    let focusable = false;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-d]')) {
      const k = b.dataset.d!;
      const [y, mo, da] = k.split('-').map(Number);
      const d = new Date(y, mo - 1, da);
      const isCo = !!co && sameDay(d, co);
      const off = !!b.dataset.closed && !isCo;
      if (off) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
      b.classList.toggle('is-co', isCo);
      b.setAttribute('aria-label', `${b.dataset.label}${isCo ? ', check-out only' : b.dataset.closed === 'sold' ? ', not available' : ''}`);
      const isS = sameDay(d, start), isE = sameDay(d, end);
      b.classList.toggle('is-start', isS);
      b.classList.toggle('is-end', isE || (!end && !!until && sameDay(d, until)));
      b.classList.toggle('in-range', !!start && !!until && d > start && d < until);
      b.classList.toggle('is-preview', !end && !!until);
      b.classList.toggle('has-range', isS && !!until);
      b.setAttribute('aria-pressed', String(isS || isE));
      b.tabIndex = k === fk ? 0 : -1;
      if (k === fk) focusable = true;
    }
    if (!focusable) { // focus day is in another month: make the first open day tabbable
      const b = this.el.querySelector<HTMLButtonElement>('[data-d]:not([aria-disabled])');
      if (b) b.tabIndex = 0;
    }
  }

  private pick(d: Date) {
    const { start, end } = this.range;
    const checkoutOnly = !!start && !end && sameDay(d, this.firstClosedAfter(start));
    if (this.isClosed(d) && !checkoutOnly) return;
    if (checkoutOnly) this.range = { start, end: d }; // leaving on the morning a sold night begins is fine
    else if (!start || end || d <= start) this.range = { start: d, end: null };
    else if (nights(start, d) > this.o.maxNights) this.range = { start: d, end: null };
    else if (this.blockedBetween(start, d)) this.range = { start: d, end: null };
    else this.range = { start, end: d };
    this.focusDay = d;
    this.paint(null);
    this.o.onChange?.(this.range);
  }
  /** The first sold night after a check-in, which is the last possible check-out day. */
  private firstClosedAfter(a: Date) {
    for (let d = addDays(a, 1), i = 0; i < this.o.maxNights; d = addDays(d, 1), i++) if (d > this.max || this.o.closed?.(d)) return d;
    return null;
  }
  /** A stay can't run across a closed night (check-out on a closed day is fine). */
  private blockedBetween(a: Date, b: Date) {
    for (let d = addDays(a, 1); d < b; d = addDays(d, 1)) if (this.o.closed?.(d)) return true;
    return false;
  }

  private onClick(e: Event) {
    const t = e.target as HTMLElement;
    const step = t.closest<HTMLButtonElement>('[data-step]');
    if (step) { this.view = addMonths(this.view, +step.dataset.step!); this.render(); return; }
    const b = t.closest<HTMLButtonElement>('[data-d]');
    if (b && !b.hasAttribute('aria-disabled')) this.pick(dateOf(b));
  }
  private onHover(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || !this.range.start || this.range.end) return;
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-d]');
    this.paint(b ? dateOf(b) : null);
  }
  private onKey(e: KeyboardEvent) {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-d]');
    if (!b) return;
    const d = dateOf(b);
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addDays(d, -1), ArrowRight: () => addDays(d, 1), ArrowUp: () => addDays(d, -7), ArrowDown: () => addDays(d, 7),
      Home: () => addDays(d, -((d.getDay() + 6) % 7)), End: () => addDays(d, 6 - ((d.getDay() + 6) % 7)),
      PageUp: () => new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), 28)),
      PageDown: () => new Date(d.getFullYear(), d.getMonth() + 1, Math.min(d.getDate(), 28)),
    };
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.pick(d); return; }
    const mv = moves[e.key];
    if (!mv) return;
    e.preventDefault();
    let next = mv();
    if (next < this.min) next = this.min;
    if (next > this.max) next = this.max;
    this.focusDay = next;
    if (!this.o.stacked) {
      const last = addMonths(this.view, this.o.months - 1);
      if (next < this.view) { this.view = new Date(next.getFullYear(), next.getMonth(), 1); this.render(); }
      else if (next >= addMonths(last, 1)) { this.view = addMonths(new Date(next.getFullYear(), next.getMonth(), 1), -(this.o.months - 1)); this.render(); }
      else this.paint(null);
    } else this.paint(null);
    this.focus();
  }
}

function dateOf(b: HTMLElement) {
  const [y, m, d] = b.dataset.d!.split('-').map(Number);
  return new Date(y, m - 1, d);
}
