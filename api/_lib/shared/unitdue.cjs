/* The unit file's rules: bill types, how often bills come, when rent and each bill are next due, and what the
 * Dashboard's "Due soon" card lists. No browser or network code.
 *
 * Arnob: "I also need to have a section where I upload all details about a unit. For example rent, tenancy agreement,
 * wifi password, door lock code, monthly rent amount and date, internet bill amount, payment due date, Water bill
 * account, owner name, number, bank account number and anything else you can possibly think of"
 *
 * A unit file (table unit_files, supabase/migrations/0023_unit_files.sql; one per unit; docs/notes/unit-file.md):
 *   lease:  {rent, dueDay (1-31), method, start, end ('YYYY-MM-DD'), noticeMonths, deposit, utilityDeposit,
 *            reminderDays (default 60), ref, paidUntil (the last rent due date paid), createdOn}
 *   owner:  {type ('person'|'company'), contact, phone2, prefers, address, nationality, idNo, taxNo, bank, holder,
 *            accountNo, swift, payRef}   (name, phone and email are edited here but kept on the property record)
 *   bills:  [{id, type, provider, accountNo, amount, freq, dueDay (monthly), nextDue (other frequencies), paidBy
 *            ('us' | 'owner' | 'rent'), autopay, notes, lastPaid (the last due date paid), createdOn}]
 *   access: {routerUser, routerPass, cards, cardNos, parkingCard, mailbox, mailboxKey, mgmtOffice, guardPhone}
 *   docs:   [{id, path, name, cat, size, mime, at, by}]   (files in the private Storage bucket unit-docs)
 *   notes, updatedAt, updatedBy
 *
 * Shared by the page (inlined by scripts/build.mjs as O.unitdue) and the node tests (tests/unitfile.test.mjs). ES5.
 */
'use strict';

var BILL_TYPES = [
  { id: 'internet', label: 'Internet' },
  { id: 'electricity', label: 'Electricity (TNB)' },
  { id: 'water', label: 'Water (Air Selangor)' },
  { id: 'sewerage', label: 'Sewerage (IWK)' },
  { id: 'maintenance', label: 'Maintenance / service charge (JMB/MC)' },
  { id: 'sinking', label: 'Sinking fund' },
  { id: 'assessment', label: 'Assessment (cukai taksiran)' },
  { id: 'quitrent', label: 'Quit rent (cukai tanah)' },
  { id: 'gas', label: 'Gas' },
  { id: 'tv', label: 'TV / streaming' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'other', label: 'Other' }
];
/* how often a bill comes, in months */
var FREQS = [
  { id: 'monthly', label: 'Monthly', months: 1 },
  { id: 'bimonthly', label: 'Every 2 months', months: 2 },
  { id: 'quarterly', label: 'Quarterly', months: 3 },
  { id: 'halfyearly', label: 'Half-yearly', months: 6 },
  { id: 'yearly', label: 'Yearly', months: 12 }
];
var PAID_BY = [
  { id: 'us', label: 'We pay' },
  { id: 'owner', label: 'Owner pays' },
  { id: 'rent', label: 'Included in rent' }
];
var PAY_METHODS = ['Bank transfer', 'DuitNow', 'Standing instruction', 'Cheque', 'Cash', 'Other'];
var DOC_CATS = [
  { id: 'tenancy', label: 'Tenancy agreement' },
  { id: 'inventory', label: 'Inventory list' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'bill', label: 'Utility bill' },
  { id: 'handover', label: 'Handover photos' },
  { id: 'licence', label: 'Licence / permit' },
  { id: 'other', label: 'Other' }
];
var DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
var DOC_MAX = 20 * 1024 * 1024; /* the bucket's limit (0023) */
var MAX_DOCS = 60;              /* documents per unit */
var MAX_BILLS = 30;             /* bills per unit */
var REMINDER_DAYS = 60;         /* tenancy renewal reminder, days before the end, when none is set */
var HORIZON = 7;                /* "Due soon": the next this many days */

var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isDate(s) { return typeof s === 'string' && DATE_RE.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')); }
function utc(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
function addDays(d, n) { return iso(utc(d) + n * 864e5); }
function daysBetween(a, b) { return Math.round((utc(b) - utc(a)) / 864e5); }
function lastDay(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); } /* m: 0-11 */
/* the date in the month of `d` (+ n months) on day `day` (31 in a 30-day month is the 30th) */
function onDay(d, n, day) {
  var y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + (n || 0);
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  return iso(Date.UTC(y, m, Math.min(day, lastDay(y, m))));
}
function addMonths(d, n) { return onDay(d, n, +d.slice(8, 10)); }
function num(v) { var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : null; }
function dayOf(v) { var n = Math.round(num(v)); return n >= 1 && n <= 31 ? n : null; }
function freqOf(id) { for (var i = 0; i < FREQS.length; i++) if (FREQS[i].id === id) return FREQS[i]; return FREQS[0]; }
function label(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].label; return ''; }

/* the first date on or after `from` that falls on day `day` of a month */
function firstOnDay(from, day) { var x = onDay(from, 0, day); return x >= from ? x : onDay(from, 1, day); }

/* when the rent is next due -> {date, overdue, paidUntil} | null (no rent or no due day).
   Counted from the day after the last payment marked (paidUntil), else from the tenancy start or the day the rent was
   first saved (createdOn), whichever is later, so an unpaid month shows as overdue. */
function nextRent(lease, today) {
  if (!lease || !(num(lease.rent) > 0)) return null;
  var day = dayOf(lease.dueDay); if (!day) return null;
  var from = isDate(lease.paidUntil) ? addDays(lease.paidUntil, 1) : [lease.start, lease.createdOn].filter(isDate).sort().pop() || today;
  if (isDate(lease.end) && from > lease.end) return null; /* paid to the end of the tenancy */
  var date = firstOnDay(from, day);
  if (isDate(lease.end) && date > lease.end) return null;
  return { date: date, overdue: date < today };
}

/* when a bill is next due -> {date, overdue} | null (not enough to tell).
   Monthly bills go by their due day; the others by their next due date, moved on by the frequency past the last
   payment marked. Autopay bills are never overdue: the next date on or after today. */
function nextBill(b, today) {
  if (!b) return null;
  var f = freqOf(b.freq), paid = isDate(b.lastPaid) ? b.lastPaid : null, date;
  if (f.months === 1 && dayOf(b.dueDay)) {
    var from = b.autopay ? today : paid ? addDays(paid, 1) : isDate(b.createdOn) ? b.createdOn : today;
    date = firstOnDay(from, dayOf(b.dueDay));
  } else {
    var anchor = isDate(b.nextDue) ? b.nextDue : null;
    if (!anchor) return null;
    date = anchor;
    var floor = b.autopay ? addDays(today, -1) : paid;
    for (var i = 0; floor && date <= floor && i < 600; i++) date = addMonths(anchor, f.months * (i + 1));
  }
  return { date: date, overdue: !b.autopay && date < today };
}

/* the tenancy end reminder -> {date (the end), from (reminder starts), ended, daysLeft} | null */
function tenancyEnd(lease, today) {
  if (!lease || !isDate(lease.end)) return null;
  var r = num(lease.reminderDays); r = r == null || r < 0 ? REMINDER_DAYS : Math.round(r);
  var from = addDays(lease.end, -r);
  return { date: lease.end, from: from, ended: lease.end < today, daysLeft: daysBetween(today, lease.end), due: today >= from };
}

/* what "Due soon" lists for a set of unit files: files = [{propertyId, data}], today 'YYYY-MM-DD'.
   -> [{key, propertyId, kind ('rent' | 'bill' | 'tenancy'), billId, title, date, amount, overdue, days}], overdue
   first, then by date. Rent and bills we pay that are due in the next `horizon` days (or overdue); tenancies inside
   their reminder window or already ended. Bills the owner pays or that are included in the rent are left out. */
function dueSoon(files, today, horizon) {
  var h = horizon == null ? HORIZON : horizon, until = addDays(today, h), out = [];
  (files || []).forEach(function (f) {
    var d = f && f.data; if (!d || !f.propertyId) return;
    var r = nextRent(d.lease, today);
    if (r && r.date <= until) out.push({ key: 'rent:' + f.propertyId, propertyId: f.propertyId, kind: 'rent', title: 'Rent to the owner', date: r.date, amount: num(d.lease.rent), overdue: r.overdue, days: daysBetween(today, r.date) });
    (Array.isArray(d.bills) ? d.bills : []).forEach(function (b) {
      if (!b || (b.paidBy && b.paidBy !== 'us')) return;
      var n = nextBill(b, today);
      if (n && n.date <= until) out.push({ key: 'bill:' + f.propertyId + ':' + b.id, propertyId: f.propertyId, kind: 'bill', billId: b.id, title: (b.type === 'other' && b.provider) ? b.provider : label(BILL_TYPES, b.type) || b.provider || 'Bill', date: n.date, amount: num(b.amount), overdue: n.overdue, days: daysBetween(today, n.date), autopay: !!b.autopay });
    });
    var t = tenancyEnd(d.lease, today);
    if (t && t.due) out.push({ key: 'tenancy:' + f.propertyId, propertyId: f.propertyId, kind: 'tenancy', title: t.ended ? 'Tenancy ended' : 'Tenancy ends', date: t.date, amount: null, overdue: t.ended, days: t.daysLeft });
  });
  return out.sort(function (a, b) { return (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.key < b.key ? -1 : 1); });
}

/* mark one rent payment or one bill paid: returns the changed copy of the unit file's data (the input is not changed) */
function markPaid(data, item, today) {
  var d = JSON.parse(JSON.stringify(data || {}));
  if (item.kind === 'rent' && d.lease) { var r = nextRent(d.lease, today); if (r) d.lease.paidUntil = r.date; }
  if (item.kind === 'bill' && Array.isArray(d.bills)) d.bills.forEach(function (b) { if (b && b.id === item.billId) { var n = nextBill(b, today); if (n) b.lastPaid = n.date; } });
  return d;
}

/* a stored file name: letters, digits, dot, dash and underscore, at most 80 characters, with its extension */
function safeName(name) {
  var s = String(name || 'document').normalize ? String(name || 'document').normalize('NFKD') : String(name || 'document');
  s = s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return (s || 'document').slice(-80);
}
/* is this a document the bucket takes -> '' or the reason */
function checkDoc(mime, size) {
  if (DOC_TYPES.indexOf(String(mime || '').toLowerCase()) < 0) return 'Add a PDF or a photo (JPEG, PNG, WebP or HEIC).';
  if (!(size > 0)) return 'This file is empty.';
  if (size > DOC_MAX) return 'This file is larger than 20 MB.';
  return '';
}
/* a saved lease's counting start: when the due day or the rent is new or changed (including from empty), rent counts
   again from today and earlier payments marked no longer apply, so months before it was entered never show as overdue */
function restartRent(oldLease, lease, today) {
  var o = oldLease || {}, out = Object.assign({}, lease);
  var had = num(o.rent) != null, has = num(out.rent) != null;
  if (dayOf(out.dueDay) !== dayOf(o.dueDay) || had !== has) { out.createdOn = today; delete out.paidUntil; }
  else { out.createdOn = isDate(o.createdOn) ? o.createdOn : today; if (isDate(o.paidUntil)) out.paidUntil = o.paidUntil; else delete out.paidUntil; }
  return out;
}

/* "1234 5678 9012" -> "•••• 9012" for lists; the whole number shows only on the unit file itself */
function mask(s, keep) {
  s = String(s || '').trim(); if (!s) return '';
  var k = keep == null ? 4 : keep, tail = s.replace(/\s+/g, '').slice(-k);
  return s.replace(/\s+/g, '').length <= k ? s : '•••• ' + tail;
}

module.exports = {
  BILL_TYPES: BILL_TYPES, FREQS: FREQS, PAID_BY: PAID_BY, PAY_METHODS: PAY_METHODS, DOC_CATS: DOC_CATS, DOC_TYPES: DOC_TYPES,
  DOC_MAX: DOC_MAX, MAX_DOCS: MAX_DOCS, MAX_BILLS: MAX_BILLS, REMINDER_DAYS: REMINDER_DAYS, HORIZON: HORIZON,
  isDate: isDate, addDays: addDays, addMonths: addMonths, daysBetween: daysBetween, num: num, label: label, freqOf: freqOf,
  nextRent: nextRent, nextBill: nextBill, tenancyEnd: tenancyEnd, dueSoon: dueSoon, markPaid: markPaid, restartRent: restartRent,
  safeName: safeName, checkDoc: checkDoc, mask: mask
};
