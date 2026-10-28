/* POST /api/account  {action, ...}
 *
 *   bootstrap        anyone, only while no platform admin exists   {email, password, name}
 *   signup           anyone                                        {company, contactName, email, phone, units, message}
 *   create-operator  platform admin                                {company, ownerName, ownerEmail, plan?}
 *   update-operator  platform admin                                {orgId, company?, staffId?, ownerName?, ownerEmail?}
 *   invite           owner of orgId                                {orgId, staffId, name, email?, phone?, role, username?, phoneLogin?, phoneCc?, password?, mustChange?}
 *   set-login        owner of orgId                                {orgId, staffId, username?, phoneLogin?, phone?, phoneCc?, password?, tempPassword?, mustChange?}
 *   reset-password   owner of orgId, or a platform admin for owners {orgId, staffId}
 *   sign-in          anyone                                        {login (mobile number or username), password}
 *
 * Sign-in: "Authorization: Bearer <Supabase access token>". See docs/API.md for the results.
 * Uses the service-role key (server only). Errors are plain English; no keys or stack traces are ever returned.
 */
import { ApiError, ok, fail, send, cors, readJson, bearer, bad, forbidden, conflict, tooMany, text, email as emailField, phone as phoneField, id as idField, uuid as uuidField, password as passwordField } from './_lib/http.js';
import { requireAdminClient, check, caller, isPlatformAdmin, platformAdminCount, getOrg, membership, requireOwner, findUserByEmail, createUser, deleteUserQuietly } from './_lib/supabase.js';
import { tempPassword } from './_lib/passwords.js';
import { isPlatformOwnerEmail } from './_lib/owners.js';
import { phoneLogin, username as usernameField, setLoginNames, loginNamesOf, signInWithLogin, standInEmail, isStandIn, showPhone, clearFailures } from './_lib/logins.js';

const ROLE_LABELS = { owner: 'Account owner', ops: 'Ops manager', housekeeping: 'Housekeeping', frontdesk: 'Front desk', maintenance: 'Maintenance', accountant: 'Accountant' };
const INVITE_ROLES = ['ops', 'housekeeping', 'frontdesk', 'maintenance', 'accountant'];

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const staffUid = () => 'S-' + (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();

/* ---------------- bootstrap: the first Orbique platform owner ---------------- */
async function bootstrap(sb, body) {
  const email = emailField(body.email);
  const password = passwordField(body.password);
  const name = text(body.name, 'Your name', { max: 80 }) || email.split('@')[0];

  if ((await platformAdminCount(sb)) > 0) throw conflict('already-set-up', 'Orbique is already set up. Please sign in instead.');
  if (!isPlatformOwnerEmail(email)) throw forbidden('This email is not on the list of Orbique platform owners. Use the email address Orbique was set up for.');

  let user = await findUserByEmail(sb, email);
  let created = false;
  if (!user) {
    user = await createUser(sb, { email, password, metadata: { name, must_change_password: false } });
    created = !!user;
    if (!user) user = await findUserByEmail(sb, email); // created by someone else a moment ago
  }
  if (!user) throw new ApiError(500, 'server', 'Could not create the account. Please try again.');
  if (!created) {
    const meta = Object.assign({}, user.user_metadata || {}, { name: (user.user_metadata && user.user_metadata.name) || name, must_change_password: false });
    check(await sb.auth.admin.updateUserById(user.id, { password, email_confirm: true, user_metadata: meta }), 'set owner password');
  }
  const ins = await sb.from('platform_admins').upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (ins.error) {
    if (created) await deleteUserQuietly(sb, user.id);
    check(ins, 'add platform admin');
  }
  return {};
}

/* ---------------- signup: an operator asks to subscribe ---------------- */
async function signup(sb, body, token) {
  const company = text(body.company, 'Company name', { max: 120, required: true });
  const contactName = text(body.contactName, 'Your name', { max: 80, required: true });
  const email = emailField(body.email);
  const phone = phoneField(body.phone);
  let units = null;
  if (body.units !== undefined && body.units !== null && body.units !== '') {
    units = Number(body.units);
    if (!Number.isInteger(units) || units < 0 || units > 100000) throw bad('bad-units', 'Number of units should be a whole number.');
  }
  const message = text(body.message, 'Message', { max: 2000, multiline: true });

  // Light abuse protection: one request per email per 10 minutes, and at most 30 requests per hour overall.
  const tenMin = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const hour = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const same = await sb.from('subscription_requests').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', tenMin);
  check(same, 'check recent requests');
  if (same.count > 0) throw tooMany('We already have your request. We will be in touch soon.');
  const all = await sb.from('subscription_requests').select('id', { count: 'exact', head: true }).gte('created_at', hour);
  check(all, 'check request volume');
  if (all.count >= 30) throw tooMany('We are receiving a lot of requests right now. Please try again in an hour.');

  let userId = null;
  if (token) { try { userId = (await caller(sb, token)).id; } catch (e) { userId = null; } }
  check(await sb.from('subscription_requests').insert({ user_id: userId, company, contact_name: contactName, email, phone: phone || null, units, message: message || null }), 'save request');
  return {};
}

/* ---------------- create-operator: a new workspace with its owner ---------------- */
async function createOperator(sb, body, me) {
  if (!(await isPlatformAdmin(sb, me.id))) throw forbidden('Only Orbique platform admins can add operators.');
  const company = text(body.company, 'Company name', { max: 120, required: true });
  const ownerName = text(body.ownerName, "Owner's name", { max: 80, required: true });
  const ownerEmail = emailField(body.ownerEmail, "Owner's email");
  const plan = (text(body.plan, 'Plan', { max: 24 }) || 'trial').toLowerCase();
  if (!/^[a-z0-9][a-z0-9 _-]*$/.test(plan)) throw bad('bad-plan', 'Plan should be a short name like trial, starter or pro.');

  const org = check(await sb.from('orgs').insert({ name: company, plan, created_by: me.id }).select('id').single(), 'create workspace');
  const staffId = staffUid();
  let user = null;
  let created = false;
  let temp = null;
  try {
    user = await findUserByEmail(sb, ownerEmail);
    if (!user) {
      temp = tempPassword();
      user = await createUser(sb, { email: ownerEmail, password: temp, metadata: { name: ownerName, must_change_password: true } });
      created = !!user;
      if (!user) { temp = null; user = await findUserByEmail(sb, ownerEmail); }
      if (!user) throw new ApiError(500, 'server', 'Could not create the owner account. Please try again.');
    }
    check(await sb.from('members').insert({ org_id: org.id, user_id: user.id, staff_id: staffId, role: 'owner', status: 'active', invited_by: me.id }), 'add owner');
    const staff = { id: staffId, name: ownerName, initials: initials(ownerName), role: 'owner', roleLabel: ROLE_LABELS.owner, email: ownerEmail };
    check(await sb.from('records').insert({ org_id: org.id, coll: 'staff', id: staffId, data: staff, updated_by: me.id }), 'add owner staff record');
  } catch (e) {
    await sb.from('orgs').delete().eq('id', org.id); // cascades to members and records
    if (created && user) await deleteUserQuietly(sb, user.id);
    throw e;
  }
  return { orgId: org.id, staffId, email: ownerEmail, tempPassword: created ? temp : null, existing: !created };
}

/* ---------------- update-operator: a platform admin corrects company and owner details ---------------- */
export async function updateOperator(sb, body, me) {
  if (!(await isPlatformAdmin(sb, me.id))) throw forbidden('Only Orbique platform admins can change operator details.');
  const orgId = uuidField(body.orgId);
  const org = await getOrg(sb, orgId);
  const company = body.company === undefined ? null : text(body.company, 'Company name', { max: 120, required: true });
  const wantsOwner = body.ownerName !== undefined || body.ownerEmail !== undefined;
  const ownerName = body.ownerName === undefined ? null : text(body.ownerName, "Owner's name", { max: 80, required: true });
  const ownerEmail = body.ownerEmail === undefined ? null : emailField(body.ownerEmail, "Owner's email");

  let target = null;
  let user = null;
  if (wantsOwner) {
    const staffId = idField(body.staffId, 'Owner');
    target = check(await sb.from('members').select('user_id, staff_id, role').eq('org_id', orgId).eq('staff_id', staffId).maybeSingle(), 'find owner');
    if (!target || target.role !== 'owner') throw bad('no-owner', 'That owner was not found in this workspace.');
    const got = await sb.auth.admin.getUserById(target.user_id);
    user = check(got, 'load owner') && got.data.user;
    if (!user) throw bad('no-owner', 'That owner was not found in this workspace.');
  }

  // Check everything before changing anything
  const emailChanges = !!(user && ownerEmail && ownerEmail !== String(user.email || '').toLowerCase());
  if (emailChanges) {
    if (await isPlatformAdmin(sb, user.id)) throw forbidden('This owner is also an Orbique platform admin. Their sign-in email cannot be changed here.');
    const taken = await findUserByEmail(sb, ownerEmail);
    if (taken && taken.id !== user.id) throw conflict('email-in-use', 'That email already has an Orbique account. Use a different email address.');
  }

  if (company !== null && company !== org.name) {
    check(await sb.from('orgs').update({ name: company }).eq('id', orgId), 'rename workspace');
  }

  if (user) {
    const meta = user.user_metadata || {};
    const name = ownerName !== null ? ownerName : (meta.name || '');
    const patch = {};
    if (ownerName !== null && ownerName !== meta.name) patch.user_metadata = Object.assign({}, meta, { name: ownerName });
    if (emailChanges) { patch.email = ownerEmail; patch.email_confirm = true; }
    if (Object.keys(patch).length) check(await sb.auth.admin.updateUserById(user.id, patch), 'update owner');

    // Keep the owner's staff record in this workspace in step, so the team sees the same name and email
    const email = emailChanges ? ownerEmail : String(user.email || '').toLowerCase();
    const rec = check(await sb.from('records').select('data, deleted').eq('org_id', orgId).eq('coll', 'staff').eq('id', target.staff_id).maybeSingle(), 'load owner staff record');
    if (rec && !rec.deleted) {
      const data = Object.assign({}, rec.data || {});
      let changed = false;
      if (name && data.name !== name) { data.name = name; data.initials = initials(name); changed = true; }
      if (data.email !== email) { data.email = email; changed = true; }
      if (changed) check(await sb.from('records').update({ data, updated_by: me.id }).eq('org_id', orgId).eq('coll', 'staff').eq('id', target.staff_id), 'update owner staff record');
    }
  }

  const others = user ? check(await sb.from('members').select('org_id').eq('user_id', user.id).neq('org_id', orgId), 'count workspaces') : [];
  return { emailChanged: emailChanges, otherWorkspaces: (others || []).length };
}

/* ---------------- sign-in names: a mobile number and a username, set by the workspace owner ---------------- */

/** The sign-in names asked for in body (stored forms; undefined = leave): username ('' removes), phoneLogin (with phone).
 *  phoneCc: the workspace's country code, for a number written with a leading 0 (Malaysia's 60 when not given). */
function wantedNames(body, phone) {
  const out = {};
  if (body.username !== undefined && body.username !== null) out.username = String(body.username).trim() ? usernameField(body.username) : null;
  if (body.phoneLogin !== undefined && body.phoneLogin !== null) {
    if (body.phoneLogin) {
      if (!phone) throw bad('no-phone', 'Add their mobile number to let them sign in with it.');
      out.phone = phoneLogin(phone, /^[1-9][0-9]{0,2}$/.test(String(body.phoneCc || '')) ? String(body.phoneCc) : '60');
    } else out.phone = null;
  }
  return out;
}

/** An owner may set the sign-in of someone whose only Orbique workspace is theirs (never an account another company also uses). */
async function onlyHere(sb, userId, orgId) {
  if (await isPlatformAdmin(sb, userId)) return false;
  const others = check(await sb.from('members').select('org_id').eq('user_id', userId).neq('org_id', orgId), 'count workspaces') || [];
  return others.length === 0;
}

/** The person's sign-in as the app shows it: {email (null for a stand-in), username, phone ('+60...')}. */
async function signInView(sb, user) {
  const n = await loginNamesOf(sb, user.id);
  return { email: isStandIn(user.email) ? null : user.email, username: n.username, phone: showPhone(n.phone) };
}

const loginLabel = (names) => names.username || showPhone(names.phone) || '';

/** Keep the staff record's sign-in fields (shown on the Team page) in step. */
async function stampStaff(sb, orgId, staffId, view, by) {
  const rec = check(await sb.from('records').select('data, deleted').eq('org_id', orgId).eq('coll', 'staff').eq('id', staffId).maybeSingle(), 'load staff record');
  if (!rec || rec.deleted) return;
  const data = Object.assign({}, rec.data || {});
  if (view.username) data.username = view.username; else delete data.username;
  if (view.phone) data.loginPhone = view.phone; else delete data.loginPhone;
  check(await sb.from('records').update({ data, updated_by: by }).eq('org_id', orgId).eq('coll', 'staff').eq('id', staffId), 'update staff record');
}

/* ---------------- invite: an owner adds a team member ---------------- */
export async function invite(sb, body, me) {
  const orgId = uuidField(body.orgId);
  const staffId = idField(body.staffId, 'Staff member');
  const name = text(body.name, 'Name', { max: 80, required: true });
  const email = body.email ? emailField(body.email) : '';
  const phone = phoneField(body.phone);
  const role = text(body.role, 'Role', { max: 20, required: true });
  if (role === 'owner') throw bad('bad-role', 'People cannot be invited as account owner. Choose another role; Orbique can add a second owner if you need one.');
  if (!INVITE_ROLES.includes(role)) throw bad('bad-role', 'Please choose a role for this person.');
  const names = wantedNames(body, phone);
  const chosen = body.password ? passwordField(body.password) : null;
  if (!email && !names.username && !names.phone) throw bad('no-login', 'Give them an email, a username or their mobile number to sign in with.');

  await requireOwner(sb, orgId, me.id); // before anything about the workspace is revealed
  const org = await getOrg(sb, orgId);
  if (org.status !== 'active') throw forbidden('This workspace is paused, so new people cannot be added. Please contact Orbique.');

  let user = email ? await findUserByEmail(sb, email) : null;
  const byStaff = check(await sb.from('members').select('user_id, role').eq('org_id', orgId).eq('staff_id', staffId).maybeSingle(), 'check staff member');
  if (user) {
    const mine = await membership(sb, orgId, user.id);
    if (mine && mine.role === 'owner') throw conflict('is-owner', 'That email belongs to an account owner of this workspace.');
    if (mine && mine.staff_id !== staffId) throw conflict('email-in-use', 'That email is already used by another person in this workspace.');
  }
  if (byStaff && (!user || byStaff.user_id !== user.id)) throw conflict('has-account', email ? `${name} already signs in with a different email address.` : `${name} already has a sign-in. Use Sign-in details to change it.`);
  // names someone else has: refused before an account is made
  for (const kind of ['username', 'phone']) {
    if (!names[kind]) continue;
    const held = check(await sb.from('login_names').select('user_id').eq('kind', kind).eq('login', names[kind]).maybeSingle(), 'check sign-in name');
    if (held && (!user || held.user_id !== user.id)) throw conflict(kind + '-taken', kind === 'phone' ? 'Someone else on Orbique already signs in with this mobile number.' : 'That username is taken on Orbique. Try another, for example with your company name in front.');
  }

  let created = false;
  let temp = null;
  if (!user) {
    temp = chosen ? null : tempPassword();
    const meta = { name, must_change_password: chosen ? !!body.mustChange : true };
    if (!email) Object.assign(meta, { login_only: true, login: loginLabel(names) });
    user = await createUser(sb, { email: email || standInEmail(), password: chosen || temp, metadata: meta });
    created = !!user;
    if (!user && email) { temp = null; user = await findUserByEmail(sb, email); }
    if (!user) throw new ApiError(500, 'server', 'Could not create the account. Please try again.');
  }
  if (!created) { // an invite only adds names to an account someone already has; removing them is for set-login
    for (const kind of ['username', 'phone']) if (!names[kind]) delete names[kind];
  }
  if (!created && (names.username || names.phone) && !(await onlyHere(sb, user.id, orgId))) {
    throw forbidden(`${name} also uses Orbique with another company, so they keep the sign-in they have. Leave the username and mobile sign-in empty.`);
  }

  try {
    await setLoginNames(sb, user.id, names);
  } catch (e) {
    if (created) await deleteUserQuietly(sb, user.id);
    throw e;
  }

  const up = await sb.from('members').upsert({ org_id: orgId, user_id: user.id, staff_id: staffId, role, status: 'active', invited_by: me.id }, { onConflict: 'org_id,user_id' });
  if (up.error) {
    if (created) await deleteUserQuietly(sb, user.id);
    if (up.error.code === '23505') throw conflict('has-account', `${name} already has a sign-in.`);
    check(up, 'add member');
  }

  const view = await signInView(sb, user);
  const rec = check(await sb.from('records').select('id, deleted').eq('org_id', orgId).eq('coll', 'staff').eq('id', staffId).maybeSingle(), 'check staff record');
  if (!rec || rec.deleted) {
    const staff = { id: staffId, name, initials: initials(name), role, roleLabel: ROLE_LABELS[role], email: view.email || '' };
    if (phone) staff.phone = phone;
    if (view.username) staff.username = view.username;
    if (view.phone) staff.loginPhone = view.phone;
    check(await sb.from('records').upsert({ org_id: orgId, coll: 'staff', id: staffId, data: staff, deleted: false, updated_by: me.id }, { onConflict: 'org_id,coll,id' }), 'add staff record');
  } else await stampStaff(sb, orgId, staffId, view, me.id);
  return Object.assign(view, { tempPassword: created ? temp : null, passwordSet: created && !!chosen, existing: !created });
}

/* ---------------- set-login: the owner sets a team member's username, mobile sign-in or password ---------------- */
export async function setLogin(sb, body, me) {
  const orgId = uuidField(body.orgId);
  const staffId = idField(body.staffId, 'Staff member');
  const phone = phoneField(body.phone);
  const names = wantedNames(body, phone);
  const chosen = body.password ? passwordField(body.password) : null;
  const temp = !chosen && body.tempPassword ? tempPassword() : null;
  await requireOwner(sb, orgId, me.id);
  await getOrg(sb, orgId);

  const target = check(await sb.from('members').select('user_id, role').eq('org_id', orgId).eq('staff_id', staffId).maybeSingle(), 'find member');
  if (!target) throw bad('no-account', 'This person does not have a sign-in yet. Use Create sign-in first.');
  if (target.user_id === me.id) throw bad('self', 'To change your own password, use Change password in your account menu.');
  if (target.role === 'owner') throw forbidden('Account owners manage their own sign-in.');
  if (!(await onlyHere(sb, target.user_id, orgId))) throw forbidden('This person also uses Orbique with another company, so only they can change their sign-in.');

  const got = await sb.auth.admin.getUserById(target.user_id);
  const user = check(got, 'load user') && got.data.user;
  if (!user) throw bad('no-account', 'This person does not have a sign-in yet. Use Create sign-in first.');
  const now = await loginNamesOf(sb, user.id);
  const after = { username: names.username !== undefined ? names.username : now.username, phone: names.phone !== undefined ? names.phone : now.phone };
  if (isStandIn(user.email) && !after.username && !after.phone) throw bad('no-login', 'Keep a username or the mobile sign-in: this person has no email to sign in with.');

  await setLoginNames(sb, user.id, names);
  const meta = Object.assign({}, user.user_metadata || {});
  if (meta.login_only || isStandIn(user.email)) meta.login = loginLabel(after);
  const patch = {};
  if (chosen || temp) { patch.password = chosen || temp; meta.must_change_password = temp ? true : !!body.mustChange; }
  patch.user_metadata = meta;
  check(await sb.auth.admin.updateUserById(user.id, patch), 'update sign-in');
  if (patch.password) await clearFailures(sb, user.id);

  const view = await signInView(sb, user);
  await stampStaff(sb, orgId, staffId, view, me.id);
  return Object.assign(view, { tempPassword: temp, passwordSet: !!chosen });
}

/* ---------------- reset-password: a new temporary password ---------------- */
export async function resetPassword(sb, body, me) {
  const orgId = uuidField(body.orgId);
  const staffId = idField(body.staffId, 'Staff member');
  const mine = await membership(sb, orgId, me.id);
  const isOwner = !!(mine && mine.role === 'owner' && mine.status === 'active');
  const isAdmin = await isPlatformAdmin(sb, me.id);
  if (!isOwner && !isAdmin) throw forbidden('Only the account owner of this workspace can reset passwords.');
  await getOrg(sb, orgId);

  const target = check(await sb.from('members').select('user_id, role').eq('org_id', orgId).eq('staff_id', staffId).maybeSingle(), 'find member');
  if (!target) throw bad('no-account', 'This person does not have a sign-in yet. Invite them first.');
  if (target.user_id === me.id) throw bad('self', 'To change your own password, use Change password in your account menu.');
  if (!isOwner && target.role !== 'owner') throw forbidden('Orbique platform admins can reset the password of workspace owners only.');
  // an owner never resets an account another company also uses (its new password would open that company too)
  if (!(isAdmin && target.role === 'owner') && !(await onlyHere(sb, target.user_id, orgId))) {
    throw forbidden('This person also uses Orbique with another company, so only they can change their password. They can use Forgot password on the sign-in screen.');
  }

  const got = await sb.auth.admin.getUserById(target.user_id);
  const user = check(got, 'load user') && got.data.user;
  if (!user) throw bad('no-account', 'This person does not have a sign-in yet. Invite them first.');
  const temp = tempPassword();
  const meta = Object.assign({}, user.user_metadata || {}, { must_change_password: true });
  check(await sb.auth.admin.updateUserById(user.id, { password: temp, user_metadata: meta }), 'reset password');
  await clearFailures(sb, user.id);
  return Object.assign(await signInView(sb, user), { tempPassword: temp });
}

const ACTIONS = {
  bootstrap: { auth: false, run: (sb, body) => bootstrap(sb, body) },
  signup: { auth: false, run: (sb, body, me, token) => signup(sb, body, token) },
  'create-operator': { auth: true, run: (sb, body, me) => createOperator(sb, body, me) },
  'update-operator': { auth: true, run: (sb, body, me) => updateOperator(sb, body, me) },
  invite: { auth: true, run: (sb, body, me) => invite(sb, body, me) },
  'set-login': { auth: true, run: (sb, body, me) => setLogin(sb, body, me) },
  'reset-password': { auth: true, run: (sb, body, me) => resetPassword(sb, body, me) },
  'sign-in': { auth: false, run: (sb, body, me, token, req) => signInWithLogin(sb, body, { ip: clientIp(req) }) }
};

function clientIp(req) {
  const h = req && req.headers ? String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '') : '';
  const ip = h.split(',')[0].trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : '';
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, { ok: false, error: 'method', message: 'Use POST for this address.' });
    }
    const body = await readJson(req);
    const action = typeof body.action === 'string' ? body.action : '';
    const spec = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (!spec) throw bad('bad-action', 'Unknown request.');
    const sb = requireAdminClient();
    const token = bearer(req);
    const me = spec.auth ? await caller(sb, token) : null;
    const result = await spec.run(sb, body, me, token, req);
    return ok(res, result);
  } catch (err) {
    return fail(res, err);
  }
}
