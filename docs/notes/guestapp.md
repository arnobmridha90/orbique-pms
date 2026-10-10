# guestapp progress

File: pages/guestapp.js (CSS inside via O.css). Phone preview (left, sticky) + admin panel (right); stacked under 1180px.
Data added on load: D.guestApp (rules, videos, todo, dont, services, requireName, requireId), D.guestRequests (6 seeds),
D.damageReports (2 seeds, one linked to T-308, one to a seeded done task); bookings with codeStatus 'sent' and still live get b.rulesAccepted.

Done:
- [x] phone: rules gate (tick + typed name) -> home; door code gated by rules + ID (ID upload in app), Wi-Fi, facts, tiles, contact
- [x] phone: videos (CSS/SVG thumbnails, city chips, YouTube search links), explore (to do per city / not to do), requests (6 types, forms), damage report (photos required per item, multi-item, arrival prompt)
- [x] admin: KPIs, guest card (3 gate steps, verify ID, door code + O.lock.change, link copy/send), tabs: requests (confirm/decline/done, code-help -> change code), damage (photos modal, task link), rules editor, videos manager, local guide editor, request types switches
- [x] screenshots desktop / 390 / otto / s3 checked
Status: complete. All shot.py runs exit 0 (desktop, 390px, otto, s2, s3, interactions).
