# Pricing page: progress note
Owner file: pages/pricing.js (CSS inside via O.css). Build: `python3 build.py --out /tmp/v3-pricing/v3.html`.

## Done (tested desktop, phone 390, Otto, viewer s2; shot.py exits 0)
- Property select + future date range (default next 30 days); honours ctx.params.propertyId / date
- KPI strip: our avg (vs LY), comp avg, price index, on-the-books vs market pace, avg suggested, expected impact
- Chart: our vs comp avg + min–max band + suggested (dashed); toggle to this year vs LY vs 2Y; click selects a night
- "What stands out" insights list with links to nights
- Reasoning panel: factor chain (base, season, weekend, event, competitor gap, booking pace, days until arrival, orphan, min/max, rounding) that sums exactly; market dot strip; apply / set own price / revert; LOS example
- Night table: select + apply to D.priceOverrides[pid][iso] (numbers, read by bookings/calendar), filters, CSV export, apply-all with confirm
- Competitor set: include/exclude, sortable, price on selected night; simulated-data note
- Same-date history (selected night + weekday bars over 3 years)
- Pricing rules (D.pricingRules[pid]) with validation, reset, copy to all, auto-apply switch; recent change log (D.priceLog)
- All-properties table (click to switch)

## Left / ideas
- Booked-night panel could show what the model would have charged
