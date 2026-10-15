/* A throwaway "Supabase" for integration tests: a fresh database on a local Postgres with the Supabase stand-in
 * (tests/sql/supabase_stub.sql) and every migration, PostgREST in front of it, and a small gateway that serves
 * /rest/v1 (PostgREST) and /auth/v1/user (sign-ins the test registers) the way supabase-js expects.
 * For a browser (tests/e2e_channex.py): anonKey, CORS, and email + password sign-in (POST /auth/v1/token, grant_type
 * password or refresh_token, for users added with {password}), which hands out a real JWT PostgREST accepts.
 * There is no realtime: the app falls back to its own reloads.
 *
 *   CHANNEX_TEST_PGURL=postgres://postgres@127.0.0.1:54329/postgres   a superuser on a server you do not mind getting a test database
 *   POSTGREST_BIN=/path/to/postgrest                                  PostgREST 12 (https://github.com/PostgREST/postgrest/releases)
 *
 * Tests only; never point this at a real database.
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const localSupabaseAvailable = () => !!(process.env.CHANNEX_TEST_PGURL && process.env.POSTGREST_BIN && fs.existsSync(process.env.POSTGREST_BIN));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function jwt(secret, claims) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(Object.assign({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }, claims));
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}

const freePort = () => new Promise((resolve, reject) => {
  const s = http.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  s.on('error', reject);
});

/**
 * Start everything. opts {dbName, today: 'YYYY-MM-DD' (pins orbique.channex_today in the database)}
 * Resolves {url, serviceKey, anonKey, db (pg.Client on the test database), addUser(email, meta, {password}) -> {id, token}, close()}.
 */
export async function startLocalSupabase(opts = {}) {
  const admin = new URL(process.env.CHANNEX_TEST_PGURL);
  const dbName = opts.dbName || 'orbique_channex_it_' + process.pid;
  const dbUrl = new URL(admin.toString()); dbUrl.pathname = '/' + dbName;

  const a = new pg.Client({ connectionString: admin.toString() });
  await a.connect();
  await a.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [dbName]);
  await a.query(`drop database if exists ${dbName}`);
  await a.query(`create database ${dbName}`);
  if (opts.today) await a.query(`alter database ${dbName} set orbique.channex_today = '${opts.today.replace(/[^0-9-]/g, '')}'`);
  await a.end();

  const db = new pg.Client({ connectionString: dbUrl.toString() });
  await db.connect();
  await db.query(fs.readFileSync(path.join(ROOT, 'tests/sql/supabase_stub.sql'), 'utf8'));
  const mig = spawnSync(process.execPath, [path.join(ROOT, 'scripts/migrate.mjs')], { cwd: ROOT, env: Object.assign({}, process.env, { DATABASE_URL: dbUrl.toString(), POSTGRES_URL: '', POSTGRES_URL_NON_POOLING: '', CHANNEX_WORKER_SECRET: '' }), encoding: 'utf8' });
  if (mig.status !== 0) throw new Error('migrate failed:\n' + mig.stdout + mig.stderr);
  if (opts.today) await db.query(`set orbique.channex_today = '${opts.today}'`);

  const secret = randomBytes(32).toString('hex');
  const restPort = await freePort();
  const rest = spawn(process.env.POSTGREST_BIN, [], {
    env: {
      PGRST_DB_URI: dbUrl.toString(), PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret,
      PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(restPort), PGRST_DB_MAX_ROWS: '1000', PGRST_LOG_LEVEL: 'crit',
      PGRST_DB_POOL: '10', PGRST_DB_CHANNEL_ENABLED: 'false'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let restErr = '';
  rest.stderr.on('data', (c) => { restErr += c; });
  for (let i = 0; ; i++) {
    try { const r = await fetch(`http://127.0.0.1:${restPort}/`); if (r.status < 500) break; } catch (e) { /* starting */ }
    if (i > 100 || rest.exitCode !== null) throw new Error('PostgREST did not start: ' + restErr);
    await new Promise((r) => setTimeout(r, 100));
  }

  const users = new Map(); // token -> user
  const logins = new Map(); // email -> {password, user}
  const refresh = new Map(); // refresh token -> user
  const json = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
  const session = (user) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access = jwt(secret, { sub: user.id, role: 'authenticated', aud: 'authenticated', email: user.email, exp });
    const rt = 'rt-' + randomBytes(12).toString('hex');
    users.set(access, user); refresh.set(rt, user);
    return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: rt, user };
  };
  const gw = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://gw');
    // a browser on another port (scripts/dev.mjs) talks to this gateway
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Location, Preference-Applied, X-Total-Count');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    if (u.pathname === '/auth/v1/token' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch (e) { /* empty */ }
      const grant = u.searchParams.get('grant_type');
      if (grant === 'password') {
        const l = logins.get(String(body.email || '').toLowerCase());
        if (!l || l.password !== body.password) return json(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials', error: 'invalid_grant', error_description: 'Invalid login credentials' });
        return json(res, 200, session(l.user));
      }
      if (grant === 'refresh_token') {
        const user = refresh.get(body.refresh_token);
        if (!user) return json(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token', error: 'invalid_grant' });
        return json(res, 200, session(user));
      }
      return json(res, 400, { code: 400, msg: 'unsupported grant_type' });
    }
    if (u.pathname === '/auth/v1/logout') { res.statusCode = 204; return res.end(); }
    if (u.pathname === '/auth/v1/user' && req.method === 'GET') {
      const m = /^Bearer\s+(\S+)/i.exec(req.headers.authorization || '');
      const user = m && users.get(m[1]);
      res.setHeader('Content-Type', 'application/json');
      if (!user) { res.statusCode = 401; return res.end(JSON.stringify({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' })); }
      return res.end(JSON.stringify(user));
    }
    if (!u.pathname.startsWith('/rest/v1/')) { res.statusCode = 404; return res.end('{}'); }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = Object.assign({}, req.headers);
    delete headers.host; delete headers['content-length'];
    try {
      const r = await fetch(`http://127.0.0.1:${restPort}${u.pathname.slice(8)}${u.search}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
      res.statusCode = r.status;
      r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(k)) res.setHeader(k, v); });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.statusCode = 502; res.end(JSON.stringify({ message: e.message }));
    }
  });
  const gwPort = await freePort();
  await new Promise((r) => gw.listen(gwPort, '127.0.0.1', r));

  return {
    url: `http://127.0.0.1:${gwPort}`,
    serviceKey: jwt(secret, { role: 'service_role' }),
    anonKey: jwt(secret, { role: 'anon', exp: Math.floor(Date.now() / 1000) + 30 * 86400 }),
    db,
    async addUser(email, meta = {}, opts = {}) {
      const id = randomUUID();
      await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, meta]);
      const token = 'tok-' + randomBytes(12).toString('hex');
      const user = { id, aud: 'authenticated', role: 'authenticated', email, user_metadata: meta, app_metadata: {}, created_at: new Date().toISOString() };
      users.set(token, user);
      if (opts.password) logins.set(String(email).toLowerCase(), { password: opts.password, user });
      return { id, email, token };
    },
    async close() {
      await new Promise((r) => { gw.closeAllConnections && gw.closeAllConnections(); gw.close(() => r()); });
      rest.kill('SIGTERM');
      await db.end().catch(() => {});
    }
  };
}
