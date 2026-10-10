#!/usr/bin/env python3
"""Visit every section of a local test build in several set-ups and report problems.

    node scripts/build.mjs --local --out /tmp/sweep/o.html
    python3 tests/sweep.py --html /tmp/sweep/o.html --out /tmp/sweep/shots
    python3 tests/sweep.py --html ... --out ... --only desktop,phone-empty --pages dashboard,tasks

Set-ups (--only picks some):
    desktop          1440x900, owner, the demo's own day
    phone            390x844, owner
    landscape        844x390, owner (calendar-like views)
    later            1440x900, owner, two weeks later (2026-10-21 15:40)
    phone-later      390x844, owner, two weeks later
    housekeeper      390x844 as s5        frontdesk  1440x900 as s4
    accountant       1440x900 as s7       maintenance 390x844 as s6
    empty            1440x900, a brand-new workspace (only the owner, no properties or bookings)
    phone-empty      390x844, the same
    guest            390x844 guest app for three bookings (arriving, in-house, past)

For each page it saves <out>/<setup>/<page>.png and prints: JS errors (with the page they happened on),
sideways scroll on phones, pages that rendered nothing, and on phones whether the bottom tab bar is visible.
Exit code 1 when any error was found.
"""
import argparse, json, os, sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
DEMO_NOW, LATER = '2026-10-06T10:15', '2026-10-21T15:40'
EMPTY_JS = """
const R = O.sync.registered();
Object.keys(R).forEach(k => { if (R[k].kind === 'demo') { const v = O.data[k]; if (Array.isArray(v)) v.length = 0; else if (v && typeof v === 'object') Object.keys(v).forEach(x => delete v[x]); } });
O.data.staff.push({id: 'u1', name: 'Test Owner', initials: 'TO', role: 'owner', roleLabel: 'Account owner'});
O.state.viewer = 'u1'; O.reindex(); O.emit('data');
"""
SETUPS = {
    'desktop': dict(w=1440, h=900),
    'phone': dict(w=390, h=844),
    'landscape': dict(w=844, h=390),
    'later': dict(w=1440, h=900, now=LATER),
    'phone-later': dict(w=390, h=844, now=LATER),
    'housekeeper': dict(w=390, h=844, viewer='s5'),
    'frontdesk': dict(w=1440, h=900, viewer='s4'),
    'accountant': dict(w=1440, h=900, viewer='s7'),
    'maintenance': dict(w=390, h=844, viewer='s6'),
    'empty': dict(w=1440, h=900, js=EMPTY_JS),
    'phone-empty': dict(w=390, h=844, js=EMPTY_JS),
    'guest': dict(w=390, h=844, guest=True),
}


def run_setup(b, html, name, cfg, out, pages_filter):
    problems, shots = [], []
    ctx = b.new_context(viewport={'width': cfg['w'], 'height': cfg['h']}, device_scale_factor=1)
    ctx.add_init_script('window.ORBIQUE_NOW = %s;' % json.dumps(cfg.get('now', DEMO_NOW)))
    pg = ctx.new_page()
    vendor = os.path.join(HERE, 'vendor', 'jspdf.umd.min.js')
    pg.route('https://cdnjs.cloudflare.com/**', lambda r: r.fulfill(path=vendor, content_type='application/javascript') if os.path.exists(vendor) else r.abort())
    pg.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    pg.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    where = {'page': 'boot'}
    pg.on('pageerror', lambda e: problems.append((where['page'], 'error', str(e).splitlines()[0][:300])))
    pg.on('console', lambda m: problems.append((where['page'], 'console.error', m.text[:300])) if m.type == 'error' and 'net::ERR' not in m.text and 'Failed to load resource' not in m.text else None)
    url = 'file://' + os.path.abspath(html)
    os.makedirs(os.path.join(out, name), exist_ok=True)
    if cfg.get('guest'):
        pg.goto(url)
        pg.wait_for_function('() => window.O && O._started', timeout=20000)
        picks = pg.evaluate("""() => {
            const D = O.data, T = D.TODAY, ok = D.bookings.filter(b => b.status !== 'cancelled');
            const arr = ok.find(b => b.checkIn === T), inh = ok.find(b => b.checkIn < T && b.checkOut > T), past = ok.filter(b => b.checkOut < T).slice(-1)[0];
            return [['arriving', arr], ['inhouse', inh], ['past', past]].filter(x => x[1]).map(x => [x[0], x[1].guestToken || x[1].id]);
        }""")
        for label, tok in picks:
            where['page'] = 'guest-' + label
            pg.goto(url + '#guest-' + tok)
            pg.reload()
            pg.wait_for_timeout(1500)
            p = os.path.join(out, name, label + '.png'); pg.screenshot(path=p); shots.append(p)
            ov = pg.evaluate('() => document.documentElement.scrollWidth - window.innerWidth')
            if ov > 1: problems.append((where['page'], 'overflow', '%dpx sideways scroll' % ov))
            txt = pg.evaluate("() => (document.querySelector('#guest-root') || document.body).innerText.trim().length")
            if txt < 40: problems.append((where['page'], 'blank', 'guest app shows almost nothing'))
        ctx.close()
        return problems, shots
    pg.goto(url)
    pg.wait_for_function('() => window.O && O._started', timeout=20000)
    if cfg.get('viewer'):
        pg.evaluate('(v) => { O.state.viewer = v; O.emit("viewer"); }', cfg['viewer'])
    if cfg.get('js'):
        pg.evaluate('() => { ' + cfg['js'] + ' }')
    pg.wait_for_timeout(500)
    pages = pg.evaluate("""() => {
        const ids = []; O.NAV.forEach(g => g[1].forEach(p => { if (O.pages[p] && O.allowed(p)) ids.push(p); }));
        Object.keys(O.EXTRA_PAGES || {}).forEach(p => { if (O.pages[p] && O.allowed(p)) ids.push(p); });
        return ids;
    }""")
    missing = pg.evaluate("() => { const m = []; O.NAV.forEach(g => g[1].forEach(p => { if (!O.pages[p]) m.push(p); })); return m; }")
    for p in missing:
        problems.append((p, 'missing', 'menu item has no page'))
    if pages_filter:
        pages = [p for p in pages if p in pages_filter]
    for pid in pages:
        where['page'] = pid
        pg.evaluate('(p) => { document.querySelectorAll(".modal-back, .drawer, .toast").forEach(x => x.remove()); O.go(p); window.scrollTo(0, 0); }', pid)
        pg.wait_for_timeout(700)
        p = os.path.join(out, name, pid + '.png'); pg.screenshot(path=p); shots.append(p)
        info = pg.evaluate("""() => {
            const root = document.querySelector('#page-root') || document.body, tb = document.querySelector('#tabbar');
            return { ov: document.documentElement.scrollWidth - window.innerWidth, text: root.innerText.trim().length,
                     tab: tb ? getComputedStyle(tb).display !== 'none' && tb.getBoundingClientRect().height > 0 : false };
        }""")
        if info['ov'] > 1: problems.append((pid, 'overflow', '%dpx sideways scroll' % info['ov']))
        if info['text'] < 30: problems.append((pid, 'blank', 'page shows almost nothing'))
        if cfg['w'] <= 760 and not info['tab']: problems.append((pid, 'tabbar', 'bottom tab bar not visible'))
    ctx.close()
    return problems, shots


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--pages', default='')
    a = ap.parse_args()
    names = [n for n in (a.only.split(',') if a.only else SETUPS.keys()) if n]
    pages_filter = [p for p in a.pages.split(',') if p]
    total = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None, args=['--no-sandbox'])
        for n in names:
            probs, shots = run_setup(b, a.html, n, SETUPS[n], a.out, pages_filter)
            print('%-12s %3d screens, %d problems' % (n, len(shots), len(probs)))
            for pid, kind, msg in probs:
                print('   %-14s %-13s %s' % (pid, kind, msg))
            total += [(n,) + x for x in probs]
        b.close()
    json.dump([{'setup': s, 'page': pg, 'kind': k, 'msg': m} for s, pg, k, m in total], open(os.path.join(a.out, 'problems.json'), 'w'), indent=1)
    print('problems:', len(total), '(details in', os.path.join(a.out, 'problems.json') + ')')
    sys.exit(1 if any(k in ('error', 'console.error', 'missing') for _, _, k, _ in total) else 0)


if __name__ == '__main__':
    main()
