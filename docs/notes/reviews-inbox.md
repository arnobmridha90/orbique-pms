# reviews + inbox progress (section agent)

Status: started 2026-10-07. Reading SPEC/core.

Done:
- (nothing yet)

Left:
- pages/reviews.js
- pages/inbox.js

Update 1: pages/reviews.js first full version written and renders (filters, KPIs, side panels, reply composer). Next: polish reviews, then build inbox.js.

Update 1: pages/reviews.js first full version written and renders (filters, KPIs, side panels, reply composer). Next: polish reviews, then build inbox.js.

Update 2: pages/inbox.js first full version written (list, chat, composer, attachments, voice recording + fallback, quick replies bar, slash menu, manager modal, new chat). Testing next.

Update 3: inbox voice recording verified with a fake mic (Playwright --use-fake-device-for-media-stream), attachments verified (photo, pdf, audio file). Fixed bubble time overlap (float meta), class collision with core `.note`. Next: quick replies manager, slash menu, phone layout, Otto, s2 viewer; then reviews phone/interactions.
Test harness: /tmp/v3-reviews-inbox/t.py <scenario.py> (scratch, not in project).

## Final status (6 Oct 2026)
- Reviews: on phone, the "Lowest" badge in Category scores now wraps under the label instead of overlapping the bar.
- Final shot.py runs pass with exit 0. Both pages were captured at desktop 1440, phone 390 (full page), Otto desktop and viewer s2, plus `--js` interactions. Horizontal overflow is 0 on phone.
- Interaction tests use /tmp/v3-reviews-inbox/t.py (Playwright with a fake mic). They cover real voice recording, the mic-denied fallback to the file picker, attachments, the slash menu for quick replies, internal notes, managing quick replies per unit, a review reply, a follow-up task and the edit flow.
- Both sections are done. Core issues are listed in earlier updates.
