# Inbox: organising chats, deleting, photos and videos (2026-10-29)

Arnob: "Rename the Guest Inbox to Inbox, I want the option to put the chats on list, archive them, pin chats, mark as
read, mark as favourites, Also there needs to be options of sending images and videos from the app." Then: "I also need
the option to delete chats/emails from the inbox".

## What is there

- **Name.** The menu, Staff Access and every page say "Inbox". The route id (`inbox`) and the permission keys
  (`inbox`, `inbox.send`, `inbox.greetings`, ...) are unchanged, so saved role settings keep working.
- **Chat menu.** Every chat and email thread has a menu: the ⋯ button on hover (desktop), right-click, a long press on
  phones, and the ⋯ in the chat's header. It offers Pin / Unpin, Mark as read / unread, Add to favourites, Add to list,
  Archive / Unarchive and Delete (Restore and Delete forever in Deleted).
- **Lists.** Named lists shared by the workspace (blob `inboxLists`, up to 30). They show as chips next to the other
  filters; the list menu (⋯ above the chats) has Manage lists (add, rename, remove). A chat can be on several lists.
- **Favourites** are personal: each user's own star (`favBy` holds user ids). The Favourites chip shows the viewer's.
- **Archived.** Archived chats leave the main list; "Archived chats (n)" in the list menu opens them.
- **Email & updates tab.** The same menu without Favourites and Add to list (that tab has no filter chips). Delete there
  says "This email" or "These updates".
- **Deleted.** Delete asks first, then moves the chat to Deleted for 30 days, where it can be restored. "Delete forever"
  (edit level, asks first) removes its files, then the chat; the record stays as a tombstone (`deleted: true`) so
  phones that were offline drop it too instead of saving it back. If Storage fails, the chat stays in Deleted and can
  be tried again. Deleted also empties itself after 30 days (50 chats per run).
- **Mark all as read** in the list menu, for the chats shown.
- **Photos and videos** from the attach button: WhatsApp (JPEG/PNG up to 5 MB, MP4/3GPP up to 16 MB), email (as
  attachments) and booking sites through Channex (photos only). Videos play in the chat, both ways.

## Defaults chosen

- A message that counts as unread (from the guest, or a booking site's notification) brings a chat back from Archived
  and from Deleted, so no guest is missed. A team message does not.
- In the live app the flags (pinned, archived, lists, favBy, trashedAt, trashedBy) belong to the server: the page asks
  `api/messages.js` (`organize`, `lists`, `purge`) and a whole-record save cannot undo them (keep trigger, 0022).
- Organising and managing lists needs the inbox's edit level (`inbox.edit`); favourites only need to open the inbox.
- The 30-day clean-up runs when the inbox opens (`config`, that workspace) and in the nightly job (all workspaces).
- Files go from the browser straight to the private Storage bucket `inbox-media` with a signed upload address (Vercel
  caps request bodies at 4.5 MB); the server checks the stored file again before sending.
- On a booking site the caption goes as its own message after the photo (Channex ignores an attachment sent with text).
- A caption longer than 1,024 characters is sent as a separate text message.
- No multi-select yet: actions are per chat, plus Mark all as read.
- On phones the filter chips scroll sideways on one line; on a computer they wrap, so every list chip is visible.
- On a computer, when the open chat leaves the view (archived, deleted, another box or tab), the next chat opens only if
  it has no unread messages; otherwise the pane waits on "Choose a chat", so nothing is marked read unseen.
- Uploads that are never sent (cancelled, failed, window closed) are removed after 24 hours (table `inbox_uploads`).
- Lists change in one locked database step (`inbox_lists`), so two people editing lists at once do not lose a change.
- While Orbique is open (any page), a new message from a guest that arrives as a live update rings the alert chime
  (`O.alertSound`, muted per device on the Booking alerts card). Not on first load, and not for the team's messages.
- Booking-site photos go to Channex's booking address (`/bookings/:id/messages`, where `attachment_id` is documented)
  when the chat has a booking; text and captions still go to the thread.

## Not tested against the real services

Real Meta, Channex and Resend calls, and the Storage bucket on the real Supabase project, are covered by tests with
fakes only (`tests/inbox/organize.test.mjs`, `tests/sql/inbox_organize.sql`). The WhatsApp size limits come from Meta's
documentation as known, because Meta's pages could not be fetched here. The live (signed-in) page paths were not run in
a browser; demo mode was.
