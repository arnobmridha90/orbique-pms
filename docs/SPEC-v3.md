# Orbique Command Center v3: build spec

Orbique Command Center is the property management system Orbique is building. Otto (Arnob's short-term rental business) subscribes to it. This is a clickable HTML prototype: no backend, all data is demo data generated in `data.js`, and every change a user makes lives in memory until reload. It must still feel like a real, polished product.

"Today" in the prototype is **Tuesday 6 October 2026, 10:15 AM**, Malaysia. Money is **RM** (Malaysian ringgit). 12 properties in Penang, Kuala Lumpur, Cameron Highlands and Melaka.

## 1. Files

```
v3-src/
  data.js        shared demo data + metrics (window.O.data, O.metrics, O.d)   DO NOT EDIT
  core.js        runtime, components, brand engine, booking drawer, invoices, door codes   DO NOT EDIT
  core.css       design system + tokens   DO NOT EDIT
  shell.html     app shell   DO NOT EDIT
  build.py       concatenates everything into one HTML file
  pages/<id>.js  one file per section (yours)
  pages/<id>.css optional CSS for your section (or call O.css(id, text) from your JS)
  tools/shot.py  screenshot + JS error check
```

Build and test (always build to YOUR OWN output path, never the default, because other people are building at the same time):

```
cd /mnt/project-files/orbique-app/v3-src
python3 build.py --out /tmp/v3-<yourname>/v3.html
python3 tools/shot.py --html /tmp/v3-<yourname>/v3.html --page <id> --out /tmp/v3-<yourname>/<id>-desktop.png --full
python3 tools/shot.py --html /tmp/v3-<yourname>/v3.html --page <id> --width 390 --height 844 --out /tmp/v3-<yourname>/<id>-phone.png --full
python3 tools/shot.py ... --js "document.querySelector('[data-act=new]').click()" --out ...   # interact, then screenshot
python3 tools/shot.py ... --viewer s2      # view as Wei Ling Tan (ops manager, not an owner)
python3 tools/shot.py ... --workspace otto # Otto workspace: brass brand, black text on brass buttons
```

`shot.py` exits 1 and prints the error if the page throws or logs `console.error`, and warns if the phone layout scrolls sideways. Look at every screenshot you take (Read the PNG). Other sections may be half-built while you work; that is fine because every page runs in its own `<script>`.

Only create or edit files for the pages you own. If you find a bug in data.js / core.js / core.css, do not edit them: work around it inside your page and report it.

## 2. Page module contract

```js
(function () {
  var O = window.O, D = O.data, M = O.metrics, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;
  var st = { /* this page's UI state survives re-renders (filters, selected tab, etc.) */ };
  O.css('bookings', `/* page CSS, prefix every selector with .pg-bookings */`);
  O.page('bookings', {
    desc: 'One-line description shown under the page title',
    render: function (root, ctx) {
      // ctx.params      params passed by O.go('bookings', {...})
      // ctx.setActions(htmlOrNode)  fills the action area at the top right of the top bar (primary buttons, export)
      // ctx.on(evt, fn)  subscribe to O events; auto-removed when the user leaves the page
      root.innerHTML = '<div class="pg-bookings">...</div>';
      // then wire events (prefer one delegated listener on root)
    }
  });
})();
```

- The router calls `render` every time the page is opened, and again when the brand, workspace, viewer, language or data changes (`O.emit('data')`). Render must be idempotent: rebuild from `st` + data each time.
- After changing data (adding a task, sending an invoice, etc.) call `O.emit('data', {type:'...'})` so badges and other open views refresh. Data changes are in memory only.
- Navigation: `O.go(pageId, params)`. Page ids: dashboard, bookings, calendar, reviews, inbox, tasks, pricing, automations, invoices, expenses, financials, reports, website, guestapp, owner, staff, brand.
- New arrays your page needs go on `O.data` defensively: `D.damageReports = D.damageReports || [];`.
- The topbar title comes from the nav label; do not repeat the page title as an h1 inside the page.

## 3. Data (`O.data` = D, `O.metrics` = M, dates `O.d`)

Dates are ISO strings `'2026-10-06'`. `O.d`: add(iso,n), diff(a,b) (days from a to b), dow, dowName, isWeekend (Fri/Sat nights), day, month, year, monthStart, monthEnd, addMonths, addYears, sameWeekdayYearsAgo(iso,n), range(from,to), fmt ('6 Oct'), fmtY ('6 Oct 2026'), fmtDM ('06/10'), fmtRange(a,b), monthName(iso,long).

- `D.TODAY` '2026-10-06', `D.NOW` '2026-10-06T10:15', `D.NOW_TIME` '10:15'.
- `D.properties[]` {id, name, short, type, beds, area, base (base nightly RM), owner (property owner name), housekeeper (staff id), lockCode (master code), lockBrand, wifi:[name,pw], parking}. `D.propById[id]`.
- `D.staff[]` {id, name, initials, role ('owner'|'ops'|'housekeeping'|'frontdesk'|'maintenance'|'accountant'), roleLabel, phone}. s1 Mei Fen Lim is the Account owner. `D.staffById(id)`.
- `D.channels` {airbnb, booking, agoda, vrbo, direct} each {id, name, feePct}; `D.channelOrder`.
- `D.bookings[]` (≈417, 1 Jun 2026 – 31 Jan 2027) {id 'BK-41xx', propertyId, guest:{name, country, countryName, foreign, phone, email}, guests, channel, checkIn, checkOut, nights, checkInTime 'HH:MM', checkOutTime, createdAt 'YYYY-MM-DDTHH:MM', nightly, accommodation, cleaningFee, tourismTax (RM10/night for foreign guests), total (what the guest pays), platformFee, payout, revenue (accommodation + cleaning; this is the revenue figure every page uses), status 'checked_out'|'checked_in'|'confirmed'|'pending'|'cancelled', idVerified, codeStatus 'sent'|'scheduled'|'held'|'expired'|'cancelled', doorCode, sameDay (booked today for arrival today), notes, invoiceNo, invoiceDate, paidAt|null, receiptNo|null, payMethod, invoiceSent {via, at}|null, receiptSent|null}. `D.booking(id)`.
  - Story for today: check-outs Ahmad Razak (bf3b), Lukas Brandt (or4), James Cole (bf1a). Check-ins known before today: Sarah Tan (bf3b, 12:00 early), The Reyes Family (mrs, ID pending, code held), Daniel Wei (hv2). **Same-day bookings** confirmed this morning for arrival today: Hafiz Aziz (bf1a, booked 9:02, arrives 12:00, ID pending, invoice not sent), Emma Laurent (kls, booked 9:47, arrives 15:00).
- `D.blocks[]` {id, propertyId, start, end (exclusive), type 'maintenance'|'owner', note}.
- `D.tasks[]` {id, title, type 'Turnover'|'Maintenance'|'Inspection'|'Restock', propertyId|null, assigneeId|null, due 'YYYY-MM-DDTHH:MM', priority 'high'|'medium'|'low', status 'todo'|'in_progress'|'done', checklist [done,total]?, note?, photos?, doneAt?}.
- `D.reviews[]` (≈168) {id, bookingId, guest, country, propertyId, platform 'airbnb'|'booking'|'agoda'|'vrbo'|'google', stars 1–5, date, text, tags[], sub {cleanliness, communication, checkin, accuracy}, reply {text, date, by}|null}. 25 need a reply.
- `D.conversations[]` {id, bookingId, unread, pinned?, messages:[{from 'guest'|'staff'|'note'|'system', staffId?, type? 'text'|'voice'|'image'|'file', text, duration?, size?, time}]}.
- `D.quickReplies[]` {id, title, text (may contain {wifi_name} {wifi_password} {property} {parking} {checkin_time} {guest_first} {door_code}), propertyIds [] (empty = all units)}.
- `D.expenses[]` (Jun–6 Oct 2026) {id, date, propertyId|null, type (one of D.expenseTypes; 'Others' has otherType), amount, paidBy (staff id, includes s1 the owner), method (D.payMethods), receipt bool, note}. `D.expenseTypes`, `D.payMethods`.
- `D.events[]` {date, end, name, areas[], lift} local demand events (demo).
- Pricing: `D.rateFor(pid, iso, yearsAgo)` our nightly rate (yearsAgo 0, 1, 2); `D.eventFor(pid, iso)`; `D.compSet(pid)` 7 competitor listings {id, name, beds, distanceKm, rating, reviews, channel, priceFactor, occ}; `D.compPrice(comp, pid, iso)`.
- `D.lockLog[]` door code changes, `D.sentLog[]` documents sent.
- `D.rng(seed)` seeded random (returns a function), `D.hash(str)` – use these instead of Math.random so numbers are stable.

`O.metrics` (M) — use these so every page agrees: revenue(from,to,{propertyId,channel}) (revenue of nights in range, inclusive), nightsSold, blockedNights(from,to,pid), availableNights, occupancy(from,to,pid), adr, revpar, dailyRevenue(from,to,f) → [{date,value}], bookingsCreated(from,to), stays(from,to,{propertyId,status}), expenses(from,to), expenseTotal(from,to), platformFees(from,to), avgRating(from,to,pid), nightsIn(booking,from,to), live(booking).

## 4. Core API (core.js)

- `O.esc(str)` always escape user/data text in HTML. `O.$`, `O.$$`, `O.html(str)` → element.
- `O.fmt`: money(n,{dp}) 'RM 1,234', moneyShort, num, pct(x), change(cur,prev) → fraction, changeText(c) '+8.6%', time('15:00') '3:00 PM', dateTime(iso), ago(iso), plural(n,'night'), initials.
- `O.ui` (U):
  - `U.kpis([{label, value (html), sub, delta (fraction), deltaOpts:{invert}, spark:[numbers], hl}])` compact KPI strip; all cards on one line on desktop.
  - `U.dateRange({preset:'mtd'|..., from, to, presets:'past'|'future'|'both'|[keys], onChange({from,to,preset,label}), align:'right'})` → element. Mount with `U.mount(root, 'slotName', el)` where your HTML contains `<span data-slot="slotName"></span>`. Preset keys: today, yesterday, tomorrow, last7, last30, last90, next7, next14, next30, next60, next90, mtd, thisMonth, lastMonth, nextMonth, lastMonthToDate, qtd, lastQuarter, ytd, last12m, since. `U.preset(key)` → {from,to,label}. `U.rangeLabel(from,to)`.
  - `U.modal({title, sub, body (html|node), size:'wide'|'xwide', actions:[{label, kind:'primary'|'ghost'|'danger', onClick(close, el) → return false to keep open}], onOpen(el, close)})`, `U.confirm(msg, okLabel)` → Promise<bool>, `U.drawer({title, sub, body, foot, onOpen})`, `U.toast(msg, 'ok'|'bad')`.
  - `U.status(status)` booking status pill (fixed colours), `U.statusLabel`, `U.pill(text, 'ok'|'warn'|'bad'|'info'|'neutral'|'brand'|'accent')`, `U.plat(channelId, {icon:true})` platform badge with name, `U.platIcon(id)` round platform logo only, `U.platName(id)`, `U.avatar(name, 'sm'|'lg')`, `U.stars(n)`, `U.delta(fraction, {invert})`, `U.empty(msg)`, `U.locked(what)` owner-only placeholder, `U.seg([[value,label]], current, 'data-attr')` segmented control HTML, `U.propOptions(selected,{all:'All properties'})`, `U.staffOptions(selected,{none:'Unassigned'})`, `U.propColor(pid)`.
- `O.chart` (charts follow the dataviz rule: the current period uses the brand colour, comparison periods are grey, one y-axis only, hover tooltips built in):
  - `O.chart.line(el, {labels, series:[{name, short, values, tone:'brand'|'prev1'|'prev2'|'accent'|'ok'|'bad'|'info', dash, width}], height, yFormat(v), xFormat(label,i), tipTitle(i), band:{lo,hi,name}, area, directLabels, markers:'all'|'none', yMin})`
  - `O.chart.bars(el, {labels, series:[...], height, yFormat, xFormat, tipTitle, stacked})`
  - `O.chart.spark(values, {tone, h})` → SVG string; `O.chart.hbars([{label (html), value, display, tone}], {max})` → HTML; `O.chart.legend([{name, tone, square, dash}])` → HTML.
  - Call chart functions AFTER the container is in the DOM (it measures width). Give the container an explicit height-free div.
- Files: `O.downloadCSV(filename, rows)` rows = array of arrays incl. header; `O.download(filename, data, mime)`; `O.pdf.report({filename, title, subtitle, summary:[[label,value]], columns:[{label, w (mm, total 186), align:'right'}], rows, boldLast, notes})` branded A4 PDF; lower level `O.pdf.start(title, subtitle)` → Promise<{doc (jsPDF), y}>, `O.pdf.table(doc, y, columns, rows, {boldLast})` → y, `O.pdf.text(doc, y, text, {bold, size, muted})` → y, `O.pdf.save(doc, filename)`. In the real artifact downloads go through the viewer's confirmation prompt.
- `O.booking.open(id)` booking drawer (stay, readiness, guest, payment, invoice/receipt with send, change door code, message guest). Use it whenever a booking is clicked anywhere.
- `O.invoice.html(b, 'invoice'|'receipt')` branded document HTML, `O.invoice.preview(b, kind)` modal, `O.invoice.pdf(b, kind)`, `O.invoice.send(b, ['invoice','receipt'])` send modal (WhatsApp or Email), `O.invoice.markPaid(b, method)`, `O.invoice.statusHTML(b, kind)`, `O.invoice.lines(b)`.
- `O.lock.change({propertyId, bookingId, scope:'guest'|'master'})` change-door-code modal (also on the key button in the top bar). `O.lock.activeBooking(pid)`.
- `O.readiness(b)` → [{key,label,state}], `O.readinessHTML(b)` arrival readiness chips.
- `O.notifications()`, `O.viewer()` current staff member, `O.isOwner()` true only for the account owner, `O.ws()` current workspace {name, legal, domain, logo (data URL), brand}, `O.theme.logoHTML(ws, onBgHex)`, `O.theme.current` {primary, accent, tokens}, `O.theme.get('--brand')`, `O.color.ink(hex)` white or near-black text for a fill, `O.color.mix(a,b,t)`.
- `O.icon(name)` inline SVG. Names: dashboard bookings calendar star chat tasks pricing automations invoices expenses financials reports website guestapp owner staff brand key bell lang search download plus x chevron left right clip mic send camera lock edit trash eye clock home play alert check up down more menu filter upload mail whatsapp image file refresh sparkle car sim card rules video map wifi user copy printer.
- `O.store.get/set(key, val)` per-viewer convenience only (wrapped in try/catch).

### Core additions from the integration pass (2026-10-07)
- Router: `ctx.onLeave(fn)` runs before the next render (stop timers, recorders, observers). The router now enforces Staff Access: a section whose level is 'none' for the viewer (`O.can(id,'view')`) shows `U.locked(name, {reason:'permission'})`, and the menu shows a lock. `O.can`, `O.permLabel`, `D.rolePerms` and `D.staffMeta` live in pages/staff.js but load before any render.
- `U.locked(what, {reason:'permission'})` reads "Only account owners can see the …" or "Your access does not include the …".
- `U.confirm(question, okLabel, kind, title)`: short questions sit in the title, longer ones get a title plus body. Escape closes only the top modal.
- `U.platIcon(id, title, size)` optional pixel size. `U.delta` shows "0.0%" for no change. Icons added: pin, pause, phone.
- Charts: `yMax` option; finer axis rounding; whole-number ticks for small counts; left padding sizes itself to the labels unless `padLeft` is given; bars draw negative values below a zero line; tone 'bad' = `--c-bad`.
- `O.lock.change({…, onDone(result)})` callback after a successful update; it refuses viewers without the "Change door codes" permission. Log entries carry `by`.
- Readiness: "Unit ready" (no turnover that day), "Checked in", "No clean booked" (arrival today after a check-out with no task), "Clean set for check-out day" (future).
- Data: phone numbers are full-length per country; no booking is created after NOW; expenses are spread evenly through each month and all have notes; `M.expenses` leaves out rejected claims; story conversations and reviews link to the stay nearest today.

## 5. Colour rules (Arnob's requirement, non-negotiable)

The interface takes its colours from the workspace logo. **Never hard-code a brand colour.** Use only these tokens:

| Changes with the brand | Use for |
|---|---|
| `--brand` + `--brand-ink` | primary buttons, selected chips/tabs/segments, active states, filled brand surfaces (text on them MUST use `--brand-ink`) |
| `--brand-hover` | hover of brand fills |
| `--brand-strong` | chart line/bar of the current period, icons, borders, progress fills, focus |
| `--brand-text` | brand-coloured text and links on white |
| `--brand-soft`, `--brand-soft-2` | pale highlight backgrounds (text on them: `--text` or `--brand-text`) |
| `--accent` + `--accent-ink`, `--accent-soft`, `--accent-text` | badges, counters, secondary highlights |

| Always fixed | Tokens |
|---|---|
| Page/card/border neutrals | `--bg --surface --surface-2 --border --border-strong` |
| Text | `--text --text-2 --muted --faint` |
| Signals | `--ok/--ok-soft --warn/--warn-soft --bad/--bad-soft --info/--info-soft` |
| Booking status (calendar bars, pills) | `--st-confirmed --st-inhouse --st-pending --st-past --st-cancelled --st-block`, each with `-ink` for the text on it |
| Chart comparisons | `--c-prev1 --c-prev2 --c-grid --c-axis` |
| Platform badges | `U.platIcon` / `U.plat` (Airbnb, Booking.com, Agoda, Vrbo, Google keep their own colours; Direct uses the brand) |

Text rule: white text on dark fills, near-black on light fills. For any fill that is not one of the tokens above, compute the text colour with `O.color.ink(hex)`. Test your page in both workspaces (`--workspace otto` gives a brass brand where button text is black).

## 6. Design and writing rules

- Compact, analytical, calm. Card grid with 14px gaps; KPI strips via `U.kpis` (one line). Prefer tables with sortable or filterable columns over long card lists for data-heavy views. Use existing classes from core.css (card, card-head, card-body, table, table-wrap, toolbar, chips/chip, seg, tabs, btn btn-primary/btn-ghost/btn-sm, field, form-grid, input, select, textarea, pill, note, list-row, kv, grid g2/g3/g4/g-2-1, section-title, empty, hbar, legend, progress, switch, check).
- Every list/table must have a sensible empty state. Every number must come from `O.data` / `O.metrics` so pages agree.
- Phone (390px wide) must work: no sideways page scroll (wrap wide tables in `.table-wrap`), tap targets ≥ 36px, toolbars wrap.
- Plain English, sentence case, no lorem ipsum, no "coming soon". Things the prototype cannot really do (send WhatsApp, charge cards, read live competitor prices, post to Airbnb) still work in the UI (update state + toast) and are stated once in a small note where relevant, e.g. "Prototype: messages are not really sent."
- Accessibility: buttons are `<button>`, inputs have labels, icons-only buttons have aria-label, colour is never the only signal (status pills have text).
- No external images, no iframes, no external scripts. Draw illustrations with CSS/SVG. Links to external sites open in a new tab.
- Charts: one y-axis per chart; current period in brand colour, comparisons in grey; legend when ≥ 2 series; direct labels sparingly.

## 7. Requirements per section (Arnob's words first, then the detail to build)

### Dashboard (`dashboard`)
Arnob: "Needs to be more analytical and have much more in depth statistics. These stats seem shallow. Revenue in the dashboard can show comparison between months. For example if it is 06/10 today, it can show revenue in the last 2 months from 01/08 to 06/08 and 01/09 to 06/09 and also how the total revenue compares to the revenue during the same period in the last two months. Must be revenues from first day of the month till today. Today's Tasks: Just need to see the incomplete tasks. No need to show completed tasks. Need another section for check-ins for bookings that were confirmed on the same day. For example till 8 in the morning I knew there were 3 check-ins. If a new booking is confirmed at 9am and new check-in is at 12 noon, I want a different section in the dashboard for this."
- Hero: **Month-to-date revenue comparison**: 01/10–06/10 vs 01/09–06/09 vs 01/08–06/08 (always day 1 → today's day number, computed from D.TODAY, never hard-coded). Show the three totals, % change vs each previous month, a cumulative daily revenue line chart (day 1..6; current month brand colour, previous months grey), and a comparison table with Revenue, Nights sold, Occupancy, ADR, RevPAR, Bookings made, Avg length of stay for the three periods with deltas. A toggle between "Earned (nights stayed)" and "Booked (new bookings made in the period)" is a plus.
- Analytical KPI strip (compact, one line): e.g. occupancy tonight, occupancy MTD, ADR MTD, RevPAR MTD, on-the-books for the rest of the month, avg lead time, cancellation rate, avg rating (30d).
- **Check-ins today** (known before today) and a separate **Same-day bookings** section (checkIn = today AND created today): show booking time → arrival time, time left to prepare, readiness (clean / ID / door code), owner of the turnover, quick actions (open booking, change door code, send invoice, assign clean). Make clear these were not on this morning's list.
- Check-outs today.
- **Today's tasks: only incomplete** (todo + in progress, including overdue from earlier days, flagged). Reassign from the dashboard (assignee dropdown).
- More depth: next 14 days occupancy by property (heat strip), revenue by property MTD vs same days last month, channel mix MTD (share + commission paid), booking pace (bookings made per day last 14 days vs previous 14), alerts (reviews needing reply, unassigned tasks, pending bookings, invoices not sent).
- Revenue and money panels are owner-only: when `!O.isOwner()` show `U.locked('Revenue')` in those panels (operations panels stay).

### Bookings (`bookings`) — separate section from the calendar
Arnob: "Bookings will be a separate section where bookings will be grouped according to the properties and there has to be a date range selector too."
- Date range selector (presets 'both', default next 30 days) plus "Match on: Stay dates / Check-in date / Booked date".
- Bookings grouped by property: collapsible groups, header with property name, booking count, nights, revenue and occupancy in range. Rows: guest, stay dates, nights, guests, platform badge, status, total, invoice/receipt status, readiness for upcoming arrivals. Click → `O.booking.open`.
- Filters: status chips (with counts), platform chips, property select, search (guest name / booking id). Expand all / collapse all. Export CSV of the filtered list.
- "New booking" (direct booking) modal: property, guest name/phone/email/country, dates, guests; nightly price suggested from `D.rateFor`; on save it creates the booking with an invoice number automatically (and a receipt when marked paid), toast says so, booking appears in the group.

### Calendar (`calendar`) — separate section
Arnob: "Calendar will be a separate section. No need to show owner name. The property column needs to be narrow to accommodate more number of days. Reservation rows must get thinner as the number of properties increases. I want the platform logos on the calendar. The colour of the bar should depend on the status of the booking, not on the platform logo colour. I should be able to choose the date range."
- Multi-property timeline: narrow sticky property column (short name only, ~96–120px, no owner), day columns sized to fit the available width for the chosen range (scroll horizontally only when days get narrower than ~22px).
- Date range picker (presets future + 7/14/30/60 days, this month, next month, custom). Prev/next/today buttons.
- Row height scales down as the property count grows (auto density, e.g. 52px for ≤6 properties down to ~22px for 40+), plus a manual density control (Auto / Comfortable / Compact). Provide a clearly-labelled "Preview with more properties" control (12 / 30 / 60) that adds demo units so the scaling can be seen.
- Bars: colour = booking status (`--st-*`, text `--st-*-ink`); platform logo (`U.platIcon`) at the start of every bar; guest name + nights when there's room, logo only when narrow. Blocks (owner stay / maintenance) hatched grey. Weekend shading, today highlight, check-in/out half-day offsets. Legend for statuses and platforms. Hover tooltip; click → `O.booking.open`; click an empty day → small menu: new booking / block dates. Filters: property, status, platform.

### Reviews (`reviews`)
Arnob: "Need to be able to select platform plus number of stars, for example Airbnb & Needs reply when selected together must show the reviews in Airbnb that need to be replied to."
- Combinable filters: platform chips (All, Airbnb, Booking.com, Agoda, Vrbo, Google), reply status (All / Needs reply / Replied), stars (multi-select 5…1), property, date range. Counts on each chip reflect the other active filters. A summary line ("7 Airbnb reviews need a reply") and a clear-filters button. Honour `ctx.params.needsReply` / `ctx.params.platform`.
- Compact KPI strip (avg rating, reviews, needs reply, response rate, 5-star share), ratings by platform, sub-score averages.
- Each review: guest, platform badge, stars, property, date, text, tags, linked booking (opens drawer); reply composer with a suggested reply (based on stars/tags), post reply → saved, counts update. Low-star reviews flagged.

### Guest inbox (`inbox`)
Arnob: "Better to have the guest names on the left side and messages on the right, just like WhatsApp. Need options of adding and editing quick replies. Need to be able to attach. Also should be able to record and send voice notes. I should also be able to tag certain quick texts to certain units."
- WhatsApp-style two-pane layout: left = conversation list (avatar, guest name, property, last message preview, time, unread badge, search, filter: all/unread/arriving today); right = chat (header with guest, property, stay dates, status, platform; actions: open booking, change door code, call). Bubbles: guest left, team right (brand colour, `--brand-ink` text), internal notes visually distinct, system events centred, date dividers, times and read ticks. On phone: list first, tap opens chat with a back button. Honour `ctx.params.bookingId`.
- Composer: text, emoji-free is fine, **attach** (file input: images show a thumbnail bubble, other files a file bubble with name and size), **voice notes** (record with `navigator.mediaDevices.getUserMedia` + MediaRecorder, show a recording timer, stop and send as an audio bubble that plays; if the microphone is unavailable or denied, tell the user and fall back to choosing an audio file), internal note toggle.
- **Quick replies**: bar of quick replies above the composer showing the ones tagged to this conversation's unit plus the all-unit ones; variables filled from the booking/property. "Manage quick replies" modal: add, edit, delete; each reply tagged to specific units (multi-select) or "All units"; list shows the tags.

### Tasks (`tasks`)
Arnob: "Make sure I have the option of assigning tasks to staff."
- Board (To do / In progress / Done) and list view; filters: assignee (everyone / me / each staff / unassigned), property, type, due (overdue / today / this week). Staff workload strip (open tasks per person today; click to filter).
- "New task" modal with **Assign to** (staff select showing role and current load), property, type, priority, due date/time, checklist size, notes. Every task card has an assignee control to reassign instantly (toast: who was notified). Bulk select + assign. Move status with buttons. Unassigned tasks stand out.

### Pricing (`pricing`)
Arnob: "This has to be a more analytical feature. We should be able to derive the competitors' average price for a certain property, suggest prices with reasoning, analyse prices for the same date in the last years, etc."
- Property selector + date range (future presets, default next 30 days).
- Compact KPIs: our average price, competitor average, price position (index vs comps), occupancy on the books vs market, average suggested price, revenue impact if suggestions applied.
- Chart: our price vs competitor average (with competitor min–max band) vs suggested price.
- Per-date table: date/day, our price, competitor avg (min–max), same weekday last year and two years ago (`D.rateFor(pid, d.sameWeekdayYearsAgo(date,n), n)`), our occupancy pace, event, suggested price, short reason; select rows and apply suggestions (store in `D.priceOverrides[pid][date]` and use it for "our price" afterwards).
- Reasoning panel for a selected date: each factor with its RM/percent contribution (base rate, season, weekend, local event, competitor gap, booking pace, days until arrival) adding up to the suggestion.
- Competitor set table (7 listings: name, beds, distance, rating, reviews, avg price in range, vs ours). Same-date history panel (this year vs last year vs two years ago).
- Pricing rules (min/max price, weekend uplift, last-minute discount, length-of-stay discount, orphan-night discount) used by the suggestion.
- Note: competitor prices are simulated in the prototype; production needs a market data feed.

### Automations (`automations`)
Keep v2's guest message journey (7 steps: booking confirmed, ID check request, pre-arrival, door code, check-in day, mid-stay, check-out + review request) and ops rules, data-driven with on/off switches. Add rules for this round: invoice created and sent automatically when a booking is confirmed; receipt created and sent when payment arrives; same-day booking alert to the ops manager + urgent turnover task; house rules must be accepted in the guest app before the door code is shown; damage report from the guest app creates a maintenance task with the photos; expense claims notify the owner for approval.

### Invoices & receipts (`invoices`)
Arnob: "Need to have this section where invoices and payment receipts get generated automatically from booking details and guest details. We should have the option of sending the invoice and payment receipt to the respective guest." Also: "1 invoice and 1 payment receipt must be generated automatically where we can send them directly to the renters."
- Explain the rule in one line: one invoice per booking when it is confirmed, one receipt when payment arrives; both use the brand logo and colours.
- Compact KPI strip; date range (by invoice date, presets past+both); filters: Not sent / Sent / Awaiting payment / Paid, platform, property, search.
- Table: invoice no, receipt no, guest, property, stay, total, invoice status, receipt status, actions (view invoice, view receipt, download PDF, send). Bulk "send selected" (invoice + receipt, channel per guest), export list CSV.
- Settings card: auto-send invoice (Email / WhatsApp / Off), auto-send receipt, numbering format, company details (from workspace), tax lines (tourism tax for foreign guests on; SST registration off by default).

### Expenses (`expenses`)
Arnob: "Where does the staff/owner record the expenses? There must be an expenses feature... There must be a section to record the expenses with a drop down expense type and also include Others as an option."
- Record expense form (prominent): date, amount, **type dropdown** (D.expenseTypes; choosing **Others** reveals a required "What was it for?" field), property or "General / company", paid by (defaults to the current viewer; only the owner can record for someone else), payment method, receipt photo (camera/file input with thumbnail), note. "Paid personally (claim)" creates a claim pending owner approval.
- List with date range (past presets), filters (type, person, property, claim status), totals by type (hbars) and by person including the owner. Owner sees everyone's expenses and can approve claims; other staff see only their own (say so). Export CSV.

### Financials (`financials`) — owner only (the router already blocks non-owners)
Arnob: "There must be an option of export to PDF along with CSV. The financials must show the expenses made by each staff including the owner. Access to financials will be strictly for the owners only. The 4 cards can become much smaller in width to accommodate all 4 cards in 1 line."
- 4 compact cards in one line: Revenue, Expenses, Platform fees, Net profit (each with change vs previous period). Date range with presets (past), default month to date.
- Export PDF and Export CSV (top bar actions) of the P&L for the selected range.
- Revenue vs expenses by month (Jun–Oct) chart; P&L table (revenue, platform fees, expenses by type, net, margin); by-property table; **Expenses by person** (each staff member including Mei Fen Lim the owner: total, count, top types, pending claims); tourism tax collected (passed through, not revenue).
- A small line stating that only account owners can open this page (Staff Access cannot grant it).

### Reports (`reports`)
Arnob: "The reports cards can also become much smaller and fit in 1 line. Must be able to choose date range with some pre-suggested ranges."
- Report picker as small cards in a single row (8–9: Occupancy, Revenue, Booking pace, Channels, Guests & origin, Reviews, Operations, Expenses, Tourism tax); scrolls sideways on phone.
- Date range with presets (past) and a comparison choice (previous period / same period last month / none).
- Selected report renders below: compact KPIs, chart, table, Export CSV and PDF. Revenue/Expenses/Tax reports are owner-only (`U.locked`).

### Website builder (`website`)
Arnob: "We will have templates for 12 website landing pages and 2 additional pages. This must also be adaptive to the brand logo and brand colour template."
- Gallery of **12 distinct landing page templates** (name, one-line description, best-for tag) rendered as live mini previews using the brand tokens + logo (they change when the brand changes). Filter by style.
- **2 additional pages** every site gets: "Property & booking" (gallery, amenities, availability calendar from O.data, price, book button) and "About & contact" (story, FAQ, contact form, WhatsApp button).
- Editor: pick template, page tabs (Home / Property & booking / About & contact), section toggles and reorder, edit headline/subheadline/CTA, featured properties, desktop/phone preview, publish (simulated) to `O.ws().domain`, SEO title/description. A note that colours and logo come from Brand & Setup automatically.

### Guest app (`guestapp`)
Arnob: "Can include video sections with vlogs from famous vloggers, things to do in Malaysia, things not to do in Malaysia, can request for SIM, car rental, Touch 'n Go card. Damage reporting section where each guest must take pictures of any damaged item they see in the unit. House rules must be the first thing they see and accept to see the door lock code. We must be able to change the lock code from any option in the app."
- Interactive phone preview + admin panel side by side (stacked on phone). Booking selector for the preview.
- Guest flow: **house rules first** → must tick agree (and type name) → only then the home screen with the **door code** unlocks (also requires ID verified; show the state). Home: door code, Wi-Fi, check-in/out, address/parking, contact host.
- Sections: **Videos** (vlog cards: vlogger, title, city, duration; open a YouTube search link in a new tab; thumbnails drawn with CSS), **Things to do in Malaysia** (tabs per city: Kuala Lumpur, Penang, Melaka, Cameron Highlands), **Things not to do in Malaysia** (accurate etiquette and law points), **Requests**: SIM card, car rental, Touch 'n Go card (forms → request list with status; requests show in the admin panel), **Damage report**: each damaged item needs at least one photo (camera input `accept="image/*" capture="environment"`), room, item, description; submissions show in admin and create a maintenance task in `D.tasks`; arrival prompt to report pre-existing damage.
- Admin panel: house rules editor, videos manager (add/remove), things to do/not to do editor, request types on/off, incoming requests and damage reports, door code card with **Change door code** (`O.lock.change`), guest app link.
- Branded with the workspace logo and colours.

### Owner portal (`owner`)
What property owners (D.properties[].owner, e.g. Rajan Pillai owns 3 units) see: owner selector, monthly statement (revenue, management fee, expenses charged, owner payout), occupancy and ADR per unit, upcoming stays (no guest contact details), maintenance log, statement PDF/CSV download, message the manager. Brand-adaptive.

### Staff access (`staff`)
Team list, roles & permissions matrix, audit log (include `D.lockLog`), invite staff. Permissions include: assign tasks, record expenses (everyone records their own), approve expense claims (owner), change door codes, send invoices. **Financials is owner-only and cannot be granted** (show it locked in the matrix).

### Brand & setup (`brand`) — built by the lead, not by section agents.
