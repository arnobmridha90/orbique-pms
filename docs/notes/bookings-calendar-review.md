# Bookings + Calendar review (reviewer/fixer note)

Owner of: pages/bookings.js, pages/calendar.js (review pass)

## Done
- Started review: read SPEC section 7, builder note.

## Left
- Build checklist, screenshot desktop/phone/otto/s2, exercise modals, fix defects.
- bookings.js fixed (pass 1): needs-action rule tightened (pending / invoice not sent / ID pending within 3 days) + tooltip;
  summary line counts live bookings like the KPI; params from calendar reset Match on to stay dates; validation errors
  visible (scroll + focus); phone: guest cell aligned, invoice chips in a row, availability box first in modal;
  KPI strip wraps 4+3 between 961-1140px instead of truncating values.
- calendar.js fixed (pass 1): bar labels measured with canvas (no "Sa…" fragments; logo only when the first name
  does not fit), block labels full/short/icon, cancelled bars solid (white text readable), sticky property column
  above hovered/focused bars (z-index 6), narrow() matches the CSS breakpoint, legend groups wrap as units and the
  sample bar no longer wraps on phone, day menu says "Free for N nights (until X)", "Blocked" subtitle when a unit has
  no available nights, prev/next move by whole months for month ranges, phone tap targets for density/preview segs.
- bookings.js fixed (pass 2): table fits without sideways scroll at every width >= 761px (compact columns <= 1420px;
  readiness folds into the invoice cell and platform shows logo only at 761-1240px); phone: lead-time KPI hidden,
  "+ Booking" sits in the group header corner.
- Tested: desktop 1440/1366/1280/1024, 760, phone 390, Otto, viewer s2; new booking (unpaid, paid, send window,
  validation, clash), block create/edit/remove, day menu, tooltip, preview 30/60, densities, 1/14/30/90-day ranges,
  month prev/next, property click -> Bookings. shot.py exit 0 everywhere.

- Event dots use --accent-text (the pale Otto accent was nearly invisible on white).

## Status: review done. Left: nothing blocking. Ideas only: drag to create/move bookings.
