#!/usr/bin/env python3
"""End-to-end test of Orbique in server mode: sign-in, workspaces, Supabase sync, realtime, roles, platform admin.

Runs the production build against a Supabase stack (the local one in Docker) through scripts/dev.mjs, drives it
with Chromium and checks the database through the Supabase REST API.

    SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon key> SUPABASE_SERVICE_ROLE_KEY=<service key> \\
        python3 tests/e2e_server.py [--out /tmp/e2e] [--port 8850] [--url http://127.0.0.1:8842] [--keep]

  --url    use a server that is already running (otherwise dev.mjs builds and serves a copy in --out/dist)
  --keep   keep the test operators and accounts afterwards (they are removed by default)
  DATABASE_URL (optional, e.g. postgresql://postgres:postgres@127.0.0.1:54322/postgres): lets the test apply
           supabase/migrations/0003_guest.sql and 0004_app.sql with node + pg when they are not applied yet.

Needs a platform admin: ORBIQUE_ADMIN_EMAIL / ORBIQUE_ADMIN_PASSWORD (default admin@orbique.test / Orbique-test-1).
Test accounts use @s2.test addresses and test operators end in "(S2 test)"; leftovers from an earlier run are removed
first. Screenshots (desktop 1440x900 and phone 390x844) of every server-mode screen go to --out.
Exit code 1 when a check fails or any page logged a JavaScript error.
"""
import argparse, json, os, re, socket, subprocess, sys, time, traceback, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
DESK = {'width': 1440, 'height': 900}
PHONE = {'width': 390, 'height': 844}

ap = argparse.ArgumentParser()
ap.add_argument('--out', default='/tmp/orbique-e2e-server')
ap.add_argument('--port', type=int, default=0)
ap.add_argument('--url', default=None)
ap.add_argument('--keep', action='store_true')
A = ap.parse_args()
OUT = os.path.abspath(A.out)
os.makedirs(OUT, exist_ok=True)

SUPA = os.environ.get('SUPABASE_URL', '').rstrip('/')
ANON = os.environ.get('SUPABASE_ANON_KEY', '')
SERVICE = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
DB_URL = os.environ.get('DATABASE_URL', '')
ADMIN_EMAIL = os.environ.get('ORBIQUE_ADMIN_EMAIL', 'admin@orbique.test')
ADMIN_PW = os.environ.get('ORBIQUE_ADMIN_PASSWORD', 'Orbique-test-1')
if not (SUPA and ANON and SERVICE):
    sys.exit('Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (see the docstring).')

ORG_A, ORG_B = 'Seri Stays (S2 test)', 'Bukit Homes (S2 test)'
OWNER_A, OWNER_B, HK, REQ = 'owner1@s2.test', 'owner2@s2.test', 'hk1@s2.test', 'owner1@s2.test'
PW_A, PW_B, PW_HK = 'Seri-owner-2026', 'Bukit-owner-2026', 'Siti-hk-2026'

# ---------------------------------------------------------------- database through the REST API (service role)
_open = urllib.request.build_opener(urllib.request.ProxyHandler({})).open


def svc(method, path, body=None, headers=None):
    req = urllib.request.Request(SUPA + path, method=method, data=None if body is None else json.dumps(body).encode())
    for k, v in {'apikey': SERVICE, 'Authorization': 'Bearer ' + SERVICE, 'Content-Type': 'application/json'}.items():
        req.add_header(k, v)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with _open(req, timeout=30) as r:
        txt = r.read().decode()
        return (json.loads(txt) if txt.strip() else None), dict(r.headers)


def q(s):
    return urllib.parse.quote(s, safe='')


def count(table, filters):
    _, h = svc('GET', '/rest/v1/%s?select=*&%s' % (table, filters), headers={'Prefer': 'count=exact', 'Range': '0-0'})
    return int(h.get('Content-Range', '*/0').split('/')[-1])


def org_id(name):
    rows, _ = svc('GET', '/rest/v1/orgs?select=id&name=eq.' + q(name))
    return rows[0]['id'] if rows else None


def record(org, coll, rid):
    rows, _ = svc('GET', '/rest/v1/records?select=data,deleted&org_id=eq.%s&coll=eq.%s&id=eq.%s' % (org, q(coll), q(rid)))
    return rows[0] if rows else None


def cleanup():
    rows, _ = svc('GET', '/rest/v1/orgs?select=id,name&name=ilike.' + q('*(S2 test)*'))
    for o in rows or []:
        svc('DELETE', '/rest/v1/orgs?id=eq.' + o['id'])
    svc('DELETE', '/rest/v1/subscription_requests?email=ilike.' + q('*@s2.test'))
    users, _ = svc('GET', '/auth/v1/admin/users?page=1&per_page=1000')
    for u in (users or {}).get('users', []):
        if (u.get('email') or '').endswith('@s2.test'):
            svc('DELETE', '/auth/v1/admin/users/' + u['id'])


def apply_sql(name):
    """apply a migration file with node + pg (only when DATABASE_URL is set)"""
    if not DB_URL:
        return False
    js = ("import pg from 'pg'; import fs from 'node:fs'; const c = new pg.Client({connectionString: process.env.DATABASE_URL});"
          "await c.connect(); await c.query(fs.readFileSync(process.argv[1], 'utf8')); await c.end();")
    r = subprocess.run(['node', '--input-type=module', '-e', js, os.path.join(ROOT, 'supabase', 'migrations', name)], cwd=ROOT,
                       env=dict(os.environ, DATABASE_URL=DB_URL), capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError('could not apply %s: %s' % (name, r.stderr.strip()[-400:]))
    return True


# ---------------------------------------------------------------- results
RESULTS, ERRORS, PAGES = [], [], []


def step(name):
    def wrap(fn):
        def run(*a, **k):
            t0 = time.time()
            try:
                note = fn(*a, **k)
                RESULTS.append(('PASS' if note != 'SKIP' and not str(note or '').startswith('SKIP') else 'SKIP', name, str(note or ''), time.time() - t0))
                print('%-5s %s %s' % (RESULTS[-1][0], name, ('· ' + str(note)) if note else ''), flush=True)
                return True
            except Exception as e:
                RESULTS.append(('FAIL', name, '%s: %s' % (type(e).__name__, str(e).splitlines()[0] if str(e) else ''), time.time() - t0))
                print('FAIL  %s · %s' % (name, RESULTS[-1][2]), flush=True)
                traceback.print_exc(limit=3)
                for pg in PAGES:  # what each open browser showed when the step failed
                    try:
                        pg.screenshot(path=os.path.join(OUT, 'fail-%s-%s.png' % (fn.__name__, pg.label)))
                        print('  %s toasts: %s' % (pg.label, pg.evaluate('() => (window.__toasts || []).slice(-3)')))
                    except Exception:
                        pass
                return False
        return run
    return wrap


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


# ---------------------------------------------------------------- browser helpers
TOAST_JS = """(() => { window.__toasts = [];
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); })
    .observe(document, {childList: true, subtree: true}); })();"""


def new_page(browser, label, vp):
    ctx = browser.new_context(viewport=vp, service_workers='block', device_scale_factor=1)
    ctx.add_init_script(TOAST_JS)
    pg = ctx.new_page()
    pg.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    pg.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    pg.on('pageerror', lambda e: ERRORS.append('%s: pageerror: %s' % (label, e)))

    def con(m):
        if m.type == 'error' and 'Failed to load resource' not in m.text and 'net::ERR' not in m.text:
            ERRORS.append('%s: console.error: %s' % (label, m.text[:300]))
    pg.on('console', con)
    pg.label = label
    PAGES.append(pg)
    return ctx, pg


def shot(pg, name, both=True):
    """screenshot in the current size, then (both=True) in the other size (desktop <-> phone)"""
    vp = pg.viewport_size
    kind = 'phone' if vp['width'] < 600 else 'desktop'
    pg.wait_for_timeout(250)
    pg.screenshot(path=os.path.join(OUT, '%s-%s.png' % (name, kind)))
    if both:
        other = DESK if kind == 'phone' else PHONE
        pg.set_viewport_size(other)
        pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(OUT, '%s-%s.png' % (name, 'desktop' if kind == 'phone' else 'phone')))
        pg.set_viewport_size(vp)
        pg.wait_for_timeout(250)


def open_app(pg):
    pg.goto(BASE + '/')
    pg.wait_for_selector('.auth-card form, #page-root .card, #page-root .pf, .auth-choice', timeout=30000)


def sign_in(pg, email, pw, expect='app'):
    open_app(pg)
    pg.wait_for_selector('.auth-card form #email', timeout=20000)
    pg.wait_for_timeout(100)  # the screen focuses its first field after 30 ms (desktop); do not race it
    pg.fill('#email', email)
    pg.fill('#password', pw)
    pg.click('.auth-btn')
    if expect == 'app':
        wait_app(pg)


def wait_app(pg, timeout=40000):
    pg.wait_for_function('() => window.O && O._started && O.sync.started', timeout=timeout)
    pg.wait_for_timeout(600)


def wait_toast(pg, text, timeout=15000):
    pg.wait_for_function('(t) => (window.__toasts || []).some(x => x.indexOf(t) >= 0)', arg=text, timeout=timeout)


def choose_password(pg, pw, name=None):
    pg.wait_for_selector('#confirm', timeout=20000)
    pg.wait_for_timeout(100)
    if name:
        shot(pg, name)
    pg.fill('#password', pw)
    pg.fill('#confirm', pw)
    pg.click('.auth-btn')


def js(pg, code, arg=None):
    return pg.evaluate(code, arg)


# ---------------------------------------------------------------- server
def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


SERVER = None
if A.url:
    BASE = A.url.rstrip('/')
else:
    port = A.port or free_port()
    BASE = 'http://127.0.0.1:%d' % port
    env = dict(os.environ, SUPABASE_URL=SUPA, SUPABASE_ANON_KEY=ANON, SUPABASE_SERVICE_ROLE_KEY=SERVICE)
    SERVER = subprocess.Popen(['node', 'scripts/dev.mjs', '--port', str(port), '--dist', os.path.join(OUT, 'dist')], cwd=ROOT, env=env,
                              stdout=open(os.path.join(OUT, 'dev-server.log'), 'w'), stderr=subprocess.STDOUT)
    for _ in range(120):
        try:
            with _open(BASE + '/api/health', timeout=2) as r:
                if r.status == 200:
                    break
        except Exception:
            time.sleep(0.5)
    else:
        SERVER.kill()
        sys.exit('the dev server did not start; see ' + os.path.join(OUT, 'dev-server.log'))

S = {}  # state shared by the steps


# ================================================================= the steps
@step('setup: "Set up Orbique" first-run screen (health intercepted)')
def t_setup(browser):
    ctx, pg = new_page(browser, 'setup', DESK)
    pg.route('**/api/health', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'db': True, 'needsBootstrap': True})))
    calls = []

    def fake_account(r):
        body = json.loads(r.request.post_data or '{}')
        calls.append(body.get('action'))
        r.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True}))
    pg.route('**/api/account', fake_account)
    open_app(pg)
    pg.wait_for_selector('text=Set up Orbique')
    shot(pg, '01-setup')
    pg.fill('#name', 'Orbique Admin')
    pg.fill('#email', ADMIN_EMAIL)
    pg.fill('#password', ADMIN_PW)
    pg.fill('#confirm', ADMIN_PW + 'x')
    pg.click('.auth-btn')
    pg.wait_for_selector('.auth-err:not([hidden])')
    check('do not match' in pg.inner_text('.auth-err'), 'mismatched passwords are caught')
    pg.fill('#confirm', ADMIN_PW)
    pg.click('.auth-btn')
    wait_app(pg)
    check(calls == ['bootstrap'], 'bootstrap was called: %s' % calls)
    pg.wait_for_selector('.pf')
    check(js(pg, '() => O.state.page') == 'platform', 'lands on the platform page')
    ctx.close()


@step('request access: "New operator? Request access" form')
def t_request(browser):
    ctx, pg = new_page(browser, 'request', PHONE)
    open_app(pg)
    pg.wait_for_selector('#email')
    shot(pg, '02-sign-in')
    pg.fill('#email', 'nobody@s2.test')
    pg.fill('#password', 'wrong-password-1')
    pg.click('.auth-btn')
    pg.wait_for_selector('.auth-err:not([hidden])')
    check('do not match' in pg.inner_text('.auth-err'), 'wrong password message')
    shot(pg, '02-sign-in-error', both=False)
    pg.click('[data-go=request]')
    pg.wait_for_selector('#company')
    shot(pg, '03-request-access')
    pg.fill('#company', ORG_A)
    pg.fill('#contactName', 'Aisha Rahman')
    pg.fill('#email', REQ)
    pg.fill('#phone', '+60 12-555 0101')
    pg.fill('#units', '12')
    pg.fill('#message', 'We run 12 units in Penang and Kuala Lumpur.')
    pg.click('.auth-btn')
    pg.wait_for_selector('.auth-done', timeout=20000)
    shot(pg, '04-request-sent')
    check(count('subscription_requests', 'email=eq.' + q(REQ) + '&status=eq.new') == 1, 'request saved in the database')
    ctx.close()


@step('platform admin signs in, sees the request and creates operator A from it')
def t_admin_create(browser):
    ctx, pg = new_page(browser, 'admin', DESK)
    S['admin'] = pg
    sign_in(pg, ADMIN_EMAIL, ADMIN_PW)
    pg.wait_for_selector('.pf')
    check(js(pg, '() => O.state.page') == 'platform', 'a platform admin without a workspace lands on the platform page')
    check(js(pg, '() => document.querySelectorAll("#nav .nav-item").length') == 1, 'only the platform link in the menu')
    shot(pg, '05-platform')
    pg.click('[data-tab=req]')
    pg.wait_for_selector('.pf-req')
    shot(pg, '06-platform-requests')
    card = pg.locator('.pf-req', has_text=ORG_A)
    card.locator('[data-req=setup]').click()
    pg.wait_for_selector('#pf-co')
    check(pg.input_value('#pf-co') == ORG_A and pg.input_value('#pf-oe') == OWNER_A, 'the form is filled from the request')
    shot(pg, '07-add-operator')
    pg.click('#pf-create')
    pg.wait_for_selector('.pf-pw', timeout=30000)
    S['tmpA'] = pg.inner_text('.pf-pw').strip()
    check(re.match(r'^[A-Za-z]+-[A-Za-z]+-\d{4}$', S['tmpA']), 'temporary password shown: %s' % S['tmpA'])
    check(S['tmpA'] in pg.input_value('#pf-msg'), 'ready-to-send message has the password')
    shot(pg, '08-operator-credentials')
    pg.click('.modal-foot .btn-ghost')
    S['A'] = org_id(ORG_A)
    check(S['A'], 'org A exists')
    pg.wait_for_function('() => !document.querySelector(".modal-back")')
    time.sleep(1)
    check(count('subscription_requests', 'email=eq.' + q(REQ) + '&status=eq.approved') == 1, 'request marked handled')
    pg.click('[data-tab=ops]')
    pg.wait_for_selector('.pf-table tr[data-org]')


@step('owner A: first sign-in, temporary password, onboarding, load demo data (rows in the database)')
def t_owner_demo(browser):
    ctx, pg = new_page(browser, 'ownerA-phone', PHONE)
    S['a1'] = pg
    sign_in(pg, OWNER_A, S['tmpA'], expect='password')
    choose_password(pg, PW_A, name='09-choose-password')
    pg.wait_for_selector('.auth-choice[data-act=demo]', timeout=20000)
    shot(pg, '10-onboarding')
    slow = lambda r: (time.sleep(0.35), r.continue_()) if r.request.method == 'POST' else r.continue_()
    pg.route('**/rest/v1/records*', slow)  # slow the writes a little so the progress screen can be photographed
    t0 = time.time()
    pg.click('.auth-choice[data-act=demo]')
    pg.wait_for_selector('.srv-seed', timeout=40000)
    pg.wait_for_timeout(300)
    shot(pg, '11-loading-demo')
    pg.wait_for_selector('.srv-seed', state='detached', timeout=240000)
    pg.unroute('**/rest/v1/records*')
    seconds = time.time() - t0
    wait_toast(pg, 'Demo data is ready')
    n_local = js(pg, '() => ({bookings: O.data.bookings.length, staff: O.data.staff.length, props: O.data.properties.length, viewer: O.state.viewer, owner: O.viewer().name})')
    check(n_local['owner'] == 'Aisha Rahman', 'the demo owner is replaced by the real owner: %s' % n_local)
    total = count('records', 'org_id=eq.%s&deleted=is.false' % S['A'])
    bookings = count('records', 'org_id=eq.%s&coll=eq.bookings&deleted=is.false' % S['A'])
    check(bookings == n_local['bookings'] and bookings > 100, 'bookings in the database %d vs app %d' % (bookings, n_local['bookings']))
    check(count('records', 'org_id=eq.%s&coll=eq.properties' % S['A']) == n_local['props'], 'properties saved')
    meta, _ = svc('GET', '/rest/v1/blobs?select=data&org_id=eq.%s&key=eq.workspaceMeta' % S['A'])
    check(meta and meta[0]['data']['v'].get('seedPending') is False and meta[0]['data']['v'].get('demo') is True, 'workspaceMeta: demo, seed done')
    toks, _ = svc('GET', '/rest/v1/records?select=data->>guestToken&org_id=eq.%s&coll=eq.bookings&limit=3' % S['A'])
    check(all(len(t['guestToken']) >= 17 for t in toks), 'every demo booking got its own guest token')
    S['token'] = toks[0]['guestToken']
    shot(pg, '12-dashboard-demo')
    return '%d rows (%d bookings) saved in %.1fs with slowed writes' % (total, bookings, seconds)


@step('realtime: an edit to a booking reaches a second signed-in browser')
def t_realtime(browser):
    ctx, pg = new_page(browser, 'ownerA-desk', DESK)
    S['a2'] = pg
    sign_in(pg, OWNER_A, PW_A)
    a1 = S['a1']
    for p in (a1, pg):
        p.wait_for_function('() => O.sync.adapter && O.sync.adapter.live', timeout=20000)
    bid = js(a1, '() => { const b = O.data.bookings.find(x => x.status === "confirmed" && x.checkIn > O.data.TODAY); b.notes = "Arrives late, around 11 PM"; O.emit("data"); return b.id; }')
    t0 = time.time()
    pg.wait_for_function('(id) => { const b = O.data.booking(id); return b && b.notes === "Arrives late, around 11 PM"; }', arg=bid, timeout=10000)
    there = time.time() - t0
    js(pg, '(id) => { O.data.booking(id).guests = 3; O.emit("data"); }', bid)
    t1 = time.time()
    a1.wait_for_function('(id) => O.data.booking(id).guests === 3', arg=bid, timeout=10000)
    back = time.time() - t1
    time.sleep(1.5)
    rec = record(S['A'], 'bookings', bid)
    check(rec['data']['notes'] == 'Arrives late, around 11 PM' and rec['data']['guests'] == 3, 'both edits saved')
    check(js(a1, '(id) => O.data.booking(id).notes', bid) == 'Arrives late, around 11 PM', 'no stale echo overwrote the first device')
    S['bid'] = bid
    return 'phone -> desktop %.2fs, desktop -> phone %.2fs' % (there, back)


@step('owner menus: workspace switcher, viewer menu, preview as a housekeeper')
def t_preview(browser):
    pg = S['a2']
    pg.click('#ws-btn')
    pg.wait_for_selector('#ws-menu.open')
    check(js(pg, '() => document.querySelectorAll("#ws-menu .ws-opt").length') == 1, 'one workspace')
    shot(pg, '13-workspace-menu', both=False)
    pg.click('#ws-btn')
    pg.wait_for_selector('#ws-menu.open', state='detached')
    pg.click('#viewer-btn')
    pg.wait_for_selector('[data-auth-act=preview]')
    shot(pg, '14-viewer-menu', both=False)
    pg.click('[data-auth-act=preview]')
    pg.wait_for_selector('[data-p=s5]')
    shot(pg, '15-preview-picker')
    pg.click('[data-p=s5]')
    pg.wait_for_selector('[data-stop-preview]')
    check(js(pg, '() => O.state.viewer') == 's5' and not js(pg, '() => O.allowed("financials")'), 'previewing as a housekeeper hides owner sections')
    shot(pg, '16-preview-banner')
    pg.click('[data-stop-preview]')
    pg.wait_for_function('() => !document.querySelector("[data-stop-preview]")')
    check(js(pg, '() => O.isOwner()'), 'back to the owner view')


@step('housekeeper: invited, signs in, sees only allowed sections; a forbidden write is refused and reported')
def t_housekeeper(browser):
    inv = js(S['a2'], '() => O.auth.invite({staffId: "s5", name: "Siti Aminah", email: "%s", phone: "+60 19-402 6631", role: "housekeeping"})' % HK)
    check(inv['tempPassword'] and not inv['existing'], 'invite returned a temporary password')
    ctx, pg = new_page(browser, 'housekeeper', PHONE)
    S['hk'] = pg
    sign_in(pg, HK, inv['tempPassword'], expect='password')
    choose_password(pg, PW_HK)
    wait_app(pg)
    info = js(pg, '() => ({viewer: O.state.viewer, role: O.viewer().role, ok: O.NAV.flatMap(g => g[1]).filter(O.allowed), locks: document.querySelectorAll("#nav .nav-lock").length})')
    check(info['viewer'] == 's5' and info['role'] == 'housekeeping', 'signed in as the housekeeper: %s' % info)
    for sec in ('tasks', 'calendar', 'inventory'):
        check(sec in info['ok'], sec + ' allowed')
    for sec in ('financials', 'reports', 'staff', 'brand', 'invoices'):
        check(sec not in info['ok'], sec + ' locked')
    check(info['locks'] >= 5, 'locked sections are marked in the menu')
    js(pg, '() => O.go("financials")')
    pg.wait_for_selector('.locked')
    shot(pg, '17-housekeeper-locked')
    js(pg, '() => O.go("tasks")')
    pg.wait_for_timeout(500)
    shot(pg, '18-housekeeper-tasks')
    # an allowed write is saved
    tid = js(pg, '() => { const t = O.data.tasks.find(x => x.assigneeId === "s5" && x.status !== "done"); t.status = "in_progress"; O.emit("data"); return t.id; }')
    deadline = time.time() + 10
    while time.time() < deadline and record(S['A'], 'tasks', tid)['data']['status'] != 'in_progress':
        time.sleep(0.4)
    check(record(S['A'], 'tasks', tid)['data']['status'] == 'in_progress', 'the housekeeper can update her task')
    # forbidden: staff records and role permissions are owner-only
    owner_id = js(pg, '() => O.data.staff.find(s => s.role === "owner").id')
    js(pg, '() => { const o = O.data.staff.find(s => s.role === "owner"); o.name = "Changed by housekeeper"; O.data.rolePerms.housekeeping.sections.financials = "edit"; O.emit("data"); }')
    wait_toast(pg, 'not saved because your access does not allow them')
    pg.wait_for_function('() => O.data.staff.find(s => s.role === "owner").name === "Aisha Rahman" && O.data.rolePerms.housekeeping.sections.financials !== "edit"', timeout=10000)
    check(record(S['A'], 'staff', owner_id)['data']['name'] == 'Aisha Rahman', 'the database kept the owner record')
    check(count('blobs', 'org_id=eq.%s&key=eq.rolePerms' % S['A']) == 0, 'no role permissions were written')
    toast = [t for t in js(pg, '() => window.__toasts') if 'not saved' in t][0]
    return toast


@step('paused workspace: read-only with a banner (live tab and after reload), then resumed')
def t_paused(browser):
    adm = S['admin']
    adm.click('.pf-table tr[data-org="%s"] button' % S['A'])
    adm.wait_for_selector('[data-act=pause]')
    shot(adm, '19-manage-operator')
    adm.click('[data-act=pause]')
    adm.wait_for_selector('.modal-back >> nth=1')
    shot(adm, '20-pause-confirm', both=False)
    adm.click('.modal-back >> nth=1 >> .btn-danger')
    wait_toast(adm, 'is paused')
    check(svc('GET', '/rest/v1/orgs?select=status&id=eq.' + S['A'])[0][0]['status'] == 'paused', 'org paused in the database')
    # a tab that is already open notices on its next save
    pg = S['a2']
    js(pg, '(id) => { O.data.booking(id).notes = "Edited while paused"; O.emit("data"); }', S['bid'])
    wait_toast(pg, 'view only')
    pg.wait_for_selector('.srv-banner.warn')
    check(js(pg, '() => O.sync.status') == 'readonly', 'sync pill says view only')
    # after a reload the workspace opens read-only straight away
    pg.reload()
    wait_app(pg)
    pg.wait_for_selector('.srv-banner.warn')
    check(js(pg, '() => O.sync.readOnly && document.querySelector("#sync-pill").textContent') == 'View only', 'view only after reload')
    js(pg, '(id) => { O.data.booking(id).notes = "Edited while paused again"; O.emit("data"); }', S['bid'])
    pg.wait_for_timeout(1500)
    shot(pg, '21-paused-workspace')
    check(record(S['A'], 'bookings', S['bid'])['data']['notes'] == 'Arrives late, around 11 PM', 'nothing was written while paused')
    adm.click('.pf-table tr[data-org="%s"] button' % S['A'])
    adm.click('[data-act=resume]')
    wait_toast(adm, 'is active again')
    # the admin changes the plan; the owner sees it after a reload
    adm.click('.pf-table tr[data-org="%s"] button' % S['A'])
    adm.select_option('#pf-plan', 'growth')
    adm.click('[data-act=plan]')
    wait_toast(adm, 'Growth plan')
    check(svc('GET', '/rest/v1/orgs?select=plan&id=eq.' + S['A'])[0][0]['plan'] == 'growth', 'plan changed in the database')
    pg.reload()
    wait_app(pg)
    check(not js(pg, '() => O.sync.readOnly') and not pg.query_selector('.srv-banner.warn'), 'writable again after resume')
    check(js(pg, '() => O.ws().plan') == 'Growth plan', 'the owner sees the new plan')


@step('operator B: created by the admin, owner starts empty, the empty workspace renders')
def t_operator_b(browser):
    adm = S['admin']
    adm.click('#tb-actions .btn-primary')
    adm.wait_for_selector('#pf-co')
    adm.wait_for_function('() => document.activeElement && document.activeElement.id === "pf-co"')  # the modal focuses its first field after 30 ms
    adm.fill('#pf-co', ORG_B)
    adm.fill('#pf-on', 'Daniel Yap')
    adm.fill('#pf-oe', OWNER_B)
    adm.select_option('#pf-pl', 'starter')
    adm.click('#pf-create')
    adm.wait_for_selector('.pf-pw', timeout=30000)
    tmp = adm.inner_text('.pf-pw').strip()
    adm.click('.modal-foot .btn-ghost')
    S['B'] = org_id(ORG_B)
    ctx, pg = new_page(browser, 'ownerB', DESK)
    S['b'] = pg
    sign_in(pg, OWNER_B, tmp, expect='password')
    choose_password(pg, PW_B)
    pg.wait_for_selector('.auth-choice[data-act=empty]', timeout=20000)
    pg.click('.auth-choice[data-act=empty]')
    wait_app(pg)
    st = js(pg, '() => ({b: O.data.bookings.length, p: O.data.properties.length, s: O.data.staff.length, t: O.data.tasks.length, page: O.state.page, meta: O.data.workspaceMeta})')
    check(st['b'] == 0 and st['p'] == 0 and st['t'] == 0 and st['s'] == 1, 'empty workspace with only the owner: %s' % st)
    check(st['meta'] and st['meta'].get('demo') is False, 'workspaceMeta says not demo')
    shot(pg, '22-empty-dashboard')
    for page in ('properties', 'bookings', 'tasks'):
        js(pg, '(p) => O.go(p)', page)
        pg.wait_for_timeout(500)
    shot(pg, '23-empty-tasks')
    check(count('records', 'org_id=eq.%s&coll=eq.bookings' % S['B']) == 0, 'no bookings in B')


@step('isolation: two operators cannot read or write each other\'s data')
def t_isolation(browser):
    probe = """async ([other]) => {
      const sb = O.auth.supabase();
      const recs = await sb.from('records').select('id').eq('org_id', other).limit(5);
      const blobs = await sb.from('blobs').select('key').eq('org_id', other).limit(5);
      const org = await sb.from('orgs').select('id').eq('id', other);
      const members = await sb.from('members').select('user_id').eq('org_id', other);
      const ins = await sb.from('records').upsert({org_id: other, coll: 'bookings', id: 'BK-INTRUDER', data: {id: 'BK-INTRUDER'}});
      const reset = await sb.rpc('reset_org', {p_org: other});
      const ctx = await sb.rpc('my_context');
      return {recs: (recs.data || []).length, blobs: (blobs.data || []).length, org: (org.data || []).length, members: (members.data || []).length,
              insErr: ins.error && ins.error.code, resetErr: reset.error && reset.error.code, mine: ctx.data.workspaces.map(w => w.id)};
    }"""
    b_sees_a = js(S['b'], probe, [S['A']])
    a_sees_b = js(S['a2'], probe, [S['B']])
    for who, r, own in (('B', b_sees_a, S['B']), ('A', a_sees_b, S['A'])):
        check(r['recs'] == 0 and r['blobs'] == 0 and r['org'] == 0 and r['members'] == 0, '%s reads nothing of the other operator: %s' % (who, r))
        check(r['insErr'] == '42501' and r['resetErr'] == '42501', '%s cannot write to the other operator: %s' % (who, r))
        check(r['mine'] == [own], '%s only has its own workspace: %s' % (who, r))
    check(record(S['A'], 'bookings', 'BK-INTRUDER') is None, 'no intruder row')
    # an owner cannot lift a pause, change the plan or rewire a member of their own workspace through the API
    own = js(S['a2'], """async ([own]) => {
      const sb = O.auth.supabase();
      const org = await sb.from('orgs').update({status: 'active', plan: 'pro'}).eq('id', own).select('id');
      const st = await sb.rpc('set_org_status', {p_org: own, p_status: 'active'});
      const pl = await sb.rpc('set_org_plan', {p_org: own, p_plan: 'pro'});
      const mem = await sb.from('members').update({staff_id: 's9'}).eq('org_id', own).eq('staff_id', 's5').select('staff_id');
      return {org: org.error && org.error.code, st: st.error && st.error.code, pl: pl.error && pl.error.code, mem: mem.error && mem.error.code};
    }""", [S['A']])
    check(own == {'org': '42501', 'st': '42501', 'pl': '42501', 'mem': '42501'}, 'owner A cannot change plan, status or member identity: %s' % own)
    check(svc('GET', '/rest/v1/orgs?select=plan&id=eq.' + S['A'])[0][0]['plan'] == 'growth', 'plan unchanged')
    # an owner changes a member's role, and back
    js(S['a2'], '() => O.auth.setMemberRole("s5", "frontdesk")')
    check(svc('GET', '/rest/v1/members?select=role&org_id=eq.%s&staff_id=eq.s5' % S['A'])[0][0]['role'] == 'frontdesk', 'member role changed by the owner')
    js(S['a2'], '() => O.auth.setMemberRole("s5", "housekeeping")')
    check(svc('GET', '/rest/v1/members?select=role&org_id=eq.%s&staff_id=eq.s5' % S['A'])[0][0]['role'] == 'housekeeping', 'and back')
    check(js(S['a2'], '() => O.auth.setMemberStatus("s6", "active")') is False, 'a person with no sign-in: nothing to update, no error')
    check(js(S['b'], '() => O.data.bookings.length') == 0, 'B still has no bookings')


@step('workspace picker: a person in two workspaces chooses one, then switches from the menu')
def t_picker(browser):
    inv = js(S['b'], '() => { O.data.staff.push({id: "s-aisha", name: "Aisha Rahman", role: "ops", roleLabel: "Ops manager"}); O.emit("data"); return O.auth.invite({staffId: "s-aisha", name: "Aisha Rahman", email: "%s", role: "ops"}); }' % OWNER_A)
    check(inv['existing'] and inv['tempPassword'] is None, 'existing account added without a new password: %s' % inv)
    pg = S['a2']
    js(pg, '() => { localStorage.removeItem("orbique4:srv:ws:" + O.auth.user().id); }')
    pg.reload()
    pg.wait_for_selector('.auth-ws', timeout=30000)
    check(js(pg, '() => document.querySelectorAll(".auth-ws").length') == 2, 'two workspaces offered')
    shot(pg, '24-workspace-picker')
    pg.click('.auth-ws[data-ws="%s"]' % S['B'])
    wait_app(pg)
    check(js(pg, '() => O.auth.orgId()') == S['B'] and js(pg, '() => O.auth.role()') == 'ops', 'opened B as ops')
    check(js(pg, '() => !O.allowed("financials") && O.allowed("bookings")'), 'ops permissions in B')
    pg.click('#ws-btn')
    pg.wait_for_selector('#ws-menu.open')
    check(js(pg, '() => document.querySelectorAll("#ws-menu .ws-opt").length') == 2, 'switcher lists both')
    shot(pg, '25-workspace-switcher', both=False)
    pg.click('#ws-menu .ws-opt[data-ws="%s"]' % S['A'])
    pg.wait_for_function('(a) => window.O && O._started && O.auth.orgId() === a', arg=S['A'], timeout=40000)
    wait_app(pg)
    check(js(pg, '() => O.auth.role()') == 'owner' and js(pg, '() => O.data.bookings.length') > 100, 'back in A as owner')
    pg.reload()
    wait_app(pg)
    check(js(pg, '() => O.auth.orgId()') == S['A'], 'the choice is remembered on this device')


@step('suspended member: a clear message and sign out; waiting and connection screens')
def t_suspended(browser):
    js(S['a2'], '() => O.auth.setMemberStatus("s5", "suspended")')
    check(svc('GET', '/rest/v1/members?select=status&org_id=eq.%s&staff_id=eq.s5' % S['A'])[0][0]['status'] == 'suspended', 'member suspended in the database')
    pg = S['hk']
    pg.reload()
    pg.wait_for_selector('text=Your access is paused', timeout=30000)
    shot(pg, '26-access-paused')
    js(S['a2'], '() => O.auth.setMemberStatus("s5", "active")')
    # "still setting things up" (a non-owner opening a workspace with no workspaceMeta), intercepted
    pg.route('**/rest/v1/blobs?select=data&org_id=*key=eq.workspaceMeta*', lambda r: r.fulfill(status=406, content_type='application/json', body=json.dumps({'code': 'PGRST116', 'details': 'The result contains 0 rows', 'message': 'JSON object requested, multiple (or no) rows returned'})) if 'single' in (r.request.headers.get('accept') or '') else r.fulfill(status=200, content_type='application/json', body='[]'))
    pg.reload()
    pg.wait_for_selector('text=still setting things up', timeout=30000)
    shot(pg, '27-waiting-for-owner')
    pg.unroute('**/rest/v1/blobs?select=data&org_id=*key=eq.workspaceMeta*')
    # cannot connect
    pg.route('**/rest/v1/rpc/my_context', lambda r: r.abort())
    pg.reload()
    pg.wait_for_selector('text=Orbique cannot connect right now', timeout=30000)
    shot(pg, '28-cannot-connect')
    pg.unroute('**/rest/v1/rpc/my_context')
    pg.click('.auth-btn >> text=Try again')
    wait_app(pg)
    check(js(pg, '() => O.state.viewer') == 's5', 'back in after the connection returns')


@step('platform admin resets an owner\'s password; the owner must choose a new one')
def t_reset_pw(browser):
    adm = S['admin']
    adm.click('.pf-table tr[data-org="%s"] button' % S['B'])
    adm.wait_for_selector('[data-reset]')
    adm.click('[data-reset]')
    adm.click('.modal-back >> nth=1 >> .btn-primary')
    adm.wait_for_selector('.pf-pw', timeout=30000)
    tmp = adm.inner_text('.pf-pw').strip()
    shot(adm, '29-reset-password')
    adm.click('.modal-foot .btn-ghost')
    pg = S['b']
    js(pg, '() => O.auth.signOut()')
    pg.wait_for_selector('.auth-card form #email', timeout=30000)
    sign_in(pg, OWNER_B, tmp, expect='password')
    choose_password(pg, PW_B + '!')
    wait_app(pg)
    check(js(pg, '() => O.auth.orgId()') == S['B'], 'owner B is back in')
    # the platform page on a phone
    adm.set_viewport_size(PHONE)
    adm.wait_for_timeout(400)
    adm.screenshot(path=os.path.join(OUT, '05-platform-cards-phone.png'))
    adm.set_viewport_size(DESK)


@step('guest link opens the guest app without signing in')
def t_guest(browser):
    if not os.path.exists(os.path.join(ROOT, 'supabase', 'migrations', '0003_guest.sql')):
        return 'SKIP: supabase/migrations/0003_guest.sql does not exist yet'
    probe = urllib.request.Request(SUPA + '/rest/v1/rpc/guest_get', method='POST', data=json.dumps({'p_token': 'x'}).encode())
    for k, v in {'apikey': ANON, 'Authorization': 'Bearer ' + ANON, 'Content-Type': 'application/json'}.items():
        probe.add_header(k, v)
    try:
        _open(probe, timeout=10)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            if not apply_sql('0003_guest.sql'):
                return 'SKIP: guest_get is not in the database and DATABASE_URL is not set to apply 0003_guest.sql'
    # a guest who is staying now (the demo has a few checked-in bookings on the story date)
    rows, _ = svc('GET', '/rest/v1/records?select=id,data&org_id=eq.%s&coll=eq.bookings&deleted=is.false&data->>status=eq.checked_in&order=id&limit=1' % S['A'])
    check(rows, 'an in-house booking exists in the demo')
    bid, b = rows[0]['id'], rows[0]['data']
    first = b['guest']['name'].split(' ')[0]
    ctx, pg = new_page(browser, 'guest', PHONE)
    pg.goto(BASE + '/guest/' + b['guestToken'])
    pg.wait_for_function('() => { const g = document.querySelector("#guest-root"); return g && !g.hidden && g.innerText.trim().length > 40; }', timeout=30000)
    pg.wait_for_timeout(1500)
    shot(pg, '30-guest-app')
    check(js(pg, '() => !localStorage.getItem("orbique-auth")'), 'no staff session in the guest browser')
    check(js(pg, '() => document.querySelector("#app").hidden'), 'the staff app stays hidden')
    txt = pg.inner_text('#guest-root')
    check(first in txt and not re.search(r'could not|went wrong|not found|has ended', txt, re.I), 'guest app shows the stay of %s: %s' % (first, txt[:120]))
    # a message from the guest reaches the owner's open app through Realtime
    staff = S['a1']
    staff.wait_for_function('() => O.sync.adapter && O.sync.adapter.live', timeout=20000)
    res = js(pg, '([t]) => O.guestApi.act(t, "message", {text: "Is late check-out possible on Sunday?"})', [b['guestToken']])
    check(res and res.get('ok'), 'guest_act message accepted: %s' % res)
    staff.wait_for_function('(bid) => (O.data.conversations || []).some(c => c.bookingId === bid && (c.messages || []).some(m => m.text === "Is late check-out possible on Sunday?"))', arg=bid, timeout=10000)
    bad = js(pg, '([t]) => O.guestApi.get(t + "x")', [b['guestToken']])
    check(bad and not bad.get('ok') and not bad.get('booking'), 'a wrong token shows nothing: %s' % json.dumps(bad)[:120])


@step('sign out returns to the sign-in screen')
def t_signout(browser):
    pg = S['a1']
    pg.click('#menu-btn')
    pg.click('#viewer-btn')
    pg.click('[data-auth-act=signout]')
    pg.wait_for_selector('.auth-card form #email', timeout=30000)
    check(not js(pg, '() => localStorage.getItem("orbique-auth")'), 'session removed')


def main():
    cleanup()
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None, args=['--no-sandbox'])
        ok = t_setup(browser) and True
        t_request(browser)
        if t_admin_create(browser) and t_owner_demo(browser):
            t_realtime(browser)
            t_preview(browser)
            hk = t_housekeeper(browser)
            t_paused(browser)
            if t_operator_b(browser):
                t_isolation(browser)
                t_picker(browser)
                t_reset_pw(browser)
            if hk:
                t_suspended(browser)
            t_guest(browser)
            t_signout(browser)
        browser.close()
    if not A.keep:
        cleanup()
    if SERVER:
        SERVER.terminate()
    print('\n' + '=' * 72)
    for r in RESULTS:
        print('%-5s %-90s %5.1fs  %s' % (r[0], r[1][:90], r[3], r[2][:160]))
    print('JavaScript errors: %d' % len(ERRORS))
    for e in ERRORS:
        print('  ' + e[:400])
    print('Screenshots: ' + OUT)
    failed = [r for r in RESULTS if r[0] == 'FAIL']
    sys.exit(1 if failed or ERRORS else 0)


if __name__ == '__main__':
    main()
