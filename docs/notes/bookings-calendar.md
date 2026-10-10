# Bookings + Calendar (section agent note)

Owner of: pages/bookings.js, pages/calendar.js

## Status: done (tested desktop 1440/1280/1024, phone 390, Otto, viewer s2, interactions; shot.py exits 0)
- bookings.js: verified + fixed (table fits 1440/1280, nights/guests fold into stay cell <=1300px, 7 KPIs,
  same-day badge on guest sub-line, phone chip labels, New booking opens on first free 2-night window).
- calendar.js: timeline with sticky 120px property column (92px phone), day columns fit width (scroll below 22px/day),
  auto row density 52->22px + Auto/Comfortable/Compact, "Preview with more properties" 12/30/60 (demo units local
  to calendar.js, never in O.data), status-coloured bars with platform logos, hatched blocks, weekend shading,
  today column + now line, event dots, half-day offsets, booked-units footer row, legend, tooltip, click bar ->
  O.booking.open, click free night -> menu (New booking via O.newBooking / Block dates), block edit/remove.
- Exposes O.newBooking (bookings.js) and O.blockDates (calendar.js) for other sections.

## Left / ideas
- Drag to create or move bookings is not implemented.
