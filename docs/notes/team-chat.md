# Team chat: messages between staff (2026-11-03)

The ask: "we need a different messaging section for staff messaging between all the staff or selected staff".

Team chat is its own page (nav id `team`, in the Operate group after Inbox). It is separate from the guest Inbox:
guests never see it, and it does not use the Inbox tables.

Files:
- `app/pages/team.js` (new): the page and `O.teamChat`.
- `api/_lib/shared/teamchat.cjs` (new): the rules and every English string (`STR`, `t()`). It runs as `O.teamchat` in
  the page and is also used by `/api/alerts`.
- `supabase/migrations/0024_team_chat.sql` (new).
- `api/alerts.js` and `api/_lib/alerts.js`: Team chat push alerts.
- `app/native/bridge.js`: the Android channel and what a tap does.
- `app/core.js`: the nav entry, the icon, the permission, and the nav badge hook.
- `app/pages/staff.js`: small fixes for a section that has no actions.

## What is there

- **All staff**: one group per workspace, made on first use. Every active member is in it automatically, the owner
  included, and nobody can leave it or be removed. Unread messages count from the moment a person joined the
  workspace.
- **Direct chats**: "New chat" → Person. There is one direct chat per pair, so opening the same pair again returns
  the existing chat.
- **Groups**: "New chat" → Group, with a name (up to 80 characters) and people (up to 50 including the maker). The
  group's maker or the account owner, while in the group, can rename it, add people and remove people. Anyone else
  can only leave. Someone added later sees unread messages only from the moment they were added.
- **Messages**: text (up to 4000 characters, links become clickable), photos (shrunk to 1600 px JPEG before upload) and
  files (PDF, Word, Excel, text/CSV, images, short MP4/MOV videos; 20 MB each). Files go to the private bucket `team-files` under
  `<org>/<chat>/...` and open through signed links that last one hour. Messages cannot be edited or deleted.
- **Unread**: there is a count on each chat and a badge on the nav item (`99+` at most). Opening a chat marks it read.
  The newest message is at the bottom, and the thread scrolls down when a message arrives, unless the person has
  scrolled up to read older ones.
- **Live updates**: Supabase realtime on `team_messages` inserts and `team_chats` changes, plus a 45-second poll that
  runs while the page is visible, as a fallback.
- **Phone alerts**: after a message is sent, the browser calls `POST /api/alerts {action: 'team-message'}`. The server
  claims the message once (`team_push_claim`) and sends FCM to the phones of the other people in the chat who have
  Team chat access and have not muted the chat. The sender never gets one. Alerts use the Android channel `team_chat`
  and are grouped per chat. Tapping one opens that chat. Each chat has a per-chat mute in its details.
- **Staff Access**: there is a new section "Team chat" with no actions. It defaults to Edit for every role, so it is
  ON by default.
  - **View**: read only. The composer shows a note and the person cannot start chats.
  - **None**: hides the page and stops alerts.
  - Role settings and personal overrides work as for other sections. A suspended member sees nothing.
  - In a paused workspace, people can read but not send.
- **Phone layout** (≤760 px): the list and the thread take turns full screen, with a back button, the same way as in
  the Inbox. The desktop layout shows the list and the thread side by side.

## Data (migration 0024)

| table | key | what |
|---|---|---|
| `team_chats` | (org_id, id) | `kind` all/direct/group, `name`, `dm_key` (sorted pair, unique), `created_by`, `last_at` |
| `team_chat_members` | (org_id, chat_id, staff_id) | `added_by`, `added_at`, `last_read_at`, `muted`. For All staff it holds only read time and mute rows; membership is everyone. |
| `team_messages` | id uuid | `chat_id`, `sender` (staff id), `body`, `file` {path, name, size, type, kind, w, h}, `created_at` (server clock), `notified_at` |

`push_devices.booking_alerts` (new column, default true): now every member's phone registers, so booking alerts are
limited to the phones whose member is the owner or an ops manager. This value is set again on every registration.

## Security model

- **Reads**: members can only SELECT, through row level security. They see a chat, its people and its messages only
  when `team_can_read` passes: they are an active, not suspended member of that org, have Team chat at View or Edit, and
  are in the chat (everyone is in All staff).
- **Message inserts** go straight to `team_messages` and pass only when all of these hold:
  - `team_can_send` passes: the workspace is not paused, the person has Edit, and they are in the chat.
  - `sender` is the caller.
  - Any file path is under `<org>/<chat>/`.

  Only these columns may be inserted: org_id, chat_id, sender, body, file. A trigger sets the server time, moves the
  chat's `last_at` and marks the chat read for the sender.
- **Everything else goes through security definer functions** with the same checks: making chats, managing groups,
  read time and mute. Nobody can UPDATE or DELETE rows directly.
- **Storage**: `team-files` is private, 20 MB, with a list of allowed types. Reading and uploading need the same rights
  as the chat in the path. Only the person who uploaded a file may delete it.
- **Realtime**: `team_messages` and `team_chats` are published, and realtime checks row level security on their
  inserts and updates. `team_chat_members` is deliberately NOT published, because realtime sends deletes to every
  subscriber without checking row level security. Membership changes instead touch the chat row
  (`update team_chats set last_at = last_at`), so the people still in the chat get an update event. A removed person's
  list catches up on the poll or on reload.
- **Push claim**: `team_push_claim` is service role only, works once per message, accepts only the sender of the
  message, and only within 15 minutes.
- **Isolation**: every table is keyed by org_id, and every check is per org.

## Local / demo mode

When there is no sign-in (the `--local` build, demo), `O.teamChat` keeps the chats in `O.store` under
`teamChat:<workspace>`, using the same rules from `teamchat.cjs`. The demo workspace comes with an All staff chat (4
messages), a "Housekeeping" group and one direct chat, so the owner starts with 3 unread. Files are kept as data URLs
of up to 1.5 MB. No alerts are sent.

## Tests

- `tests/teamchat.test.mjs` (in CI unit tests) covers:
  - The rules: list order, unread counts, read-since times, managing, direct keys, file checks, push text.
  - Every `t('key')` used by the page exists.
  - sendTeamPush, the `booking_alerts` filter on booking alerts, and the bridge and API wiring.
- `tests/sql/team_chat.sql` (in `tests/sql/run.sh`, on a local Postgres with Supabase and Storage stand-ins) covers:
  - All staff; groups and managing them; direct chats.
  - Server time; no updates or deletes.
  - File paths and the bucket.
  - View only, role and personal overrides, suspended members, a paused workspace, another workspace, anon.
  - The push claim (once, mute respected, the sender left out), grants, and the realtime tables.
- `tests/team_chat_e2e.mjs` (Playwright on the `--local` build at 390 px and on desktop) covers:
  - The badge; opening a chat marks it read.
  - Sending text and a photo; the newest message is at the bottom.
  - Making a group and a direct chat; managing and muting.
  - View only.

## Not verified here

These parts were tested only against stand-ins, not against the live Supabase project or FCM:
- Realtime delivery under row level security.
- Storage policies and signed links.
- Push delivery and the Android `team_chat` channel.
- `tests/e2e_server.py`, which needs Docker and Supabase, was not run.

## Known limits

- `reset_org` does not clear Team chat.
- Messages cannot be deleted or edited.
- Team chat is not on the phone tab bar; it is reached from the menu.
- While the app is open, the in-app sound for a new message is the same chime as for bookings.
