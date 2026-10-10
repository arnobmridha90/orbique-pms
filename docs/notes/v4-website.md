# v4 website builder

Files: `app/pages/website.js`, `app/pages/website.css` (both rewritten). No other files touched.

## What I built

**Eight complete designs**, each a full site with hero, welcome/intro, homes grid with "from RM x / night", amenities, reviews, location/area, booking CTA with enquiry form, and a footer with contact and social links. Each design also styles its own **property page** (gallery, facts, amenities, two-month availability calendar with nightly prices, booking card with quote, reviews, house info, more homes) and **About page** (story, team from `D.staff`, stats, FAQ, contact form).

| id | Name | Look | Type stack (ends in fonts the test machine has) |
|---|---|---|---|
| coastal | Coastal escape | sea-view hero, floating date search, sand tones | Avenir Next / Segoe / Helvetica → DejaVu Sans |
| urban | Urban loft | dark, bold capitals, index grid, area ticker | condensed Helvetica + mono |
| highland | Highland retreat | misty hills, card-over-image hero, alternating rows | Palatino / Georgia → Liberation Serif |
| heritage | Heritage shophouse | Peranakan tile strip, arched photos, centred masthead | Didot / Georgia → Liberation Serif |
| minimal | Minimal grid | Swiss bento hero, hairlines, square photos | Helvetica Neue + mono |
| editorial | Boutique editorial | magazine masthead, italic serif, featured home | Baskerville / Iowan → DejaVu Serif |
| tropical | Tropical resort | deep green, palm leaves, round photos, carousel | Futura / Century Gothic → DejaVu Sans |
| family | Family stays | polaroids, stickers, speech-bubble welcome | rounded sans / Verdana → DejaVu Sans |

- Workspace brand colours (`O.theme.current` primary/accent/dark) go through a per-design palette recipe (`palette(t)`) that keeps contrast (`O.color.ensure`) and keeps each design's character (for example heritage stays cream, urban stays charcoal).
- **Images**: `property.photos` (JPEG data URLs from the Properties page) are used when present, converted once to blob URLs so the many scaled previews stay light. Otherwise each home gets a brand-tinted inline SVG scene picked from its name/area/address (sea, marina, hills, heritage, river, garden, night city, pool) plus room scenes for gallery slots. Never an empty box or broken image.
- **Gallery**: 8 cards with a live scaled render (desktop + mini phone), the name in the design's own font, description, "Best for", type style, colour swatch, Live / In use pills, Preview, Use this design / Edit site. Two extra cards show the property and About pages in the current design.
- **Full-screen preview**: prev/next design (arrow keys too), Home / Property / About, Desktop / Phone, Use this design, Esc closes. The site inside is clickable: nav, menu, homes, calendar date picking, quote, "book" (opens a "Guest checkout (preview)" summary), enquiry form (toast), FAQ.
- **Switching keeps everything**: content, featured homes, section order and visibility, social, SEO all live in `D.website` and are shared by every design. Toast says what carried over.
- **Editor**: home section show/hide/reorder (shared across designs), property page sections and preview home, About page sections, headline/sub/button/welcome text with design defaults as placeholders and counters, featured homes picker, location text, WhatsApp/Instagram/Facebook/TikTok, SEO title/description with a Google-style preview, link to Brand & Setup. Right side: live preview with page and device toggles. Typing saves after 600 ms without re-rendering the form (focus kept).
- **Status bar**: domain, Live / Draft changes / Not published, who published when, direct bookings in the last 90 days, current design.
- **Publish** keeps the v3 flow and wording ("Prototype: publishing is simulated and no site goes live."), with a checklist and the `website-published` data event type.
- **Phone (390)**: Edit / Preview segmented tabs (also used up to 1024 px), single-column gallery, full-screen preview without the phone frame, all builder controls at least 40 px, no sideways scroll. The rendered site is responsive through container queries, so it reflows inside any preview width.
- **Permissions**: `O.can('website')` to see (else core locked page); `website.edit` for every change (inputs disabled, buttons disabled with hover reason, read-only note); `website.publish` for both publish buttons. Tested as owner, s2 (ops), s4 front desk with website set to view, s5 and s7 (locked).
- **Empty workspace**: every design renders with tasteful placeholder homes ("Your first home", house illustration), placeholder review cards with dashed borders, map without pins, and a note with an Add properties button (or Open Properties if the viewer cannot add). Publish checklist adapts. A single new home with only a name and address renders correctly (no price shows "Ask us for rates").

## Data (D.website, config blob, all v3 fields kept)

- v3 fields kept as is: `template, changed, content{headline,sub,cta,story,whatsapp}, featured, sections, pageSections, seo{title,desc}, propertyId, published, log`.
- New optional fields: `home` (shared home section order `[{id,on}]`, null = design order), `social` ({instagram,facebook,tiktok}, null = derived from workspace name), `content.intro`, `content.introTitle`, `content.location`.
- v3 template ids map to the new ones (`harbour→coastal`, `skyline/metro/workstay→urban`, `tropika→tropical`, `mosaic/weekender→minimal`, `highlands→highland`, `concierge/storyteller→editorial`, `postcard→family`, `heritage→heritage`), so old saved sites and old publish log rows display correctly.
- Demo publish history moved to a **demo** blob `D.websiteLog` registered with `O.sync.blob('websiteLog','demo')`, so a new workspace starts "Not published" while the config blob still carries the operator's own settings. `D.website` is now created at module load (not lazily), so it exists before sync and date shifting.
- No date literals in render code; everything uses `D.TODAY` / `D.NOW` (seed log entries at module load only).

## Decisions and why

- One shared section order rather than per-design orders: switching designs must keep the operator's choices.
- Designs differ in layout variants (hero, intro, units, amenities, reviews, location, book, footer variants) plus type, spacing, radius and palette, not just colours, so all eight look like different sites.
- KPI strip from v3 replaced by a lean status bar (v4 asks for a cleaner interface).
- Thumbnails are `div role=button` with an `inert` inner render (a button inside a button is invalid HTML); keyboard Enter/Space opens them.
- The page uses `noDataRerender` and its own `data` listener so typing never loses focus, while changes from other tabs/devices still re-render when nothing is focused.
- Calendar treats today as bookable (same-day check-in) and stops showing booked days with a dash.

## Tested

Desktop 1440, 1280, 1024, phone 390; `--now 2026-10-21T15:40`; empty workspace (spec rule 5) and one bare property; owner, s2, s4 view-only, s5, s7; `--workspace otto`; properties with generated JPEG photos. `tests/shot.py` exits 0 in each case. Interactions checked: use design, edit text, toggle/reorder sections, featured homes, social, SEO, open home in preview, pick dates, book summary, enquiry, FAQ, menu, publish.

## Left / ideas

- Property and About page sections (v3 `pageSections`) are editable, but the property page uses one layout for every home; per-home overrides are not built.
- No per-design custom hero image upload; the hero uses the first featured home with photos.
- Enquiry form and booking are preview only (as v3). Wiring the enquiry into Guest Inbox and checkout into Bookings needs the server.

## Requests for core

1. A shared `O.photoURL(dataUrl)` helper (data URL → cached blob URL). Properties, guest app and website all render the same photos; I wrote a local one (`photoSrc`).
2. Icons for `instagram`, `facebook`, `tiktok`, `snow` (air-con), `bed`, `pan`, `quote` in `O.icon`. Local copies live in `ICX` in website.js.
3. Optional: a `website` badge/notifier hook ("Draft changes not published") for the sidebar, if the lead wants one.

## Other engineers

During the first build, `app/pages/guestapp.js` had a syntax error ("Unexpected end of input"), which stopped the whole bundle. It was fixed by its owner later; the current build is clean.
