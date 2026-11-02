# Unit file: lease, owner's bank details, bills, documents (2026-11-02)

Arnob: "I also need to have a section where I upload all details about a unit. For example rent, tenancy agreement,
wifi password, door lock code, monthly rent amount and date, internet bill amount, payment due date, Water bill account,
owner name, number, bank accout number and anything else you can possibly think of"

The operator rents units from their owners and lets them out short-term, so each unit has a lease to pay, bills to keep
up with and paperwork to find. Files: `app/pages/unitfile.js` (new, `O.unitFile`), `api/_lib/shared/unitdue.cjs` (new,
the rules, `O.unitdue` in the page), `supabase/migrations/0023_unit_files.sql`, small hooks in `app/pages/properties.js`,
`app/pages/dashboard.js`, `app/server/auth.js` and `app/core.js` (the permission).

## What is there

- **Unit file tab.** A unit's drawer in Properties has a Details / Unit file switch for people who may see unit files.
  `O.go('properties', {propertyId, unitTab: 'file'})` opens it directly. "Edit unit file" turns the drawer into a form
  (same look as Edit details; unsaved changes ask before closing).
- **Lease from the owner**: monthly rent (in the unit's currency), the day of the month it is due, how it is paid
  (bank transfer, DuitNow, standing instruction, cheque, cash, other), tenancy start and end, notice period in months,
  security and utility deposits, renewal reminder (days before the end, 60 by default), agreement reference. "Mark
  paid" records the rent due date paid (`paidUntil`).
- **Owner and payment**: the owner's name, phone and email are shown from the property record (edited in Details, not
  copied), plus IC / passport / company registration number, bank, account holder and account number. The account
  number, IC number and router password show masked (`•••• 1234`) until "Show"; the account number can be copied.
- **Bills**: as many rows as needed (up to 30). Types: Internet, Electricity (TNB), Water (Air Selangor), Sewerage
  (IWK), Maintenance / service charge (JMB/MC), Sinking fund, Assessment (cukai taksiran), Quit rent (cukai tanah), Gas,
  TV / streaming, Insurance, Other. Each: provider, account number, usual amount, how often (monthly, every 2 months,
  quarterly, half-yearly, yearly), the due day (monthly) or next due date (the others), paid by (we pay / owner pays /
  included in rent), autopay, notes. The next due date is computed and shown; overdue ones are flagged; "Mark paid"
  moves it on.
- **Access and building**: the smart lock, door code, Wi-Fi and parking bay are shown from the property (the code and
  Wi-Fi only with `properties.access`), plus router admin login, access cards (count and numbers), parking card, mailbox
  number and key, building management office, guard house phone.
- **Documents**: upload with a category (Tenancy agreement, Inventory list, Insurance, Utility bill, Handover photos,
  Licence / permit, Other), list, open, remove. PDF, JPEG, PNG, WebP, HEIC; 20 MB each; 60 per unit.
- **Notes**: free text.
- **Dashboard "Due soon"**: rent and bills we pay that are due in the next 7 days or overdue (overdue first, in red),
  and tenancies inside their reminder window or already ended. Each row opens the unit file; rent and bill rows have
  "Mark paid". Only for people who may see unit files, and only when the workspace has any unit file.

## Data shape

Table `public.unit_files (org_id, property_id, data jsonb, updated_at, updated_by)`, one row per unit. `data`:

```
{ v: 1,
  lease:  {rent, dueDay, method, start, end, noticeMonths, deposit, utilityDeposit, reminderDays, ref, paidUntil, createdOn},
  owner:  {idNo, bank, holder, accountNo},
  bills:  [{id, type, provider, accountNo, amount, freq, dueDay | nextDue, paidBy: 'us'|'owner'|'rent', autopay, notes, lastPaid, createdOn}],
  access: {routerUser, routerPass, cards, cardNos, parkingCard, mailbox, mailboxKey, mgmtOffice, guardPhone},
  docs:   [{id, path, name, cat, size, mime, at, by}],
  notes, updatedAt, updatedBy }
```

Documents are in the private Storage bucket `unit-docs` at `<org id>/<property id>/<random id>-<cleaned name>`.

## Security model

- **New permission** `properties.file`, "See and edit unit files" under Properties in Staff Access (a "see" action:
  the Properties section at View or Edit, and the switch on). Account owners always have it; **no other role has it by
  default** (not even Ops managers); an owner switches it on per role or per person.
- **Enforced by the database.** `unit_file_can(org)` (0023) applies the same rule as `O.can('properties.file')`, the
  way `website_can()` (0017) does for the website: active member, not suspended in `staffMeta`, owner, or the person's
  override, else the saved role (`rolePerms`), else the defaults. `unit_files` has row level security on select,
  insert, update and delete with it (changes also need `can_write`, so a paused workspace is read-only). `anon` has no
  privileges on the table or the functions.
- **Never on the property record.** All members read `records`; none of these fields go there, nor into `D` (the synced
  data). The page reads and writes `unit_files` with the member's own Supabase session, so RLS decides.
- **Storage.** Unlike `inbox-media` (0022), where only the server reaches files and hands out signed addresses, members
  reach `unit-docs` directly and the bucket's policies decide: `unit_docs_can(name, write)` requires a path of exactly
  three parts whose first is a workspace id the member has `unit_file_can` for (and `can_write` to change). This needs
  no new Vercel function (the Hobby plan allows 12; Orbique uses 11) and keeps request bodies off Vercel's 4.5 MB cap.
  The bucket is private; documents open only through signed addresses valid for 60 seconds. If the policies cannot be
  created on a database, the migration warns and members get no access (it fails closed).
- **Saving** is guarded against lost updates: an edit saves only if the row's `updated_at` is unchanged since it was
  loaded; otherwise the file reloads and the person is asked to make the change again. One unit's saves (edit, Mark paid,
  adding or removing a document) run one after another in the page, each starting from the row the previous one
  returned, so two quick "Mark paid" clicks on the same unit do not report a false conflict.
- `reset_org()` (as in 0006) also clears the workspace's unit files; the app removes their documents first.

## Defaults chosen

- Rent counts again from the day the due day or the rent is first entered or changed (`restartRent`), so a file saved
  earlier with only the owner's bank never shows rent as overdue for months before it was entered.
- Rent and monthly bills are counted from the later of the tenancy start and the day they were first saved, or from
  the day after the last payment marked, so a month that passed unpaid shows as overdue but history before the file
  existed does not. Changing a due day or frequency starts counting again from that day.
- Autopay bills are never overdue and have no "Mark paid": their next date is the next one on or after today.
- Bills the owner pays or that are included in the rent are kept for reference but never listed in "Due soon".
- A due day of 31 is the last day of shorter months; quarterly and longer bills keep the day of their first date.
- Payments are not a ledger: "Mark paid" records only the last due date paid. Real payments still go in Expenses.
- Demo workspaces get sample unit files for three demo units with obviously fake values (`XXXX-XXXX-1234`,
  `+60 3-XXXX XXXX`, `TA-DEMO-0001`) and no documents. The local test copy keeps unit files in that browser's storage and
  cannot add documents.

## Tests

- `tests/unitfile.test.mjs` (in CI): due dates, overdue, mark paid, tenancy reminder, "Due soon", file checks.
- `tests/sql/unit_files.sql` (run by `tests/sql/run.sh`, on a third database with a Storage stand-in,
  `tests/sql/storage_stub.sql`): owner can; ops without the switch cannot select, insert, update or delete rows or
  documents; ops with it can (per person and per role); housekeeping and an accountant without the Properties section
  cannot; a suspended member cannot; a paused workspace reads but does not change; another workspace's owner sees
  nothing of this one; anon has nothing; odd paths are refused; the bucket is private; `reset_org` clears only its own.

## Not tested against the real services

The bucket and its policies on the real Supabase project, and the signed-in page paths (upload, open, remove, the
`updated_at` check), were not run against a live Supabase here; the local test copy was driven in a browser.
