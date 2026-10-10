# reports + owner — progress note

## Done
- pages/reports.js: 9 small cards in one row (horizontal scroll under 1200px), each with a headline value; date range
  (past presets, default last 30 days), compare (previous period / same period last month / none), property filter.
  Each report: insight line, KPIs, chart (current = brand, comparison = grey), side panel, sortable table, CSV + PDF
  (card + top bar), schedule-by-email modal. Revenue/Expenses/Tax owner-only (U.locked); money columns hidden for
  non-owners in Pace/Channels/Guests. Ranges clamped to 1 Jun 2026 (data start); comparison dropped if before it.
- pages/owner.js: branded hero with owner + month selectors, unit chips, KPIs (MTD months compare like-for-like days),
  statement (revenue, platform fees, 20% management fee, expenses charged, payout; negative carried forward),
  payouts history with Approve (account owner), revenue vs payout chart, unit performance, messages with manager
  (send + reply), upcoming stays 60 days (first name + initial, no contact) with owner-stay request (availability
  check, creates D.blocks), maintenance log (tasks, repair expenses, maintenance blocks), statement PDF/CSV, copy portal link.
  Money parts locked for non-owner viewers.
- Tested: desktop, 390px phone, Otto, viewer s2, interactions.

## Left
- Nothing required. Possible polish: owner stays approval workflow instead of instant block.
