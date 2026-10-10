# tasks / staff / automations — review + fix pass

Build: python3 build.py --out /tmp/v3-tasks-staff-automations-review/v3.html
Screens: /tmp/v3-tasks-staff-automations-review/

## Status
- [x] Read SPEC + all three page files, screenshots taken (desktop, phone, otto, s2/s3/s5/s7, modals)
- [x] tasks.js fixes T1-T8 done (short names in selects, list fits 1440, Board/List moved to summary row, phone column switcher, O.can('tasks') lock + view-only mode, params reset filters, duplicate note hidden)
- [x] staff.js fixes S1-S6 done (+ phone card rows for Team, phone role picker for the matrix, audit time on phone, matrix aria labels)
- [x] automations.js fixes A1-A7 done (+ door code chain as numbered list with held-now note, v2 late check-out offer kept, future-stamped bookings ignored)
- [x] Re-test everything, shot.py exit 0 (tasks/staff/automations x desktop/phone/otto/s2 + s3/s5/s7 + flows: invite, matrix, exceptions, bulk assign, params). Workload strip now reads "2 of 3 open"; phone shows "You".
- [x] Final StructuredOutput to lead sent

## Defects found
Tasks
- T1 card/list assignee select text truncated ("Wei Ling Tan · 1 ope"); use short names
- T2 data note "Overdue since yesterday" duplicates the due label on T-307
- T3 list view wider than 1440 viewport (actions column cut off); merge checklist into status
- T4 filter row wraps search onto 2nd line on desktop; move Board/List to the summary row
- T5 phone: board is 3 stacked columns (very long); add a column switcher when stacked
- T6 accountant (tasks = None in matrix) still sees the whole board; respect O.can('tasks')
- T7 workload names truncated on phone; show short names there
- T8 params from dashboard keep stale filters; reset on fresh params
Staff
- S1 Team member cell rendered as a big centred box: website.css has a global `.tm` rule (website's bug) -> rename our classes
- S2 phone: team table scrolls sideways, Manage button off screen -> card rows on phone
- S3 removed members still look like suspended members; counts include them
- S4 invite preview grammar "as Housekeeping"
- S5 sentLog entries attributed to whoever is viewing now; stamp at send time
- S6 seed "Created 4 turnover tasks for today's check-outs" but there are 3 check-outs -> compute
Automations
- A1 housekeeping/accountant (automations = None) still see everything; respect O.can
- A2 invoice/receipt rules not linked to Invoices settings (D.invoiceSettings.autoInvoice/autoReceipt)
- A3 damage count double-counts T-308 (report + note)
- A4 "problem message" count has a hard-coded +3
- A5 same-day feed claims "urgent turnover for Siti Aminah" at KLCC but no such task; link real tasks
- A6 "Invoice for Hafiz not sent: confirmed before the invoice rule ran" is not believable; receipts paid today not explained
- A7 Paused pill uses info tone; edit-step preview ignores chosen sample booking

## Report to lead (core / other sections)
- website.css: global unprefixed selectors (.tm .nm .sc .cd .tl .pp .zz .wf .wh .hero ...) leak into other pages
- data.js: Isabella Garcia (19:23) and Ravi Shankar (17:33) bookings have createdAt after NOW
- data.js: bookings paid today never get receiptSent (only paid >= 1 day ago)
- core: D.sentLog entries have no `by`; staff.js stamps it on data events
- core router does not enforce section permissions; each page calls O.can itself
- shell: sidebar background stops at 100vh in full-page screenshots
