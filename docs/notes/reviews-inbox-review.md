# reviews + inbox review (reviewer/fixer)

Status: 2026-10-07. Tested both pages (desktop, phone 390, Otto, s2, interactions). Harness: /tmp/v3-reviews-inbox-review/t.py (scratch).

Found (to fix in pages/reviews.js, pages/inbox.js):
- [x] inbox: website.css defines global .tm and .nm -> white box over the recording timer, .nm flex column. Rename to ib-rtm / ib-nm.
- [x] reviews: website.css global .pl-row -> rename to rv-pl.
- [x] inbox: @mention highlight only catches first word (@Wei of @Wei Ling).
- [x] inbox: via label says "Sending" for single-tick sent state.
- [x] inbox: caption placeholder not reset after send.
- [x] inbox: "Checks out today 10:00 AM" for a guest already checked out (status pill says Checked out).
- [x] inbox: new conversation offers guests who already checked out.
- [x] inbox: More menu item wraps (Send invoice INV-...).
- [x] inbox: in-house guests show "No turnover needed" chip (drop clean chip for in-house).
- [x] reviews: phone meta row shows leading "·" on wrapped lines.
- [x] reviews: by-property names wrap; red flag on 8 of 12 (<4.5); use scope average.
- [x] reviews: replied card vanishes instantly under Needs reply filter; keep visible until filters change.
- [x] reviews: zero-result summary "0 reviews have a reply" wording.
- [x] reviews: hard-coded star colour #B7791F (use core .stars class).
- [x] reviews: follow-up task title generic.

Core / other-section issues to report: website.css unscoped .tm/.nm/.pl-row/.pp etc; data.js malformed phones (+60 11844471); RV-903/RV-904 bookingId null; O.readiness "No turnover needed" for in-house.

Update: all items above fixed in page files (not yet: final regression shots). Also added: replied low reviews keep Create follow-up task / Message guest; low reviews link to an open task that already covers the issue (RV-901 -> T-304); follow-up task titles specific (e.g. Check the water heater (2 stars on Airbnb)).

Update 2 (final): all fixes in. Extra fixes after the list above:
- reviews: rating / 5-star share / category deltas shown in absolute points (was % of a %: "17.6% points").
- reviews: unlinked reviews (RV-903, RV-904 have bookingId null in data.js) show "Not linked to a booking · Link booking" (modal of stays at that unit ending in the 3 weeks before the review).
- reviews: suggested reply says what is booked ("Our technician is fixing the air conditioning ... on 7 Oct") while the linked task is open.
- reviews: by-property table fits the side panel (flush card body had padding from .rv-side .card-body).
- inbox: guest photo timestamp overlay was muted text on a dark pill -> white.
- inbox: phone header hides the status pill so the guest name is not cut; sub-line ellipsis.
- inbox: below 1100px the stay strip stays on one line (scrolls) and the quick replies label hides.
shot.py exits 0 for reviews/inbox at desktop, 390, otto, s2 and with --js interactions. Done.
