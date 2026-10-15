/* update-operator (api/account.js) against an in-memory stand-in for the Supabase admin client. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { updateOperator } from '../api/account.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function fake() {
  const db = {
    platform_admins: [{ user_id: 'admin' }],
    orgs: [{ id: ORG, name: 'Old Co', plan: 'trial', status: 'active' }, { id: OTHER, name: 'Second', plan: 'trial', status: 'active' }],
    members: [
      { org_id: ORG, user_id: 'u1', staff_id: 'S-1', role: 'owner', status: 'active' },
      { org_id: ORG, user_id: 'u2', staff_id: 'S-2', role: 'ops', status: 'active' },
      { org_id: OTHER, user_id: 'u1', staff_id: 'S-9', role: 'owner', status: 'active' }
    ],
    records: [{ org_id: ORG, coll: 'staff', id: 'S-1', deleted: false, data: { id: 'S-1', name: 'Old Name', initials: 'ON', role: 'owner', email: 'old@x.my' } }]
  };
  const users = { u1: { id: 'u1', email: 'old@x.my', user_metadata: { name: 'Old Name', must_change_password: false } }, u2: { id: 'u2', email: 'taken@x.my', user_metadata: {} } };
  const userUpdates = [];
  function q(table) {
    const f = []; let op = 'select'; let patch = null;
    const rows = () => db[table].filter((r) => f.every((p) => p(r)));
    const api = {
      select() { return api; },
      update(p) { op = 'update'; patch = p; return api; },
      eq(k, v) { f.push((r) => r[k] === v); return api; },
      neq(k, v) { f.push((r) => r[k] !== v); return api; },
      maybeSingle() { const r = rows(); return Promise.resolve({ data: r[0] || null, error: null }); },
      then(res, rej) {
        if (op === 'update') rows().forEach((r) => Object.assign(r, patch));
        return Promise.resolve({ data: op === 'update' ? null : rows(), error: null }).then(res, rej);
      }
    };
    return api;
  }
  const sb = {
    from: q,
    rpc(name, args) { const u = Object.values(users).find((x) => x.email === args.p_email); return Promise.resolve({ data: u ? u.id : null, error: null }); },
    auth: { admin: {
      getUserById(id) { return Promise.resolve({ data: { user: users[id] || null }, error: null }); },
      updateUserById(id, p) { userUpdates.push([id, p]); if (p.email) users[id].email = p.email; if (p.user_metadata) users[id].user_metadata = p.user_metadata; return Promise.resolve({ data: {}, error: null }); }
    } }
  };
  return { sb, db, users, userUpdates };
}

const admin = { id: 'admin' };

test('renames the company and changes owner name and email everywhere it shows', async () => {
  const { sb, db, users } = fake();
  const r = await updateOperator(sb, { orgId: ORG, company: 'New Co', staffId: 'S-1', ownerName: 'Nur Aisyah', ownerEmail: 'New@X.my' }, admin);
  assert.deepEqual(r, { emailChanged: true, otherWorkspaces: 1 });
  assert.equal(db.orgs[0].name, 'New Co');
  assert.equal(users.u1.email, 'new@x.my');
  assert.equal(users.u1.user_metadata.name, 'Nur Aisyah');
  assert.equal(users.u1.user_metadata.must_change_password, false);
  assert.deepEqual(db.records[0].data, { id: 'S-1', name: 'Nur Aisyah', initials: 'NA', role: 'owner', email: 'new@x.my' });
});

test('only platform admins may change details', async () => {
  const { sb } = fake();
  await assert.rejects(updateOperator(sb, { orgId: ORG, company: 'X' }, { id: 'u1' }), /platform admins/);
});

test('refuses an email that already belongs to someone else, before changing anything', async () => {
  const { sb, db, userUpdates } = fake();
  await assert.rejects(updateOperator(sb, { orgId: ORG, company: 'New Co', staffId: 'S-1', ownerName: 'X', ownerEmail: 'taken@x.my' }, admin), /already has an Orbique account/);
  assert.equal(db.orgs[0].name, 'Old Co');
  assert.equal(userUpdates.length, 0);
});

test('only an owner of that workspace can be edited', async () => {
  const { sb } = fake();
  await assert.rejects(updateOperator(sb, { orgId: ORG, staffId: 'S-2', ownerName: 'X', ownerEmail: 'taken@x.my' }, admin), /owner was not found/);
  await assert.rejects(updateOperator(sb, { orgId: OTHER, staffId: 'S-1', ownerName: 'X', ownerEmail: 'a@b.my' }, admin), /owner was not found/);
});

test('does not change the sign-in email of a platform admin', async () => {
  const { sb, db } = fake();
  db.platform_admins.push({ user_id: 'u1' });
  await assert.rejects(updateOperator(sb, { orgId: ORG, staffId: 'S-1', ownerName: 'Old Name', ownerEmail: 'other@x.my' }, admin), /platform admin/);
});

test('company name alone leaves the owner untouched', async () => {
  const { sb, db, userUpdates } = fake();
  const r = await updateOperator(sb, { orgId: ORG, company: '  Seri  Co ' }, admin);
  assert.equal(db.orgs[0].name, 'Seri Co');
  assert.equal(r.emailChanged, false);
  assert.equal(userUpdates.length, 0);
});

test('a blank company name is refused', async () => {
  const { sb } = fake();
  await assert.rejects(updateOperator(sb, { orgId: ORG, company: '   ' }, admin), /company name/i);
});
