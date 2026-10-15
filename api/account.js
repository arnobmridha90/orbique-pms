/* POST /api/account  {action, ...}
 *
 *   bootstrap        anyone, only while no platform admin exists   {email, password, name}
 *   signup           anyone                                        {company, contactName, email, phone, units, message}
 *   create-operator  platform admin                                {company, ownerName, ownerEmail, plan?}
 *   update-operator  platform admin                                {orgId, company?, staffId?, ownerName?, ownerEmail?}
 *   invite           owner of orgId                                {orgId, staffId, name, email, phone?, role}
 *   reset-password   owner of orgId, or a platform admin for owners {orgId, staffId}
 *
 * Sign-in: "Authorization: Bearer <Supabase access token>". See docs/API.md for the results.
 * Uses the service-role key (server only). Errors are plain English; no keys or stack traces are ever returned.
 */
import { ApiError, ok, fail, send, cors, readJson, bearer, bad, forbidden, conflict, tooMany, text, email as emailField, phone as phoneField, id as idField, uuid as uuidField, password as passwordField } from './_lib/http.js';
import { requireAdminClient, check, caller, isPlatformAdmin, platformAdminCount, getOrg, membership, requireOwner, findUserByEmail, createUser, deleteUserQuietly } from './_lib/supabase.js';
import { tempPassword } from './_lib/passwords.js';
import { isPlatformOwnerEmail } from './_lib/owners.js';

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

/* ---------------- invite: an owner adds a team member ---------------- */
async function invite(sb, body, me) {
  const orgId = uuidField(body.orgId);
  const staffId = idField(body.staffId, 'Staff member');
  const name = text(body.name, 'Name', { max: 80, required: true });
  const email = emailField(body.email);
  const phone = phoneField(body.phone);
  const role = text(body.role, 'Role', { max: 20, required: true });
  if (role === 'owner') throw bad('bad-role', 'People cannot be invited as account owner. Choose another role; Orbique can add a second owner if you need one.');
  if (!INVITE_ROLES.includes(role)) throw bad('bad-role', 'Please choose a role for this person.');

  await requireOwner(sb, orgId, me.id); // before anything about the workspace is revealed
  const org = await getOrg(sb, orgId);
  if (org.status !== 'active') throw forbidden('This workspace is paused, so new people cannot be added. Please contact Orbique.');

  let user = await findUserByEmail(sb, email);
  const byStaff = check(await sb.from('members').select('user_id, role').eq('org_id', orgId).eq('staff_id', staffId).maybeSingle(), 'check staff member');
  if (user) {
    const mine = await membership(sb, orgId, user.id);
    if (mine && mine.role === 'owner') throw conflict('is-owner', 'That email belongs to an account owner of this workspace.');
    if (mine && mine.staff_id !== staffId) throw conflict('email-in-use', 'That email is already used by another person in this workspace.');
  }
  if (byStaff && (!user || byStaff.user_id !== user.id)) throw conflict('has-account', `${name} already signs in with a different email address.`);

  let created = false;
  let temp = null;
  if (!user) {
    temp = tempPassword();
    user = await createUser(sb, { email, password: temp, metadata: { name, must_change_password: true } });
    created = !!user;
    if (!user) { temp = null; user = await findUserByEmail(sb, email); }
    if (!user) throw new ApiError(500, 'server', 'Could not create the account. Please try again.');
  }

  const up = await sb.from('members').upsert({ org_id: orgId, user_id: user.id, staff_id: staffId, role, status: 'active', invited_by: me.id }, { onConflict: 'org_id,user_id' });
  if (up.error) {
    if (created) await deleteUserQuietly(sb, user.id);
    if (up.error.code === '23505') throw conflict('has-account', `${name} already signs in with a different email address.`);
    check(up, 'add member');
  }

  const rec = check(await sb.from('records').select('id, deleted').eq('org_id', orgId).eq('coll', 'staff').eq('id', staffId).maybeSingle(), 'check staff record');
  if (!rec || rec.deleted) {
    const staff = { id: staffId, name, initials: initials(name), role, roleLabel: ROLE_LABELS[role], email };
    if (phone) staff.phone = phone;
    check(await sb.from('records').upsert({ org_id: orgId, coll: 'staff', id: staffId, data: staff, deleted: false, updated_by: me.id }, { onConflict: 'org_id,coll,id' }), 'add staff record');
  }
  return { email, tempPassword: created ? temp : null, existing: !created };
}

/* ---------------- reset-password: a new temporary password ---------------- */
async function resetPassword(sb, body, me) {
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

  const got = await sb.auth.admin.getUserById(target.user_id);
  const user = check(got, 'load user') && got.data.user;
  if (!user) throw bad('no-account', 'This person does not have a sign-in yet. Invite them first.');
  const temp = tempPassword();
  const meta = Object.assign({}, user.user_metadata || {}, { must_change_password: true });
  check(await sb.auth.admin.updateUserById(user.id, { password: temp, user_metadata: meta }), 'reset password');
  return { email: user.email, tempPassword: temp };
}

const ACTIONS = {
  bootstrap: { auth: false, run: (sb, body) => bootstrap(sb, body) },
  signup: { auth: false, run: (sb, body, me, token) => signup(sb, body, token) },
  'create-operator': { auth: true, run: (sb, body, me) => createOperator(sb, body, me) },
  'update-operator': { auth: true, run: (sb, body, me) => updateOperator(sb, body, me) },
  invite: { auth: true, run: (sb, body, me) => invite(sb, body, me) },
  'reset-password': { auth: true, run: (sb, body, me) => resetPassword(sb, body, me) }
};

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
    const result = await spec.run(sb, body, me, token);
    return ok(res, result);
  } catch (err) {
    return fail(res, err);
  }
}
