# Pricing review: progress note (reviewer/fixer)
Owner file: pages/pricing.js (CSS inside via O.css). Build: `python3 build.py --out /tmp/v3-pricing-review/v3.html`.

## Status: DONE (all fixes applied and re-tested; shot.py exits 0 for desktop, phone 390, otto, otto phone, s2, s3, s4 and interaction chains)
- Factor chains verified to sum exactly to the suggestion for all 188 open nights (12 properties, next 30 days)
- NaN/Infinity sweep across today/tomorrow/next7/30/90 for all 12 properties: clean
- No table overflows at 1440 for any property/range; no sideways scroll at 390

## Fixed
1. All-blocked range (Orchid 4 + Today) showed RM 0 / "RM Infinity" / index 0: now dashes and plain reasons; portfolio row says Blocked
2. Plurals ("1 of 1 night"), impact KPI wording, top button ("No open nights to price", "Apply 1 suggestion"), ±0% instead of −0%
3. Chart empty state no longer shows legend; y-axis now fits the data (baseline offset + yMin) in both chart modes
4. Market strip: min/avg/max labels were not aligned with positions; now an average ring + legend + plain-English sentence, in its own "Market on <night>" card under the chart (balances the two columns)
5. Comp table: no "2 BR" wrap, core star colour, "You" pill, occupancy/avg tooltips, empty-range dashes
6. WKND -> Weekend; event insight rewritten per event (booked/open/blocked nights); under-market insight says why
7. Apply-all now a proper modal (ups/downs, expected and full impact, biggest changes, channel note)
8. D.priceOverrideMeta records how a price was set: "Suggestion applied" vs "Set by you"; filter renamed "Changed by you"
9. Booked night panel rebuilt (booked rate, market avg, model today, lead time, stay vs market verdict, LY/2Y, revenue); blocked panel shows block dates, market and model rate
10. Save price no-op detection; empty rule fields rejected; last-minute window must be whole days <= 14
11. Permissions via O.can (staff.js): no pricing view -> locked card; view only (front desk s4) -> read-only with notes
12. Rule changes, resets, auto-apply toggles and price changes logged to D.priceLog ("Recent changes") and D.auditLog (cat 'pricing')
13. Waterfall has a scale under the bars; 7-night example only when the 7 nights are free
14. Keyboard access: night dates and portfolio property names are buttons

## Left
- Nothing blocking. Competitor exclusions/selected night/filters are page state (reset on reload) like the rest of the prototype.
