# Rooms & beds, and unit requests

Asked for by the operator:

> I also need bed mapping. Which unit which room has which bed size, mattress size, bedsheet size, pillow size.
> We also need a section where we make request for a unit, for example repair request > Basin > Toilet, Master Bed;
> Replacement > Sofa, Living Room; Replacement > Plates. This should automatically go to tasks also. When task is
> completed, the request for the unit is also ticked. Request > Internet Connection ... like that.

The units are 2-bedroom serviced apartments (one queen room, one room with a queen and a single, a foldable extra bed
for a 5th guest). Housekeeping and laundry need the linen sizes; staff who find something broken need to raise it.

## What was built

A unit in **Properties** now has the tabs **Details · Rooms & beds · Requests · Unit file** (Unit file only for people
with `properties.file`, as before). **Tasks & Cleaning** has a new **Requests** tab between Tasks and Checklists that lists
requests across all units (Open / Done / Cancelled / All, filter by unit, New request).

| Piece | File |
| --- | --- |
| Bed types, size presets, linen per change (pure) | `api/_lib/shared/beds.cjs` (`O.beds`) |
| Request kinds, task fields, **the sync rule** (pure) | `api/_lib/shared/unitreq.cjs` (`O.unitreq`) |
| Rooms & beds tab (view and edit form) | `app/pages/unitrooms.js` (`O.unitRooms`) |
| Requests tab, request form, Tasks > Requests, the sync listener | `app/pages/unitreq.js` (`O.unitReq`) |
| Tabs in the unit drawer | `app/pages/properties.js` |
| Requests tab, "From a unit request" line in the task detail, helpers for requests (`O.taskHelpers`) | `app/pages/tasks.js` |
| Node tests | `tests/beds-requests.test.mjs` (in CI) |
| Browser check, 390 px and desktop (by hand) | `tests/beds_requests_e2e.mjs` |

Both modules are in `scripts/build.mjs` SHARED and in the CI "API functions load" and production-output checks, like
`unitdue.cjs`.

## Data

Both are ordinary synced workspace data (records collections registered as `'demo'`: a new workspace starts empty;
the demo units `or4` and `bf3b` get sample rooms and requests). Nothing here is sensitive: no guest details, no codes.

### `D.unitRooms` — one record per unit

```js
{ id: 'UR-<propertyId>', propertyId, updatedAt, updatedBy,
  rooms: [{ id: 'R1', kind: 'master'|'bed2'|'bed3'|'living'|'study'|'other', name: 'Master bedroom',
            beds: [{ id: 'B1', type: 'king'|'queen'|'supersingle'|'single'|'sofabed'|'extra'|'bunk'|'other', qty: 1,
                     frame: '', mattress: '152x190', thick: 25,            // cm
                     fitted: '',                                           // '' = same as the mattress
                     flat: '210x210',                                      // flat sheet / duvet cover
                     duvet: '210x210',                                     // comforter / duvet
                     pillow: '48x74', pillows: 2,                          // pillows per bed
                     pcase: '',                                            // '' = same as the pillow
                     protector: true, notes: '' }] }] }
```

Sizes are text. The form offers presets (cm, common in Malaysia: King 183x190, Queen 152x190, Super single 107x190,
Single 91x190, Super king 200x200, Sofa bed 120x190; covers King 240x220, Queen 210x210, Super single 160x210,
Single 140x210; pillows Standard 48x74, Queen 51x76, King 51x91, Euro 65x65, Bolster) through a datalist, and anything
typed is kept as typed. Choosing a bed type fills in that type's usual sizes, but only fields still at the old type's
defaults; sizes someone typed stay.

**Linen per change** (`O.beds.linen(rooms)`): per bed × quantity: one fitted sheet (fitted size, else mattress size),
one flat sheet / duvet cover (if a size is set), pillows × pillowcases (pillowcase size, else pillow size), one mattress
protector (mattress size, beds that have one). Comforters and pillows are listed under "On the beds, not changed each
time" so laundry knows the sizes. The tab also shows rooms, beds and "Sleeps" (King/Queen/Sofa bed/Bunk 2, others 1).

### `D.unitRequests`

```js
{ id: 'RQ-…', propertyId, kind: 'repair'|'replace'|'purchase'|'service'|'cleaning'|'other',
  item: 'Basin', location: 'Master bathroom', priority: 'high'|'medium'|'low', notes, photo /* JPEG data URL, optional */,
  status: 'open'|'in_progress'|'done'|'cancelled', at, by /* staff id */,
  taskId: 'T-RQ-…',              // while a task is linked
  doneAt, doneBy,                // copied from the task
  cancelledAt, cancelledBy, taskGone /* true: its task was deleted */ }
```

Shown as a breadcrumb, `Repair › Basin › Master bathroom`. Item suggestions: Basin, Toilet, Shower, Water heater,
Aircon, Bed, Mattress, Sofa, Plates, Cutlery, Kettle, TV, Fridge, Washer, Internet connection, Lights, Door lock and more;
locations: the unit's rooms from Rooms & beds, then Kitchen, Master bathroom, Bathroom 1, Bathroom 2, Living room,
Dining area, Balcony, Laundry area, Entrance, Whole unit. Both accept free text.

### The task

Saving a request pushes its task into `D.tasks` at once:

```js
{ id: 'T-' + request.id, requestId, title: 'Repair: Basin (Master bathroom)', propertyId, priority,
  type: 'Maintenance' /* repair, replacement, service, other */ | 'Restock' /* new item */ | 'Housekeeping' /* cleaning */,
  due: /* high: now + 4 h; medium: tomorrow 17:00; low: in 3 days 17:00 */,
  assigneeId: /* the Tasks page's own suggestion: maintenance staff for Maintenance, the unit's housekeeper for
                 Housekeeping / Restock; otherwise unassigned, so it shows on the dashboard */,
  status: 'todo', createdAt, createdBy, note: '<notes>\nFrom unit request RQ-…: Repair > Basin > Master bathroom.' }
```

The task id comes from the request id, so it can never be made twice. The task detail shows "From a unit request:
…" with the photo; board cards show a small house mark.

## The sync rule (one place)

`O.unitreq.reconcile(requests, tasks, opts)` in `api/_lib/shared/unitreq.cjs`, run by `O.unitReq.sync()` in
`app/pages/unitreq.js` from a single `'data'` listener (400 ms after any change, here or arriving from another device)
and as the background job `unitRequests`. Nothing else changes a request's status from a task, so the task detail, the
board's move buttons, the list, bulk "Mark done", checklist ticking and the dashboard's "done" all go through it.

- While a request has its task, the request **follows the task**: `todo → open`, `in_progress → in_progress`,
  `done → done` with `doneAt` / `doneBy` from the task. Reopening the task reopens the request (done fields removed).
- **Cancelling a request** removes its task if the task is not done; a done task stays as history.
- **Deleting the task** leaves the request: it becomes `open` again (unless it was done), `taskId` is cleared and
  `taskGone: true` is set; the request shows "Its task was deleted" and a **Make a task** button. Chosen over
  cancelling the request so a broken basin is not forgotten because a task was tidied away.
  A task counts as deleted when this device saw it and it is gone, or when it is still missing 10 minutes
  (`GRACE_MIN`) after the request was made — so a request whose task row has not arrived yet from another device is
  not unlinked.
- **Reopen** on a cancelled request opens it and makes (or reopens) its task.

Everything reconcile writes is derived from the request and its task, so it is idempotent (a second run changes
nothing) and two devices reach the same record (tested). It writes no audit lines of its own: the task's own
"Completed …" / "Reopened …" line already records who did it.

## Permissions

No new permission keys.

- **Rooms & beds**: everyone who can open Properties sees the tab; editing needs **Edit property details**
  (`properties.edit`): on for account owners and ops managers, housekeeping and maintenance see it only.
- **Raise a request**: **Create tasks** (`tasks.create`) *or* **Edit property details** (`properties.edit`). By default
  owners, ops, housekeeping, front desk and maintenance can, so the people who find broken things can report them.
  The task is created for them even without "Assign tasks to others": it goes to the suggested person, as automatic
  tasks do.
- **Cancel a request**: `properties.edit`, `tasks.delete`, or the person who raised it.
- **Open task** shows only when the viewer may see that task (`tasks.others` or it is theirs).

## Audit log

Category `properties`: "Added / Updated the rooms and beds of <unit>: 3 rooms, 4 beds".
Category `tasks`: "Raised request Repair > Basin > Master bathroom for <unit> and created the task "…" for <person>",
"Cancelled request …", "Reopened request …", "Made a new task "…" for request …".

## Not done / later

- A request has one photo (compressed like the task photo note, about 110 KB); it is kept on the request, not copied to
  the task. Several photos would need Storage.
- No per-request comments; use the task's notes and photo note.
- The guest app's damage reports (`D.damageReports`) stay separate; they could raise unit requests later.
