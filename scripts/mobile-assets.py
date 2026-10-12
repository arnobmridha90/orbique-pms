#!/usr/bin/env python3
"""Make the phone app's icons and splash screens from public/icons/icon.svg.

    python3 scripts/mobile-assets.py

Re-run it whenever icon.svg changes. It renders the SVG with the Playwright Chromium in this
container (CHROME=/path/to/chrome picks another one), resizes with Pillow and writes:

  android/app/src/main/res/
    mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png         legacy square icon (48dp), Android 7
    mipmap-*/ic_launcher_round.png                      legacy round icon (48dp), Android 7.1
    mipmap-*/ic_launcher_foreground.png                 adaptive icon foreground (108dp): ring and dot on
                                                        transparent, inside the 66dp safe zone; also the
                                                        Android 12+ splash icon (values/styles.xml)
    mipmap-*/ic_launcher_monochrome.png                 the same shape in white, Android 13 themed icons
    mipmap-anydpi-v26/ic_launcher.xml, ic_launcher_round.xml
    values/ic_launcher_background.xml                   adaptive icon background colour
    drawable/ic_launcher_background.xml                 the same colour as a drawable
    drawable*/splash.png                                SplashScreen.show() and the pre-12 launch window
  ios/App/App/Assets.xcassets/
    AppIcon.appiconset/AppIcon-512@2x.png, Contents.json   1024x1024, no alpha channel
    Splash.imageset/splash-2732x2732*.png, Contents.json   aspect-filled by LaunchScreen.storyboard

The Android 12+ launch splash colours live in values/styles.xml, the iOS launch background in
Base.lproj/LaunchScreen.storyboard and the plugin's colour in capacitor.config.json. Those files are
edited by hand; the script only checks that they still say BRAND.
"""
import copy, io, json, math, os, re, sys
import xml.etree.ElementTree as ET
from PIL import Image, ImageChops, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG = os.path.join(ROOT, 'public', 'icons', 'icon.svg')
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
XCASSETS = os.path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets')
CHROME = os.environ.get('CHROME', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome')

BRAND = '#0B5D54'          # icon background, splash background
MASTER = 2048              # px of every Chromium render; everything else is a downscale of these
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

# Sizes below are for the mark's width (the ring's outer diameter; the dot stays inside that box).
FG_MARK_DP = 48            # in the 108dp adaptive foreground: 2/3 of the 72dp a launcher shows, as in
                           # the web app's maskable icon. The whole mark must stay within SAFE_ZONE_DP.
SAFE_ZONE_DP = 66
LEGACY_SQUARE_MARGIN_DP, LEGACY_CORNER = 2, 0.10   # 44dp square in the 48dp icon, corners 10% of its side
LEGACY_ROUND_MARGIN_DP = 1                         # 46dp circle
ANDROID_SPLASH_MARK = 0.25  # of the image's shorter side
IOS_SPLASH_MARK = 0.14      # of the 2732px square; aspect-fill shows it at ~30% of a phone's width

ANDROID_SPLASHES = {        # Capacitor's template sizes; other drawable*/splash.png found keep their size
    'drawable': (480, 320),
    'drawable-land-mdpi': (480, 320), 'drawable-land-hdpi': (800, 480), 'drawable-land-xhdpi': (1280, 720),
    'drawable-land-xxhdpi': (1600, 960), 'drawable-land-xxxhdpi': (1920, 1280),
    'drawable-port-mdpi': (320, 480), 'drawable-port-hdpi': (480, 800), 'drawable-port-xhdpi': (720, 1280),
    'drawable-port-xxhdpi': (960, 1600), 'drawable-port-xxxhdpi': (1280, 1920),
}
IOS_SPLASHES = [('splash-2732x2732-2.png', '1x'), ('splash-2732x2732-1.png', '2x'), ('splash-2732x2732.png', '3x')]
IOS_ICON = 'AppIcon-512@2x.png'

NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)
written = []


def q(tag):
    return '{%s}%s' % (NS, tag)


def rgb(hex_colour):
    h = hex_colour.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# ---------------------------------------------------------------- SVG -> master renders

def svg_variants():
    """Three SVG strings at MASTER px: the whole icon, the mark alone on transparent, and the mark in white.

    The first shape must be the full-size background. A later shape filled with a background colour
    (the green ring around the gold dot) is a gap in the mark, so in the mark layers it becomes a
    cut-out through everything drawn before it rather than a green shape."""
    root = ET.parse(SVG).getroot()
    vx, vy, vw, vh = (float(v) for v in root.get('viewBox').split())
    defs = [k for k in root if k.tag == q('defs')]
    shapes = [k for k in root if k.tag != q('defs')]
    bg = shapes[0] if shapes else None
    if bg is None or bg.tag != q('rect') or float(bg.get('width', 0)) != vw or float(bg.get('height', 0)) != vh:
        sys.exit('icon.svg: expected the first shape to be a <rect> filling the viewBox (the background)')
    bg_colours = {bg.get('fill', '').lower()}
    m = re.match(r'url\(#([^)]+)\)', bg.get('fill', ''))
    if m:
        grad = root.find(".//*[@id='%s']" % m.group(1))
        bg_colours |= {s.get('stop-color', '').lower() for s in grad.iter(q('stop'))}
    area = {'x': str(vx), 'y': str(vy), 'width': str(vw), 'height': str(vh)}

    def svg_root():
        return ET.Element(q('svg'), {'viewBox': root.get('viewBox'), 'width': str(MASTER), 'height': str(MASTER)})

    def layer(white):
        svg = svg_root()
        d = ET.SubElement(svg, q('defs'))
        for dd in defs:
            d.extend(copy.deepcopy(list(dd)))
        drawn = []
        for el in shapes[1:]:
            el = copy.deepcopy(el)
            if el.get('style'):
                sys.exit('icon.svg: style="" attributes are not supported here; use fill/stroke attributes')
            if el.get('fill', '').lower() in bg_colours:
                mid = 'cut%d' % len(d)
                mask = ET.SubElement(d, q('mask'), dict(area, id=mid, maskUnits='userSpaceOnUse'))
                ET.SubElement(mask, q('rect'), dict(area, fill='#FFFFFF'))
                el.set('fill', '#000000')
                mask.append(el)
                g = ET.Element(q('g'), {'mask': 'url(#%s)' % mid})
                g.extend(drawn)
                drawn = [g]
                continue
            if white:
                for e in el.iter():
                    for a in ('fill', 'stroke'):
                        if e.get(a, 'none' if a == 'stroke' else '') != 'none':
                            e.set(a, '#FFFFFF')
            drawn.append(el)
        svg.extend(drawn)
        return ET.tostring(svg, encoding='unicode')

    full = svg_root()
    full.extend(copy.deepcopy(list(root)))
    return {'full': ET.tostring(full, encoding='unicode'), 'mark': layer(False), 'mono': layer(True)}


def render(svgs):
    from playwright.sync_api import sync_playwright
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME if os.path.exists(CHROME) else None,
                              args=['--no-sandbox', '--force-color-profile=srgb'])
        pg = b.new_page(viewport={'width': MASTER, 'height': MASTER}, device_scale_factor=1)
        for name, svg in svgs.items():
            pg.set_content('<!doctype html><style>html,body{margin:0;background:transparent}'
                           'svg{display:block}</style>' + svg)
            out[name] = Image.open(io.BytesIO(pg.screenshot(omit_background=True))).convert('RGBA')
        b.close()
    for name, im in out.items():
        if im.size != (MASTER, MASTER) or im.getchannel('A').getextrema()[1] == 0:
            sys.exit('render of %s came out wrong: %s, alpha %s' % (name, im.size, im.getchannel('A').getextrema()))
    return out


# ---------------------------------------------------------------- geometry

def solid(alpha):
    return alpha.point(lambda v: 255 if v >= 128 else 0)


def mark_geometry(mark):
    """Centre of the mark's box, its width (the larger side) and the farthest opaque pixel from that centre, in master px."""
    a = solid(mark.getchannel('A'))
    x0, y0, x1, y1 = a.getbbox()
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = 0.0
    for y in range(y0, y1):
        row = a.crop((0, y, MASTER, y + 1)).getbbox()
        if row:
            r = max(r, math.hypot(max(abs(row[0] - cx), abs(row[2] - cx)), max(abs(y - cy), abs(y + 1 - cy))))
    return (cx, cy), max(x1 - x0, y1 - y0), r


def place(canvas, mark, centre, half, scale):
    """Composite `mark` onto the middle of `canvas`, scaled by `scale` (canvas px per master px), with `centre`
    (master px) on the canvas centre. `half` is how far the mark reaches from `centre` in master px."""
    W, H = canvas.size
    hc = math.ceil(half * scale) + 4                       # + room for the filter's soft edge
    nx, ny = 2 * hc + W % 2, 2 * hc + H % 2                 # same parity as the canvas: exact centring
    ox, oy = (W - nx) // 2, (H - ny) // 2
    box = [centre[0] - nx / 2 / scale, centre[1] - ny / 2 / scale, centre[0] + nx / 2 / scale, centre[1] + ny / 2 / scale]
    pad = math.ceil(max(0, -box[0], -box[1], box[2] - mark.width, box[3] - mark.height))
    if pad:
        big = Image.new('RGBA', (mark.width + 2 * pad, mark.height + 2 * pad))
        big.paste(mark, (pad, pad))
        mark, box = big, [v + pad for v in box]
    # Pillow resizes RGBA with premultiplied alpha, so transparent black does not darken the edges.
    canvas.alpha_composite(mark.resize((nx, ny), Image.LANCZOS, box=tuple(box)), (ox, oy))
    return canvas


def shaped(full, size, margin_dp, shape):
    m = round(margin_dp * size / 48)
    mask = Image.new('L', full.size, 0)
    draw = ImageDraw.Draw(mask)
    if shape == 'circle':
        draw.ellipse((0, 0, MASTER - 1, MASTER - 1), fill=255)
    else:
        draw.rounded_rectangle((0, 0, MASTER - 1, MASTER - 1), radius=round(MASTER * LEGACY_CORNER), fill=255)
    icon = full.copy()
    icon.putalpha(ImageChops.multiply(full.getchannel('A'), mask))
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.alpha_composite(icon.resize((size - 2 * m, size - 2 * m), Image.LANCZOS), (m, m))
    return out


# ---------------------------------------------------------------- output

def save(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, optimize=True)
    written.append((path, im.size, im.mode))


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    old = open(path).read() if os.path.exists(path) else None
    if old != text:
        with open(path, 'w') as f:
            f.write(text)
    written.append((path, None, 'unchanged' if old == text else 'written'))


ADAPTIVE_XML = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
'''
COLOUR_XML = '''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">%s</color>
</resources>
''' % BRAND
BACKGROUND_DRAWABLE_XML = '''<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/mobile-assets.py. The launcher icons use @color/ic_launcher_background directly. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="@color/ic_launcher_background"
        android:pathData="M0,0h108v108h-108z" />
</vector>
'''


def contents_json(images):
    return json.dumps({'images': images, 'info': {'author': 'xcode', 'version': 1}}, indent=2, separators=(',', ' : ')) + '\n'


def android(full, mark, mono, centre, mark_w, reach):
    for dens, d in DENSITIES.items():
        folder = os.path.join(RES, 'mipmap-' + dens)
        size = round(48 * d)
        save(shaped(full, size, LEGACY_SQUARE_MARGIN_DP, 'square'), os.path.join(folder, 'ic_launcher.png'))
        save(shaped(full, size, LEGACY_ROUND_MARGIN_DP, 'circle'), os.path.join(folder, 'ic_launcher_round.png'))
        size = round(108 * d)
        scale = FG_MARK_DP * d / mark_w
        for name, src in (('ic_launcher_foreground', mark), ('ic_launcher_monochrome', mono)):
            save(place(Image.new('RGBA', (size, size), (0, 0, 0, 0)), src, centre, reach, scale),
                 os.path.join(folder, name + '.png'))
    for name in ('ic_launcher', 'ic_launcher_round'):
        write_text(os.path.join(RES, 'mipmap-anydpi-v26', name + '.xml'), ADAPTIVE_XML)
    write_text(os.path.join(RES, 'values', 'ic_launcher_background.xml'), COLOUR_XML)
    write_text(os.path.join(RES, 'drawable', 'ic_launcher_background.xml'), BACKGROUND_DRAWABLE_XML)
    robot = os.path.join(RES, 'drawable-v24', 'ic_launcher_foreground.xml')   # the template's Android robot, unused
    if os.path.exists(robot):
        os.remove(robot)
        written.append((robot, None, 'removed'))

    splashes = dict(ANDROID_SPLASHES)
    for folder in sorted(os.listdir(RES)):
        p = os.path.join(RES, folder, 'splash.png')
        if folder.startswith('drawable') and folder not in splashes and os.path.exists(p):
            splashes[folder] = Image.open(p).size
    for folder, (w, h) in splashes.items():
        canvas = Image.new('RGBA', (w, h), rgb(BRAND) + (255,))
        place(canvas, mark, centre, reach, ANDROID_SPLASH_MARK * min(w, h) / mark_w)
        save(canvas.convert('RGB'), os.path.join(RES, folder, 'splash.png'))


def ios(full, mark, centre, mark_w, reach):
    icon = Image.new('RGB', (1024, 1024), rgb(BRAND))
    small = full.resize((1024, 1024), Image.LANCZOS)
    icon.paste(small, (0, 0), small)
    save(icon, os.path.join(XCASSETS, 'AppIcon.appiconset', IOS_ICON))
    write_text(os.path.join(XCASSETS, 'AppIcon.appiconset', 'Contents.json'), contents_json(
        [{'filename': IOS_ICON, 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}]))

    canvas = Image.new('RGBA', (2732, 2732), rgb(BRAND) + (255,))
    splash = place(canvas, mark, centre, reach, IOS_SPLASH_MARK * 2732 / mark_w).convert('RGB')
    for name, _ in IOS_SPLASHES:
        save(splash, os.path.join(XCASSETS, 'Splash.imageset', name))
    write_text(os.path.join(XCASSETS, 'Splash.imageset', 'Contents.json'), contents_json(
        [{'idiom': 'universal', 'filename': name, 'scale': scale} for name, scale in IOS_SPLASHES]))


def check_wiring():
    """The hand-edited files that carry the splash colour: warn when they drift from BRAND."""
    problems = []
    styles = open(os.path.join(RES, 'values', 'styles.xml')).read()
    launch = re.search(r'<style name="AppTheme\.NoActionBarLaunch".*?</style>', styles, re.S)
    for item, value in (('windowSplashScreenBackground', BRAND), ('windowSplashScreenAnimatedIcon', '@mipmap/ic_launcher_foreground'),
                        ('postSplashScreenTheme', '@style/AppTheme.NoActionBar')):
        if not launch or not re.search(r'<item name="%s">\s*%s\s*</item>' % (item, re.escape(value)), launch.group(0), re.I):
            problems.append('android/app/src/main/res/values/styles.xml: AppTheme.NoActionBarLaunch should set %s to %s' % (item, value))
    cfg = json.load(open(os.path.join(ROOT, 'capacitor.config.json')))
    if cfg.get('plugins', {}).get('SplashScreen', {}).get('backgroundColor', '').upper() != BRAND.upper():
        problems.append('capacitor.config.json: plugins.SplashScreen.backgroundColor should be ' + BRAND)
    board = open(os.path.join(ROOT, 'ios', 'App', 'App', 'Base.lproj', 'LaunchScreen.storyboard')).read()
    m = re.search(r'<color key="backgroundColor" red="([\d.]+)" green="([\d.]+)" blue="([\d.]+)"', board)
    if not m or tuple(round(float(v) * 255) for v in m.groups()) != rgb(BRAND):
        problems.append('ios/App/App/Base.lproj/LaunchScreen.storyboard: the splash view backgroundColor should be ' + BRAND)
    return problems


def main():
    masters = render(svg_variants())
    full, mark, mono = masters['full'], masters['mark'], masters['mono']
    centre, mark_w, reach = mark_geometry(mark)
    reach_dp = reach * FG_MARK_DP / mark_w
    if reach_dp > SAFE_ZONE_DP / 2:
        sys.exit('the mark reaches %.1fdp from the centre of the foreground, outside the %ddp safe zone; lower FG_MARK_DP'
                 % (reach_dp, SAFE_ZONE_DP))
    android(full, mark, mono, centre, mark_w, reach)
    ios(full, mark, centre, mark_w, reach)

    for path, size, mode in written:
        print('%-90s %-11s %s' % (os.path.relpath(path, ROOT), '%dx%d' % size if size else '', mode))
    print('\nadaptive foreground: mark %ddp wide, reaches %.1fdp from the centre (safe zone radius %ddp)'
          % (FG_MARK_DP, reach_dp, SAFE_ZONE_DP / 2))
    problems = check_wiring()
    for p in problems:
        print('warning: ' + p)
    if not problems:
        print('styles.xml, LaunchScreen.storyboard and capacitor.config.json use ' + BRAND)


if __name__ == '__main__':
    main()
