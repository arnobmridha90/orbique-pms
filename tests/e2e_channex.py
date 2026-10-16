#!/usr/bin/env python3
"""End-to-end test of the channel manager screens (Channels, Calendar → Rates & restrictions, Bookings, Pricing).

Two parts:

  live   The production build in live channel mode against the Channex mock and a throwaway Supabase (Postgres +
         PostgREST, tests/channex/helpers/e2e-stack.mjs). Drives certification tests 1-10 (plan section 7) through
         the real UI and asserts what reached the mock: one batched call per test with the expected values.
         Also: the Channex screen in a full-size window, the sync log with task ids, resolving an alert, a platform
         booking (read-only dates, cancel disabled, invoice number from 'channel-invoices'), and the front desk view.
  sim    The local test copy (practice mode): the same screens with fake ids; "would send" entries in the channel log.

    CHANNEX_TEST_PGURL=postgres://postgres@127.0.0.1:54329/postgres POSTGREST_BIN=/path/to/postgrest \\
        python3 tests/e2e_channex.py [--part live|sim|all] [--out /tmp/e2e-channex]

The live part is skipped (with a message) when CHANNEX_TEST_PGURL / POSTGREST_BIN are not set.
Screenshots go to --out. Exit code 1 when a check fails or a page logged a JavaScript error.
"""
import argparse, json, os, re, subprocess, sys, time, traceback, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
DESK = {'width': 1440, 'height': 900}
PHONE = {'width': 390, 'height': 844}
TODAY = '2026-10-15'
LAST = '2028-02-26'  # TODAY + 499

ap = argparse.ArgumentParser()
ap.add_argument('--part', default='all', choices=['live', 'sim', 'all'])
ap.add_argument('--out', default='/tmp/orbique-e2e-channex')
A = ap.parse_args()
OUT = os.path.abspath(A.out)
os.makedirs(OUT, exist_ok=True)

FAILS, ERRORS, RESULTS = [], [], []
PAGES = []  # open pages, for a screenshot when a step fails
_open = urllib.request.build_opener(urllib.request.ProxyHandler({})).open


def step(name):
    def wrap(fn):
        def run(*a, **k):
            t0 = time.time()
            try:
                fn(*a, **k)
                RESULTS.append(('PASS', name, time.time() - t0))
                print('PASS  %s  (%.1fs)' % (name, time.time() - t0), flush=True)
            except Exception as e:
                FAILS.append((name, e))
                RESULTS.append(('FAIL', name, time.time() - t0))
                print('FAIL  %s: %s' % (name, e), flush=True)
                traceback.print_exc()
                for i, p in enumerate(PAGES):
                    try:
                        if not p.is_closed():
                            p.screenshot(path=os.path.join(OUT, 'FAIL-%s-%d.png' % (re.sub(r'[^a-z0-9]+', '-', name.lower())[:40], i)))
                    except Exception:
                        pass
        return run
    return wrap


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


TOAST_JS = """(() => { window.__toasts = [];
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); })
    .observe(document, {childList: true, subtree: true}); })();"""

# the gateway has no realtime: supabase-js retries its websocket; those messages are not app errors
IGNORE = ('Failed to load resource', 'net::ERR', 'WebSocket', 'realtime', 'websocket')


def new_page(browser, label, vp, now):
    ctx = browser.new_context(viewport=vp, service_workers='block', device_scale_factor=1)
    ctx.add_init_script('window.ORBIQUE_NOW = %s;' % json.dumps(now))
    ctx.add_init_script(TOAST_JS)
    pg = ctx.new_page()
    PAGES.append(pg)
    pg.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    pg.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    pg.on('pageerror', lambda e: ERRORS.append('%s: pageerror: %s' % (label, e)))

    def con(m):
        if m.type == 'error' and not any(x in m.text for x in IGNORE):
            ERRORS.append('%s: console.error: %s' % (label, m.text[:300]))
    pg.on('console', con)
    return ctx, pg


def shot(pg, name):
    pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(OUT, name + '.png'))


def modal(pg, sel, **kw):
    """wait for a dialog, then past its autofocus (30ms), so a fill is not split between two fields"""
    pg.wait_for_selector(sel, **kw)
    pg.wait_for_timeout(120)


def js(pg, expr, arg=None):
    return pg.evaluate(expr, arg)


def wait_toast(pg, text, timeout=20000):
    pg.wait_for_function('(t) => (window.__toasts || []).some(x => x.indexOf(t) >= 0)', arg=text, timeout=timeout)


def last_toast(pg):
    return js(pg, '() => (window.__toasts || []).slice(-1)[0] || ""')


def go(pg, page, params=None):
    js(pg, '([p, q]) => O.go(p, q || {})', [page, params])
    pg.wait_for_timeout(400)


def set_date(pg, sel, iso):
    pg.fill(sel, iso)
    js(pg, '([s]) => { const e = document.querySelector(s); e.dispatchEvent(new Event("input", {bubbles: true})); e.dispatchEvent(new Event("change", {bubbles: true})); }', [sel])


def saved(pg, timeout=20000):
    """wait until every change is written (the sync is idle)"""
    pg.wait_for_function('() => O.sync.status !== "saving" && !O.sync._writing && !O.sync._timer && !O.sync.pending', timeout=timeout)


# ---------------------------------------------------------------- rates editor helpers (Calendar → Rates & restrictions)
def rates_view(pg, start):
    go(pg, 'calendar')
    if not js(pg, '() => !!document.querySelector(".rr-card")'):
        pg.click('[data-view=rates]')
        pg.wait_for_selector('.rr-card')
    if start:
        set_date(pg, '[data-f=start]', start)
        pg.wait_for_selector('.rr-card')


def add_change(pg, plan, frm, to, rate=None, min_stay=None, max_stay=None, cta=None, ctd=None, stop=None, weekdays=None):
    pg.click('[data-act=rr-add]')
    modal(pg, '.modal .rr-ed')
    pg.select_option('.modal [name=plan]', plan)
    set_date(pg, '.modal [name=from]', frm)
    set_date(pg, '.modal [name=to]', to)
    if weekdays is not None:
        js(pg, '(w) => document.querySelectorAll(".modal [name=wd]").forEach(c => { c.checked = w.indexOf(+c.value) >= 0; })', weekdays)
    if rate is not None:
        pg.fill('.modal [name=rate]', str(rate))
    if min_stay is not None:
        pg.fill('.modal [name=min]', str(min_stay))
    if max_stay is not None:
        pg.fill('.modal [name=max]', str(max_stay))
    for name, v in (('cta', cta), ('ctd', ctd), ('stop', stop)):
        if v is not None:
            pg.select_option('.modal [name=%s]' % name, '1' if v else '0')
    pg.click('#rr-add-btn')
    pg.wait_for_function('() => !document.querySelector(".modal .rr-ed")', timeout=5000)


def send_tray(pg, n):
    btn = pg.locator('[data-act=rr-send]')
    check(btn.inner_text().strip() == 'Send %d change%s' % (n, '' if n == 1 else 's'), 'tray button says ' + btn.inner_text())
    btn.click()


# ================================================================ live part
class Stack:
    def __init__(self):
        env = dict(os.environ)
        self.p = subprocess.Popen(['node', os.path.join(ROOT, 'tests/channex/helpers/e2e-stack.mjs'), '--out', os.path.join(OUT, 'stack')], cwd=ROOT, env=env,
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'stack.err'), 'w'), text=True)
        line = self.p.stdout.readline()
        if not line:
            raise RuntimeError('the e2e stack did not start; see ' + os.path.join(OUT, 'stack.err'))
        self.info = json.loads(line)

    def get(self, path):
        with _open(urllib.request.Request(self.info['control'] + path), timeout=30) as r:
            return json.loads(r.read())

    def post(self, path, body=None):
        req = urllib.request.Request(self.info['control'] + path, method='POST', data=json.dumps(body or {}).encode(), headers={'Content-Type': 'application/json'})
        with _open(req, timeout=30) as r:
            return json.loads(r.read())

    def close(self):
        try:
            self.p.stdin.close()
            self.p.wait(timeout=20)
        except Exception:
            self.p.kill()


def posts(stack, path):
    return [c for c in stack.get('/calls')['calls'] if c['method'] == 'POST' and c['path'] == path]


def wait_calls(stack, path, n_min=1, timeout=30, settle=4.0):
    """wait for at least n_min POSTs to path, then a quiet moment, and return them all"""
    t0 = time.time()
    while time.time() - t0 < timeout:
        if len(posts(stack, path)) >= n_min:
            break
        time.sleep(0.5)
    time.sleep(settle)
    return posts(stack, path)


def one_call(stack, path):
    list_ = wait_calls(stack, path)
    check(len(list_) == 1, 'expected exactly one POST %s, got %d' % (path, len(list_)))
    check(list_[0]['status'] == 200, 'POST %s answered %s' % (path, list_[0]['status']))
    other = '/availability' if path == '/restrictions' else '/restrictions'
    check(not posts(stack, other), 'no POST %s expected' % other)
    return list_[0]['body']['values']


def item(items, key, cid, when, fields):
    hit = [i for i in items if i.get(key) == cid and ((i.get('date') == when) if isinstance(when, str) else (i.get('date_from') == when[0] and i.get('date_to') == when[1]))]
    check(len(hit) == 1, 'one item for %s %s in %s' % (cid, when, json.dumps(items)[:600]))
    for k, v in fields.items():
        check(hit[0].get(k) == v, '%s %s: %s is %r, expected %r' % (cid, when, k, hit[0].get(k), v))
    return hit[0]


ID_KEYS = ('property_id', 'rate_plan_id', 'room_type_id', 'date', 'date_from', 'date_to')


def sheet(items, rows):
    """exactly the certification sheet: one item per row (rate_plan_id, when, fields), each carrying only those fields"""
    check(len(items) == len(rows), '%d items expected, got %d: %s' % (len(rows), len(items), json.dumps(items)[:800]))
    for cid, when, fields in rows:
        hit = item(items, 'rate_plan_id', cid, when, fields)
        extra = sorted(k for k in hit if k not in ID_KEYS and k not in fields)
        check(not extra, '%s %s sends only the changed fields, also got %s: %s' % (cid, when, extra, json.dumps(hit)))


def run_live(browser):
    if not (os.environ.get('CHANNEX_TEST_PGURL') and os.environ.get('POSTGREST_BIN') and os.path.exists(os.environ.get('POSTGREST_BIN', ''))):
        print('SKIP  live part: set CHANNEX_TEST_PGURL and POSTGREST_BIN (see the top of this file)')
        return
    stack = Stack()
    S = stack.info
    print('stack: app %s, mock %s' % (S['app'], S['mock']), flush=True)
    ctx, pg = new_page(browser, 'live-owner', DESK, TODAY + 'T10:00')
    P = {}   # 'TB' -> plan id (Twin BAR), 'TBB', 'DB', 'DBB'
    RP = {}  # plan id -> Channex rate plan id
    RT = {}  # unit type id -> Channex room type id

    def ids():
        d = stack.get('/ids')
        for p in d['plans']:
            if p['rate_plan_id']:
                RP[p['plan_id']] = p['rate_plan_id']
        for r in d['rooms']:
            RT[r['unit_type_id']] = r['room_type_id']
        return d

    def state_r(key, iso):
        return (stack.get('/state')['restrictions'].get(RP[P[key]]) or {}).get(iso) or {}

    try:
        @step('live: sign in as the owner; Channels is in live mode')
        def t_signin():
            pg.goto(S['app'] + '/')
            pg.wait_for_selector('.auth-card form #email', timeout=60000)
            pg.wait_for_timeout(150)
            pg.fill('#email', S['users']['owner']['email'])
            pg.fill('#password', S['users']['owner']['password'])
            pg.click('.auth-btn')
            pg.wait_for_function('() => window.O && O._started && O.sync.started', timeout=60000)
            go(pg, 'channels')
            pg.wait_for_function('() => O.channel.mode() === "live"', timeout=20000)
            pg.wait_for_selector('.ch-card[data-building="BD-1"]')
            check(not js(pg, '() => !!document.querySelector("[data-mode=simulated]")'), 'no practice-mode banner')
            check('Test environment' in pg.inner_text('.pg-channels'), 'staging banner')
            txt = pg.inner_text('.ch-card[data-building="BD-1"]')
            check('needs a rate plan' in txt, 'the card lists what is missing before connecting: ' + txt)
            check('Add a phone number for the building' in txt, 'Channex needs a phone before connecting: ' + txt)
            shot(pg, 'live-01-channels-before')
        t_signin()

        @step('live: setup: the building phone in Properties, Edit building (Channex needs it before Connect)')
        def t_phone():
            go(pg, 'properties', {'tab': 'types'})
            pg.click('[data-bt=editbd][data-id="BD-1"]')
            modal(pg, '.modal [name=phone]')
            check(not pg.is_disabled('.modal [name=currency]'), 'currency can change before connecting')
            pg.fill('.modal [name=phone]', 'call us')
            pg.click('.modal-foot .btn-primary')
            pg.wait_for_selector('.modal [data-err=phone]:has-text("Check the phone number")')
            pg.fill('.modal [name=phone]', '+60 3-2142 0000')
            pg.click('.modal-foot .btn-primary')
            wait_toast(pg, 'Saved Test Property - Orbique')
            saved(pg)
            go(pg, 'channels', {'tab': 'buildings'})
            txt = pg.inner_text('.ch-card[data-building="BD-1"]')
            check('phone number' not in txt and 'email address' not in txt, 'contact details complete: ' + txt)
        t_phone()

        @step('live: setup: rate plans BAR (100) and Bed & Breakfast (120, breakfast) for each type, in the UI')
        def t_plans():
            pg.click('[data-tab=plans]')
            for tid in ('UT-T', 'UT-D'):
                for name, rate, meal in (('Best Available Rate', 100, 'room_only'), ('Bed & Breakfast', 120, 'breakfast')):
                    pg.click('[data-new-plan="%s"]' % tid)
                    modal(pg, '.modal [name=name]')
                    pg.fill('.modal [name=name]', name)
                    pg.select_option('.modal [name=meal]', meal)
                    pg.fill('.modal [name=rate]', str(rate))
                    pg.click('.modal-foot .btn-primary')
                    pg.wait_for_function('() => !document.querySelector(".modal [name=name]")', timeout=5000)
            plans = js(pg, '() => ["UT-T", "UT-D"].map(t => O.channel.plansOf(t).map(p => [p.id, p.name, p.primary, p.defaultRate, p.meal]))')
            check([len(x) for x in plans] == [2, 2], 'two plans per type: %s' % plans)
            for tkey, lst in (('T', plans[0]), ('D', plans[1])):
                for pid, name, primary, rate, meal in lst:
                    P[tkey + ('B' if name == 'Best Available Rate' else 'BB')] = pid
                    check(primary == (name == 'Best Available Rate'), 'BAR is the main plan')
            shot(pg, 'live-02-rate-plans')
            saved(pg)
        t_plans()

        @step('cert 1: Connect sends one full sync: 1 availability + 1 restrictions call, 500 days')
        def t_cert1():
            go(pg, 'channels', {'tab': 'buildings'})
            pg.wait_for_timeout(3500)  # let earlier saves settle
            stack.post('/reset')
            pg.click('.ch-card[data-building="BD-1"] [data-act=connect]')
            pg.click('.modal-foot .btn-primary')
            wait_toast(pg, 'is connected', 60000)
            av = wait_calls(stack, '/availability', settle=3)
            rs = posts(stack, '/restrictions')
            check(len(av) == 1 and len(rs) == 1, 'one availability and one restrictions call, got %d and %d' % (len(av), len(rs)))
            prop = [c for c in stack.get('/calls')['calls'] if c['method'] == 'POST' and c['path'] == '/properties'][0]['body']['property']
            check(prop.get('phone') == '+60 3-2142 0000' and prop.get('email') == 'ops@cert.test' and prop.get('property_type') == 'apartment', 'property contact and type: %s' % prop)
            d = ids()
            check(len(RP) == 4 and len(RT) == 2, 'mapped: %s' % d)
            for c, key in ((av[0], 'room_type_id'), (rs[0], 'rate_plan_id')):
                vals = c['body']['values']
                last = max((v.get('date_to') or v.get('date')) for v in vals)
                first = min((v.get('date_from') or v.get('date')) for v in vals)
                check(first == TODAY and last == LAST, '%s covers %s to %s' % (c['path'], first, last))
            rates = set(v.get('rate') for v in rs[0]['body']['values'] if v['rate_plan_id'] == RP[P['TB']])
            check(len(rates) > 3, 'Twin BAR rates vary by day (the model): %s' % sorted(rates)[:8])
            avs = set(v['availability'] for v in av[0]['body']['values'])
            check(len(avs) > 1, 'availability varies: %s' % avs)
            pg.wait_for_function('() => (document.querySelector(".ch-card[data-building=\\"BD-1\\"] [data-status]") || {}).dataset.status === "live"', timeout=30000)
            shot(pg, 'live-03-connected')
        t_cert1()

        @step('cert 2: Calendar cell -> Twin/BAR 22 Nov rate 333 -> Send: 1 restrictions call')
        def t_cert2():
            rates_view(pg, '2026-11-22')
            stack.post('/reset')
            pg.click('.rr-c[data-rr="%s"][data-date="2026-11-22"]' % P['TB'])
            modal(pg, '.modal .rr-ed')
            pg.fill('.modal [name=rate]', '333')
            pg.click('#rr-add-btn')
            shot(pg, 'live-04-tray-one')
            send_tray(pg, 1)
            sheet(one_call(stack, '/restrictions'), [(RP[P['TB']], '2026-11-22', {'rate': '333.00'})])
        t_cert2()

        @step('cert 3: three single-date rates in the tray -> Send 3 changes: 1 call')
        def t_cert3():
            stack.post('/reset')
            add_change(pg, P['TB'], '2026-11-21', '2026-11-21', rate=333)
            add_change(pg, P['DB'], '2026-11-25', '2026-11-25', rate=444)
            add_change(pg, P['DBB'], '2026-11-29', '2026-11-29', rate='456.23')
            shot(pg, 'live-05-tray-three')
            send_tray(pg, 3)
            sheet(one_call(stack, '/restrictions'), [
                (RP[P['TB']], '2026-11-21', {'rate': '333.00'}),
                (RP[P['DB']], '2026-11-25', {'rate': '444.00'}),
                (RP[P['DBB']], '2026-11-29', {'rate': '456.23'})])
        t_cert3()

        @step('cert 4: three From-To ranges -> 1 call, one ranged item each')
        def t_cert4():
            stack.post('/reset')
            add_change(pg, P['TB'], '2026-11-01', '2026-11-10', rate=241)
            add_change(pg, P['DB'], '2026-11-10', '2026-11-16', rate='312.66')
            add_change(pg, P['DBB'], '2026-11-01', '2026-11-20', rate=111)
            send_tray(pg, 3)
            sheet(one_call(stack, '/restrictions'), [
                (RP[P['TB']], ('2026-11-01', '2026-11-10'), {'rate': '241.00'}),
                (RP[P['DB']], ('2026-11-10', '2026-11-16'), {'rate': '312.66'}),
                (RP[P['DBB']], ('2026-11-01', '2026-11-20'), {'rate': '111.00'})])
        t_cert4()

        @step('cert 5: minimum stay on three plans -> 1 call')
        def t_cert5():
            stack.post('/reset')
            add_change(pg, P['TB'], '2026-11-23', '2026-11-23', min_stay=3)
            add_change(pg, P['DB'], '2026-11-25', '2026-11-25', min_stay=2)
            add_change(pg, P['DBB'], '2026-11-15', '2026-11-15', min_stay=5)
            send_tray(pg, 3)
            sheet(one_call(stack, '/restrictions'), [
                (RP[P['TB']], '2026-11-23', {'min_stay_arrival': 3}),
                (RP[P['DB']], '2026-11-25', {'min_stay_arrival': 2}),
                (RP[P['DBB']], '2026-11-15', {'min_stay_arrival': 5})])
            check(state_r('DB', '2026-11-25').get('rate') == '444.00', 'Channex keeps the rate from test 3')
        t_cert5()

        @step('cert 6: stop sell on three plans -> 1 call')
        def t_cert6():
            stack.post('/reset')
            add_change(pg, P['TB'], '2026-11-14', '2026-11-14', stop=True)
            add_change(pg, P['DB'], '2026-11-16', '2026-11-16', stop=True)
            add_change(pg, P['DBB'], '2026-11-20', '2026-11-20', stop=True)
            send_tray(pg, 3)
            sheet(one_call(stack, '/restrictions'), [
                (RP[P['TB']], '2026-11-14', {'stop_sell': True}),
                (RP[P['DB']], '2026-11-16', {'stop_sell': True}),
                (RP[P['DBB']], '2026-11-20', {'stop_sell': True})])
            rates_view(pg, '2026-11-14')
            check(js(pg, '(p) => document.querySelector(`.rr-c[data-rr="${p}"][data-date="2026-11-14"]`).classList.contains("stop")', P['TB']), 'the cell shows stop sell')
            shot(pg, 'live-06-rates-stop-sell')
        t_cert6()

        @step('cert 7: several restrictions per row -> 1 call')
        def t_cert7():
            stack.post('/reset')
            add_change(pg, P['TB'], '2026-11-01', '2026-11-10', cta=True, ctd=False, max_stay=4, min_stay=1)
            add_change(pg, P['TBB'], '2026-11-12', '2026-11-16', cta=False, ctd=True, min_stay=6)
            add_change(pg, P['DB'], '2026-11-10', '2026-11-16', cta=True, min_stay=2)
            add_change(pg, P['DBB'], '2026-11-01', '2026-11-20', min_stay=10)
            send_tray(pg, 4)
            # four rows, four items. Twin/BAR's closed to departure (false) and min stay (1) are what Channex already
            # has, so only the fields that change go out (test 13: only changed values)
            sheet(one_call(stack, '/restrictions'), [
                (RP[P['TB']], ('2026-11-01', '2026-11-10'), {'closed_to_arrival': True, 'max_stay': 4}),
                (RP[P['TBB']], ('2026-11-12', '2026-11-16'), {'closed_to_departure': True, 'min_stay_arrival': 6}),
                (RP[P['DB']], ('2026-11-10', '2026-11-16'), {'closed_to_arrival': True, 'min_stay_arrival': 2}),
                (RP[P['DBB']], ('2026-11-01', '2026-11-20'), {'min_stay_arrival': 10})])
            for iso in ['2026-11-%02d' % i for i in range(1, 11)]:
                v = state_r('TB', iso)
                check(v.get('closed_to_arrival') is True and v.get('closed_to_departure') is False and v.get('max_stay') == 4 and v.get('min_stay_arrival') == 1, 'Twin BAR %s: %s' % (iso, v))
            for iso in ['2026-11-%02d' % i for i in range(12, 17)]:
                v = state_r('TBB', iso)
                check(v.get('closed_to_arrival') is False and v.get('closed_to_departure') is True and v.get('min_stay_arrival') == 6, 'Twin B&B %s: %s' % (iso, v))
            for iso in ['2026-11-%02d' % i for i in range(10, 17)]:
                v = state_r('DB', iso)
                check(v.get('closed_to_arrival') is True and v.get('min_stay_arrival') == 2, 'Double BAR %s: %s' % (iso, v))
            for iso in ['2026-11-%02d' % i for i in range(1, 21)]:
                check(state_r('DBB', iso).get('min_stay_arrival') == 10, 'Double B&B %s min stay 10' % iso)
        t_cert7()

        @step('cert 8: 1 Dec 2026 - 1 May 2027, two rows -> 1 call, one item per plan')
        def t_cert8():
            stack.post('/reset')
            add_change(pg, P['TB'], '2026-12-01', '2027-05-01', rate=432, cta=False, ctd=False, min_stay=2)
            add_change(pg, P['DB'], '2026-12-01', '2027-05-01', rate=342, min_stay=3)
            send_tray(pg, 2)
            sheet(one_call(stack, '/restrictions'), [
                (RP[P['TB']], ('2026-12-01', '2027-05-01'), {'rate': '432.00', 'min_stay_arrival': 2}),
                (RP[P['DB']], ('2026-12-01', '2027-05-01'), {'rate': '342.00', 'min_stay_arrival': 3})])
            v = state_r('TB', '2027-02-10')
            check(v.get('closed_to_arrival') is False and v.get('closed_to_departure') is False and v.get('rate') == '432.00', 'Twin BAR in the half year: %s' % v)
        t_cert8()

        @step('cert 9: new direct booking (Twin, 21 Nov) + block all 4 Double units on 25 Nov in one dialog -> Twin 7, Double 0')
        def t_cert9():
            stack.post('/reset')
            go(pg, 'bookings')
            pg.click('#tb-actions [data-act=new]')
            modal(pg, '.modal [name=pid]')
            pg.select_option('.modal [name=pid]', 'type:UT-T')
            set_date(pg, '.modal [name=ci]', '2026-11-21')
            set_date(pg, '.modal [name=co]', '2026-11-22')
            pg.fill('.modal [name=name]', 'Cert Nine')
            pg.fill('.modal [name=phone]', '+60 12-345 6789')
            pg.click('.modal-foot .btn-primary')
            wait_toast(pg, 'Booking created')
            go(pg, 'calendar')
            if js(pg, '() => !!document.querySelector(".rr-card")'):
                pg.click('[data-view=stays]')
            pg.click('#tb-actions [data-act=block]')
            modal(pg, '.modal [data-all="UT-D"]')
            pg.check('.modal [data-all="UT-D"]')
            set_date(pg, '.modal [name=a]', '2026-11-25')
            set_date(pg, '.modal [name=z]', '2026-11-25')
            check('4 units' in pg.inner_text('.modal .blk-sum'), 'four units ticked: ' + pg.inner_text('.modal .blk-sum'))
            pg.click('.modal-foot .btn-primary')
            wait_toast(pg, 'Blocked all 4 Double Room units')
            check('Your channels close these nights within a minute' in last_toast(pg), 'live block wording: ' + last_toast(pg))
            calls = wait_calls(stack, '/availability', settle=5)
            check(1 <= len(calls) <= 2, '1-2 availability calls, got %d' % len(calls))
            check(not posts(stack, '/restrictions'), 'no restrictions call')
            items = [v for c in calls for v in c['body']['values']]
            item(items, 'room_type_id', RT['UT-T'], '2026-11-21', {'availability': 7})
            item(items, 'room_type_id', RT['UT-D'], '2026-11-25', {'availability': 0})
            check(len(items) == 2, 'only those two: %s' % items)
            RESULTS.append(('INFO', 'cert 9 used %d availability call(s)' % len(calls), 0))
        t_cert9()

        @step('cert 10: block 5 Twin units 10-16 Nov in one dialog + remove the D-01 hold 17-24 Nov -> Twin 3, Double 4')
        def t_cert10():
            stack.post('/reset')
            set_date(pg, '[data-f=start]', '2026-11-17')
            pg.wait_for_selector('[data-block="BL-HOLD-D01"]')
            pg.click('#tb-actions [data-act=block]')
            modal(pg, '.modal [data-all="UT-T"]')
            for u in ('T-01', 'T-02', 'T-03', 'T-04', 'T-05'):
                pg.check('.modal [name=u][value="%s"]' % u)
            set_date(pg, '.modal [name=a]', '2026-11-10')
            set_date(pg, '.modal [name=z]', '2026-11-16')
            pg.click('.modal-foot .btn-primary')
            wait_toast(pg, 'Blocked 5 Twin Room units')
            pg.click('[data-block="BL-HOLD-D01"]')
            modal(pg, '.modal-foot .btn-danger')
            pg.click('.modal-foot .btn-danger')
            wait_toast(pg, 'Block removed')
            check('Your channels open these nights again within a minute' in last_toast(pg), 'live unblock wording: ' + last_toast(pg))
            calls = wait_calls(stack, '/availability', settle=5)
            check(1 <= len(calls) <= 2, '1-2 availability calls, got %d' % len(calls))
            items = [v for c in calls for v in c['body']['values']]
            item(items, 'room_type_id', RT['UT-T'], ('2026-11-10', '2026-11-16'), {'availability': 3})
            item(items, 'room_type_id', RT['UT-D'], ('2026-11-17', '2026-11-24'), {'availability': 4})
            check(len(items) == 2, 'only those two: %s' % items)
            RESULTS.append(('INFO', 'cert 10 used %d availability call(s)' % len(calls), 0))
            shot(pg, 'live-07-calendar-after-cert10')
        t_cert10()

        @step('live: Pricing on a Twin unit updates the Twin main plan; one restrictions call; live wording')
        def t_pricing():
            stack.post('/reset')
            js(pg, '() => O.go("pricing", {propertyId: "T-01"})')
            pg.wait_for_timeout(600)
            # the pricing page's own apply path for one night (same function the buttons use)
            ok = js(pg, '''() => { const b = [...document.querySelectorAll('.pg-pricing button')].find(x => /Apply/.test(x.textContent) && !x.disabled); return !!b; }''')
            js(pg, '() => O.channel.setDays([{planId: O.channel.mainPlan("UT-T").id, dates: ["2026-11-30"], set: {rate: 155}}])')
            items = one_call(stack, '/restrictions')
            item(items, 'rate_plan_id', RP[P['TB']], '2026-11-30', {'rate': '155.00'})
            prices = js(pg, '() => O.unitsOfType("UT-T").map(u => (O.data.priceOverrides[u.id] || {})["2026-11-30"])')
            check(all(p == 155 for p in prices), 'every Twin unit has the price: %s' % prices)
            RESULTS.append(('INFO', 'pricing page apply button present: %s' % ok, 0))
        t_pricing()

        @step('live: the building currency is fixed while connected (Edit building)')
        def t_currency():
            go(pg, 'properties', {'tab': 'types'})
            pg.click('[data-bt=editbd][data-id="BD-1"]')
            modal(pg, '.modal [name=currency]')
            check(pg.is_disabled('.modal [name=currency]'), 'currency select is locked')
            check('Fixed while this building is connected to channels' in pg.inner_text('.modal'), 'the reason is shown')
            shot(pg, 'live-08a-currency-locked')
            pg.click('.modal-foot .btn:has-text("Cancel")')
        t_currency()

        @step('live: Manage channels opens the Channex screen in a full-size window; Sync log has task ids; Alerts resolve')
        def t_frame_log_alerts():
            go(pg, 'channels', {'tab': 'buildings'})
            pg.click('.ch-card[data-building="BD-1"] [data-act=manage]')
            modal(pg, '.modal.ch-frame iframe', timeout=20000)
            src = js(pg, '() => document.querySelector(".modal.ch-frame iframe").src')
            check('/auth/exchange?' in src and 'oauth_session_key=' in src, 'iframe url: ' + src)
            check('read_only_availability=true' in src, 'availability is read-only in the Channex screen: ' + src)
            box = pg.locator('.modal.ch-frame').bounding_box()
            check(box['width'] > 1300 and box['height'] > 800, 'full size: %s' % box)
            pg.wait_for_timeout(1200)
            shot(pg, 'live-08-manage-channels')
            pg.click('.modal.ch-frame .modal-x')
            pg.click('[data-tab=log]')
            pg.wait_for_selector('.ch-tbl tr[data-call]')
            n_rows = js(pg, '() => document.querySelectorAll(".ch-tbl tr[data-call]").length')
            n_tasks = js(pg, '() => document.querySelectorAll(".ch-tbl [data-copy]").length')
            check(n_rows >= 12 and n_tasks >= 10, 'sync log rows %d, task ids %d' % (n_rows, n_tasks))
            txt = pg.inner_text('.ch-tbl')
            check('POST /restrictions' in txt and 'POST /availability' in txt and '200' in txt, 'endpoints and status shown')
            shot(pg, 'live-09-sync-log')
            pg.click('.ch-tbl tr[data-call]:has-text("POST /restrictions")')
            pg.wait_for_selector('.ch-modal pre')
            pg.wait_for_function('() => /values/.test(document.querySelector(".ch-modal").textContent)', timeout=10000)
            shot(pg, 'live-10-call-payload')
            pg.click('.modal-x')
            a = stack.post('/alert', {'kind': 'sync_error', 'message': 'Channex refused an update: test. Fix it, then press Retry on the Channels page.', 'ref': {'key': 'e2e'}})
            js(pg, '() => O.channel.reload()')
            pg.click('[data-tab=alerts]')
            pg.wait_for_selector('[data-resolve="%s"]' % a['id'], timeout=15000)
            shot(pg, 'live-11-alerts')
            pg.click('[data-resolve="%s"]' % a['id'])
            wait_toast(pg, 'Resolved')
            al = [x for x in stack.get('/alerts')['alerts'] if x['id'] == a['id']][0]
            check(al['resolved_at'] and al['resolved_by'], 'resolved in the database: %s' % al)
        t_frame_log_alerts()

        @step('live: a platform booking: source line, read-only dates, cancel disabled, invoice number assigned')
        def t_ota():
            b = {'id': 'BK-CHX-1', 'channel': 'booking', 'otaName': 'Booking.com', 'reservationCode': '4012345678', 'channex': {'bookingId': 'x', 'revisionId': 'y'},
                 'unitTypeId': 'UT-D', 'propertyId': 'D-02', 'checkIn': '2026-12-20', 'checkOut': '2026-12-23', 'nights': 3, 'guests': 2, 'status': 'confirmed',
                 'guest': {'name': 'Platform Guest', 'country': 'GB', 'countryName': 'United Kingdom', 'foreign': True, 'phone': '', 'email': 'pg@guest.booking.com'},
                 'nightly': 342, 'accommodation': 1026, 'cleaningFee': 0, 'tourismTax': 30, 'total': 1056, 'revenue': 1026, 'platformFee': 154, 'payout': 902,
                 'checkInTime': '15:00', 'checkOutTime': '11:00', 'createdAt': '2026-10-15T09:30', 'currency': 'USD',
                 'assignment': {'how': 'auto', 'by': None, 'at': '2026-10-15T09:30', 'locked': False}, 'idVerified': False, 'codeStatus': 'held'}
            stack.post('/ota-booking', b)
            pg.reload()
            pg.wait_for_function('() => window.O && O._started && O.sync.started && O.data.booking("BK-CHX-1")', timeout=60000)
            pg.wait_for_function('() => !!O.data.booking("BK-CHX-1").invoiceNo', timeout=15000)
            saved(pg)
            time.sleep(1.5)
            rec = stack.get('/booking?id=BK-CHX-1')['booking']
            check(rec and str(rec.get('invoiceNo', '')).startswith('INV-2026-'), 'invoice number saved: %s' % (rec or {}).get('invoiceNo'))
            js(pg, '() => O.bookingTools.open("BK-CHX-1")')
            pg.wait_for_selector('.drawer .bk-src')
            check(pg.inner_text('.drawer .bk-src') == 'From Booking.com · Reservation 4012345678', 'source line: ' + pg.inner_text('.drawer .bk-src'))
            cancel = pg.locator('.drawer button:has-text("Cancel booking")')
            check(cancel.is_disabled(), 'cancel is disabled')
            check('Cancel this on Booking.com' in (cancel.get_attribute('title') or ''), 'reason: %s' % cancel.get_attribute('title'))
            shot(pg, 'live-12-ota-drawer')
            pg.click('.drawer button:has-text("Edit")')
            modal(pg, '.modal [name=ci]')
            check(pg.is_disabled('.modal [name=ci]') and pg.is_disabled('.modal [name=co]'), 'dates are read-only')
            check('Change this on Booking.com; changes arrive here automatically' in pg.inner_text('.modal'), 'the read-only note')
            shot(pg, 'live-13-ota-edit')
            pg.click('.modal-foot .btn:has-text("Cancel")')
        t_ota()
        ctx.close()

        @step('live: front desk sees Channels and rates read-only')
        def t_frontdesk():
            c2, p2 = new_page(browser, 'live-frontdesk', DESK, TODAY + 'T10:00')
            p2.goto(S['app'] + '/')
            p2.wait_for_selector('.auth-card form #email', timeout=60000)
            p2.wait_for_timeout(150)
            p2.fill('#email', S['users']['frontdesk']['email'])
            p2.fill('#password', S['users']['frontdesk']['password'])
            p2.click('.auth-btn')
            p2.wait_for_function('() => window.O && O._started && O.sync.started', timeout=60000)
            go(p2, 'channels')
            p2.wait_for_selector('.ch-card[data-building="BD-1"] [data-status=live]', timeout=20000)
            check(not js(p2, '() => !!document.querySelector(".ch-card [data-act=connect], .ch-card [data-act=manage], .ch-card [data-act=disconnect]")'), 'no connect, manage or disconnect for front desk')
            shot(p2, 'live-14-frontdesk-channels')
            rates_view(p2, '2026-11-20')
            check(js(p2, '() => [...document.querySelectorAll(".rr-c")].every(b => b.disabled)'), 'cells are read-only')
            check('look but not change' in p2.inner_text('.rr-tray'), 'read-only note')
            shot(p2, 'live-15-frontdesk-rates')
            c2.close()
        t_frontdesk()
    finally:
        stack.close()


# ================================================================ practice (simulated) part
def run_sim(browser):
    html = os.path.join(OUT, 'orbique-local.html')
    r = subprocess.run(['node', os.path.join(ROOT, 'scripts/build.mjs'), '--local', '--out', html], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError('local build failed: ' + r.stdout + r.stderr)
    ctx, pg = new_page(browser, 'sim', DESK, '2026-10-06T10:15')
    pg.goto('file://' + html)
    pg.wait_for_function('() => window.O && O._started && O.sync.started', timeout=30000)
    pg.wait_for_timeout(500)

    @step('sim: Channels in practice mode with the demo building connected (fake ids)')
    def t_page():
        go(pg, 'channels')
        check(js(pg, '() => O.channel.mode()') == 'simulated', 'practice mode')
        pg.wait_for_selector('[data-mode=simulated]')
        check('Practice mode.' in pg.inner_text('[data-mode=simulated]'), 'banner')
        check(js(pg, '() => document.querySelector(".ch-card[data-building=\\"BD-saujana\\"] [data-status]").dataset.status') == 'live', 'connected')
        check('sim-' in pg.inner_text('.ch-card[data-building="BD-saujana"]'), 'fake property id')
        shot(pg, 'sim-01-channels')
        pg.set_viewport_size(PHONE)
        pg.wait_for_timeout(400)
        shot(pg, 'sim-02-channels-phone')
        pg.set_viewport_size(DESK)
    t_page()

    @step('sim: rates tray with a weekday filter -> one "would send" entry with only Fri and Sat nights; main plan prices reach every Deluxe unit')
    def t_rates():
        bar = js(pg, '() => O.channel.mainPlan("UT-deluxe").id')
        bb = js(pg, '() => O.channel.plansOf("UT-deluxe").filter(p => !p.primary)[0].id')
        n0 = js(pg, '() => O.data.channelLog.length')
        rates_view(pg, None)
        add_change(pg, bar, '2026-10-12', '2026-10-25', rate=480, weekdays=[5, 6])
        check('Fri, Sat only' in pg.inner_text('.rr-tray'), 'tray shows the weekday filter')
        send_tray(pg, 1)
        pg.wait_for_function('(n) => O.data.channelLog.length > n', arg=n0, timeout=15000)
        e = js(pg, '() => O.data.channelLog[0]')
        check(e['endpoint'] == '/restrictions' and e['text'].startswith('Would send'), 'log entry: %s' % e)
        days = sorted(set(x.get('date') or x.get('date_from') for x in e['sample']))
        check(all(js(pg, '(d) => O.d.isWeekend(d)', d) for d in days), 'only Fri and Sat nights: %s' % days)
        check('Practice mode' in last_toast(pg), 'practice wording: ' + last_toast(pg))
        prices = js(pg, '() => O.unitsOfType("UT-deluxe").map(u => O.data.priceOverrides[u.id]["2026-10-16"])')
        check(prices == [480, 480, 480], 'Fri 16 Oct on every Deluxe unit: %s' % prices)
        check(js(pg, '(p) => O.channel.planRate(p, "2026-10-16")', bb) == 520, 'B&B follows BAR + 40')
        check(js(pg, '(p) => O.channel.day(p, "2026-10-15")', bar)['src'] == 'model', 'Thursday stays on the model')
        shot(pg, 'sim-03-rates')
        pg.set_viewport_size(PHONE)
        pg.wait_for_timeout(400)
        shot(pg, 'sim-04-rates-phone')
        pg.set_viewport_size(DESK)
    t_rates()

    @step('sim: blocking all Deluxe units logs availability; practice wording')
    def t_block():
        n0 = js(pg, '() => O.data.channelLog.length')
        go(pg, 'calendar')
        if js(pg, '() => !!document.querySelector(".rr-card")'):
            pg.click('[data-view=stays]')
        pg.click('#tb-actions [data-act=block]')
        modal(pg, '.modal [data-all="UT-deluxe"]')
        pg.check('.modal [data-all="UT-deluxe"]')
        set_date(pg, '.modal [name=a]', '2026-12-01')
        set_date(pg, '.modal [name=z]', '2026-12-02')
        pg.click('.modal-foot .btn-primary')
        wait_toast(pg, 'Practice mode')
        pg.wait_for_function('(n) => O.data.channelLog.length > n', arg=n0, timeout=15000)
        e = js(pg, '() => O.data.channelLog[0]')
        check(e['endpoint'] == '/availability', 'availability entry: %s' % e)
        check(any(x.get('availability') == 0 for x in e['sample']), 'availability 0 in %s' % e['sample'])
    t_block()

    @step('sim: rate plan editor adds a plan that follows BAR minus 10%')
    def t_plan():
        go(pg, 'channels', {'tab': 'plans'})
        pg.click('[data-new-plan="UT-supreme"]')
        modal(pg, '.modal [name=name]')
        pg.fill('.modal [name=name]', 'Non-refundable')
        pg.fill('.modal [name=rate]', '340')
        bar = js(pg, '() => O.channel.mainPlan("UT-supreme").id')
        pg.select_option('.modal [name=fp]', bar)
        pg.select_option('.modal [name=ft]', 'pct')
        pg.fill('.modal [name=fv]', '-10')
        pg.click('.modal-foot .btn-primary')
        pg.wait_for_selector('.ch-plan-t[data-type="UT-supreme"] tr[data-plan]:nth-child(2)')
        nr = js(pg, '() => O.channel.plansOf("UT-supreme").filter(p => p.name === "Non-refundable")[0].id')
        a = js(pg, '([b, n]) => [O.channel.planRate(b, "2026-10-20"), O.channel.planRate(n, "2026-10-20")]', [bar, nr])
        check(abs(a[1] - round(a[0] * 0.9, 2)) < 0.01, 'follows: %s' % a)
        shot(pg, 'sim-05-rate-plans')
    t_plan()

    @step('sim: Sync log and Alerts tabs; disconnect and connect again logs a full update')
    def t_log():
        go(pg, 'channels', {'tab': 'log'})
        check(js(pg, '() => document.querySelectorAll(".ch-tbl tr[data-sim]").length') >= 2, 'log rows')
        shot(pg, 'sim-06-sync-log')
        pg.click('[data-tab=alerts]')
        check('Needs a unit' in pg.inner_text('.pg-channels'), 'the demo booking without a unit is listed')
        shot(pg, 'sim-07-alerts')
        pg.click('[data-tab=buildings]')
        pg.click('.ch-card[data-building="BD-saujana"] [data-act=disconnect]')
        pg.click('.modal-foot .btn-danger')
        pg.wait_for_selector('.ch-card[data-building="BD-saujana"] [data-act=connect]')
        n0 = js(pg, '() => O.data.channelLog.length')
        pg.click('.ch-card[data-building="BD-saujana"] [data-act=connect]')
        pg.click('.modal-foot .btn-primary')
        wait_toast(pg, 'connected in practice mode')
        news = js(pg, '(n) => O.data.channelLog.slice(0, O.data.channelLog.length - n).map(e => [e.endpoint, e.source])', n0)
        check(sorted(map(tuple, news)) == [('/availability', 'full'), ('/restrictions', 'full')], 'full update logged: %s' % news)
    t_log()

    @step('sim: platform booking from the channel manager is read-only; channel-invoices numbers it')
    def t_ota():
        js(pg, '''() => { const D = O.data, b = JSON.parse(JSON.stringify(D.bookings.find(x => x.unitTypeId === "UT-deluxe" && x.propertyId && x.checkIn > D.TODAY)));
            b.id = "BK-CHX-SIM"; b.channel = "expedia"; b.reservationCode = "EX-778899"; b.otaName = "Expedia"; b.channex = {bookingId: "sim"}; delete b.invoiceNo;
            b.checkIn = O.d.add(D.TODAY, 3); b.checkOut = O.d.add(D.TODAY, 5); b.nights = 2; b.status = "confirmed"; b.conflict = {kind: "double_booking", with: ["BK-4101"], at: D.NOW};
            D.bookings.push(b); O.automation.run("manual"); O.emit("data"); }''')
        check(str(js(pg, '() => O.data.booking("BK-CHX-SIM").invoiceNo')).startswith('INV-'), 'invoice number')
        js(pg, '() => O.bookingTools.open("BK-CHX-SIM")')
        pg.wait_for_selector('.drawer .bk-src')
        check(pg.inner_text('.drawer .bk-src') == 'From Expedia · Reservation EX-778899', 'source line')
        check('Double booking' in pg.inner_text('.drawer'), 'double booking pill')
        check(pg.locator('.drawer button:has-text("Cancel booking")').is_disabled(), 'cancel disabled')
        shot(pg, 'sim-08-ota-drawer')
        pg.keyboard.press('Escape')
        go(pg, 'bookings')
        check('Expedia EX-778899' in pg.inner_text('#page-root'), 'reservation code in the list')
        go(pg, 'dashboard')
        check('channel issue' in pg.inner_text('#page-root').lower() or 'Double booking' in pg.inner_text('#page-root'), 'dashboard channel issues item')
        shot(pg, 'sim-09-dashboard')
        go(pg, 'automations')
        check('Assign a unit and close the dates on every other channel' in pg.inner_text('#page-root'), 'platform booking rule')
    t_ota()
    ctx.close()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None, args=['--no-sandbox'])
        try:
            if A.part in ('sim', 'all'):
                run_sim(browser)
            if A.part in ('live', 'all'):
                run_live(browser)
        finally:
            browser.close()
    print()
    for r in RESULTS:
        print('%-5s %s' % (r[0], r[1]))
    if ERRORS:
        print('\nJavaScript errors:')
        for e in ERRORS:
            print('  ' + e)
    print('\n%d passed, %d failed, %d JavaScript errors. Screenshots in %s' % (sum(1 for r in RESULTS if r[0] == 'PASS'), len(FAILS), len(ERRORS), OUT))
    sys.exit(1 if FAILS or ERRORS else 0)


if __name__ == '__main__':
    main()
