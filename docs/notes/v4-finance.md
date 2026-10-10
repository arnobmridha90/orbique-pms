# v4 Finance, reviews and inbox (builder note)

Owner of: `app/pages/invoices.js`, `app/pages/expenses.js`, `app/pages/financials.js`, `app/pages/reviews.js`,
`app/pages/inbox.js`. No `.css` files were needed: every page keeps its styles in `O.css(...)` as in v3. No other files
were edited.

Tested with `node scripts/build.mjs --local` and `tests/shot.py` on each page:
- desktop and phone (390x844)
- the demo day and `--now 2026-10-21T15:40`
- an empty workspace
- viewers s4, s5, s6 and s7, plus overrides
- scripted interactions: save an expense, cost type suggestion, record payment, bulk send, post a reply, create a task,
  the inbox property filter and notes-only mode

No JS errors come from these pages. All dates are read at render time from `D.TODAY` / `D.NOW`. New ids use `O.uid`.

## What I built

### Invoices
- The stats strip is gone. One "Awaiting payment" card shows:
  - the open amount and count
  - overdue called out in red, or "Nothing overdue" plus the next due date
  - "Show them" (filters the list to open invoices)
  - "See statistics", which goes to `statistics` `{tab:'invoices'}` and is shown only when the viewer may open Statistics
- Create, send, bulk send, record payment, PDF and receipts all work as before. They are gated by
  `invoices.send`, `invoices.payments` and `invoices.settings`.
- Empty states are one sentence plus the main action ("Show all dates", "Clear filters" or "Add a booking").
- Without `bookings.contacts`, the bulk-send rows show a masked phone or email, and the CSV leaves out the Phone and
  Email columns.
- Phone: 40px tap targets, and the table becomes cards.

### Expenses
- The form has a required **Cost type**: radio cards for "Operating expense" and "Capital expense".
  - It is suggested from `D.capexTypes` when the type is picked, with a "Suggested from the type" tag.
  - Once the person picks a cost type themselves, changing the type no longer changes it.
  - One line under the field explains the difference.
  - It can also be changed in the detail modal.
- The list has:
  - a cost filter (All cost types, Operating only, Capital only), also accepted as `params.cls`
  - an Operating / Capital badge on every row
  - operating and capital split totals in the header and footer (hidden when one cost type is filtered)
  - a "Cost type" column in the CSV, plus operating and capital total rows
- KPIs: Operating costs (with change), Capital spending ("kept out of profit"), claims to approve (or "Your claims
  pending"), and Receipts missing.
  - With `expenses.viewAll` they use `M.expenses(from, to, cls)`.
  - Without it they use the viewer's own records.
- Permissions:
  - `expenses.record` shows the form and the "Record expense" action.
  - Without `expenses.viewAll` the person filter is cleared and claims are limited to the viewer's own.
  - `expenses.approve` gates approving and rejecting.

### Financials (owner only: the router blocks others, and render checks `O.isOwner()` again)
- The P&L uses operating expenses only and ends at "Total operating expenses", "Operating profit" and "Operating margin".
- Below that comes the "Capital spending (not in profit)" section, listing the capital types, "Total capital spending"
  and "Net cash".
- "Cash flow by month" adds Capital and Net cash columns and a Capital spending chart series.
  - The current month is marked "Oct*", with "month to date" in the subtitle.
  - The first month shown is the earliest of `D.DATA_START` and the first expense, at most 11 months back.
- The property table has "Operating expenses", "Operating profit" and a sortable "Capital" column.
- "Spending by person" includes capital.
- The CSV and PDF exports carry the same split.
- KPIs: Revenue, Operating expenses, Operating profit (margin) and Capital spending.
- In an empty workspace the page shows one sentence plus "Add your first property" or "Add a booking".

### Reviews
- The top shows only Average rating and Needs reply (with "Show them"), plus "See statistics" (`{tab:'reviews'}`) when
  allowed. The platform, star and subscore panels moved to Statistics.
- Filters, search, property and mention panels are kept, and so is replying.
- Permissions:
  - `reviews.reply` gates editing and posting. Without it a card shows a one-line read-only note.
  - `reviews` edit gates linking a booking.
  - `tasks.create` gates "Create task".
  - Without `tasks.assign` the task is left unassigned, with its own toast.
  - Booking and chat links follow page access.
- Dates are no longer cached in module state, so the page follows the clock.
- Tasks created here get `O.uid('T')`, `createdAt`, `createdBy` and `reviewId`.

### Inbox
- A property filter (All properties, or one property with chat counts).
  - It is remembered with `O.store` key `inbox:prop`.
  - On the phone it is a full-width select.
  - It combines with the chips and search.
  - The empty result names the property and offers "Show all properties", "Clear search" and "Show all chats".
  - Opening `params.bookingId` for a chat outside the filter clears the filter.
- Permissions:
  - `inbox.send` and `inbox.notes` decide the composer modes. With only notes, the composer is in note mode with a
    one-line explanation, and quick replies and the `/` shortcut are hidden. With neither, a read-only line is shown.
  - `inbox.quickReplies` gates managing quick replies.
  - `inbox` edit gates assigning, pinning and marking unread.
  - `invoices.send` gates "Send invoice".
- Guest phone numbers are masked (first 2 and last 2 digits) without `bookings.contacts`, and the call button is
  disabled.
- Without `guestapp.doorCodes`, door codes are replaced with `••••` in bubbles and previews, and a quick reply fills in
  "[door code left out]".
- Chats whose booking no longer exists are skipped.
- Sent messages are stamped with `D.NOW`.
- Phone: the chat fills the screen between the topbar and the tab bar (`fit()` plus CSS), so the composer is never
  behind the tab bar, and every control is at least 40px.

## Decisions and why
- **Missing `costClass` counts as operating.** This is the same rule as `M.expenses`, so page totals match Financials and
  Statistics.
- **Capital stays visible on the Expenses page but out of "Operating costs".** It is spending the owner needs to see,
  but not a running cost.
- **Unknown or removed properties count as "General" in Financials.** This avoids crashes and keeps the totals whole.
- **Invoice amounts are shown to anyone with the invoices section.** `bookings.value` is not checked there, because the
  invoice is the amount.
- **Review tasks are unassigned without `tasks.assign`.** Assigning someone else is a separate right.
- **Door codes are hidden from people without `guestapp.doorCodes`.** Housekeeping can still read and answer chats.
- **Prototype footers now say "not connected in this version"** (invoices, reviews and inbox), in plain English.

## Requests for core
1. **Shared masking helpers.** Add `O.maskPhone` / `O.maskEmail`. inbox.js and invoices.js have local copies.
2. **Unmasked contacts in core views.** The booking drawer, `O.invoice.html` and the `O.invoice.send` dialog show the
   guest phone and email unmasked to viewers without `bookings.contacts`.
3. **Crashes on a removed property.** `O.invoice.html` and `O.invoice.preview` crash when the booking's property was
   removed. They need a fallback like `{name:'Removed property'}`.
4. **Receipt numbering.** `O.invoice.markPaid` always writes `RCP-YYYY-n` and ignores the receipt numbering settings.
   invoices.js still wraps it (as in v3); core should do this itself.
5. **Cost type fallback.** `M.expenses` should fall back to `D.capexTypes` when `costClass` is missing, for imported
   rows. Today a missing value means operating.
6. **`U.empty` button option.** `U.empty` should take a button (label, action), so empty states do not need custom
   markup.
7. **40px phone sizes in core.css.** Make `.btn-sm`, `.btn-xs`, `.chip`, `.select`, `.search`, `.seg button` and
   `.dr-btn` at least 40px tall on the phone. Every page currently repeats the same CSS block.
8. **Phone topbar title.** The title wraps or clips: "Invoices & Receipts" goes to three lines, "Guest Inbox" to two,
   and "Financials" is cut off when actions are present.
9. **Bar height variables.** Add CSS variables for the phone topbar and tab bar heights (for example
   `--topbar-h`, `--tabbar-h`). Full-height pages like the inbox currently hard-code 59px and 61px.
10. **Door code permission alias.** `O.lock.change` still checks the old alias `changeDoorCodes` instead of
    `guestapp.doorCodes`.

## Other engineers' files
- During the work `app/pages/guestapp.js` failed to parse ("Unexpected end of input" in every screenshot). It parses in
  the final build.
- `app/pages/website.css` defines global (unscoped) classes.
- Several other pages still say "Prototype:" in their footers.

## Left to do
- Statistics links assume `{tab:'invoices'}` and `{tab:'reviews'}`. These match statistics.js today.
- The inbox `+` (new chat) button stays visible in an empty workspace. It explains with a toast that there are no
  bookings to chat about.
