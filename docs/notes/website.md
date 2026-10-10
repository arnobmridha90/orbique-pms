# Website builder (pages/website.js + pages/website.css) — progress

State lives in D.website (in memory). Templates = TPL array (12), each with its own hero (HERO map), header/footer variant,
skin class and section mix; generic sections in SEC with variants. Extra pages: propertyPage(), aboutPage().
Previews scale with CSS zoom ([data-fit] -> fitAll); the site is responsive through container queries (.wbs is the container).

Done (tested desktop 1440, phone 390, Otto workspace, viewer s2 and s3, coral brand via O.theme.apply):
- Gallery: 12 live thumbnails, style filter chips with counts, preview / use template, the 2 extra pages shown in current style
- Full-screen preview (page tabs, desktop/phone, Esc closes), clickable site (nav, property cards, calendar date picking, booking quote modal,
  FAQ accordion, enquiry toasts, WhatsApp link in new tab)
- Editor: page tabs, section show/hide + reorder (home per template, property, about), headline/sub/CTA with counters,
  featured properties, preview property, story + WhatsApp number, SEO title/description + Google snippet, publish card + history
- Publish modal with checks (simulated), KPI strip (direct bookings, share, fees saved owner-only)
- Access: O.can('website','view'/'edit'): read-only note for view, locked box for none

Left: nothing required. Possible polish: drag-and-drop reorder, per-template copy overrides.
