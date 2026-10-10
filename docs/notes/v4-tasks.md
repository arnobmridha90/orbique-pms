# v4 Tasks & Cleaning (tasks)

File: `app/pages/tasks.js` (rewritten, CSS inline through `O.css('tasks', ...)`, classes prefixed `tk-` under `.pg-tasks`).
No other file was edited.

## What it does

Two tabs: **Tasks** and **Checklists**. One primary action ("New task"); "Export CSV" next to it on desktop only.

- **Tasks tab**
  - Today line: "Today N tasks, x done · N overdue · N unassigned · N created automatically" (the overdue and unassigned
    parts are links that filter).
  - People chips with open counts (only with `tasks.others`): Everyone, You, each person, Unassigned.
  - Filters: Today (includes overdue) / Overdue / This week / Any day, property, type, search, Clear; Board / List.
    "Today" is the default so the To do column is short. On the phone the property/type/search filters fold behind a
    Filter button.
  - Board: To do / In progress / Done. Overdue first, then day headings. Done shows 6, then "Show more".
    At 1100px and below one column is shown at a time with a column switch; 761 to 1100px uses a 2-column card grid.
  - Card: type, priority (not on done tasks), due label ("Overdue since ...", "Today 11:45 AM · in 1.5h"), title,
    property, a live booking line ("Sarah Tan arrives 12:00 (early check-in)", "Night 3 of 5"), progress after the
    first tick, assignee (a select only with `tasks.assign`), Start / Done / Reopen.
  - List: sortable table with checkboxes and a bulk bar (assign, move, delete when allowed).
  - Maintenance, Restock and Inspection tasks from v3 are kept. Added a **Housekeeping** type for daily service.
- **Task detail** (modal):
  - checklist with big tap rows (44px desktop, 52px phone, 2 columns on desktop), progress bar, "All required items
    ticked: Mark done"
  - optional photo note: canvas-compressed JPEG data URL (max 900px, about 80 KB or less), plus a short text
  - a link to the booking, done by / when / reason, a note on automatic tasks
  - actions: Delete (`tasks.delete`), Edit, Start / Mark done / Reopen. View-only people get Close.
- **Mark done** with required items unticked asks for a reason (chips "Done without the app", "Guest asked us not to
  enter", "Not needed this time", or free text up to 300 characters). It is stored as `doneReason` and shown in the detail.
- **Checklists tab**: one card per template (`D.checklists`), each with its automation switch and settings
  (create for N days ahead, stays of N nights or more, due time), the items, and "N items · used by N open tasks".
  - People with `tasks.checklists` get Edit: rename, description, add, reword, Required / Optional, move up / down, remove.
  - Everyone else sees the templates read-only.
  - The switches need `automations.toggle`; without it they are greyed with the reason.

## Automation (`O.automation.register('tasks', fn)`)

- Settings in `O.sync.blob('taskAutomation', 'config')` (defaults: all three on, check-outs 2 days ahead, arrivals
  1 day ahead, daily service for stays of 3+ nights at 12:00, `dismissed: {}`).
- **Check-out turnover** `TO-<bookingId>` (template CL-checkout).
  - With a same-day arrival: due at whichever is later, check-out + 45 min or arrival − 45 min, and priority high.
  - Without one: due at check-out + 3 h.
- **Check-in readiness** `CI-<bookingId>` (type Inspection, CL-checkin): due 15 minutes before check-in.
- **Daily housekeeping** `DH-<bookingId>-<date>` (type Housekeeping, CL-daily): for today only, for in-house stays.
- Every task is assigned to the property's housekeeper (skipped when suspended or removed). Records are fully
  deterministic (no `createdAt`), so two devices produce identical rows.
- **Dedupe.** A task is skipped when the property already has a task of the same *kind* that day. The kind comes from the
  checklist template, so the demo's T-309 (a Turnover using CL-daily) counts as daily service. On the demo date this
  adds 15 tasks and skips T-301/302/303/311/312, T-305 and T-309.
- **Deleting a task** records its id and the automatic ids for that slot in `dismissed {id: day}`, so it never comes
  back. Entries are pruned after 30 days.
- **Untouched tasks follow their booking.** An untouched task is still To do, has no ticks or photo, and has not been
  re-timed.
  - It moves when the booking's times change.
  - It is removed when the booking is cancelled or pending, or when the stay no longer covers a daily task.
  - Touched tasks are never changed.
- **When it runs**
  - At boot and on 'day', through core; there is no extra emit, because core re-renders.
  - On 'data' when the bookings, housekeepers, templates or settings signature changes (debounced 80 ms, only after
    `O._started` and when `O.sync.canWrite()`). It emits `data {type:'task-auto'}` only when something changed.
  - A run takes about 1.5 ms.
- Turning a switch on runs the job and says how many tasks were added. Turning it off removes untouched future tasks of
  that kind. Both are written to the audit log.

## Checklists

Everything uses `O.checklist.*` and `checklistId` + `checks` (item ids). Legacy `task.checklist: [done, total]` from
any page or old saved data is converted on the fly (ticks are mapped proportionally) and the field is deleted.
Editing a template keeps the ticks on existing tasks: the item ids stay, new items get `O.uid(prefix).toLowerCase()`.
Changing a task's checklist in Edit clears its ticks.

## Permissions

| Permission | Effect |
|---|---|
| `tasks` view | Read-only page (Close only, no ticks). |
| `tasks` edit | Tick items, move tasks and add photo notes. |
| `tasks.others` | Without it a person sees only their own tasks: no people chips, "Showing your tasks." Tested as s5 and s6. |
| `tasks.assign` | Shows the assignee select and the reassign bulk action. Without it, new tasks go to yourself. |
| `tasks.create` | New task. |
| `tasks.delete` | Delete. |
| `tasks.checklists` | Edit templates. |
| `automations.toggle` | The automation switches and settings. |

Tested as owner s1, ops s2, front desk s4, housekeeper s5, maintenance s6, accountant s7 (locked by core) and a view-only role.

## Tested

Desktop 1440x900, phone 390x844, tablet 1024, phone landscape, `--now 2026-10-21T15:40` with and without an older saved
story, the empty workspace (one sentence plus "New task"), and persistence through `--storage`. Also checked:
- re-runs create nothing new
- deleted tasks stay gone after reload
- the next day adds its tasks
- booking time changes and cancellations update or remove untouched tasks
- the photo note compresses and saves
- no horizontal scroll

The only JS error in every run comes from `app/pages/guestapp.js` (see below).

## Left / known limits

- Tasks deleted from *other* pages are not added to `dismissed`, so an automatic one could come back. Pages should
  delete through `O.emit` with a task id, or core could own a `O.tasks.remove(t)`.
- `dismissed` is one config blob, so two devices deleting at the same moment use last write wins.
- Daily housekeeping is created for today only, not ahead.
- There is no "reset template to default".

## Requests for core / other pages

1. **guestapp.js** has a syntax error ("Unexpected end of input", work in progress from another engineer). It shows as a
   pageerror on every page. It also seeds T-316 with literal dates and a `photos: 1` field.
2. **reviews.js** (`D.tasks.push(t)` near line 491) creates tasks without `checklistId` / `checks`. Its "Deep clean" is a
   Turnover with no checklist; suggest `checklistId: O.checklist.forType(type, title), checks: []`.
3. **O.readiness** ignores the Inspection when a Turnover exists on the same day. It could show "Cleaned, inspection
   not started" and then "Inspected", since check-in readiness tasks now exist for every arrival. It also calls
   `t.due.slice`, which crashes on a task without a due date.
4. **U.locked** lowercases the first letter, which gives "the tasks & Cleaning". Suggest passing the page label
   unchanged or lowercasing the whole label.
5. Consider moving `kindOf`, `normalize` and the automation helpers into core (`O.tasks`) so the dashboard, bookings and
   the guest app can create and delete tasks with the same dedupe and dismiss rules.
6. Statistics and reports should know the new `Housekeeping` type. statistics.js line 283 counts only Turnover for
   turnaround, which is still correct.
