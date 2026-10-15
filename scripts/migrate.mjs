#!/usr/bin/env node
/* Apply the database schema: supabase/migrations/*.sql in name order, each file in its own transaction.
 *
 *   node scripts/migrate.mjs                        apply the files not applied yet
 *   node scripts/migrate.mjs --status               list applied / pending / changed files, change nothing
 *   node scripts/migrate.mjs --reapply 0003_x.sql   run one already-applied file again (it must be safe to re-run)
 *
 * Connection string: POSTGRES_URL_NON_POOLING, else POSTGRES_URL, else DATABASE_URL (the Supabase integration on
 * Vercel sets the first two). No URL -> a note and exit 0 (CI, local builds). Any failure -> exit 1, so a broken
 * schema stops the Vercel deploy. Applied files are recorded in public._migrations (name, applied_at, checksum);
 * a file that changed after it was applied is NOT run again (a warning is printed): put changes in a new file.
 * Vercel preview deployments skip migrations (they usually share the production database) unless
 * ORBIQUE_MIGRATE_PREVIEW=1. A file whose first line is "-- migrate:no-transaction" runs outside a transaction.
 *
 * After the files, when CHANNEX_WORKER_SECRET and APP_URL (or VERCEL_PROJECT_PRODUCTION_URL) are set, the Channex
 * worker address and secret are stored in Supabase Vault for pg_cron (0007). The secret is never printed.
 *
 * Locally: node --env-file=.env.local scripts/migrate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'supabase', 'migrations');
const args = process.argv.slice(2);
const statusOnly = args.includes('--status') || args.includes('--dry-run');
const reapply = args.indexOf('--reapply') >= 0 ? args[args.indexOf('--reapply') + 1] : null;
const env = process.env;
const log = (...a) => console.log('migrate:', ...a);

const raw = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || env.DATABASE_URL || '';
if (!raw.trim()) {
  log('no database URL (POSTGRES_URL_NON_POOLING, POSTGRES_URL or DATABASE_URL), so the schema was not applied. That is fine for local builds and CI.');
  process.exit(0);
}
if (env.VERCEL_ENV === 'preview' && env.ORBIQUE_MIGRATE_PREVIEW !== '1') {
  log('preview deployment: migrations skipped (set ORBIQUE_MIGRATE_PREVIEW=1 to run them here).');
  process.exit(0);
}

/* Supabase URLs carry ?sslmode=require; newer pg reads that as verify-full and Supabase's certificate chain then fails.
   Remove the ssl parameters from the URL and pass ssl options ourselves (encrypted, certificate not verified). */
function connection(urlText) {
  let u;
  try { u = new URL(urlText.trim()); } catch (e) { throw new Error('the database URL is not a valid postgres:// address'); }
  for (const k of ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey', 'sslcrl', 'uselibpqcompat']) u.searchParams.delete(k);
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const local = host === 'localhost' || host === '::1' || /^127\./.test(host) || host === 'host.docker.internal';
  return { connectionString: u.toString(), ssl: local ? false : { rejectUnauthorized: false }, host, port: u.port || '5432' };
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function where(sql, position) {
  const pos = Number(position);
  if (!pos) return '';
  const before = sql.slice(0, pos - 1);
  const line = before.split('\n').length;
  const text = sql.split('\n')[line - 1] || '';
  return ` at line ${line}: ${text.trim().slice(0, 160)}`;
}

async function main() {
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort() : [];
  if (reapply && !files.includes(reapply)) throw new Error(`--reapply: ${reapply} is not in supabase/migrations`);
  const conn = connection(raw);
  const client = new pg.Client({ connectionString: conn.connectionString, ssl: conn.ssl, connectionTimeoutMillis: 20000, application_name: 'orbique-migrate' });
  client.on('error', (e) => console.error('migrate: connection error:', e.message));
  log(`connecting to ${conn.host}:${conn.port}${conn.ssl ? ' (ssl)' : ''}`);
  await client.connect();
  try {
    await client.query(`create table if not exists public._migrations (
      name text primary key, applied_at timestamptz not null default now(), checksum text not null)`);
    // Not readable through the public API: RLS on with no policies, no grants for the browser roles.
    await client.query(`alter table public._migrations enable row level security`);
    await client.query(`do $$ begin
      if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public._migrations from anon; end if;
      if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public._migrations from authenticated; end if;
    end $$`);
    const applied = new Map((await client.query('select name, checksum from public._migrations')).rows.map((r) => [r.name, r.checksum]));

    let ran = 0;
    for (const name of files) {
      const sql = fs.readFileSync(path.join(DIR, name), 'utf8');
      const sum = sha(sql);
      const again = name === reapply;
      if (applied.has(name) && !again) {
        if (applied.get(name) !== sum) console.warn(`migrate: WARNING ${name} changed after it was applied; not run again. Put schema changes in a new migration file (or run --reapply ${name} if it is safe to re-run).`);
        else if (statusOnly) log(`applied  ${name}`);
        continue;
      }
      if (statusOnly) { log(`${applied.has(name) ? 'reapply' : 'pending'}  ${name}`); continue; }

      const noTx = /^\s*--\s*migrate:no-transaction\b/i.test(sql);
      const started = Date.now();
      try {
        if (noTx) {
          await client.query(sql);
          await client.query('insert into public._migrations (name, checksum) values ($1, $2) on conflict (name) do update set checksum = excluded.checksum, applied_at = now()', [name, sum]);
        } else {
          await client.query('begin');
          await client.query("select pg_advisory_xact_lock(hashtext('orbique-migrate'))"); // two deploys at once: one waits
          const done = await client.query('select checksum from public._migrations where name = $1', [name]);
          if (done.rowCount && !again) { await client.query('rollback'); log(`${name} was applied by another deploy just now`); continue; }
          await client.query("set local statement_timeout = '10min'");
          await client.query(sql);
          await client.query('insert into public._migrations (name, checksum) values ($1, $2) on conflict (name) do update set checksum = excluded.checksum, applied_at = now()', [name, sum]);
          await client.query('commit');
        }
      } catch (e) {
        if (!noTx) await client.query('rollback').catch(() => {});
        const err = new Error(`${name} failed${where(sql, e.position)}\n  ${e.message}${e.detail ? '\n  detail: ' + e.detail : ''}${e.hint ? '\n  hint: ' + e.hint : ''}`);
        err.reported = true;
        throw err;
      }
      ran++;
      log(`${again ? 're-applied' : 'applied'} ${name} (${Date.now() - started} ms)`);
    }
    if (!statusOnly) log(ran ? `${ran} file(s) applied; schema up to date.` : 'schema already up to date.');
    if (!statusOnly) await channexWorker(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/* Channex worker clock (0007): store the worker address and its bearer secret in Supabase Vault, so pg_cron can call
   /api/channex-worker. Only when CHANNEX_WORKER_SECRET and an app URL (APP_URL, else VERCEL_PROJECT_PRODUCTION_URL)
   are set, never on preview deployments, and only when the database has Vault and channex_set_worker(). The secret is
   passed as a query parameter and never printed. A failure here is a warning: the schema itself is applied. */
async function channexWorker(client) {
  const secret = String(env.CHANNEX_WORKER_SECRET || '').trim();
  const base = String(env.APP_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + env.VERCEL_PROJECT_PRODUCTION_URL : '')).trim().replace(/\/+$/, '');
  if (!secret || !base) return;
  if (env.VERCEL_ENV === 'preview') { log('preview deployment: the Channex worker address was not changed.'); return; }
  const hide = (s) => String(s || '').split(secret).join('<secret>');
  try {
    const has = await client.query("select to_regprocedure('public.channex_set_worker(text,text)') is not null as fn, to_regnamespace('vault') is not null as vault");
    if (!has.rows[0].fn) return;
    if (!has.rows[0].vault) { log('Channex worker not scheduled: this database has no Supabase Vault.'); return; }
    await client.query('select public.channex_set_worker($1, $2)', [base + '/api/channex-worker', secret]);
    log(`Channex worker address stored: ${base}/api/channex-worker (secret from CHANNEX_WORKER_SECRET).`);
  } catch (e) {
    console.warn('migrate: WARNING the Channex worker address was not stored: ' + hide(e && e.message));
  }
}

main().catch((e) => {
  const msg = (e && e.message) || String(e);
  // never print the connection string (it contains the database password)
  console.error('migrate: FAILED: ' + msg.split(raw).join('<database url>'));
  process.exit(1);
});
