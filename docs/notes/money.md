# Money section (invoices, expenses, financials)

Build: python3 build.py --out /tmp/v3-money/v3.html

## Status: all three pages done and tested (desktop 1440, phone 390, Otto, viewer s2)
- Shared init block (copied in each file, guarded by D._moneyReady): claimStatus on claim expenses
  (pending <=10 days old, approved <=18, else reimbursed), D.invoiceSettings.
- invoices.js: rule note, KPIs, invoice-date range, status chips (honours params.status e.g. 'notsent'),
  platform/property/search, table (view invoice/receipt, record payment, send, PDF menu), bulk send with
  channel per guest, "Send unsent", CSV, settings (auto-send, numbering, company, tourism tax, SST), preview, send log.
- expenses.js: record form (Others -> required field, claim note, receipt photo w/ thumbnail, paid-by locked for
  non-owners), claims approval panel (owner) / your claims (staff), by type + by person, list with filters,
  detail modal (approve/reject/paid back/delete), CSV. Params: person, claim, preset, from/to.
- financials.js: 4 KPI cards, compare toggle, PDF + CSV, monthly chart + table, P&L, tourism tax,
  expenses by person (click -> Expenses filtered), by property (sortable).

## Left / ideas
- Numbering + SST settings are stored but core O.invoice ignores them (core gap).
