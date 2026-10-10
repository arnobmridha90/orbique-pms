# Website builder review (pages/website.js + website.css)

Reviewer, 2026-10-07. Builds to /tmp/v3-website-review/v3.html. Backups of the files as received: /tmp/v3-website-review/bak/.

Fixed:
- Site CSS was global (.nm .tm .sc .cd .hero ...) and leaked into the shell (viewer name centred in the sidebar on every
  page) and the dashboard (check-in rows .nm forced into a centred column). Every site selector is now scoped with
  :where(.wbs) (no specificity change). Script used: /tmp/v3-website-review/scope.py.
- Serif templates (Heritage, Concierge, Storyteller...) did not get serif headings: core h1-h4 beat :where(). Now .wbs :where(h1..h4).
- Concierge (dark skin) calendar start date lost its highlight; key swatch matches the skin.
- Phone calendar shows both months. Narrow main column (Highlands side nav) stacks the location block.
- Mosaic grid left a hole with 6 featured homes: spans now computed for any count (mzSpan).
- KPI subtitles no longer truncated; direct bookings use M.bookingsCreated; fees saved on accommodation (how data.js charges fees).
- "RM 237 x 3 nights = RM 710" rounding mismatch: now "3 nights avg RM 237".
- Weekender: hero shows house facts (amenities were listed twice); strip has a booked/free summary; tapping a free night
  selects it (there is no calendar on that page) and highlights it.
- Carousel arrows were inert spans: now buttons that scroll. Search bar fields open the stays page.
- Big footer listed only 2 of 4 cities: now Destinations + Popular homes. Headings, meta separators, editor template box, brand note.
- Up/down reorder buttons are 36px on phone.
- Template switch toast says what carries over (featured homes, property/about page settings, SEO; headline only if edited).
- Meta description field shows 4 rows. Checked a light custom brand (yellow #F2C14E): buttons and tiles get dark ink.

Left: nothing blocking. Drag-and-drop reorder and per-template copy are possible polish.
