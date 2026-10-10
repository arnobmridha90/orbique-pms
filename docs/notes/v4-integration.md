# v4 integration notes (lead)

What the lead changed in shared files after the section builders finished, answering their requests.

## New core helpers (app/core.js)

- `O.activeProperties()`: properties that are not archived. `U.propOptions` skips archived ones (unless selected or `opts.archived`).
- `O.propLabel(p | id)`: "Bayfront Loft 3B · Gurney Drive, Penang"; "Removed property" when missing.
- `O.activeStaff()`; `U.staffOptions` hides people removed from the team (unless selected or `opts.all`).
- `U.copy(text, what)`: clipboard with a toast, falls back to a selectable box.
- `U.modal({cls})`, `U.empty(msg, icon, actionHTML)`.
- `O.maskPhone`, `O.maskEmail`, `O.contact(booking)` -> `{phone, email, masked}` following `bookings.contacts`.
- `O.newToken(prefix)`: 128 random bits, URL-safe. `O.bookingDefaults` uses it for `guestToken` (and crypto for door codes).
  Demo bookings keep deterministic tokens locally; server "Load demo data" replaces them (auth.js `strongToken`).
- `O.booking.actions`: buttons any page adds to the booking drawer (`{label, icon, kind, show(b), run(b, close)}`).
  Bookings registers Edit, Copy guest link and Cancel, so they appear wherever the drawer opens.
- The booking drawer gates itself: contacts (`bookings.contacts`), payment and invoices (`bookings.value`, `invoices.*`),
  door code (`guestapp.doorCodes`), ID verification (`bookings.edit`), message (`inbox`).
- `ctx.hold(true|false)` in page render: data changes do not redraw the page while held (read-aloud).
- `O.voice.speak(text | sentences[], {onstart, onpart, onend})`, `O.voice.hasVoices()`; decimals no longer split sentences.
- `O.readiness`: tolerates tasks without `due`; the check-in readiness task counts once the clean is done.
- `O.lock.change`: uses `guestapp.doorCodes`; a friendly message when there are no properties.
- `O.saveBrand` keeps the business details stored beside the brand; boot applies them to the workspace.
- `inventory.money` permission (ops and accountant by default). Housekeeping has Guest App at Edit so `guestapp.requests` works.
- `invCats` registered as a config blob. A toast when this browser runs out of storage.
- PDF header: the address line no longer runs into a long subtitle.

## data.js

- `M.availableNights` counts each unit from `createdAt` to the day before `archivedAt`.
- `D.eventFor` / `D.rateFor` tolerate properties without `area` or `base`.
- No turnover stock moves for today's check-outs (they happen after the demo's 10:15): 350 moves, 6 overuse warnings.

## core.css

- `.g1`, phone controls at least 40px tall, `--topbar-h` / `--tabbar-h`, phone top bar title on one line,
  sync status as a dot on phones, door-code button hidden on phones and for people without door-code access,
  compact date picker on phones, empty-state icon size.

## scripts/build.mjs

- The shell's `<title>`, `<meta>` and `<link>` tags go into `<head>` (Chrome ignores a manifest link in `<body>`).

## Checks run

- `tests/sweep.py`: 12 set-ups (desktop, phone, landscape, two weeks later, four roles, empty workspace on desktop and
  phone, guest app), 210 screens, 0 problems.
- `tests/e2e_server.py` against the local Supabase stack: 15 of 15 steps pass, 0 JavaScript errors.

## Known limits (honest list)

- Guest ID photos sit in the booking's conversation record, which every workspace member can read through the API.
  Move them to private storage before real guests upload IDs.
- A staff save of a conversation can overwrite a guest message that arrived seconds earlier (whole-record writes).
- Invoice and receipt numbers are "highest + 1": two devices recording payments at the same moment could clash.
- Website enquiries, OTA, WhatsApp, payment and smart-lock connections are still simulated.
- Permissions inside a section are enforced by the screens; the database enforces workspace isolation, staff records,
  role permissions and staff settings.
