# Orbique server API (production)

Vercel serverless functions in `api/`. Node 20+, ES modules, `export default async function handler(req, res)`.
They use the Supabase **service-role key** (env `SUPABASE_SERVICE_ROLE_KEY`, or `SUPABASE_SECRET_KEY`) and the project URL
(env `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`). That key never appears in front-end code, `dist/config.js`, logs or responses.
Write handlers so they work both on Vercel and under `scripts/dev.mjs`: parse the body yourself when `req.body` is
undefined or a string, and answer with `res.statusCode`, `res.setHeader` and `res.end(JSON.stringify(...))`.

Every response is JSON: `{ok: true, ...}` or `{ok: false, error: '<code>', message: '<plain English for the screen>'}`
with status 400 (bad input), 401 (not signed in), 403 (not allowed), 409 (conflict), 429 (too many) or 500.

## GET /api/health

No sign-in. `{ok: true, db: <the service key and URL are set and the database answers>, needsBootstrap: <no platform admin yet>, commit}`.

## POST /api/account

Body `{action, ...}`. Sign-in is `Authorization: Bearer <the user's Supabase access token>`; the handler checks it with
`auth.getUser(token)`. Actions:

| action | who | body | result |
|---|---|---|---|
| `bootstrap` | anyone, only while no platform admin exists | `{email, password, name}` | `{ok}`. Allowed only when `sha256(lower(trim(email)))` is in `config/platform-owners.json` (`emailSha256`) or the email / its hash is in env `PLATFORM_OWNER_EMAILS` (comma separated). Creates the user already confirmed with that password (or sets the password of an existing user), adds `platform_admins`. |
| `signup` | anyone | `{company, contactName, email, phone, units, message}` | `{ok}`. Inserts `subscription_requests` (an operator asking to subscribe). Validate and cap lengths. |
| `create-operator` | platform admin | `{company, ownerName, ownerEmail, plan?}` | `{ok, orgId, staffId, email, tempPassword \| null, existing}`. Creates the org, the owner's account if new (confirmed, temporary password, `user_metadata = {name, must_change_password: true}`), the `members` row (role `owner`), and the owner's staff record (`records` coll `staff`: `{id: staffId, name, role: 'owner', roleLabel: 'Account owner', email}`). An existing user is added as owner without changing their password (`tempPassword: null, existing: true`). |
| `invite` | owner of `orgId` | `{orgId, staffId, name, email, phone?, role}` | `{ok, email, tempPassword \| null, existing}`. `role` is not `owner`. Creates or reuses the account, adds/updates `members` (org, user, staff_id, role, status active); creates the staff record if the org has none with that id. |
| `reset-password` | owner of `orgId` (for members of that org) or a platform admin (for org owners) | `{orgId, staffId}` | `{ok, email, tempPassword}`. New temporary password, `must_change_password: true`. |

Temporary passwords: easy to read aloud and type on a phone, e.g. `Mango-River-4821` (two words from a list + 4 digits, crypto random).

## Database functions the browser calls (supabase.rpc)

From `supabase/migrations/0001_core.sql`: `my_context()`, `platform_overview()`, `set_org_status(p_org, p_status)`,
`set_org_plan(p_org, p_plan)`, `reset_org(p_org)`. From `0003_guest.sql`: `guest_get(p_token)`, `guest_act(p_token, p_action, p_args)`.
Check the SQL for the exact argument names.

## Browser-side O.auth (app/server/auth.js) used by pages

`O.auth.enabled()`, `gate()`, `switchWorkspace(key)`, `loadDemo()`, `startEmpty()`, `resetWorkspace()`,
`invite({staffId, name, email, phone, role}) -> Promise<{email, tempPassword, existing}>`,
`setMemberStatus(staffId, 'active'|'suspended')`, `setMemberRole(staffId, role)`, `resetPassword(staffId) -> Promise<{email, tempPassword}>`,
`previewAs(staffId | null)`, `isPlatformAdmin()`, `user()`, `signOut()`.
Pages call them only when they exist (`O.auth && O.auth.enabled && O.auth.enabled() && O.auth.invite`), otherwise they keep the local behaviour.
