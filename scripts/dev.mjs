#!/usr/bin/env node
/* Local development server: the production build plus the api/ functions, like Vercel does it.
 *
 *   node scripts/dev.mjs [--port 8787] [--dist <dir>] [--no-build]
 *
 * 1. Loads environment variables from .env.local (if present; variables already set in the shell win).
 * 2. Builds the production web app into dist/ (node scripts/build.mjs, with the same environment), unless --no-build.
 *    --dist <dir> builds and serves another folder (handy when several people share one checkout).
 * 3. Serves the files, the rewrites and the headers from vercel.json (files first, then rewrites, e.g. /guest/<token> -> index.html).
 * 4. Routes /api/<name> to the default export of api/<name>.js with a Vercel-like req.body / req.query and res.status() / res.json().
 *    req.rawBody holds the exact bytes received (webhook signature checks; see rawBody in api/_lib/http.js).
 *    Edits to api/<name>.js are picked up on the next request; restart after changing api/_lib/*.js.
 *
 * 5. --worker: POSTs {task: 'tick'} to /api/channex-worker every 20 s with CHANNEX_WORKER_SECRET (stands in for pg_cron).
 *
 * Needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_ANON_KEY for the app and SUPABASE_SERVICE_ROLE_KEY for the API.
 * Without them the app runs as a local test copy and /api/health reports db: false.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const PORT = Number(arg('--port', process.env.PORT || 8787));
const HOST = arg('--host', '127.0.0.1');
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'dist')));
const BUILD = !args.includes('--no-build');
const WORKER = args.includes('--worker');

/* ---------- .env.local (KEY=value lines; # comments; optional quotes; "export " prefix allowed) ---------- */
export function parseEnv(src) {
  const out = {};
  for (const raw of String(src).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"')) {
      const end = v.indexOf('"', 1) > 0 ? v.lastIndexOf('"') : -1;
      v = (end > 0 ? v.slice(1, end) : v.slice(1)).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else if (v.startsWith("'")) {
      const end = v.lastIndexOf("'");
      v = end > 0 ? v.slice(1, end) : v.slice(1);
    } else {
      v = v.replace(/\s+#.*$/, '').trim();
    }
    out[m[1]] = v;
  }
  return out;
}

const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  const vars = parseEnv(fs.readFileSync(envFile, 'utf8'));
  let n = 0;
  for (const [k, v] of Object.entries(vars)) if (process.env[k] === undefined) { process.env[k] = v; n++; }
  console.log(`loaded ${n} variable(s) from .env.local`);
}

/* ---------- build ---------- */
if (BUILD) {
  const buildArgs = [path.join(ROOT, 'scripts', 'build.mjs')];
  if (DIST !== path.join(ROOT, 'dist')) buildArgs.push('--out', DIST);
  const r = spawnSync(process.execPath, buildArgs, { cwd: ROOT, env: process.env, stdio: 'inherit' });
  if (r.status !== 0) { console.error('build failed'); process.exit(r.status || 1); }
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error(`no ${path.relative(ROOT, DIST) || DIST}/index.html: run without --no-build`); process.exit(1); }

/* ---------- vercel.json rewrites + headers (small path-to-regexp subset: :name, :name*, (regex)) ---------- */
function compile(source) {
  let re = '';
  for (let i = 0; i < source.length;) {
    const c = source[i];
    if (c === ':') {
      const m = /^:([A-Za-z0-9_]+)([*+?])?/.exec(source.slice(i));
      re += m[2] === '*' ? '(.*)' : m[2] === '+' ? '(.+)' : '([^/]+)';
      i += m[0].length;
    } else if (c === '(') {
      let depth = 0, j = i;
      for (; j < source.length; j++) { if (source[j] === '(') depth++; else if (source[j] === ')' && --depth === 0) break; }
      re += source.slice(i, j + 1);
      i = j + 1;
    } else {
      re += c.replace(/[.*+?^${}|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp('^' + re + '/?$');
}
let vercel = { rewrites: [], headers: [] };
try { vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')); } catch (e) { console.warn('vercel.json not read:', e.message); }
const REWRITES = (vercel.rewrites || []).map((r) => ({ re: compile(r.source), dest: r.destination }));
const HEADERS = (vercel.headers || []).map((h) => ({ re: compile(h.source), headers: h.headers || [] }));

/* ---------- static files ---------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json', '.woff2': 'font/woff2'
};

function fileFor(urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch (e) { return null; }
  if (rel.includes('\0')) return null;
  const p = path.resolve(DIST, '.' + path.posix.normalize('/' + rel));
  if (p !== DIST && !p.startsWith(DIST + path.sep)) return null;
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return p;
    if (st.isDirectory() && fs.existsSync(path.join(p, 'index.html'))) return path.join(p, 'index.html');
  } catch (e) { /* missing */ }
  return null;
}

function sendFile(req, res, file, status = 200) {
  const st = fs.statSync(file);
  res.statusCode = status;
  res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Content-Length', st.size);
  if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/* ---------- api/<name>.js ---------- */
const API_DIR = path.join(ROOT, 'api');

function vercelish(req, res, url) {
  req.query = Object.fromEntries(url.searchParams);
  req.cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map((s) => s.trim().split('=')).filter((kv) => kv[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res; };
  res.send = (body) => {
    if (body !== null && typeof body === 'object' && !Buffer.isBuffer(body)) return res.json(body);
    if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', Buffer.isBuffer(body) ? 'application/octet-stream' : 'text/plain; charset=utf-8');
    res.end(body); return res;
  };
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function runApi(req, res, url, name) {
  const file = path.join(API_DIR, name + '.js');
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name) || !fs.existsSync(file)) {
    res.statusCode = 404; res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok: false, error: 'not-found', message: 'Unknown address.' }));
  }
  vercelish(req, res, url);
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      const raw = await readBody(req);
      req.rawBody = raw;
      const type = String(req.headers['content-type'] || '');
      if (!raw.length) req.body = undefined;
      else if (/application\/json/i.test(type)) {
        let parsed;
        try { parsed = JSON.parse(raw.toString('utf8')); } catch (e) { parsed = Symbol.for('invalid'); }
        // Vercel's req.body getter throws on invalid JSON; mimic that
        if (parsed === Symbol.for('invalid')) Object.defineProperty(req, 'body', { get() { throw new Error('Invalid JSON'); }, configurable: true });
        else req.body = parsed;
      } else if (/application\/x-www-form-urlencoded/i.test(type)) req.body = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
      else req.body = /^text\//i.test(type) ? raw.toString('utf8') : raw;
    }
    const mod = await import(pathToFileURL(file).href + '?v=' + fs.statSync(file).mtimeMs);
    if (typeof mod.default !== 'function') throw new Error(`api/${name}.js has no default export`);
    await mod.default(req, res);
  } catch (e) {
    console.error(`[dev] api/${name}.js:`, e && e.stack ? e.stack : e);
    if (!res.headersSent) {
      res.statusCode = e.status || 500; res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: 'server', message: 'Something went wrong on our side.' }));
    } else res.end();
  }
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  res.on('finish', () => { if (!/^\/(vendor|icons)\//.test(req.url)) console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`); });
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch (e) { res.statusCode = 400; return res.end(); }
  const p = url.pathname;
  for (const h of HEADERS) if (h.re.test(p)) for (const { key, value } of h.headers) res.setHeader(key, value);

  const api = /^\/api\/([^/]+?)\/?$/.exec(p);
  if (api) return runApi(req, res, url, api[1]);
  if (p.startsWith('/api/')) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json; charset=utf-8'); return res.end(JSON.stringify({ ok: false, error: 'not-found', message: 'Unknown address.' })); }

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); return res.end(); }
  const direct = fileFor(p);
  if (direct) return sendFile(req, res, direct);
  for (const r of REWRITES) {
    if (r.re.test(p)) { const f = fileFor(r.dest); if (f) return sendFile(req, res, f); }
  }
  // dev fallback: anything else gets the app (the app has no other paths)
  const index = fileFor('/index.html');
  if (index && !path.extname(p)) return sendFile(req, res, index);
  res.statusCode = 404; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('Not found');
});

server.listen(PORT, HOST, () => {
  const env = process.env;
  const db = !!(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL);
  const key = !!(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY);
  console.log(`\nOrbique dev server: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`);
  console.log(`  serving ${path.relative(ROOT, DIST) || DIST}/  ·  api/*.js at /api/<name>`);
  console.log(`  database URL ${db ? 'set' : 'NOT set (local test copy)'}  ·  service key ${key ? 'set' : 'NOT set (/api/account will refuse)'}`);
  console.log('  restart after changing api/_lib/*.js or vercel.json; run with --no-build to skip the build\n');
  if (WORKER) startWorker();
});

/* ---------- --worker: the Channex sending job every 20 s (pg_cron does this in production) ---------- */
function startWorker() {
  const secret = String(process.env.CHANNEX_WORKER_SECRET || '').trim();
  if (!secret) { console.log('  --worker: set CHANNEX_WORKER_SECRET to run the Channex worker'); return; }
  const url = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}/api/channex-worker`;
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'tick' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || (j.ari && (j.ari.calls || j.ari.errors))) console.log('[worker]', r.status, JSON.stringify(j.ari || j));
    } catch (e) {
      console.log('[worker]', e && e.message ? e.message : String(e));
    } finally {
      busy = false;
    }
  };
  console.log('  --worker: Channex worker every 20 s');
  setInterval(run, 20000).unref();
}
