# reports + owner — review/fix note (reviewer)

Originals backed up at /tmp/v3-reports-owner-review/*.orig.js (scratch, may be gone).

## Done (reports.js)
- Chart card now fills the height of the side panel (grid measured unstretched, then stretched).
- Card subs shortened (no truncation): "Airbnb share", "181 foreign nights".
- Insight wording "down 8.0%" instead of "−8.0%"; pace sentence no longer claims urgent turnovers.
- Channels: OTA commission excludes direct card fees; fee note built from D.channels; lead/cancel totals; "Lead (days)".
- Reviews "Low" column renamed "1–3 stars"; ops back-to-back sub shortened.
- Renamed .side-foot (clashed with shell .side-foot) to .rp-sfoot; numeric cells nowrap on phone.
- Compare control: short labels on phone; money axis "RM 12.5k"; weekly buckets end on the last day.

## Left
- owner.js: layout balance (stacks), upcoming table compact, hero logo tile, revenue split bar,
  expense charge rule, reply always available, rateOf overrides.
- Re-test everything (desktop, phone, otto, s2, interactions).
