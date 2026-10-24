#!/usr/bin/env python3
"""Builds the Kozi websites as plain static pages.

  out/staykozi-com/  the global site (www.staykozi.com): brand home and country picker
  out/staykozi-my/   the Malaysia site (www.staykozi.my): cities, buildings, suites, guides

Run:  python3 websites/kozi/build.py   (needs Pillow; photos come from PHOTOS below)
Each output folder is deployed as its own Vercel project with no build step.
"""
import html, json, os, re, shutil, sys
from datetime import date
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
OUT = os.path.join(HERE, 'out')
PHOTOS = os.environ.get('KOZI_PHOTOS', '/mnt/project-files/otto-listings/photos')
LOGO_SVG = os.environ.get('KOZI_LOGO', os.path.join(SRC, 'logo.svg'))

COM = 'https://www.staykozi.com'
MY = 'https://www.staykozi.my'
EMAIL = 'hello@staykozi.com'
PHONE = '+60 3-2142 8800'
WA = '60321428800'  # WhatsApp number for enquiries, digits only with country code
IG = 'https://www.instagram.com/kozimalaysia/'
FB = 'https://www.facebook.com/profile.php?id=61595749560838'
UPDATED = date.today().isoformat()
GSAP = ('<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js" defer></script>\n'
        '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js" defer></script>')

IMAGES = {
    'hero': 'boutique/2026-10-20/10-klcc-night-view.jpg',
    'morning': 'boutique/2026-10-20/05-bedroom-window-view.jpg',
    'noon': 'boutique/2026-10-20/01-living-room.jpg',
    'dusk': 'premium/unit-b-2026-10-20/02-living-tv-dusk.jpg',
    'blue': 'premium/unit-a-2026-10-20/10-kl-tower-view-night.jpg',
    'night': 'premium/unit-b-2026-10-20/03-tv-klcc-night.jpg',
    'bldg': 'premium/unit-b-2026-10-20/01-living-room-day.jpg',
}
SUITE_PHOTOS = {
    'boutique': [('boutique/2026-10-20/' + f, a) for f, a in [
        ('02-dining-and-living.jpg', 'Boutique suite dining table and living room'),
        ('01-living-room.jpg', 'Boutique suite living room with floor-to-ceiling windows'),
        ('03-bedroom-1-view.jpg', 'Boutique suite bedroom with a city view'),
        ('04-bedroom-2.jpg', 'Second bedroom in a Boutique suite'),
        ('05-bedroom-window-view.jpg', 'Kuala Lumpur skyline from a Boutique bedroom window'),
        ('06-tv-klcc-view.jpg', 'Living room TV with the Petronas Twin Towers behind'),
        ('07-bathroom.jpg', 'Bathroom with a walk-in shower'),
        ('08-kitchen.jpg', 'Kitchen with hob and oven'),
        ('09-coffee-tea.jpg', 'Coffee and tea tray with a kettle'),
        ('10-klcc-night-view.jpg', 'The Petronas Twin Towers at night from a Boutique suite'),
    ]],
    'premium': [('premium/' + f, a) for f, a in [
        ('unit-a-2026-10-20/03-dining-living-daylight.jpg', 'Premium suite dining and living room in daylight'),
        ('unit-b-2026-10-20/07-master-bedroom-wide.jpg', 'Premium suite master bedroom'),
        ('unit-a-2026-10-20/01-dining-and-living.jpg', 'Premium dining table under rattan lamps'),
        ('unit-b-2026-10-20/06-bed-klcc-view.jpg', 'Bed facing the Petronas Twin Towers'),
        ('unit-a-2026-10-20/08-master-bedroom-merdeka-118-night.jpg', 'Master bedroom at night with Merdeka 118 outside'),
        ('unit-b-2026-10-20/04-dining-and-living.jpg', 'Premium dining and living area'),
        ('unit-a-2026-10-20/05-twin-bedroom-day.jpg', 'Twin bedroom in daylight'),
        ('unit-b-2026-10-20/10-klcc-window-view.jpg', 'The Petronas Twin Towers from a Premium window'),
        ('unit-a-2026-10-20/10-kl-tower-view-night.jpg', 'KL Tower at blue hour from a Premium bedroom'),
        ('unit-b-2026-10-20/09-dressing-desk.jpg', 'Dressing desk in a Premium bedroom'),
        ('unit-a-2026-10-20/09-twin-bedroom-night.jpg', 'Twin bedroom at night'),
        ('unit-b-2026-10-20/03-tv-klcc-night.jpg', 'Living room at night with the towers outside'),
    ]],
}

e = html.escape


# ---------------------------------------------------------------- assets

def slug_of(path):
    return re.sub(r'[^a-z0-9]+', '-', path.lower().rsplit('.', 1)[0]).strip('-')


_img_done = {}


def img_file(site_dir, rel):
    """Writes a 1600px and a 800px JPG of a photo; returns (url, url_small, w, h)."""
    key = (site_dir, rel)
    if key in _img_done:
        return _img_done[key]
    name = slug_of(rel)
    d = os.path.join(site_dir, 'assets', 'img')
    os.makedirs(d, exist_ok=True)
    im = Image.open(os.path.join(PHOTOS, rel)).convert('RGB')
    big = im.copy(); big.thumbnail((1600, 1600))
    big.save(os.path.join(d, name + '.jpg'), 'JPEG', quality=78, optimize=True, progressive=True)
    small = im.copy(); small.thumbnail((800, 800))
    small.save(os.path.join(d, name + '-800.jpg'), 'JPEG', quality=74, optimize=True, progressive=True)
    _img_done[key] = ('/assets/img/%s.jpg' % name, '/assets/img/%s-800.jpg' % name, big.width, big.height)
    return _img_done[key]


def img(site_dir, rel, alt, eager=False, sizes='(max-width: 760px) 100vw, 50vw'):
    big, small, w, h = img_file(site_dir, rel)
    return ('<img src="%s" srcset="%s 800w, %s %dw" sizes="%s" width="%d" height="%d" alt="%s" data-full="%s"%s>'
            % (small, small, big, w, sizes, w, h, e(alt), big, '' if eager else ' loading="lazy" decoding="async"'))


def logo(cls):
    s = open(LOGO_SVG).read()
    s = re.sub(r'<metadata>.*?</metadata>', '', s, flags=re.S)
    p = re.findall(r'<path d="([^"]+)"', s)
    k, z, i = [x if x.startswith('M') else 'M' + x for x in p[0].split(' Z M')]
    return ('<svg class="logo lg-%s" viewBox="0 0 822 822" role="img" aria-label="Kozi">'
            '<defs><clipPath id="sun-%s" clipPathUnits="userSpaceOnUse"><rect class="lg-clip" x="330" y="-4" width="310" height="306"/></clipPath></defs>'
            '<g transform="translate(94,94)">'
            '<rect class="lg-v" x="315.5" y="-34" width="3" height="702" fill="#C8862E"/>'
            '<rect class="lg-h" x="-34" y="315.5" width="702" height="3" fill="#C8862E"/>'
            '<path class="lg-k" d="%s Z" fill="currentColor"/><path class="lg-z" d="%s Z" fill="currentColor"/><path class="lg-i" d="%s" fill="currentColor"/>'
            '<g class="lg-o" clip-path="url(#sun-%s)"><path d="%s" fill="#C8862E" fill-rule="evenodd"/></g>'
            '<path class="lg-bar" d="%s" fill="#C8862E"/></g></svg>') % (cls, cls, k, z, i, cls, p[1], p[2])


# ---------------------------------------------------------------- page shell

GLOBE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>'
WA_ICON = ('<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.5 1 2.7.2.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.4-.3Z"/></svg>')


def nav_my():
    return ('<a class="country" href="%s/" title="Choose another country">%sMalaysia <span>Change</span></a>'
            '<a class="l" href="/kuala-lumpur/">Kuala Lumpur</a>'
            '<a class="l" href="/kuala-lumpur/vortex-klcc/">Vortex KLCC</a>'
            '<a class="l" href="/guides/">Guides</a>'
            '<a class="btn small magnet" href="/kuala-lumpur/vortex-klcc/#check">Check dates</a>') % (COM, GLOBE_ICON)


def nav_com():
    return ('<a class="l" href="/#destinations">Destinations</a>'
            '<a class="l" href="/#way">The Kozi way</a>'
            '<a class="country magnet" href="/#destinations">%sChoose country</a>') % GLOBE_ICON


def footer_my():
    return ('<footer><div class="wrap"><a class="brand" href="/">%s<b>KOZI</b></a>'
            '<nav aria-label="Site"><a href="/kuala-lumpur/">Kuala Lumpur</a><a href="/kuala-lumpur/vortex-klcc/">Kozi @ Vortex KLCC</a><a href="/guides/">Guides</a><a href="/contact/">Contact</a></nav>'
            '<span><a href="%s/">staykozi.com</a> · all countries · A brand of Orbique Global Sdn. Bhd.</span>'
            '<nav aria-label="Social"><a href="%s" rel="noopener">Instagram</a><a href="%s" rel="noopener">Facebook</a></nav></div></footer>') % (logo('foot'), COM, IG, FB)


def footer_com():
    return ('<footer><div class="wrap"><a class="brand" href="/">%s<b>KOZI</b></a>'
            '<span>Malaysia · <a href="%s/">staykozi.my</a></span><span>A brand of Orbique Global Sdn. Bhd.</span>'
            '<nav aria-label="Social"><a href="%s" rel="noopener">Instagram</a><a href="%s" rel="noopener">Facebook</a></nav></div></footer>') % (logo('foot'), MY, IG, FB)


def page(site, path, title, desc, body, jsonld=(), intro=False, extra_js='', hreflang=None, image=None, noindex=False):
    base = MY if site == 'my' else COM
    url = base + path
    alts = ''
    if hreflang:  # [(lang, url)]
        alts = ''.join('<link rel="alternate" hreflang="%s" href="%s">' % (l, u) for l, u in hreflang)
    og_img = image and (base + image) or (base + '/assets/og.jpg')
    lds = ''.join('<script type="application/ld+json">%s</script>' % json.dumps(j, ensure_ascii=False) for j in jsonld)
    head = f'''<!doctype html>
<html lang="en" data-wa="{WA}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{url}">{alts}
{'<meta name="robots" content="noindex">' if noindex else ''}
<meta property="og:type" content="website"><meta property="og:site_name" content="Kozi">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{url}"><meta property="og:image" content="{og_img}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#F6EFE4">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap">
<link rel="stylesheet" href="/assets/site.css">
{lds}
{GSAP}
<script src="/assets/motion.js" defer></script>{extra_js}
</head>
<body>
'''
    intro_html = ('<div class="intro" id="intro" aria-hidden="true">%s<div class="panel"></div>'
                  '<button class="skip" id="skip" type="button">Skip intro</button></div>' % logo('intro')) if intro else ''
    shell = f'''{intro_html}
<a class="skip-link" href="#main">Skip to content</a>
<div class="progress" id="progress"></div>
<div class="cursor" id="cur"></div><div class="cursor ring" id="ring"></div>
<header class="top" id="top"><div class="wrap">
<a class="brand" href="/" aria-label="Kozi home">{logo('head')}<b>KOZI</b></a>
<nav class="nav" aria-label="Main">{nav_my() if site == 'my' else nav_com()}</nav>
</div></header>
<main id="main">
{body}
</main>
{footer_my() if site == 'my' else footer_com()}
<div class="lb" id="lb" hidden><img id="lbimg" alt=""><button type="button" id="lbx">Close</button></div>
</body>
</html>
'''
    root = os.path.join(OUT, 'staykozi-' + site)
    if path.endswith('.html'):
        target = os.path.join(root, path.lstrip('/'))
    else:
        out_dir = os.path.join(root, path.strip('/'))
        os.makedirs(out_dir, exist_ok=True)
        target = os.path.join(out_dir, 'index.html')
    with open(target, 'w') as f:
        f.write(head + shell)
    if not noindex:
        SITEMAP.setdefault(site, []).append(url)


SITEMAP = {}


def crumbs(items):
    """items: [(name, path)] ending with the current page (path None)."""
    parts, ld = [], []
    for n, (name, path) in enumerate(items):
        if path:
            parts.append('<a href="%s">%s</a>' % (path, e(name)))
        else:
            parts.append('<span aria-current="page">%s</span>' % e(name))
        ld.append({'@type': 'ListItem', 'position': n + 1, 'name': name, 'item': MY + (path or '')})
    nav = '<nav class="crumbs hero-in" aria-label="Breadcrumb">' + '<span aria-hidden="true">/</span>'.join(parts) + '</nav>'
    return nav, {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': ld}


def check_form(building, suite=None, title='Check availability'):
    opts = ''.join('<option%s>%s</option>' % (' selected' if suite == s else '', s) for s in ('Standard', 'Boutique', 'Premium'))
    return f'''<form class="avail hero-in" id="check" data-building="{e(building)}" autocomplete="off" novalidate>
<div class="field"><label for="ci">Check-in</label><input id="ci" type="date"></div>
<div class="field"><label for="co">Check-out</label><input id="co" type="date"></div>
<div class="field"><label for="gs">Guests</label><select id="gs"><option value="1">1 guest</option><option value="2" selected>2 guests</option><option value="3">3 guests</option><option value="4">4 guests</option><option value="5">5 guests (extra bed)</option></select></div>
<div class="field"><label for="st">Suite</label><select id="st"><option value="any"{'' if suite else ' selected'}>Any suite</option>{opts}</select></div>
<a class="btn amber magnet" id="wa" href="https://wa.me/{WA}" rel="noopener">{WA_ICON}{title}</a>
</form>
<p class="msg" id="msg" aria-live="polite"><span>Pick your dates and we'll open WhatsApp with your message ready to send.</span></p>'''


def marquee(words):
    inner = ' <i class="dot"></i> '.join(('<em>%s</em>' % e(w[1:]) if w.startswith('*') else e(w)) for w in words) + ' <i class="dot"></i>'
    return '<div class="marquee" aria-hidden="true"><div class="mq-track" id="mq"><span>%s</span><span>%s</span></div></div>' % (inner, inner)


def finale(title_html, lede, primary=('Check availability', '/kuala-lumpur/vortex-klcc/#check'), phone=True):
    contact = '<span>Email <b>%s</b></span>' % EMAIL + ('<span>Phone <b>%s</b></span>' % PHONE if phone else '')
    return f'''<section class="finale" aria-labelledby="h-fin">
<div class="wrap">
<p class="eyebrow" style="color:var(--amber-hi)">Book direct</p>
<h2 id="h-fin" class="split">{title_html}</h2>
<p class="lede">{lede}</p>
<div class="cta"><a class="btn amber magnet" href="{primary[1]}">{primary[0]}</a><a class="btn ghost magnet" href="{IG}" rel="noopener">Follow on Instagram</a></div>
<div class="contact">{contact}</div>
</div>
<div class="horizon" aria-hidden="true"><div class="haze"></div><div class="big-sun" id="bigsun"></div><div class="ground"></div></div>
</section>'''


FEATS = [
    ('M4 30V18h32v12M4 30v4M36 30v4M8 18v-6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6M20 18v-6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6', 'Two bedrooms', 'Proper doors, proper beds, fresh linen and towels.'),
    ('M6 10h28v24H6zM6 18h28M12 14h2M18 14h2M14 26h12', 'Full kitchen', 'Hob, oven and the basics to cook a real meal.'),
    ('M8 16h20v8a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8zM28 18h3a3 3 0 0 1 0 6h-3M14 6c0 3 3 3 3 6M20 6c0 3 3 3 3 6', 'Coffee &amp; tea', 'A kettle and a welcome tray for your first morning.'),
    ('M4 8h32v22H4zM14 36h12M20 30v6', 'Smart TV', 'Sign in to your own streaming apps.'),
    ('M6 34V20l4-2v16M14 34V12l3-6 3 6v22M22 34V12l3-6 3 6v22M32 34V18l2 2v14M4 34h32', 'City views', 'High floors facing the skyline. Tower views in selected suites.'),
    ('M8 20a12 12 0 1 0 24 0 12 12 0 1 0-24 0M20 14v6l4 3M4 34c6-4 26-4 32 0', 'We reply fast', 'Message us in English, Bahasa Malaysia or Bahasa Indonesia.'),
]


def feats(items=FEATS):
    return '<div class="feats">' + ''.join(
        '<div class="feat"><svg viewBox="0 0 40 40"><path class="draw" d="%s"/></svg><div><h4>%s</h4><p>%s</p></div></div>' % f for f in items) + '</div>'


def faq_block(qas):
    body = '<div class="faq">' + ''.join('<details><summary>%s</summary><p>%s</p></details>' % (e(q), a) for q, a in qas) + '</div>'
    ld = {'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': [
        {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': re.sub('<[^>]+>', '', a)}} for q, a in qas]}
    return body, ld


# ---------------------------------------------------------------- shared data

VORTEX_LD = {
    '@context': 'https://schema.org', '@type': 'LodgingBusiness', '@id': MY + '/kuala-lumpur/vortex-klcc/#kozi',
    'name': 'Kozi @ Vortex KLCC', 'url': MY + '/kuala-lumpur/vortex-klcc/', 'email': EMAIL, 'telephone': PHONE,
    'slogan': 'Exceptional spaces. Memorable stays.',
    'description': 'Two-bedroom serviced city suites at Vortex KLCC in central Kuala Lumpur, each sleeping four with a full kitchen.',
    'address': {'@type': 'PostalAddress', 'streetAddress': 'Vortex KLCC, Jalan Sultan Ismail', 'addressLocality': 'Kuala Lumpur', 'addressRegion': 'Wilayah Persekutuan Kuala Lumpur', 'addressCountry': 'MY'},
    'amenityFeature': [{'@type': 'LocationFeatureSpecification', 'name': n, 'value': True} for n in ('Kitchen', 'City view', 'Smart TV', 'Coffee and tea')],
    'knowsLanguage': ['en', 'ms', 'id'],
    'parentOrganization': {'@type': 'Organization', 'name': 'Kozi', 'url': COM + '/'},
    'sameAs': [IG, FB],
}
ORG_LD = {'@context': 'https://schema.org', '@type': 'Organization', '@id': COM + '/#org', 'name': 'Kozi', 'url': COM + '/',
          'logo': COM + '/assets/apple-touch-icon.png', 'email': EMAIL, 'slogan': 'Exceptional spaces. Memorable stays.',
          'parentOrganization': {'@type': 'Organization', 'name': 'Orbique Global Sdn. Bhd.'}, 'sameAs': [IG, FB]}

HREF_HOME = [('x-default', COM + '/'), ('en', COM + '/'), ('en-MY', MY + '/')]

VORTEX_FAQ = [
    ('How many guests can stay in a Kozi suite?', 'Every suite has two bedrooms and sleeps four. A fifth guest can stay on an extra bed for a small nightly fee.'),
    ('How do I book directly with Kozi?', 'Pick your dates on this page and tap Check availability. WhatsApp opens with your message ready. Our team confirms the suite and sends you a secure payment link.'),
    ('Is there a kitchen?', 'Yes. Every suite has a kitchen with a hob and an oven, plus a kettle with coffee and tea for your first morning.'),
    ('Where is Kozi @ Vortex KLCC?', 'Vortex KLCC is on Jalan Sultan Ismail in central Kuala Lumpur, between KLCC and Bukit Bintang.'),
    ('Which languages does the team speak?', 'English, Bahasa Malaysia and Bahasa Indonesia.'),
    ('Do I need to fill in a Malaysia arrival card?', 'Most foreign visitors need the free Malaysia Digital Arrival Card (MDAC) before landing. Read our <a href="/guides/mdac-malaysia-digital-arrival-card/">MDAC guide</a>.'),
]


# ---------------------------------------------------------------- staykozi.my

def my_home(d):
    body = f'''<section class="hero" aria-labelledby="h1">
<div class="sun" id="sun"></div><div class="cross v"></div><div class="cross h"></div>
<div class="wrap grid">
<div>
<p class="eyebrow hero-in">Kozi Malaysia · City suites</p>
<h1 id="h1" class="split">Exceptional spaces. <span class="serif">Memorable</span> stays.</h1>
<p class="lede hero-in">Two-bedroom serviced suites in Malaysia, beginning in the heart of Kuala Lumpur. A full kitchen, room for four, and the Petronas Twin Towers outside the window of selected suites.</p>
</div>
<div class="hero-art">
<div class="shot" id="shot">{img(d, IMAGES['hero'], 'The Petronas Twin Towers lit up at night, seen from a Kozi suite at Vortex KLCC', eager=True)}</div>
<div class="badge" id="badge"><i><svg viewBox="0 0 24 24" fill="none" stroke="#1B1815" stroke-width="2" stroke-linecap="round"><path d="M8 21V7l1-4 1 4v14M14 21V7l1-4 1 4v14M10 12h4"/></svg></i><span>Twin Towers views from selected suites</span></div>
<svg class="spin" id="spin" viewBox="0 0 120 120" aria-hidden="true"><defs><path id="circ" d="M60,60 m-46,0 a46,46 0 1,1 92,0 a46,46 0 1,1 -92,0"/></defs><circle cx="60" cy="60" r="58" fill="#F6EFE4"/><text><textPath href="#circ">Exceptional spaces · Memorable stays · </textPath></text><circle cx="60" cy="60" r="9" fill="#C8862E"/></svg>
</div>
<div class="book">{check_form('Kozi @ Vortex KLCC')}</div>
</div>
</section>
{marquee(['Two bedrooms', 'Sleeps four', '*City views', 'Full kitchen', 'Coffee & tea on us', '*Kuala Lumpur'])}
<section class="cities" id="cities" aria-labelledby="h-cities">
<div class="wrap">
<p class="eyebrow">Cities</p>
<h2 id="h-cities" class="split">Where would you like <span class="serif">to stay?</span></h2>
<nav class="ctabs" aria-label="Cities in Malaysia"><a class="ctab on" href="/kuala-lumpur/" aria-current="true"><b>Kuala Lumpur</b><small>Kozi @ Vortex KLCC</small></a></nav>
</div>
<div class="cityname" aria-hidden="true"><span class="fill">Kuala</span> Lumpur <span class="fill">Kuala</span> Lumpur</div>
<div class="wrap bldg">
<div class="ph">{img(d, IMAGES['bldg'], 'Living room of a Kozi suite at Vortex KLCC with the city skyline outside')}</div>
<div>
<p class="eyebrow">Kuala Lumpur · City centre</p>
<h3>Kozi @ <span class="serif">Vortex KLCC</span></h3>
<p>Two-bedroom suites high above the city centre on Jalan Sultan Ismail, between KLCC and Bukit Bintang. Choose from three styles of suite.</p>
<div class="tiers"><span>Standard</span><span>Boutique</span><span>Premium</span></div>
<div class="go"><a class="btn magnet" href="/kuala-lumpur/vortex-klcc/">Explore Vortex KLCC <span aria-hidden="true">→</span></a></div>
</div>
</div>
</section>
{suites_section(d)}
<section class="inside" aria-labelledby="h-inside"><div class="wrap grid">
<div><p class="eyebrow">In every suite</p><h2 id="h-inside" class="split">Room to <span class="serif">live,</span> not just sleep</h2>
<div class="big-n"><span class="count" data-to="4">4</span><small>guests in two bedrooms, plus an extra bed for a fifth</small></div></div>
{feats()}
</div></section>
{guides_section()}
{finale('Tell us your dates. <span class="serif">We&#39;ll do the rest.</span>', 'Send us a message on WhatsApp with your dates and the number of guests. A real person from our team replies, confirms the suite and sends you a secure payment link.')}'''
    page('my', '/', 'Kozi Malaysia | Two-bedroom city suites in Kuala Lumpur',
         'Kozi serviced suites in Malaysia: two bedrooms, a full kitchen and room for four in central Kuala Lumpur, with Petronas Twin Towers views from selected suites.',
         body, jsonld=[ORG_LD, VORTEX_LD], intro=True, hreflang=HREF_HOME, image=img_file(d, IMAGES['hero'])[0])


def suites_section(d, heading=True):
    b1 = SUITE_PHOTOS['boutique']; p1 = SUITE_PHOTOS['premium']
    return f'''<section class="suites" id="suites" aria-labelledby="h-suites"><div class="wrap">
<div class="head"><div><p class="eyebrow">Three ways to stay</p><h2 id="h-suites" class="split">Choose your <span class="serif">suite</span></h2></div>
<p class="lede">Every Kozi suite has two bedrooms, sleeps four, and has a full kitchen. A fifth guest can stay on an extra bed. The difference is the finish and the view.</p></div>
<div class="cards">
<article class="card tilt"><div class="media std" aria-hidden="true">{logo('std')}<span class="tag">Standard</span></div>
<div class="body"><h3>Standard</h3><p>Our simplest two-bedroom suite, with the same building, the same care and the same kitchen. Ask us for photos on WhatsApp.</p>
<ul><li>2 bedrooms</li><li>Sleeps 4</li><li>Full kitchen</li></ul>
<div class="ask"><a href="/kuala-lumpur/vortex-klcc/standard/" class="more">See the Standard suite <span>→</span></a></div></div></article>
<article class="card tilt"><div class="media">{img(d, b1[0][0], b1[0][1], sizes='(max-width: 640px) 100vw, 33vw')}{img(d, b1[2][0], b1[2][1], sizes='(max-width: 640px) 100vw, 33vw')}<span class="tag">Boutique</span></div>
<div class="body"><h3>Boutique</h3><p>Warm lighting, soft linen and a living room that opens onto the skyline.</p>
<ul><li>2 bedrooms</li><li>Sleeps 4</li><li>City views</li></ul>
<div class="ask"><a href="/kuala-lumpur/vortex-klcc/boutique/" class="more">See the Boutique suite <span>→</span></a></div></div></article>
<article class="card tilt"><div class="media">{img(d, p1[0][0], p1[0][1], sizes='(max-width: 640px) 100vw, 33vw')}{img(d, p1[1][0], p1[1][1], sizes='(max-width: 640px) 100vw, 33vw')}<span class="tag">Premium</span></div>
<div class="body"><h3><span class="serif">Premium</span></h3><p>Our finest suites, higher up, with the best of the night views.</p>
<ul><li>2 bedrooms</li><li>Sleeps 4</li><li>Tower views</li></ul>
<div class="ask"><a href="/kuala-lumpur/vortex-klcc/premium/" class="more">See the Premium suite <span>→</span></a></div></div></article>
</div></div></section>'''


GUIDES = [
    ('mdac-malaysia-digital-arrival-card', 'Arrival', 'The MDAC arrival card, step by step', 'What to fill in before you land in Malaysia, and how to avoid the fake sites.', 'g1'),
    ('klia-to-kuala-lumpur-city-centre', 'Transport', 'KLIA to the city centre', 'The airport train, Grab and taxis compared, with the 2027 fare change.', 'g2'),
    ('halal-food-near-klcc', 'Food', 'Eating halal near KLCC', 'How to spot certified places, and where to start near Vortex KLCC.', 'g3'),
]


def guides_section():
    cards = ''.join(f'<a class="gcard {c}" href="/guides/{s}/"><span class="orbit"></span><div><p class="eyebrow">{k}</p><h3>{t}</h3><p>{x}</p></div><div class="go">Read the guide <i>→</i></div></a>'
                    for s, k, t, x, c in GUIDES)
    return f'''<section class="guides" id="guides" aria-labelledby="h-guides"><div class="wrap">
<p class="eyebrow">Kozi guides</p><h2 id="h-guides" class="split">Before you <span class="serif">fly</span></h2>
<div class="gcards">{cards}</div></div></section>'''


def my_city(d):
    nav, bl = crumbs([('Malaysia', '/'), ('Kuala Lumpur', None)])
    body = f'''<section class="phero" aria-labelledby="h1"><div class="sun" id="sun"></div><div class="wrap grid">
<div>{nav}<p class="eyebrow hero-in" style="margin-top:22px">Kozi in Kuala Lumpur</p>
<h1 id="h1" class="split">Kuala Lumpur <span class="serif">city suites</span></h1>
<p class="lede hero-in">Kozi's first city. Our suites sit in Vortex KLCC on Jalan Sultan Ismail, between the Petronas Twin Towers and Bukit Bintang, so the sights, the food and the shopping are close by.</p></div>
<div class="ph">{img(d, IMAGES['blue'], 'KL Tower at blue hour, seen from a Kozi suite', eager=True)}</div>
</div></section>
<section class="cities" aria-labelledby="h-b"><div class="wrap"><p class="eyebrow">Buildings</p><h2 id="h-b" class="split">Where Kozi <span class="serif">is in KL</span></h2></div>
<div class="cityname" aria-hidden="true"><span class="fill">Vortex</span> KLCC <span class="fill">Vortex</span> KLCC</div>
<div class="wrap bldg"><div class="ph">{img(d, IMAGES['bldg'], 'Living room of a Kozi suite at Vortex KLCC')}</div>
<div><p class="eyebrow">Jalan Sultan Ismail</p><h3>Kozi @ <span class="serif">Vortex KLCC</span></h3>
<p>Two-bedroom suites in three styles: Standard, Boutique and Premium. Every suite sleeps four and has a full kitchen.</p>
<div class="tiers"><span>Standard</span><span>Boutique</span><span>Premium</span></div>
<div class="go"><a class="btn magnet" href="/kuala-lumpur/vortex-klcc/">See Kozi @ Vortex KLCC <span aria-hidden="true">→</span></a></div></div></div></section>
{near_section()}
{guides_section()}
{finale('Your stay in <span class="serif">Kuala Lumpur</span>', 'Tell us your dates on WhatsApp. A real person from our team replies and confirms your suite.')}'''
    page('my', '/kuala-lumpur/', 'Kuala Lumpur serviced suites near KLCC | Kozi',
         'Kozi two-bedroom serviced suites in central Kuala Lumpur at Vortex KLCC, between the Petronas Twin Towers and Bukit Bintang. Sleeps four, full kitchen.',
         body, jsonld=[bl, VORTEX_LD], image=img_file(d, IMAGES['blue'])[0])


def near_section():
    rows = [
        ('Landmark', 'Petronas Twin Towers <span class="serif">&amp; KLCC Park</span>', 'The skyline you see from the window, and the park at its feet.'),
        ('Shopping', 'Pavilion <span class="serif">Kuala Lumpur</span>', 'The big mall on Bukit Bintang, linked to KLCC by a covered walkway.'),
        ('Food', 'Jalan Alor <span class="serif">night market</span>', 'Satay, grilled seafood and late-night stalls after dark.'),
        ('Park', 'TRX City Park <span class="serif">&amp; The Exchange</span>', 'A 10-acre rooftop park on The Exchange TRX mall.'),
        ('Skyline', 'Merdeka 118 <span class="serif">&amp; KL Tower</span>', 'The two towers you see from the Premium suites.'),
    ]
    r = ''.join('<div class="row"><span class="k">%s</span><span class="nm">%s</span><span class="d">%s</span></div>' % x for x in rows)
    return f'''<section class="near" id="nearby" aria-labelledby="h-near"><div class="wrap">
<p class="eyebrow">The neighbourhood</p><h2 id="h-near" class="split">In the middle <span class="serif">of it all</span></h2>
<div class="rows">{r}</div>
<p class="note">Walking times are being measured door to door by our team and will be added here.</p></div></section>'''


def my_vortex(d):
    nav, bl = crumbs([('Malaysia', '/'), ('Kuala Lumpur', '/kuala-lumpur/'), ('Kozi @ Vortex KLCC', None)])
    faq, faq_ld = faq_block(VORTEX_FAQ)
    frames = [('morning', '07:00', 'Morning', 'Wake up above the city', 'Morning light on the Kuala Lumpur skyline from a bedroom window'),
              ('noon', '13:00', 'Afternoon', 'Long lunches, cool rooms', 'Bright living room with floor-to-ceiling windows'),
              ('dusk', '18:45', 'Dusk', 'The city turns blue', 'Living room at dusk with the city turning blue outside'),
              ('blue', '19:30', 'Blue hour', 'Blue hour over KL Tower', 'KL Tower at blue hour seen from a Premium bedroom'),
              ('night', '22:00', 'Night', 'Towers in the window', 'The Petronas Twin Towers at night behind the living room TV')]
    fr = ''.join(f'<figure class="frame" data-t="{t}" data-p="{p}"><div class="ph">{img(d, IMAGES[k], a, sizes="(max-width: 760px) 100vw, 40vw")}</div><figcaption><b>{t}</b><span>{c}</span></figcaption></figure>'
                 for k, t, p, c, a in frames)
    gal = SUITE_PHOTOS['premium'][3:9] + SUITE_PHOTOS['boutique'][6:9]
    mason = ''.join('<figure>%s</figure>' % img(d, r, a, sizes='(max-width: 760px) 100vw, 33vw') for r, a in gal)
    body = f'''<section class="hero" aria-labelledby="h1">
<div class="sun" id="sun"></div><div class="cross v"></div><div class="cross h"></div>
<div class="wrap grid">
<div>{nav}
<p class="eyebrow hero-in" style="margin-top:22px">Kuala Lumpur · Jalan Sultan Ismail</p>
<h1 id="h1" class="split">Kozi @ <span class="serif">Vortex KLCC</span></h1>
<p class="lede hero-in">Two-bedroom serviced suites high above central Kuala Lumpur. Each sleeps four, with a full kitchen and city views. Some look straight at the Petronas Twin Towers.</p>
</div>
<div class="hero-art"><div class="shot" id="shot">{img(d, IMAGES['hero'], 'The Petronas Twin Towers at night from a Kozi suite at Vortex KLCC', eager=True)}</div>
<div class="badge" id="badge"><i><svg viewBox="0 0 24 24" fill="none" stroke="#1B1815" stroke-width="2" stroke-linecap="round"><path d="M8 21V7l1-4 1 4v14M14 21V7l1-4 1 4v14M10 12h4"/></svg></i><span>Twin Towers views from selected suites</span></div></div>
<div class="book">{check_form('Kozi @ Vortex KLCC')}</div>
</div></section>
{marquee(['Two bedrooms', 'Sleeps four', '*Tower views', 'Full kitchen', 'Jalan Sultan Ismail', '*KLCC'])}
<section class="day" id="day" aria-labelledby="h-day">
<div class="wrap head"><div><p class="eyebrow">A day at Kozi</p><h2 id="h-day" class="split">From sunrise <span class="serif">to city lights</span></h2></div>
<div class="dial"><span id="phase">Morning</span><span class="clock" id="clock">07:00</span></div></div>
<div class="wrap arc" aria-hidden="true"><svg viewBox="0 0 1000 120" preserveAspectRatio="none"><path class="path" id="arcp" d="M0,118 C250,-30 750,-30 1000,118"/><circle class="glow" id="glow" r="26" cx="0" cy="118"/><circle class="orb" id="orb" r="9" cx="0" cy="118"/></svg></div>
<div class="pin" id="pin"><div class="track" id="track">{fr}</div></div><div class="tail"></div>
</section>
{suites_section(d)}
<section class="inside" aria-labelledby="h-inside"><div class="wrap grid">
<div><p class="eyebrow">In every suite</p><h2 id="h-inside" class="split">Room to <span class="serif">live,</span> not just sleep</h2>
<div class="big-n"><span class="count" data-to="4">4</span><small>guests in two bedrooms, plus an extra bed for a fifth</small></div></div>
{feats()}</div></section>
{near_section()}
<section class="gallery" aria-labelledby="h-gal"><div class="wrap"><p class="eyebrow">Gallery</p><h2 id="h-gal" class="split">Take a <span class="serif">look around</span></h2>
<div class="mason" data-zoom>{mason}</div></div></section>
<section class="band paper" aria-labelledby="h-faq"><div class="wrap"><p class="eyebrow">Questions</p><h2 id="h-faq" class="split">Good to <span class="serif">know</span></h2>{faq}</div></section>
{finale('Tell us your dates. <span class="serif">We&#39;ll do the rest.</span>', 'Send us a message on WhatsApp with your dates and the number of guests. A real person from our team replies, confirms the suite and sends you a secure payment link.', primary=('Check availability', '#check'))}'''
    page('my', '/kuala-lumpur/vortex-klcc/', 'Kozi @ Vortex KLCC | 2-bedroom suites with Twin Towers views',
         'Book Kozi @ Vortex KLCC direct: two-bedroom serviced suites on Jalan Sultan Ismail, Kuala Lumpur. Sleeps four, full kitchen, city and Petronas Twin Towers views.',
         body, jsonld=[bl, VORTEX_LD, faq_ld], image=img_file(d, IMAGES['hero'])[0])


SUITES = {
    'boutique': ('Boutique', 'Boutique suites at Kozi @ Vortex KLCC', 'Warm lighting, soft linen and a living room that opens onto the skyline. Two bedrooms, a full kitchen, and city views, with the Petronas Twin Towers in view from some rooms.'),
    'premium': ('Premium', 'Premium suites at Kozi @ Vortex KLCC', 'Our finest suites, higher up, with the best of the night views: the Petronas Twin Towers, KL Tower and Merdeka 118 from selected rooms. Two bedrooms and a full kitchen.'),
    'standard': ('Standard', 'Standard suites at Kozi @ Vortex KLCC', 'Our simplest two-bedroom suite, with the same building, the same care and the same full kitchen. Ask us on WhatsApp and we will send you photos of the suite.'),
}


def my_suite(d, key):
    name, h1, lede = SUITES[key]
    nav, bl = crumbs([('Malaysia', '/'), ('Kuala Lumpur', '/kuala-lumpur/'), ('Kozi @ Vortex KLCC', '/kuala-lumpur/vortex-klcc/'), (name + ' suite', None)])
    photos = SUITE_PHOTOS.get(key, [])
    if photos:
        art = '<div class="ph">%s</div>' % img(d, photos[0][0], photos[0][1], eager=True)
        thumbs = ('<section class="band paper" aria-labelledby="h-ph"><div class="wrap"><p class="eyebrow">Photos</p><h2 id="h-ph" class="split">Inside the <span class="serif">%s suites</span></h2><div class="thumbs" data-zoom>%s</div></div></section>'
                  % (name, ''.join('<figure>%s</figure>' % img(d, r, a, sizes='(max-width: 760px) 50vw, 25vw') for r, a in photos[1:])))
    else:
        art = '<div class="ph std" style="display:grid;place-items:center;aspect-ratio:4/3;border-radius:22px">%s</div>' % logo('std')
        thumbs = ''
    others = ''.join('<a class="btn ghost magnet" style="color:var(--ink);border:1px solid var(--line);background:transparent" href="/kuala-lumpur/vortex-klcc/%s/">%s suite</a>' % (k, SUITES[k][0]) for k in SUITES if k != key)
    body = f'''<section class="phero" aria-labelledby="h1"><div class="sun" id="sun"></div><div class="wrap grid">
<div>{nav}<p class="eyebrow hero-in" style="margin-top:22px">Kozi @ Vortex KLCC · Kuala Lumpur</p>
<h1 id="h1" class="split">{name} <span class="serif">suites</span></h1>
<p class="lede hero-in">{lede}</p></div>{art}</div>
<div class="wrap">{check_form('Kozi @ Vortex KLCC', suite=name, title='Check ' + name + ' dates')}</div></section>
{thumbs}
<section class="inside" aria-labelledby="h-inside"><div class="wrap grid">
<div><p class="eyebrow">In every suite</p><h2 id="h-inside" class="split">What's <span class="serif">inside</span></h2>
<div class="big-n"><span class="count" data-to="4">4</span><small>guests in two bedrooms, plus an extra bed for a fifth</small></div></div>
{feats()}</div></section>
<section class="band sand"><div class="wrap"><p class="eyebrow">Other suites</p><h2 class="split">Compare <span class="serif">the suites</span></h2><div class="whatsapp-row">{others}<a class="btn magnet" href="/kuala-lumpur/vortex-klcc/">All of Vortex KLCC</a></div></div></section>
{finale('Ask about the <span class="serif">' + name + '</span> suite', 'Send us your dates on WhatsApp. We confirm availability and send you a secure payment link.', primary=('Check dates', '#check'))}'''
    ld = {'@context': 'https://schema.org', '@type': 'Suite', 'name': name + ' suite, Kozi @ Vortex KLCC', 'numberOfRooms': 2,
          'occupancy': {'@type': 'QuantitativeValue', 'maxValue': 5}, 'containedInPlace': {'@id': VORTEX_LD['@id']},
          'amenityFeature': VORTEX_LD['amenityFeature']}
    page('my', '/kuala-lumpur/vortex-klcc/%s/' % key, '%s suites, Vortex KLCC Kuala Lumpur | Kozi' % name,
         '%s two-bedroom suites at Kozi @ Vortex KLCC, Kuala Lumpur: sleeps four, full kitchen and city views. Check dates on WhatsApp.' % name,
         body, jsonld=[bl, VORTEX_LD, ld], noindex=not photos, image=photos and img_file(d, photos[0][0])[0] or None)


# ---------------------------------------------------------------- guides

def guide_page(d, slug, kicker, title, desc, h1_html, lede, prose, sources, image):
    nav, bl = crumbs([('Malaysia', '/'), ('Guides', '/guides/'), (title, None)])
    src = ''.join('<li><a href="%s" rel="noopener">%s</a></li>' % (u, e(n)) for n, u in sources)
    body = f'''<section class="phero" aria-labelledby="h1"><div class="sun" id="sun"></div><div class="wrap grid">
<div>{nav}<p class="eyebrow hero-in" style="margin-top:22px">Kozi guides · {kicker}</p>
<h1 id="h1" class="split">{h1_html}</h1><p class="lede hero-in">{lede}</p>
<p class="updated hero-in">Checked {UPDATED}. Rules and prices change, so confirm on the official sites linked below.</p></div>
<div class="ph">{img(d, image[0], image[1], eager=True)}</div></div></section>
<section class="band"><div class="wrap"><article class="prose">{prose}
<div class="sources"><b>Sources</b><ul>{src}</ul></div></article></div></section>
{finale('Staying in <span class="serif">Kuala Lumpur?</span>', 'Kozi @ Vortex KLCC has two-bedroom suites in the city centre. Message us your dates.')}'''
    ld = {'@context': 'https://schema.org', '@type': 'Article', 'headline': title, 'description': desc, 'dateModified': UPDATED,
          'author': {'@type': 'Organization', 'name': 'Kozi'}, 'publisher': {'@id': COM + '/#org'}, 'mainEntityOfPage': MY + '/guides/%s/' % slug}
    page('my', '/guides/%s/' % slug, title + ' | Kozi guides', desc, body, jsonld=[bl, ld], image=img_file(d, image[0])[0])


def guides(d):
    guide_page(d, GUIDES[0][0], 'Arrival', 'MDAC: the Malaysia Digital Arrival Card, step by step',
        'How to fill in the free Malaysia Digital Arrival Card (MDAC) before you land, who is exempt, and how to avoid fake MDAC websites that charge a fee.',
        'The MDAC <span class="serif">arrival card</span>',
        'Most foreign visitors must submit the free Malaysia Digital Arrival Card online before they land. It takes a few minutes, and the only real website ends in imi.gov.my.',
        '''<h2>What the MDAC is</h2>
<p>The Malaysia Digital Arrival Card (MDAC) is an online form from the Immigration Department of Malaysia. It replaces the paper arrival card. Most foreign visitors submit it before arriving by air, land or sea.</p>
<div class="note"><b>The MDAC is free.</b> The official form is at <a href="https://imigresen-online.imi.gov.my/mdac/main" rel="noopener">imigresen-online.imi.gov.my/mdac/main</a>. Any site that asks you to pay is not the Immigration Department.</div>
<h2>When to submit it</h2>
<p>Submit the MDAC within the 3 days before you arrive in Malaysia. Guides word this slightly differently, so check the exact window on the official portal when you fill it in.</p>
<h2>Step by step</h2>
<ol>
<li>Open the official portal at imigresen-online.imi.gov.my and choose the MDAC registration form.</li>
<li>Enter your details exactly as they appear in your passport.</li>
<li>Add your trip: arrival date, how you arrive (for example, your flight number) and your departure date.</li>
<li>Add your address in Malaysia. If you are staying with us, use the Kozi @ Vortex KLCC address from your booking confirmation.</li>
<li>Submit the form and keep the confirmation email or a screenshot on your phone.</li>
</ol>
<p>The form's fields can change, so follow what the portal shows on the day.</p>
<h2>Watch out for fake MDAC websites</h2>
<p>In January 2025 the Immigration Department warned travellers about a fraudulent MDAC website. Copycat sites charge a fee and sometimes appear as paid search ads above the real site. Check the address bar: the real site ends in <b>imi.gov.my</b>.</p>
<h2>Who doesn't need an MDAC</h2>
<p>Singapore citizens are exempt, as reported in 2023. Other exemptions, such as for diplomatic passport holders and Malaysian permanent residents, differ between sources. If you're not sure, check the official portal before you travel.</p>
<h2>Visas are a separate question</h2>
<p>The MDAC is not a visa. Visa-free stays depend on your nationality. For example, Indian and Chinese citizens can visit visa-free for 30 days for tourism until 31 December 2026. Check your own country on the Immigration Department's website.</p>''',
        [('Immigration Department of Malaysia: MDAC portal', 'https://imigresen-online.imi.gov.my/mdac/main'),
         ('Bernama: Immigration Department warns of fake MDAC website', 'https://www.bernama.com/en/news.php?id=2379295'),
         ('Malay Mail: Singaporeans not required to fill in the digital arrival card (2023)', 'https://www.malaymail.com/news/malaysia/2023/12/06/report-singaporeans-travelling-to-malaysia-not-required-to-fill-in-digital-arrival-card-says-saifuddin-nasution/106060'),
         ('Wego: MDAC guide', 'https://blog.wego.com/mdac/'),
         ('EY: Malaysia extends visa exemption for India and China nationals', 'https://www.ey.com/en_gl/technical/tax-alerts/malaysia-extends-visa-exemption-period-for-india-and-china-nationals')],
        SUITE_PHOTOS['premium'][7])

    guide_page(d, GUIDES[1][0], 'Transport', 'KLIA to Kuala Lumpur city centre: train, Grab or taxi',
        'How to get from KLIA Terminal 1 or 2 to central Kuala Lumpur and KLCC: KLIA Ekspres fares (including the 1 January 2027 rise), Grab and airport taxi costs, and late-night options.',
        'KLIA to the <span class="serif">city centre</span>',
        'Three good ways in from Kuala Lumpur International Airport: the KLIA Ekspres train, a Grab car or a prepaid taxi. Here is what each costs and when to pick it.',
        '''<h2>At a glance</h2>
<div class="tablewrap"><table>
<thead><tr><th>Option</th><th>Cost (adult)</th><th>Time</th><th>Best for</th></tr></thead>
<tbody>
<tr><td>KLIA Ekspres to KL Sentral</td><td>RM55 one way until 31 Dec 2026; RM65 from 1 Jan 2027</td><td>About 28 minutes, then a short ride on</td><td>Light luggage, daytime, avoiding traffic</td></tr>
<tr><td>Grab (ride-hailing app)</td><td>About RM65–100 off-peak; more at busy times</td><td>Depends on traffic</td><td>Families, heavy bags, door to door</td></tr>
<tr><td>Airport coupon taxi</td><td>About RM75–120 for a standard car</td><td>Depends on traffic</td><td>No app, paying a fixed price upfront</td></tr>
</tbody></table></div>
<p>The Grab and taxi figures are estimates from 2026 travel guides, not official tariffs.</p>
<h2>KLIA Ekspres</h2>
<p>The non-stop airport train runs from KLIA Terminal 1 and Terminal 2 to KL Sentral in about 28 minutes, with trains roughly every 20 minutes. It runs until about 1am.</p>
<div class="note"><b>Fares change on 1 January 2027.</b> Adults pay RM55 one way until 31 December 2026. From 1 January 2027 it is RM65 one way or RM118 return. Children aged 6 to 15 pay RM29 one way or RM53 return, and under-6s ride free.</div>
<p>From KL Sentral, take a Grab or taxi to Kozi @ Vortex KLCC, or ask us on WhatsApp for the best train connection on your arrival day.</p>
<h2>Grab</h2>
<p>Grab is South-East Asia's main ride-hailing app. Book from the arrivals hall and meet the driver at the marked pick-up point. Prices rise at busy times, so compare with the train if the app shows a surge.</p>
<h2>Airport coupon taxi</h2>
<p>Buy a prepaid coupon at the taxi counter in arrivals. Prices are fixed by zone and car size, so you know the cost before you leave.</p>
<h2>Arriving late at night</h2>
<p>After the last train, a Grab or a coupon taxi is the way in. Tell us your flight time and we'll make sure check-in is ready for you.</p>
<h2>Touch 'n Go card</h2>
<p>For trains and buses around the city, a Touch 'n Go card costs a RM10 issue fee plus the credit you load. You can buy one at the KLIA Ekspres counters and at convenience stores.</p>''',
        [('paultan.org: KLIA Ekspres fares go up from 1 January 2027', 'https://paultan.org/2026/09/30/klia-ekspres-transit-fares-to-go-up-effective-january-1-kl-sentral-klia-rm65-one-way-rm118-return/'),
         ('The Star: KLIA Ekspres, Transit fares up from Jan 1', 'https://www.thestar.com.my/news/nation/2026/10/01/klia-ekspres-transit-fares-up-from-jan-1'),
         ('Wego: KLIA to Kuala Lumpur city guide', 'https://blog.wego.com/klia-to-kuala-lumpur-city/'),
         ('Wikipedia: KLIA Ekspres', 'https://en.wikipedia.org/wiki/KLIA_Ekspres'),
         ('Miss Lobang: KLIA to KL city transport guide 2026', 'https://www.misslobang.my/article/klia-to-kl-city-transport-guide'),
         ('Trip.com: Touch n Go card and eWallet', 'https://my.trip.com/guide/payments/touch-n-go-card-ewallet.html')],
        (IMAGES['morning'], 'Kuala Lumpur skyline in the morning from a Kozi bedroom window'))

    guide_page(d, GUIDES[2][0], 'Food', 'Halal food near KLCC and Jalan Sultan Ismail',
        'How to tell halal-certified food in Malaysia (the JAKIM logo, not "pork-free"), and halal and Muslim-run places to start with near KLCC and Vortex KLCC.',
        'Eating halal <span class="serif">near KLCC</span>',
        'Malaysia is one of the easiest places in the world to eat halal. The one thing to know is how to read the signs, and where to start near Vortex KLCC.',
        '''<h2>Look for the JAKIM logo, not "pork-free"</h2>
<p>Halal certification in Malaysia comes from JAKIM, the Department of Islamic Development. Certified restaurants display the JAKIM halal logo. A "pork-free" or "no pork" sign is not the same thing, and JAKIM has warned that such signs can mislead Muslim diners. When it matters to you, look for the logo at the counter.</p>
<div class="note"><b>Quick rule:</b> JAKIM logo means certified halal. "Muslim-owned" or "Muslim-run" usually means halal food but not always certification. "Pork-free" alone is not halal.</div>
<h2>Near KLCC</h2>
<ul>
<li><b>Suria KLCC</b>, the mall under the Twin Towers. Ahh-Yum in the Signatures Food Court (Level 2) is listed as halal-certified. Serai's central kitchen is halal-certified. Melur and Thyme serves no alcohol, drinks included.</li>
<li><b>Damascus</b> on Jalan Sultan Ismail, the same road as Vortex KLCC, is a Muslim-owned restaurant.</li>
<li><b>Mamak restaurants</b> on Jalan Ampang are Indian-Muslim restaurants, open late and good for roti canai and teh tarik.</li>
</ul>
<h2>Kampung Baru for Malay food</h2>
<p>Kampung Baru, across the river from KLCC, is the city's Malay village and a hub for Malay food such as nasi lemak. Many stalls take cash only, so carry small notes.</p>
<h2>Jalan Alor</h2>
<p>Jalan Alor's night market is famous, but most of its Chinese stalls are not halal. Check each stall before you order.</p>
<h2>Ask us</h2>
<p>Our team speaks English, Bahasa Malaysia and Bahasa Indonesia. Message us on WhatsApp and we'll point you to halal places that suit your plans.</p>''',
        [('Malaysiakini: JAKIM on "no pork" signs', 'https://malaysiakini.com/news/330459'),
         ('Have Halal Will Travel: Ahh-Yum, Suria KLCC', 'https://www.havehalalwilltravel.com/halal-restaurants/detail/ahh-yum-suria-klcc'),
         ('Seth Lui: Suria KLCC food guide', 'https://sethlui.com/suria-klcc-food-guide-malaysia/'),
         ('Yelp: halal near Jalan Sultan Ismail', 'https://www.yelp.com/search?cflt=halal&find_loc=Jalan+Sultan+Ismail%2C+50250+Kuala+Lumpur'),
         ('OpenRice: Malay food in Kampung Baru', 'https://my.openrice.com/en/klangvalley/article/6-malay-delicacies-in-kampung-baru-kl-a333'),
         ('KL Foodie: best halal and Muslim-owned spots, 2025', 'https://klfoodie.com/10-best-halal-muslim-owned-food-spots-in-kl-pj-2025-guide/')],
        SUITE_PHOTOS['premium'][2])

    nav, bl = crumbs([('Malaysia', '/'), ('Guides', None)])
    body = f'''<section class="phero" aria-labelledby="h1"><div class="sun" id="sun"></div><div class="wrap">
{nav}<p class="eyebrow hero-in" style="margin-top:22px">Kozi guides</p>
<h1 id="h1" class="split">Guides for your <span class="serif">Malaysia trip</span></h1>
<p class="lede hero-in">Practical, checked answers to the questions our guests ask before they fly: arrival forms, getting in from the airport, and where to eat.</p></div></section>
{guides_section()}
{finale('Staying in <span class="serif">Kuala Lumpur?</span>', 'Kozi @ Vortex KLCC has two-bedroom suites in the city centre. Message us your dates.')}'''
    page('my', '/guides/', 'Malaysia travel guides: MDAC, KLIA transport, halal food | Kozi',
         'Kozi guides for visitors to Malaysia and Kuala Lumpur: the MDAC arrival card, KLIA to the city centre, and halal food near KLCC.', body, jsonld=[bl])


def my_contact(d):
    nav, bl = crumbs([('Malaysia', '/'), ('Contact', None)])
    body = f'''<section class="phero" aria-labelledby="h1"><div class="sun" id="sun"></div><div class="wrap grid">
<div>{nav}<p class="eyebrow hero-in" style="margin-top:22px">Contact</p><h1 id="h1" class="split">Talk to <span class="serif">our team</span></h1>
<p class="lede hero-in">The fastest way to reach us is WhatsApp. We reply in English, Bahasa Malaysia and Bahasa Indonesia.</p>
<div class="whatsapp-row hero-in"><a class="btn amber magnet" href="https://wa.me/{WA}" rel="noopener">{WA_ICON}Message us on WhatsApp</a></div>
<div class="contact hero-in" style="justify-content:flex-start;color:var(--muted)"><span>Email <b style="color:var(--ink)">{EMAIL}</b></span><span>Phone <b style="color:var(--ink)">{PHONE}</b></span></div></div>
<div class="ph">{img(d, IMAGES['noon'], 'Living room of a Kozi suite in Kuala Lumpur', eager=True)}</div></div></section>'''
    page('my', '/contact/', 'Contact Kozi Malaysia', 'Contact Kozi Malaysia on WhatsApp or email hello@staykozi.com. We reply in English, Bahasa Malaysia and Bahasa Indonesia.', body, jsonld=[bl, VORTEX_LD])


def my_404(d):
    body = '''<section class="phero"><div class="sun" id="sun"></div><div class="wrap"><p class="eyebrow hero-in">Page not found</p>
<h1 class="split">This page has <span class="serif">checked out</span></h1><p class="lede hero-in">The page you were looking for isn't here. Try the home page or Kozi @ Vortex KLCC.</p>
<div class="whatsapp-row hero-in"><a class="btn magnet" href="/">Home</a><a class="btn amber magnet" href="/kuala-lumpur/vortex-klcc/">Kozi @ Vortex KLCC</a></div></div></section>'''
    page('my', '/404.html', 'Page not found | Kozi', 'Page not found.', body, noindex=True)


# ---------------------------------------------------------------- staykozi.com

def com_home(d):
    tpl = open(os.path.join(SRC, 'global-body.html')).read()
    body = tpl.replace('{{MY}}', MY + '/').replace('{{IMG_MY}}', img(d, IMAGES['hero'], 'The Petronas Twin Towers at night from a Kozi suite in Kuala Lumpur', sizes='(max-width: 900px) 100vw, 60vw'))
    page('com', '/', 'Kozi | Serviced city suites. Exceptional spaces, memorable stays',
         'Kozi serviced city suites for families and friends who travel together. Choose your country to find a Kozi stay, starting with Kuala Lumpur, Malaysia.',
         body, jsonld=[ORG_LD], intro=True, extra_js='\n<script src="/assets/globe.js" defer></script>', hreflang=HREF_HOME, image=img_file(d, IMAGES['hero'])[0])


def com_404(d):
    body = '''<section class="phero"><div class="sun" id="sun"></div><div class="wrap"><p class="eyebrow hero-in">Page not found</p>
<h1 class="split">This page has <span class="serif">checked out</span></h1><p class="lede hero-in">Choose a country to find a Kozi stay.</p>
<div class="whatsapp-row hero-in"><a class="btn amber magnet" href="/#destinations">Choose a country</a></div></div></section>'''
    page('com', '/404.html', 'Page not found | Kozi', 'Page not found.', body, noindex=True)


# ---------------------------------------------------------------- write

def statics(site, d):
    a = os.path.join(d, 'assets'); os.makedirs(a, exist_ok=True)
    for f in ('site.css', 'motion.js', 'globe.js'):
        if f == 'globe.js' and site != 'com':
            continue
        shutil.copy(os.path.join(SRC, f), a)
    # favicon: the logo on cream; og image: the night view
    svg = logo('fav').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" style="color:#2B2622;background:#F6EFE4" ', 1)
    open(os.path.join(a, 'favicon.svg'), 'w').write(svg)
    shutil.copy(os.path.join(SRC, 'apple-touch-icon.png'), a)
    im = Image.open(os.path.join(PHOTOS, IMAGES['blue'])).convert('RGB')
    w, h = im.size; th = int(w * 630 / 1200); top = max(0, (h - th) // 2)
    im.crop((0, top, w, top + th)).resize((1200, 630)).save(os.path.join(a, 'og.jpg'), 'JPEG', quality=80)
    base = MY if site == 'my' else COM
    open(os.path.join(d, 'robots.txt'), 'w').write('User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n' % base)
    urls = ''.join('<url><loc>%s</loc><lastmod>%s</lastmod></url>' % (u, UPDATED) for u in SITEMAP.get(site, []))
    open(os.path.join(d, 'sitemap.xml'), 'w').write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">%s</urlset>\n' % urls)
    open(os.path.join(d, 'vercel.json'), 'w').write(json.dumps({
        'cleanUrls': True, 'trailingSlash': True,
        'headers': [
            {'source': '/assets/(.*)', 'headers': [{'key': 'Cache-Control', 'value': 'public, max-age=604800, stale-while-revalidate=86400'}]},
            {'source': '/(.*)', 'headers': [{'key': 'X-Content-Type-Options', 'value': 'nosniff'}, {'key': 'Referrer-Policy', 'value': 'strict-origin-when-cross-origin'}]}],
    }, indent=2))


def main():
    for site in ('my', 'com'):
        d = os.path.join(OUT, 'staykozi-' + site)
        shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    d = os.path.join(OUT, 'staykozi-my')
    my_home(d); my_city(d); my_vortex(d)
    for k in SUITES:
        my_suite(d, k)
    guides(d); my_contact(d); my_404(d)
    statics('my', d)
    d = os.path.join(OUT, 'staykozi-com')
    com_home(d); com_404(d)
    statics('com', d)
    for s, u in SITEMAP.items():
        print(s, len(u), 'pages')


if __name__ == '__main__':
    main()
