# guestapp review (independent reviewer + fixer)

Status: COMPLETE (2026-10-07). All fixes are in pages/guestapp.js. shot.py exits 0 for desktop 1440, phone 390, 1024,
--workspace otto, --viewer s2/s3/s7 and interaction runs (accept rules, ID upload, verify, restart preview, requests,
code help -> change code, late check-out, mid-stay clean confirm, damage report -> task, photo modal, editors).
A scripted sweep of every phone screen and admin tab found no sideways overflow, no unsized SVGs, no unlabelled controls.

Fixed in this review:
- permissions follow Staff Access (O.can): accountant/maintenance get a locked page; housekeeping is view-only
  (read-only rules list, On/Off pills, no request actions, no Change door code, no Send to guest)
- grammar ("all 1 guest", "1 items"); damage description now required (spec); studio rooms ("Main room")
- request dates limited to the stay with validation; one late check-out per stay + next-arrival hint for admins;
  mid-stay clean task uses the requested day and slot; transfer date follows direction
- code help: guest sees "we are on it" then "new code set"; admin row = Change door code + Mark solved
- KPI "Codes still hidden" (was "Door codes held", clashed with readiness "Code held"); KPI subs fit on one line
- Restart preview restores rules + ID + code status; held code released when "needs ID" is off; ID step says so
- ctx.params applied only on a fresh open; guest-app events open an inbox chat if the stay has none
- seeds: SIM request fits the 5-night stay; T-308 gets its 2 photos; 14 "not to do" points; guide form has time field
- hard-coded white/grey surfaces -> tokens; arrival prompt uses brand tokens (Otto accent was nearly invisible)
- rules editor usable at 390px; Videos nav/tile hidden when there are no videos

Core issues to report (not fixed, not my files):
- core top-bar key button opens O.lock.change for any viewer, ignoring O.can('changeDoorCodes')
- O.can lives in pages/staff.js, not core.js (guestapp falls back to a role table if it is missing)
