# tasks / staff / automations — progress

Build: python3 build.py --out /tmp/v3-tasks-staff-automations/v3.html

## Done (all tested: desktop 1440, phone 390 no sideways scroll, otto workspace, viewers s2/s4/s5, modals)
- [x] tasks.js — KPI strip, workload strip per person (click = filter), filters (assignee/property/type/due/search), board + sortable list, bulk select (assign/start/done), assignee select on every card (toast names who was notified), new task modal (assign to with role + load + suggested person), task detail (checklist ticking, photos, edit, delete), CSV export, params {assignee, due, propertyId, taskId}. Non-assigners see own tasks + disabled reassign.
- [x] staff.js — Team (members, invites, manage modal with role/status/property scope/per-person exceptions), Roles & permissions matrix (sections None/View/Edit + action switches; Financials and Approve claims locked owner-only; Record own expenses locked for everyone), Audit log (D.lockLog, D.sentLog, tasks, review replies, same-day alerts, D.auditLog; filters + CSV), invite modal, "Your access" for non-owners. Defines O.can(key, level, staffId), D.rolePerms, D.staffMeta, D.staffInvites, D.auditLog.
- [x] automations.js — 7-step journey with switches, edit modal (channels, timing, variables, live preview), sample-booking preview; rules (6 new this round + v2 ops rules) with switches, counts from data, edit modal, confirm when turning off key rules; "Ran today" feed; door code safety chain; new automation modal. D.automations.

## Left / ideas
- Other pages could read O.can() (expenses approve claims, door codes, invoices) — lead decision.
