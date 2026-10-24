/* /api/public/*   the booking API for a workspace's own website (api/_lib/website.js, migration 0015)
 *
 * One function for every public path (vercel.json rewrites /api/public/:path* here), so the site adds no Vercel
 * functions per endpoint. No sign-in: the website slug (ws) picks the workspace, and only what a guest may see leaves.
 *
 *   GET  availability?ws&in&out&guests       every room type for one stay: free or not, nightly prices, totals
 *   GET  calendar?ws&type&from&to            nightly availability and prices of one room type (date picker)
 *   POST checkout?ws  {type, in, out, guests, plan?, guest, memberToken?, successUrl?, cancelUrl?}
 *                                            holds the nights and opens Stripe Checkout -> {url, bookingId, ...}
 *   POST member/start?ws  {email}            emails a 6-digit code
 *   POST member/verify?ws {email, code}      -> {token, expiresAt} (30 days; send it back as memberToken)
 *   POST stripe-webhook                      Stripe events (Stripe-Signature checked with STRIPE_WEBHOOK_SECRET)
 *
 * Browsers: allowed origins get CORS headers (originAllowed). Errors are {ok: false, error, message} in plain English.
 */
import { send, fail, readJson, rawBody, ApiError } from './_lib/http.js';
import { requireAdminClient } from './_lib/supabase.js';
import {
  loadSite, availability, calendar, checkout, memberStart, memberVerify, stripeEvent, stripeConfig, stripeSignatureOk, originAllowed
} from './_lib/website.js';

const ROUTES = {
  availability: { method: 'GET', run: (sb, site, q) => availability(sb, site, q) },
  calendar: { method: 'GET', run: (sb, site, q) => calendar(sb, site, q) },
  checkout: { method: 'POST', body: true, run: (sb, site, q, body, origin) => checkout(sb, site, body, { origin }) },
  'member/start': { method: 'POST', body: true, run: (sb, site, q, body) => memberStart(sb, site, body) },
  'member/verify': { method: 'POST', body: true, run: (sb, site, q, body) => memberVerify(sb, site, body) }
};

/** The path after /api/public/ ("availability", "member/start"), from the URL or the rewrite's ?path=. */
export function routeOf(req) {
  let p = '';
  try {
    const u = new URL(req.url || '/', 'http://x');
    p = u.pathname.startsWith('/api/public/') ? u.pathname.slice('/api/public/'.length) : u.searchParams.get('path') || '';
  } catch (e) { p = ''; }
  return p.replace(/^\/+|\/+$/g, '').toLowerCase();
}

function query(req) {
  const out = {};
  try { for (const [k, v] of new URL(req.url || '/', 'http://x').searchParams) if (k !== 'path') out[k] = v.slice(0, 200); } catch (e) { /* none */ }
  return out;
}

function corsHeaders(req, res) {
  const origin = req.headers && req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (!originAllowed(origin, null)) return null;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  return origin;
}

async function webhook(req, res) {
  const cfg = stripeConfig();
  if (!cfg.webhookSecret) return send(res, 503, { ok: false, error: 'not-configured', message: 'Payments are not set up.' });
  const raw = await rawBody(req, 512 * 1024);
  if (!stripeSignatureOk(raw, req.headers && req.headers['stripe-signature'], cfg.webhookSecret)) return send(res, 400, { ok: false, error: 'bad-signature', message: 'Signature check failed.' });
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch (e) { return send(res, 400, { ok: false, error: 'bad-json', message: 'Not JSON.' }); }
  const out = await stripeEvent(requireAdminClient(), event);
  return send(res, 200, { ok: true, received: true, handled: !!out.handled, status: out.status || null });
}

export default async function handler(req, res) {
  const route = routeOf(req);
  try {
    if (route === 'stripe-webhook') {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { ok: false, error: 'method', message: 'Use POST for this address.' }); }
      return await webhook(req, res);
    }
    const origin = corsHeaders(req, res);
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    const r = ROUTES[route];
    if (!r) return send(res, 404, { ok: false, error: 'not-found', message: 'Unknown address.' });
    if (req.method !== r.method) { res.setHeader('Allow', r.method + ', OPTIONS'); return send(res, 405, { ok: false, error: 'method', message: 'Use ' + r.method + ' for this address.' }); }
    const q = query(req);
    const body = r.body ? await readJson(req) : {};
    const sb = requireAdminClient();
    const site = await loadSite(sb, q.ws || body.ws);
    if (req.headers && req.headers.origin && !originAllowed(req.headers.origin, site.settings)) throw new ApiError(403, 'not-allowed', 'This website is not allowed to book here.');
    const data = await r.run(sb, site, q, body, origin || null);
    return send(res, 200, Object.assign({ ok: true }, data));
  } catch (err) {
    return fail(res, err);
  }
}
