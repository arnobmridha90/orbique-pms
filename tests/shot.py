#!/usr/bin/env python3
"""Screenshot one section of a local test build and report JavaScript errors.

    node scripts/build.mjs --local --out /tmp/me/o.html
    python3 tests/shot.py --html /tmp/me/o.html --page dashboard --out /tmp/me/dash.png
    python3 tests/shot.py --html ... --page calendar --phone --out ... --full
    python3 tests/shot.py --html ... --page inbox --js "document.querySelector('.conv').click()" --out ...
    python3 tests/shot.py --html ... --page expenses --viewer s5 --out ...          # as a housekeeper
    python3 tests/shot.py --html ... --guest BK-4105 --phone --out guest.png        # the guest app for a booking (token or booking id)
    python3 tests/shot.py --html ... --now 2026-10-20T09:00 --page dashboard ...    # run the app as if it were another day

The clock is pinned to --now (default 2026-10-06T10:15, the demo's own "today", so nothing is shifted).
--js runs after the page renders (repeatable); --wait is milliseconds to wait after each.
--storage FILE keeps this browser's saved data between runs (JSON of localStorage), to test that changes persist.
Exit code 1 if the page logged an uncaught error or console.error.
"""
import argparse, json, os, sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', required=True)
    ap.add_argument('--page', default=None)
    ap.add_argument('--guest', default=None)
    ap.add_argument('--out', required=True)
    ap.add_argument('--width', type=int, default=1440)
    ap.add_argument('--height', type=int, default=900)
    ap.add_argument('--phone', action='store_true', help='390 x 844 phone')
    ap.add_argument('--full', action='store_true', help='full-page screenshot')
    ap.add_argument('--js', action='append', default=[], help='JS to run after render (repeatable)')
    ap.add_argument('--wait', type=int, default=400)
    ap.add_argument('--viewer', default=None, help='staff id to view as, e.g. s5')
    ap.add_argument('--workspace', default=None, help='orbique or otto')
    ap.add_argument('--selector', default=None, help='screenshot only this element')
    ap.add_argument('--now', default='2026-10-06T10:15')
    ap.add_argument('--storage', default=None)
    a = ap.parse_args()
    if a.phone:
        a.width, a.height = 390, 844
    errors = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None, args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': a.width, 'height': a.height}, device_scale_factor=1 if a.width > 600 else 2)
        init = 'window.ORBIQUE_NOW = %s;' % json.dumps(a.now)
        if a.storage and os.path.exists(a.storage):
            init += 'try { const s = %s; if (!sessionStorage.getItem("__seeded")) { localStorage.clear(); Object.keys(s).forEach(k => localStorage.setItem(k, s[k])); sessionStorage.setItem("__seeded", "1"); } } catch (e) {}' % open(a.storage).read()
        ctx.add_init_script(init)
        pg = ctx.new_page()
        vendor = os.path.join(HERE, 'vendor', 'jspdf.umd.min.js')
        pg.route('https://cdnjs.cloudflare.com/**', lambda r: r.fulfill(path=vendor, content_type='application/javascript') if os.path.exists(vendor) else r.abort())
        pg.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        pg.route('https://fonts.gstatic.com/**', lambda r: r.abort())
        pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errors.append('console.error: ' + m.text) if m.type == 'error' and 'net::ERR' not in m.text and 'Failed to load resource' not in m.text else None)
        url = 'file://' + os.path.abspath(a.html)
        if a.guest:
            url += '#guest-' + a.guest
        pg.goto(url)
        if not a.guest:
            pg.wait_for_function('() => window.O && O._started', timeout=15000)
            pg.evaluate("""([page, viewer, ws]) => {
                if (ws && O.state.workspace !== ws) O.setWorkspace(ws, {silent: true});
                if (viewer) { O.state.viewer = viewer; O.emit('viewer'); }
                if (page) O.go(page);
                document.querySelectorAll('.toast').forEach(t => t.remove());
            }""", [a.page, a.viewer, a.workspace])
        pg.wait_for_timeout(600)
        for js in a.js:
            try:
                pg.evaluate('() => { ' + js + ' }')
            except Exception as e:
                errors.append('js-arg error: ' + str(e).splitlines()[0])
            pg.wait_for_timeout(a.wait)
        if a.selector:
            pg.locator(a.selector).first.screenshot(path=a.out)
        else:
            pg.screenshot(path=a.out, full_page=a.full)
        ov = pg.evaluate('() => document.documentElement.scrollWidth - window.innerWidth')
        if a.storage:
            pg.evaluate('() => window.O && O.sync && O.sync.flush && O.sync.flush()')
            pg.wait_for_timeout(300)
            st = pg.evaluate('() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; }')
            json.dump(st, open(a.storage, 'w'))
        b.close()
    print('saved', a.out)
    if ov > 1:
        print('WARNING: page is', ov, 'px wider than the viewport (horizontal scroll)')
    for e in errors:
        print(e)
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
