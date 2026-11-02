/* The unit file's rules (api/_lib/shared/unitdue.cjs, the same module the page uses as O.unitdue): when rent and bills
 * are next due, overdue flags, the tenancy end reminder and what the Dashboard's "Due soon" card lists.
 *
 *   node --test tests/unitfile.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import F from '../api/_lib/shared/unitdue.cjs';

const T = '2026-11-02';

test('rent: due day, overdue until marked paid, months without that day', () => {
  const lease = { rent: 3200, dueDay: 1, start: '2026-01-01', createdOn: '2026-10-15' };
  /* saved on 15 Oct, due on the 1st: 1 Nov has passed unpaid */
  assert.deepEqual(F.nextRent(lease, T), { date: '2026-11-01', overdue: true });
  /* paid: the next is 1 Dec */
  const paid = F.markPaid({ lease }, { kind: 'rent' }, T);
  assert.equal(paid.lease.paidUntil, '2026-11-01');
  assert.equal(lease.paidUntil, undefined, 'the input is not changed');
  assert.deepEqual(F.nextRent(paid.lease, T), { date: '2026-12-01', overdue: false });
  /* the 31st in a 30-day month is the 30th */
  assert.equal(F.nextRent({ rent: 1, dueDay: 31, createdOn: '2026-11-01' }, T).date, '2026-11-30');
  assert.equal(F.nextRent({ rent: 1, dueDay: 31, paidUntil: '2027-01-31' }, T).date, '2027-02-28');
  /* nothing to tell */
  assert.equal(F.nextRent({ rent: 0, dueDay: 1 }, T), null);
  assert.equal(F.nextRent({ rent: 100 }, T), null);
  /* paid to the end of the tenancy */
  assert.equal(F.nextRent({ rent: 100, dueDay: 1, end: '2026-11-30', paidUntil: '2026-11-01' }, T), null);
});

test('bills: monthly by day, others by date and frequency, autopay never overdue', () => {
  assert.deepEqual(F.nextBill({ freq: 'monthly', dueDay: 10, createdOn: '2026-10-20' }, T), { date: '2026-11-10', overdue: false });
  assert.deepEqual(F.nextBill({ freq: 'monthly', dueDay: 25, createdOn: '2026-10-20' }, T), { date: '2026-10-25', overdue: true });
  assert.deepEqual(F.nextBill({ freq: 'monthly', dueDay: 25, createdOn: '2026-10-20', autopay: true }, T), { date: '2026-11-25', overdue: false });
  /* quarterly from a date: unpaid past it is overdue; marked paid moves it a quarter on */
  const q = { id: 'b1', freq: 'quarterly', nextDue: '2026-10-31', paidBy: 'us' };
  assert.deepEqual(F.nextBill(q, T), { date: '2026-10-31', overdue: true });
  const d = F.markPaid({ bills: [q] }, { kind: 'bill', billId: 'b1' }, T);
  assert.equal(d.bills[0].lastPaid, '2026-10-31');
  assert.deepEqual(F.nextBill(d.bills[0], T), { date: '2027-01-31', overdue: false });
  /* the end of a month stays the end of the month (no drift: 31 Jan -> 30 Apr -> 31 Jul) */
  assert.equal(F.nextBill({ freq: 'quarterly', nextDue: '2026-01-31', lastPaid: '2026-04-30' }, T).date, '2026-07-31');
  /* yearly autopay: the next date on or after today */
  assert.deepEqual(F.nextBill({ freq: 'yearly', nextDue: '2024-03-15', autopay: true }, T), { date: '2027-03-15', overdue: false });
  assert.equal(F.nextBill({ freq: 'yearly' }, T), null);
});

test('tenancy end reminder', () => {
  assert.equal(F.tenancyEnd({ end: '2027-03-01' }, T).due, false);
  const t = F.tenancyEnd({ end: '2026-12-15' }, T);
  assert.equal(t.due, true); assert.equal(t.from, '2026-10-16'); assert.equal(t.daysLeft, 43); assert.equal(t.ended, false);
  assert.equal(F.tenancyEnd({ end: '2026-12-15', reminderDays: 30 }, T).due, false);
  assert.equal(F.tenancyEnd({ end: '2026-10-30', reminderDays: 0 }, T).ended, true);
});

test('Due soon: our rent and bills in the next 7 days, overdue first, tenancies in their window', () => {
  const files = [
    { propertyId: 'kls', data: {
      lease: { rent: 3200, dueDay: 5, createdOn: '2026-10-20', end: '2026-12-01' },
      bills: [
        { id: 'i', type: 'internet', freq: 'monthly', dueDay: 8, amount: 129, paidBy: 'us', createdOn: '2026-10-20' },
        { id: 'w', type: 'water', freq: 'monthly', dueDay: 3, amount: 40, paidBy: 'owner', createdOn: '2026-10-20' },
        { id: 'e', type: 'electricity', freq: 'monthly', dueDay: 28, amount: 210, paidBy: 'us', createdOn: '2026-10-20' },
        { id: 'm', type: 'maintenance', freq: 'quarterly', nextDue: '2026-12-31', amount: 900, paidBy: 'us' },
        { id: 'o', type: 'other', provider: 'Pest control', freq: 'monthly', dueDay: 4, amount: 60, createdOn: '2026-11-01' }
      ] } },
    { propertyId: 'or4', data: { lease: { rent: 2800, dueDay: 20, createdOn: '2026-10-01' } } },
    { propertyId: 'x', data: null }
  ];
  const list = F.dueSoon(files, T);
  /* or4's rent on 20 Oct passed unpaid: overdue, listed first */
  assert.deepEqual(list.map((x) => [x.key, x.date, x.overdue]), [
    ['rent:or4', '2026-10-20', true],
    ['bill:kls:e', '2026-10-28', true],
    ['bill:kls:o', '2026-11-04', false],
    ['rent:kls', '2026-11-05', false],
    ['bill:kls:i', '2026-11-08', false],
    ['tenancy:kls', '2026-12-01', false]
  ]);
  assert.equal(list[2].title, 'Pest control');
  assert.equal(list[3].amount, 3200);
  assert.equal(list[5].days, 29);
  /* marked paid, it leaves the list */
  assert.deepEqual(F.dueSoon([{ propertyId: 'or4', data: F.markPaid(files[1].data, { kind: 'rent' }, T) }], T), []);
  assert.deepEqual(F.dueSoon([], T), []);
});

test('documents: allowed types and size, safe stored names, masked numbers', () => {
  assert.equal(F.checkDoc('application/pdf', 1000), '');
  assert.equal(F.checkDoc('image/HEIC', 1000), '');
  assert.match(F.checkDoc('application/zip', 1000), /PDF or a photo/);
  assert.match(F.checkDoc('application/pdf', 21 * 1024 * 1024), /20 MB/);
  assert.match(F.checkDoc('application/pdf', 0), /empty/);
  assert.equal(F.safeName('Tenancy agreement (signed).pdf'), 'Tenancy-agreement-signed-.pdf');
  assert.equal(F.safeName('../../etc/passwd'), 'etc-passwd');
  assert.equal(F.safeName(''), 'document');
  assert.ok(!F.safeName('a/b\\c').includes('/'));
  assert.equal(F.mask('1234 5678 XXXX'), '•••• XXXX');
  assert.equal(F.mask('12'), '12');
  assert.equal(F.mask(''), '');
});

test('rent entered for the first time counts from that day, not from when the file was first saved', () => {
  /* saved on 6 Oct with only the owner's bank; on 2 Nov the rent and due day 10 are added */
  const first = F.restartRent({ createdOn: '2026-10-06' }, { rent: 3000, dueDay: 10, createdOn: '2026-10-06' }, T);
  assert.equal(first.createdOn, T);
  assert.deepEqual(F.nextRent(first, T), { date: '2026-11-10', overdue: false });
  /* a changed due day starts again and drops the last payment marked */
  const moved = F.restartRent({ rent: 3000, dueDay: 10, createdOn: '2026-10-06', paidUntil: '2026-10-10' }, { rent: 3000, dueDay: 5 }, T);
  assert.equal(moved.createdOn, T);
  assert.equal(moved.paidUntil, undefined);
  /* rent added to an existing due day also starts again */
  assert.equal(F.restartRent({ dueDay: 10, createdOn: '2026-10-06' }, { rent: 3000, dueDay: 10 }, T).createdOn, T);
  /* a new amount on the same day keeps counting and keeps the last payment */
  const same = F.restartRent({ rent: 3000, dueDay: 10, createdOn: '2026-10-06', paidUntil: '2026-10-10' }, { rent: 3200, dueDay: 10 }, T);
  assert.equal(same.createdOn, '2026-10-06');
  assert.equal(same.paidUntil, '2026-10-10');
  /* nothing filed before: today */
  assert.equal(F.restartRent(undefined, { rent: 3000, dueDay: 10 }, T).createdOn, T);
});
