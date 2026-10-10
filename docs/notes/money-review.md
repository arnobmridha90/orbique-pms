# Money review (invoices, expenses, financials) - reviewer notes

Build: python3 build.py --out /tmp/v3-money-review/v3.html
Helper (scratch): /tmp/v3-money-review/multi.py (multi-step screenshots in one session)

## Status: review done, all fixes applied and retested (desktop 1440, phone 390, Otto, viewer s2).
shot.py exits 0 for all three pages in every variant, no sideways scroll, no oversized SVGs.

## Fixes made
- invoices: renamed .nm/.sb (website.css has a global unprefixed .nm that centred guest names and broke the bulk-send modal)
- invoices: "Send unsent" uses the whole date range, not the status chip (was disabled on "Awaiting payment")
- invoices: KPI subs fit (79 of 82 invoices, 194 foreign nights); record payment label "Payment method"
- invoices: receipt numbering format now applied (wraps O.invoice.markPaid once; default format gives the same number);
  format must end with {seq}; robust next-number parse
- invoices: preview shows a note when SST is on / tourism tax off; Otto "Registration: Not added yet" pill
- invoices: send log includes receipts (time = invoice time on booking day); presets add this month, last quarter
- invoices: phone - preview amounts no wrap, menu clamped inside viewport
- expenses: 6 KPIs with copy that fits (short category names, "vs prior 30 days" / "30d" on phone); dropped "Per property"
- expenses: amounts show cents when they have them; first names "Wei Ling"; reject needs a reason
- expenses: rejected claims stay listed (struck amount) but are out of every total (same rule as Financials)
- expenses: "Add receipt photo" in the detail modal; owner's pending claim rows open the detail (to see the receipt)
- expenses: arriving from Financials with a person scrolls to the filtered list
- financials: negative margins red with a real minus; spark lines on all 4 cards; shorter compare text on phone
- financials: PDF by-property and by-person tables get total rows; phone property column narrower

## Left / for the lead (core or data, not editable here)
- data.js: Oct 1-6 expenses RM 6,153 vs Sep 1-6 RM 552 (+1,015%) because October gets ~a month of items in 6 days
- core: O.invoice.markPaid ignores numbering (wrapped from invoices.js); bookings.js nextNo ignores invoice pattern
- core: M.expenses / expenseTotal count rejected claims (dashboard/reports will differ after a rejection)
- website.css: global .nm, .nm b, .nm span rules leak into every page
