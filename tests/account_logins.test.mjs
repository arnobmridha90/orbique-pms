/* Signing in with a mobile number or username, and the owner setting a team member's sign-in (api/account.js,
 * api/_lib/logins.js), against an in-memory stand-in for the Supabase admin client. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { invite, setLogin, resetPassword } from '../api/account.js';
import { loginKind, phoneLogin, username, signInWithLogin, isStandIn, FAIL_LIMIT } from '../api/_lib/logins.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OWNER = { id: 'u-owner' };

function fake() {
  const db = {
    platform_admins: [],
    orgs: [{ id: ORG, name: 'Kozi', plan: 'pro', status: 'active' }, { id: OTHER, name: 'Other', plan: 'trial', status: 'active' }],
    members: [{ org_id: ORG, user_id: 'u-owner', staff_id: 'S-OWN', role: 'owner', status: 'active' }, { org_id: OTHER, user_id: 'u-other-owner', staff_id: 'S-X', role: 'owner', status: 'active' }],
    records: [],
    login_names: [],
    login_failures: []
  };
  const users = { 'u-owner': { id: 'u-owner', email: 'owner@kozi.my', user_metadata: { name: 'Owner' } } };
  let n = 0;
  const passwords = {};
  function q(table) {
    const f = []; let op = 'select'; let payload = null; let opts = {};
    const rows = () => db[table].filter((r) => f.every((p) => p(r)));
    const api = {
      select(cols, o) { if (o) opts = o; return api; },
      insert(p) { op = 'insert'; payload = p; return api; },
      upsert(p) { op = 'upsert'; payload = p; return api; },
      update(p) { op = 'update'; payload = p; return api; },
      delete() { op = 'delete'; return api; },
      eq(k, v) { f.push((r) => r[k] === v); return api; },
      neq(k, v) { f.push((r) => r[k] !== v); return api; },
      in(k, v) { f.push((r) => v.includes(r[k])); return api; },
      gte(k, v) { f.push((r) => r[k] >= v); return api; },
      lt(k, v) { f.push((r) => r[k] < v); return api; },
      maybeSingle() { return api.then((r) => ({ data: (r.data || [])[0] || null, error: r.error })); },
      single() { return api.maybeSingle(); },
      then(res, rej) {
        let out = { data: null, error: null };
        if (op === 'select') { const r = rows(); out = opts.head ? { count: r.length, data: null, error: null } : { data: r.map((x) => Object.assign({}, x)), error: null }; }
        if (op === 'insert') {
          const list = [].concat(payload);
          if (table === 'login_names' && list.some((x) => db.login_names.some((y) => (y.kind === x.kind && y.login === x.login) || (y.user_id === x.user_id && y.kind === x.kind)))) out = { data: null, error: { code: '23505', message: 'dup' } };
          else db[table].push(...list.map((x) => Object.assign({}, x)));
        }
        if (op === 'upsert') {
          for (const x of [].concat(payload)) {
            const keyOf = table === 'members' ? (r) => r.org_id + r.user_id : (r) => r.org_id + r.coll + r.id;
            const i = db[table].findIndex((r) => keyOf(r) === keyOf(x));
            if (i >= 0) Object.assign(db[table][i], x); else db[table].push(Object.assign({}, x));
          }
        }
        if (op === 'update') rows().forEach((r) => Object.assign(r, payload));
        if (op === 'delete') { const gone = new Set(rows()); db[table] = db[table].filter((r) => !gone.has(r)); }
        return Promise.resolve(out).then(res, rej);
      }
    };
    return api;
  }
  const sb = {
    from: q,
    rpc(name, args) { const u = Object.values(users).find((x) => x.email === args.p_email); return Promise.resolve({ data: u ? u.id : null, error: null }); },
    auth: { admin: {
      createUser({ email, password, user_metadata }) {
        if (Object.values(users).some((u) => u.email === email)) return Promise.resolve({ data: null, error: { code: 'email_exists', message: 'exists' } });
        const id = 'u' + (++n); users[id] = { id, email, user_metadata }; passwords[id] = password;
        return Promise.resolve({ data: { user: users[id] }, error: null });
      },
      getUserById(id) { return Promise.resolve({ data: { user: users[id] || null }, error: null }); },
      updateUserById(id, p) { if (p.password) passwords[id] = p.password; if (p.user_metadata) users[id].user_metadata = p.user_metadata; return Promise.resolve({ data: {}, error: null }); },
      deleteUser(id) { delete users[id]; return Promise.resolve({ data: {}, error: null }); }
    } }
  };
  // what Supabase does for signInWithPassword, for signInWithLogin
  const client = () => ({ auth: { signInWithPassword({ email, password }) {
    const u = Object.values(users).find((x) => x.email === email);
    return Promise.resolve(u && passwords[u.id] === password ? { data: { session: { access_token: 'AT-' + u.id, refresh_token: 'RT', expires_in: 3600, token_type: 'bearer', user: u } }, error: null } : { data: {}, error: { status: 400, message: 'Invalid login credentials' } });
  } } });
  return { sb, db, users, passwords, client };
}

test('what someone typed to sign in: email, mobile number or username; stored forms', () => {
  assert.equal(loginKind('aina@kozi.my'), 'email');
  assert.equal(loginKind('+60 12-345 6789'), 'phone');
  assert.equal(loginKind('012-345 6789'), 'phone');
  assert.equal(loginKind('Aina.K'), 'username');
  assert.equal(loginKind('x'), null);
  assert.equal(phoneLogin('+60 12-345 6789'), '60123456789');
  assert.equal(phoneLogin('012-345 6789'), '60123456789');
  assert.equal(phoneLogin('0065 8123 4567'), '6581234567');
  assert.throws(() => phoneLogin('12'), /does not look right/);
  assert.equal(username(' Aina.K '), 'aina.k');
  assert.throws(() => username('1abc'), /starting with a letter/);
});

test('a person with no email: the owner gives a username and mobile sign-in and a password; they sign in with either', async () => {
  const { sb, db, users, client } = fake();
  const r = await invite(sb, { orgId: ORG, staffId: 'S-1', name: 'Aina Karim', phone: '+60 12-345 6789', role: 'housekeeping', username: 'Aina.K', phoneLogin: true, password: 'sunrise-2026' }, OWNER);
  assert.deepEqual([r.email, r.username, r.phone, r.tempPassword, r.passwordSet, r.existing], [null, 'aina.k', '+60123456789', null, true, false]);
  const u = Object.values(users).find((x) => x.user_metadata && x.user_metadata.name === 'Aina Karim');
  assert.ok(isStandIn(u.email));
  assert.equal(u.user_metadata.must_change_password, false);
  assert.equal(u.user_metadata.login_only, true);
  const staff = db.records.find((x) => x.coll === 'staff' && x.id === 'S-1').data;
  assert.deepEqual([staff.email, staff.username, staff.loginPhone], ['', 'aina.k', '+60123456789']);
  assert.equal(JSON.stringify(staff).includes('login.orbiquepms.com'), false);

  for (const login of ['aina.k', 'AINA.K', '+60 12-345 6789', '012-345 6789']) {
    const s = await signInWithLogin(sb, { login, password: 'sunrise-2026' }, { client });
    assert.equal(s.access_token, 'AT-' + u.id, login);
  }
  await assert.rejects(signInWithLogin(sb, { login: 'aina.k', password: 'wrong-one' }, { client }), /do not match/);
  await assert.rejects(signInWithLogin(sb, { login: 'nobody.here', password: 'x' }, { client }), /do not match/);
});

test('without an email a sign-in name is needed; a name someone else has is refused before an account is made', async () => {
  const { sb, users } = fake();
  await assert.rejects(invite(sb, { orgId: ORG, staffId: 'S-1', name: 'A', role: 'housekeeping' }, OWNER), /email, a username or their mobile/);
  await assert.rejects(invite(sb, { orgId: ORG, staffId: 'S-1', name: 'A', role: 'housekeeping', phoneLogin: true }, OWNER), /mobile number/);
  await invite(sb, { orgId: ORG, staffId: 'S-1', name: 'A', role: 'housekeeping', username: 'sam' }, OWNER);
  const count = Object.keys(users).length;
  await assert.rejects(invite(sb, { orgId: ORG, staffId: 'S-2', name: 'B', role: 'housekeeping', username: 'Sam' }, OWNER), /taken/);
  assert.equal(Object.keys(users).length, count);
});

test('the owner changes a team member\'s sign-in: username, mobile number, a password they choose or a temporary one', async () => {
  const { sb, passwords, users, client } = fake();
  await invite(sb, { orgId: ORG, staffId: 'S-1', name: 'Aina', phone: '+60 12-345 6789', role: 'frontdesk', username: 'aina' }, OWNER);
  const id = Object.values(users).find((x) => x.user_metadata.name === 'Aina').id;
  let r = await setLogin(sb, { orgId: ORG, staffId: 'S-1', username: 'aina.front', phoneLogin: true, phone: '+60 12-345 6789', password: 'new-pass-99' }, OWNER);
  assert.deepEqual([r.username, r.phone, r.passwordSet, r.tempPassword], ['aina.front', '+60123456789', true, null]);
  assert.equal(passwords[id], 'new-pass-99');
  assert.equal(users[id].user_metadata.login, 'aina.front');
  await assert.rejects(signInWithLogin(sb, { login: 'aina', password: 'new-pass-99' }, { client }), /do not match/);
  assert.ok(await signInWithLogin(sb, { login: 'aina.front', password: 'new-pass-99' }, { client }));
  r = await setLogin(sb, { orgId: ORG, staffId: 'S-1', tempPassword: true }, OWNER);
  assert.equal(r.username, 'aina.front');
  assert.equal(passwords[id], r.tempPassword);
  assert.equal(users[id].user_metadata.must_change_password, true);
  await assert.rejects(setLogin(sb, { orgId: ORG, staffId: 'S-1', username: '', phoneLogin: false }, OWNER), /no email to sign in with/);
  const reset = await resetPassword(sb, { orgId: ORG, staffId: 'S-1' }, OWNER);
  assert.deepEqual([reset.email, reset.username], [null, 'aina.front']);
});

test('the owner cannot set the sign-in of an account another company also uses, of an owner, or their own', async () => {
  const { sb, db, users } = fake();
  users['u-shared'] = { id: 'u-shared', email: 'shared@x.my', user_metadata: { name: 'Shared' } };
  db.members.push({ org_id: ORG, user_id: 'u-shared', staff_id: 'S-9', role: 'ops', status: 'active' }, { org_id: OTHER, user_id: 'u-shared', staff_id: 'S-8', role: 'ops', status: 'active' });
  await assert.rejects(setLogin(sb, { orgId: ORG, staffId: 'S-9', password: 'takeover-123' }, OWNER), /another company/);
  await assert.rejects(invite(sb, { orgId: ORG, staffId: 'S-9', name: 'Shared', email: 'shared@x.my', role: 'ops', username: 'shared' }, OWNER), /another company/);
  await assert.rejects(setLogin(sb, { orgId: ORG, staffId: 'S-OWN', password: 'x-12345678' }, OWNER), /own password/);
  await assert.rejects(setLogin(sb, { orgId: OTHER, staffId: 'S-X', password: 'x-12345678' }, OWNER), /account owner/);
});

test('wrong passwords are limited per login name, and a success clears the count', async () => {
  const { sb, db, client } = fake();
  await invite(sb, { orgId: ORG, staffId: 'S-1', name: 'Aina', role: 'housekeeping', username: 'aina', password: 'right-pass-1' }, OWNER);
  for (let i = 0; i < 3; i++) await assert.rejects(signInWithLogin(sb, { login: 'aina', password: 'nope' }, { client }), /do not match/);
  assert.ok(await signInWithLogin(sb, { login: 'aina', password: 'right-pass-1' }, { client }));
  assert.equal(db.login_failures.length, 0);
  for (let i = 0; i < FAIL_LIMIT; i++) await assert.rejects(signInWithLogin(sb, { login: 'aina', password: 'nope' }, { client }), /do not match/);
  await assert.rejects(signInWithLogin(sb, { login: 'aina', password: 'right-pass-1' }, { client }), /Too many wrong tries/);
  await assert.rejects(signInWithLogin(sb, { login: 'aina@x.my', password: 'p' }, { client }), /email in the app/);
});
