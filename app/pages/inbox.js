/* Orbique Command Center v4 — Guest inbox (WhatsApp-style)
   Arnob: "Better to have the guest names on the left side and messages on the right, just like WhatsApp.
   Need options of adding and editing quick replies. Need to be able to attach. Also should be able to record
   and send voice notes. I should also be able to tag certain quick texts to certain units."
   - Left: chats (avatar, guest, property + stay, last message, time, unread), search, filters.
   - Right: chat header (guest, property, stay, status, platform; booking, door code, call), readiness strip,
     bubbles (guest left, team right in the brand colour, internal notes, system events, date dividers, ticks).
   - Composer: reply / internal note, attachments (photos with thumbnails, files with name + size),
     voice notes recorded with getUserMedia + MediaRecorder (live timer and level meter; falls back to an
     audio file when the microphone is unavailable), quick replies bar + "/" shortcut.
   - Quick replies manager: add, edit, delete, tag to units or all units, variables filled from the booking.
   Phone: chat list first, tap opens the chat with a back button. Honours ctx.params.bookingId.
   v4: property filter (All properties or one) on the chat list, remembered on this device (O.store 'inbox:prop'); it combines
   with the chips and the search. Permissions: inbox.send (reply to guests, new chats), inbox.notes (internal notes),
   inbox.quickReplies (manage quick replies), inbox edit level (assign, pin, mark unread), bookings.contacts (guest phone,
   masked otherwise), guestapp.doorCodes (door codes in quick replies and the lock button), invoices.send. Times use D.NOW.
   Live (server mode, api/messages.js): guest messages from WhatsApp arrive in the booking's chat (booking-site chat through
   Channex is built but switched off: CHANNEX_MESSAGES); replies go back the way the guest wrote, WhatsApp only within 24 hours
   of the guest's last WhatsApp message. Guest messages show in the team's language (inboxSettings.lang) with the original a tap
   away; "Translate" on a reply shows it in the guest's language to check before it goes. Chats from numbers or booking-site
   threads that match no booking wait at the top of the list to be linked. Photos, files and voice notes still go out only as
   internal notes; guests' WhatsApp files open through the server. Agoda's guest emails show only what the guest wrote
   (api/_lib/email-in.js agodaMessage); a special request carries Agoda's answer buttons (m.actions), which open Agoda's
   own page, and the chat notes the answer picked (c.picks by message xid: {label, at, staffId}). */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, fmt = O.fmt;

  /* ---- data fixes (reported to the lead) -------------------------------------------------------
     data.js links conversations to the FIRST booking with the guest's name. For guests whose name is also
     used by older generated bookings (Olivia Chen, Amira Hassan, Mohammed Al-Farsi) that is a stay from June.
     Re-link such conversations to the guest's booking closest in time to the conversation (the story booking). */
  D.conversations.forEach(function (c) {
    var last = c.messages.length ? c.messages[c.messages.length - 1].time.slice(0, 10) : D.TODAY;
    var b = D.booking(c.bookingId);
    function gap(x) { return last < x.checkIn ? d.diff(last, x.checkIn) : last > x.checkOut ? d.diff(x.checkOut, last) : 0; }
    if (!b || gap(b) <= 14) return;
    var cands = D.bookings.filter(function (x) { return x.guest.name === b.guest.name && x.status !== 'cancelled' && gap(x) <= 14; })
      .sort(function (x, y) { return x.id < y.id ? -1 : 1; }); /* hand-made story bookings have the lowest ids */
    if (cands[0]) c.bookingId = cands[0].id;
  });
  /* extra detail for the demo messages (transcript for the voice note, a drawn photo, assignee) */
  D.conversations.forEach(function (c) {
    c.messages.forEach(function (m) {
      if (m.type === 'voice' && !m.transcript && c.id === 'C-2') m.transcript = 'Amazing, thank you so much! We will come straight from the airport, so see you at twelve.';
      if (m.type === 'image' && !m.art && /sink/i.test(m.text)) m.art = 'sink';
    });
    if (!c.assigneeId) { var sm = c.messages.filter(function (m) { return m.from === 'staff' && m.staffId; }).pop(); c.assigneeId = sm ? sm.staffId : 's4'; }
  });

  var st = { sel: null, view: 'list', tab: 'guests', filter: 'all', q: '', prop: null, mode: 'reply', drafts: {}, pending: {}, unreadMark: {}, rec: null, told: false, qrSel: 0 };
  var player = { key: null, audio: null, raf: 0, t0: 0, dur: 0 };
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var VARS = [['guest_first', 'Guest first name'], ['property', 'Property'], ['wifi_name', 'Wi-Fi name'], ['wifi_password', 'Wi-Fi password'], ['parking', 'Parking'], ['checkin_time', 'Check-in time'], ['checkout_time', 'Check-out time'], ['door_code', 'Door code']];
  var PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
  var PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>';
  var PIN_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15.5 2.5 21.5 8.5l-2.2.6-3.6 3.6.4 4.6-1.8 1.8-4.1-4.1L5 20.2 3.8 19l5.2-5.2-4.1-4.1 1.8-1.8 4.6.4 3.6-3.6z"/></svg>';
  var TICK1 = '<svg class="tick" viewBox="0 0 16 11" aria-hidden="true"><path d="M1.5 5.8 4.8 9 11 1.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var TICK2 = '<svg class="tick" viewBox="0 0 16 11" aria-hidden="true"><path d="M1 5.8 4.3 9 10.5 1.8M7.2 8.2 8 9l6.2-7.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ------------------------------------------------------------------ styles */
  O.css('inbox', `
.pg-inbox{margin-bottom:-48px;}
.pg-inbox .ib{display:grid;grid-template-columns:376px minmax(0,1fr);height:calc(100vh - 100px);height:calc(100dvh - 100px);min-height:540px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--shadow);overflow:hidden;}
.pg-inbox svg{width:18px;height:18px;flex-shrink:0;}
/* ---------- left: chat list ---------- */
.pg-inbox .ib-list{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--border);background:var(--surface);}
.pg-inbox .ib-lhead{display:flex;align-items:center;gap:8px;padding:12px 12px 8px 16px;}
.pg-inbox .ib-lhead h2{font-size:17px;font-weight:800;flex:1;}
.pg-inbox .ib-ic{width:36px;height:36px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;border:none;background:none;color:var(--text-2);text-decoration:none;flex-shrink:0;}
.pg-inbox .ib-ic:hover{background:var(--surface-2);}
.pg-inbox .ib-ic svg{width:19px;height:19px;}
.pg-inbox .ib-tools{display:flex;gap:8px;margin:0 12px 8px;align-items:center;}
.pg-inbox .ib-tools .ib-search{margin:0;flex:1;min-width:0;}
.pg-inbox .ib-propsel{width:auto;max-width:46%;height:36px;padding-top:0;padding-bottom:0;font-size:12.5px;font-weight:700;}
.pg-inbox .ib-propsel.on{border-color:var(--brand-strong);background-color:var(--brand-soft-2);color:var(--brand-text);}
.pg-inbox .ib-empty{text-align:center;padding:0 16px 20px;}
.pg-inbox .ib-ro{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted);background:var(--surface-2);border:1px dashed var(--border-strong);border-radius:12px;padding:10px 12px;}
.pg-inbox .ib-ro svg{width:15px;height:15px;}
.pg-inbox .ib-stay .asg .who-plain{font-weight:700;color:var(--text-2);white-space:nowrap;}
.pg-inbox .ib-who.static{cursor:default;} .pg-inbox .ib-who.static:hover{background:none;}
.pg-inbox .ib-ic[disabled]{opacity:0.4;cursor:not-allowed;}
.pg-inbox .ib-search{margin:0 12px 8px;display:flex;align-items:center;gap:8px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:0 10px;height:36px;}
.pg-inbox .ib-search svg{width:15px;height:15px;color:var(--faint);}
.pg-inbox .ib-search input{border:none;background:none;outline:none;width:100%;font-size:13px;}
.pg-inbox .ib-filters{display:flex;gap:4px;padding:0 12px 10px;flex-wrap:wrap;}
.pg-inbox .ib-filters .chip{padding:4px 9px;font-size:11.5px;min-height:30px;gap:4px;}
.pg-inbox .ib-rows{flex:1;overflow-y:auto;border-top:1px solid var(--border);}
.pg-inbox .cv{display:flex;gap:12px;align-items:center;width:100%;padding:10px 14px 10px 16px;background:none;border:none;border-bottom:1px solid var(--border);text-align:left;position:relative;}
.pg-inbox .cv:hover{background:var(--surface-2);}
.pg-inbox .cv.on{background:var(--brand-soft-2);box-shadow:inset 3px 0 0 var(--brand-strong);}
.pg-inbox .cv .avatar{width:46px;height:46px;font-size:15px;}
.pg-inbox .cv-av{position:relative;flex-shrink:0;}
.pg-inbox .cv-av .plat-ic{position:absolute;right:-2px;bottom:-2px;width:18px;height:18px;font-size:9px;box-shadow:0 0 0 2px var(--surface);}
.pg-inbox .cv-main{flex:1;min-width:0;}
.pg-inbox .cv-l1{display:flex;align-items:baseline;gap:8px;}
.pg-inbox .cv-name{font-weight:700;font-size:14px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pg-inbox .cv-time{font-size:11.5px;color:var(--muted);white-space:nowrap;}
.pg-inbox .cv.unread .cv-time{color:var(--brand-text);font-weight:700;}
.pg-inbox .cv-l2{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted);margin-top:1px;white-space:nowrap;min-width:0;}
.pg-inbox .cv-l2 .cv-st{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;}
.pg-inbox .cv-l2 .sd{flex-shrink:0;}
.pg-inbox .cv-l2 .soon{color:var(--brand-text);font-weight:700;}
.pg-inbox .cv-l2 .sd{font-size:10px;font-weight:800;padding:0 6px;border-radius:10px;background:var(--warn-soft);color:var(--warn);}
.pg-inbox .cv-l3{display:flex;align-items:center;gap:6px;margin-top:3px;}
.pg-inbox .cv-prev{flex:1;min-width:0;font-size:13px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:4px;}
.pg-inbox .cv-prev svg{width:14px;height:14px;color:var(--muted);}
.pg-inbox .cv-prev .tick{width:16px;height:11px;color:var(--muted);}
.pg-inbox .cv-prev .tick.read{color:var(--info);}
.pg-inbox .cv-prev .who{color:var(--muted);}
.pg-inbox .cv-prev .sys{font-style:italic;color:var(--muted);}
.pg-inbox .cv.unread .cv-name{font-weight:800;}
.pg-inbox .cv.unread .cv-prev{color:var(--text);font-weight:600;}
.pg-inbox .cv-badge{min-width:20px;height:20px;border-radius:10px;padding:0 6px;background:var(--brand);color:var(--brand-ink);font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums;}
.pg-inbox .cv-pin{color:var(--faint);}
.pg-inbox .cv-pin svg{width:13px;height:13px;}
.pg-inbox .ib-lfoot{padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--muted);display:flex;gap:6px;align-items:center;background:var(--surface-2);}
.pg-inbox .ib-lfoot svg{width:13px;height:13px;}
/* ---------- right: chat ---------- */
.pg-inbox .ib-chat{display:flex;flex-direction:column;min-width:0;min-height:0;position:relative;}
.pg-inbox .ib-head{display:flex;align-items:center;gap:10px;padding:8px 10px 8px 14px;border-bottom:1px solid var(--border);background:var(--surface);min-height:60px;}
.pg-inbox .ib-back{display:none;}
.pg-inbox .ib-who{flex:1;min-width:0;display:flex;align-items:center;gap:11px;background:none;border:none;padding:4px;border-radius:10px;text-align:left;}
.pg-inbox .ib-who:hover{background:var(--surface-2);}
.pg-inbox .ib-who .avatar{width:40px;height:40px;font-size:14px;}
.pg-inbox .ib-who-t{min-width:0;}
.pg-inbox .ib-who-n{display:flex;align-items:center;gap:8px;font-weight:800;font-size:14.5px;white-space:nowrap;}
.pg-inbox .ib-who-n span.ib-nm{overflow:hidden;text-overflow:ellipsis;}
.pg-inbox .ib-who-s{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;display:flex;align-items:center;gap:6px;}
.pg-inbox .ib-who-s .plat-ic{width:15px;height:15px;font-size:8px;box-shadow:none;}
.pg-inbox .ib-who-s > span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis;}
.pg-inbox .ib-hacts{display:flex;align-items:center;gap:2px;}
.pg-inbox .ib-more{position:relative;}
.pg-inbox .ib-menu{display:none;position:absolute;right:0;top:calc(100% + 4px);background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-lg);z-index:30;min-width:220px;max-width:calc(100vw - 24px);overflow:hidden;}
.pg-inbox .ib-menu.open{display:block;}
.pg-inbox .ib-menu button{display:flex;align-items:center;gap:10px;width:100%;padding:10px 14px;background:none;border:none;border-top:1px solid var(--border);font-size:13px;text-align:left;white-space:nowrap;min-height:40px;}
.pg-inbox .ib-menu button:first-child{border-top:none;}
.pg-inbox .ib-menu button:hover{background:var(--surface-2);}
.pg-inbox .ib-menu svg{width:15px;height:15px;color:var(--muted);}
.pg-inbox .ib-stay{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;padding:7px 14px;border-bottom:1px solid var(--border);background:var(--surface-2);font-size:12px;}
.pg-inbox .ib-stay .when{font-weight:700;color:var(--text-2);display:inline-flex;align-items:center;gap:6px;}
.pg-inbox .ib-stay .when svg{width:14px;height:14px;color:var(--muted);}
.pg-inbox .ib-stay .asg{margin-left:auto;display:flex;align-items:center;gap:6px;color:var(--muted);}
.pg-inbox .ib-stay .asg .select{width:auto;padding:4px 26px 4px 8px;font-size:12px;height:30px;}
.pg-inbox .ib-thread{flex:1;overflow-y:auto;padding:14px 6% 10px;background-color:var(--bg);background-image:radial-gradient(circle at 1px 1px,var(--border) 1px,transparent 0);background-size:18px 18px;display:flex;flex-direction:column;gap:2px;}
.pg-inbox .ib-thread > :first-child{margin-top:auto;}
.pg-inbox .day{align-self:center;margin:10px 0 8px;background:var(--surface);color:var(--text-2);font-size:11.5px;font-weight:700;padding:4px 12px;border-radius:8px;box-shadow:0 1px 0.5px rgba(16,24,40,0.12);}
.pg-inbox .unread-div{align-self:stretch;text-align:center;margin:8px -6% ;padding:4px 0;background:var(--surface);color:var(--brand-text);font-size:11.5px;font-weight:800;box-shadow:0 1px 0.5px rgba(16,24,40,0.08);}
.pg-inbox .sysm{align-self:center;max-width:82%;margin:6px 0;background:var(--surface);border:1px solid var(--border);color:var(--text-2);font-size:12px;padding:5px 12px;border-radius:8px;text-align:center;display:flex;align-items:center;gap:7px;line-height:1.4;}
.pg-inbox .sysm svg{width:14px;height:14px;color:var(--muted);}
.pg-inbox .sysm .t{color:var(--faint);font-size:11px;white-space:nowrap;}
.pg-inbox .sysm.rich{text-align:left;align-items:flex-start;max-width:92%;}
.pg-inbox .sysm.rich svg{margin-top:2px;}
.pg-inbox .sysm .lk{display:inline;margin-left:6px;font-weight:700;color:var(--brand-text);background:none;border:0;padding:0;cursor:pointer;font-size:12px;}
.pg-inbox .sysb{margin-top:4px;}
.pg-inbox .sysb summary{cursor:pointer;color:var(--brand-text);font-weight:700;}
.pg-inbox .sysb-t{margin-top:6px;white-space:pre-wrap;word-break:break-word;max-height:360px;overflow:auto;background:var(--surface-2);border-radius:8px;padding:8px 10px;color:var(--text);font-size:12.5px;}
.pg-inbox .sysb-t a,.pg-inbox .txt a{color:var(--brand-text);text-decoration:underline;}
.pg-inbox .bub .subj{font-weight:700;font-size:12px;margin-bottom:3px;}
.pg-inbox .bub .efiles{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--muted);margin-top:5px;}
.pg-inbox .bub .efiles svg{width:12px;height:12px;}
.pg-inbox .bub .acts{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px;padding-top:7px;border-top:1px solid var(--border);}
.pg-inbox .bub .acts .acts-h{flex-basis:100%;font-size:11.5px;color:var(--muted);}
.pg-inbox .bub .acts .acts-h b{color:var(--text);}
.pg-inbox .bub .acts a.act{display:inline-flex;align-items:center;min-height:30px;padding:4px 12px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--brand-text);font-size:12.5px;font-weight:700;text-decoration:none;}
.pg-inbox .bub .acts a.act:hover{border-color:var(--brand);}
.pg-inbox .bub .acts a.act.on{background:var(--brand);border-color:var(--brand);color:var(--brand-ink);}
.pg-inbox .bub .acts span.act{display:inline-flex;align-items:center;min-height:30px;padding:4px 12px;border-radius:999px;border:1px dashed var(--border);color:var(--muted);font-size:12.5px;}
.pg-inbox .ib-tabs{display:flex;gap:4px;margin:0 12px 8px;padding:3px;border-radius:10px;background:var(--surface-2);}
.pg-inbox .ib-tabs button{flex:1;border:0;background:none;border-radius:8px;padding:6px 8px;font-size:12.5px;font-weight:700;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;}
.pg-inbox .ib-tabs button.on{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.08);}
.pg-inbox .ib-tabs .n{background:var(--brand);color:#fff;border-radius:9px;padding:0 6px;font-size:10.5px;line-height:16px;}
.pg-inbox .cv-feed{display:inline-flex;width:36px;height:36px;border-radius:50%;align-items:center;justify-content:center;background:var(--surface-2);}
.pg-inbox .cv-feed.lg{width:44px;height:44px;}
.pg-inbox .cv-feed .plat-ic{position:static;width:24px;height:24px;font-size:11px;box-shadow:none;}
.pg-inbox .cv-feed svg{width:18px;height:18px;color:var(--muted);}
.pg-inbox .msg{display:flex;flex-direction:column;max-width:min(560px,78%);}
.pg-inbox .msg.in{align-self:flex-start;}
.pg-inbox .msg.out, .pg-inbox .msg.inote{align-self:flex-end;}
.pg-inbox .msg.first{margin-top:8px;}
.pg-inbox .bub{position:relative;display:flow-root;padding:6px 9px 8px 10px;border-radius:9px;font-size:13.5px;line-height:1.42;box-shadow:0 1px 0.5px rgba(16,24,40,0.13);overflow-wrap:anywhere;}
.pg-inbox .msg.in .bub{background:var(--surface);color:var(--text);}
.pg-inbox .msg.out .bub{background:var(--brand);color:var(--brand-ink);}
.pg-inbox .msg.inote .bub{background:var(--warn-soft);color:var(--text);border:1px dashed var(--warn);box-shadow:none;}
.pg-inbox .msg.first.in .bub{border-top-left-radius:0;}
.pg-inbox .msg.first.out .bub{border-top-right-radius:0;}
.pg-inbox .msg.first.in .bub::before{content:"";position:absolute;top:0;left:-7px;border-top:9px solid var(--surface);border-left:8px solid transparent;}
.pg-inbox .msg.first.out .bub::before{content:"";position:absolute;top:0;right:-7px;border-top:9px solid var(--brand);border-right:8px solid transparent;}
.pg-inbox .bub .who{font-size:11.5px;font-weight:800;margin-bottom:2px;opacity:0.85;display:flex;align-items:center;gap:5px;}
.pg-inbox .msg.inote .bub .who{color:var(--warn);opacity:1;}
.pg-inbox .bub .who svg{width:12px;height:12px;}
.pg-inbox .bub .txt{white-space:pre-wrap;}
.pg-inbox .bub .txt b.mention{color:var(--warn);}
.pg-inbox .bub .meta{float:right;position:relative;margin:8px 0 -5px 12px;display:inline-flex;align-items:center;gap:3px;font-size:10.5px;line-height:1.2;opacity:0.72;white-space:nowrap;}
.pg-inbox .msg.in .bub .meta{color:var(--muted);opacity:1;}
.pg-inbox .bub .meta .tick{width:16px;height:11px;}
.pg-inbox .bub .meta .tick.read{opacity:1;}
.pg-inbox .msg.out .bub .meta{opacity:0.8;}
.pg-inbox .via{font-size:10.5px;color:var(--faint);margin:2px 4px 0;text-align:right;}
/* attachments in bubbles */
.pg-inbox .bub.media{padding:4px 4px 6px;}
.pg-inbox .bub.media .who{padding:2px 6px 0;}
.pg-inbox .img-btn{display:block;padding:0;border:none;background:none;border-radius:7px;overflow:hidden;cursor:zoom-in;max-width:300px;}
.pg-inbox .img-btn img{display:block;max-width:300px;width:100%;max-height:320px;object-fit:cover;}
.pg-inbox .img-btn .art{display:block;width:300px;max-width:100%;height:auto;}
.pg-inbox .bub.media .cap{padding:4px 6px 0;white-space:pre-wrap;}
.pg-inbox .bub.media .meta{position:absolute;float:none;margin:0;right:10px;bottom:10px;background:rgba(10,15,25,0.5);color:#FFFFFF;opacity:1;padding:1px 6px;border-radius:8px;}
.pg-inbox .msg .bub.media:not(.hascap):not(.isfile) .meta{color:#FFFFFF;opacity:1;}
.pg-inbox .bub.media.hascap .meta, .pg-inbox .bub.media.isfile .meta{position:relative;float:right;right:auto;bottom:auto;background:none;color:inherit;opacity:0.72;margin:6px 4px -2px 12px;padding:0;}
.pg-inbox .msg.in .bub.media.hascap .meta, .pg-inbox .msg.in .bub.media.isfile .meta{color:var(--muted);opacity:1;}
.pg-inbox .bub.vbub .meta{position:absolute;float:none;margin:0;right:8px;bottom:5px;}
.pg-inbox .fileb{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:7px;background:rgba(127,127,127,0.12);min-width:220px;max-width:320px;}
.pg-inbox .fileb .fi{width:36px;height:42px;border-radius:5px;background:var(--surface);border:1px solid var(--border);display:flex;align-items:flex-end;justify-content:center;font-size:9px;font-weight:800;color:var(--bad);padding-bottom:5px;flex-shrink:0;position:relative;}
.pg-inbox .fileb .fi.doc{color:var(--info);} .pg-inbox .fileb .fi.img{color:var(--ok);} .pg-inbox .fileb .fi.gen{color:var(--muted);}
.pg-inbox .fileb .fi::before{content:"";position:absolute;top:-1px;right:-1px;border-top:10px solid var(--bg);border-left:10px solid var(--border);}
.pg-inbox .fileb .fn{flex:1;min-width:0;}
.pg-inbox .fileb .fn b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pg-inbox .fileb .fn span{font-size:11px;opacity:0.75;}
.pg-inbox .fileb .dl{width:32px;height:32px;border-radius:50%;border:1px solid currentColor;display:inline-flex;align-items:center;justify-content:center;background:none;color:inherit;opacity:0.75;flex-shrink:0;}
.pg-inbox .fileb .dl svg{width:15px;height:15px;}
.pg-inbox .voice{display:flex;align-items:center;gap:10px;min-width:250px;max-width:320px;padding:4px 2px 2px 2px;}
.pg-inbox .voice .vw{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;padding-top:12px;}
.pg-inbox .voice .vp{width:36px;height:36px;border-radius:50%;border:none;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.pg-inbox .msg.in .voice .vp, .pg-inbox .msg.inote .voice .vp{background:var(--brand);color:var(--brand-ink);}
.pg-inbox .msg.out .voice .vp{background:var(--brand-ink);color:var(--brand);}
.pg-inbox .voice .vp svg{width:16px;height:16px;}
.pg-inbox .voice .wave{display:flex;align-items:center;gap:2px;height:26px;min-width:0;}
.pg-inbox .voice .wave i{flex:1;min-width:2px;max-width:4px;border-radius:2px;background:currentColor;opacity:0.35;}
.pg-inbox .voice .wave i.p{opacity:1;}
.pg-inbox .voice .vd{font-size:10.5px;opacity:0.75;font-variant-numeric:tabular-nums;height:13px;}
.pg-inbox .msg.in .voice .vd{color:var(--muted);opacity:1;}
.pg-inbox .voice .vav{position:relative;flex-shrink:0;}
.pg-inbox .voice .vav .avatar{width:38px;height:38px;}
.pg-inbox .voice .vav svg{position:absolute;right:-3px;bottom:-2px;width:16px;height:16px;padding:2px;border-radius:50%;background:var(--surface);color:var(--ok);}
.pg-inbox .trans{font-size:12px;margin:2px 6px 0;padding:6px 8px;border-radius:6px;background:rgba(127,127,127,0.1);font-style:italic;}
.pg-inbox .trans-t{border:none;background:none;padding:4px 6px 0;font-size:11px;font-weight:700;color:inherit;opacity:0.8;text-decoration:underline;}
/* empty chat / nothing selected */
.pg-inbox .ib-none{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;padding:30px;color:var(--muted);background:var(--surface-2);}
.pg-inbox .ib-none .art{width:120px;height:120px;border-radius:50%;background:var(--brand-soft);display:flex;align-items:center;justify-content:center;color:var(--brand-strong);}
.pg-inbox .ib-none .art svg{width:52px;height:52px;}
.pg-inbox .ib-none h3{color:var(--text);font-size:18px;}
.pg-inbox .ib-hello{align-self:center;max-width:360px;text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;font-size:13px;color:var(--text-2);margin:auto 0;}
/* ---------- composer ---------- */
.pg-inbox .ib-compose{border-top:1px solid var(--border);background:var(--surface);padding:8px 10px 10px;display:flex;flex-direction:column;gap:7px;position:relative;}
.pg-inbox .qr-bar{display:flex;align-items:center;gap:6px;overflow-x:auto;scrollbar-width:thin;padding-bottom:2px;}
.pg-inbox .qr-bar .lbl{font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap;margin-right:2px;display:inline-flex;align-items:center;gap:4px;}
.pg-inbox .qr-bar .lbl svg{width:13px;height:13px;}
.pg-inbox .qr{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;border:1px solid var(--border);background:var(--surface);border-radius:16px;padding:5px 10px;font-size:12px;font-weight:700;color:var(--text-2);flex-shrink:0;min-height:30px;}
.pg-inbox .qr:hover{border-color:var(--brand-strong);color:var(--brand-text);}
.pg-inbox .qr .unit{display:inline-flex;align-items:center;gap:3px;font-size:10.5px;font-weight:800;color:var(--brand-text);background:var(--brand-soft);border-radius:10px;padding:0 6px;}
.pg-inbox .qr .unit svg{width:11px;height:11px;}
.pg-inbox .qr.manage{border-style:dashed;color:var(--muted);}
.pg-inbox .qr.manage svg{width:13px;height:13px;}
.pg-inbox .cmp-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.pg-inbox .cmp-top .seg button{padding:4px 10px;font-size:12px;}
.pg-inbox .cmp-hint{font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:6px;min-width:0;flex:1;}
.pg-inbox .cmp-hint svg{width:13px;height:13px;}
.pg-inbox .cmp-hint .k{margin-left:auto;color:var(--faint);white-space:nowrap;}
.pg-inbox .cmp-bar{display:flex;align-items:flex-end;gap:6px;}
.pg-inbox .cmp-box{flex:1;min-width:0;display:flex;align-items:flex-end;background:var(--surface-2);border:1px solid var(--border);border-radius:22px;padding:2px 6px 2px 14px;}
.pg-inbox .cmp-box:focus-within{border-color:var(--brand-strong);}
.pg-inbox .cmp-box textarea{flex:1;border:none;background:none;outline:none;resize:none;font-size:14px;line-height:1.4;padding:9px 0;max-height:140px;min-height:40px;color:var(--text);}
.pg-inbox .ib-compose.is-note .cmp-box{background:var(--warn-soft);border:1px dashed var(--warn);}
.pg-inbox .round{width:42px;height:42px;border-radius:50%;border:none;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.pg-inbox .round.plain{background:none;color:var(--text-2);}
.pg-inbox .round.plain:hover{background:var(--surface-2);}
.pg-inbox .round.go{background:var(--brand);color:var(--brand-ink);}
.pg-inbox .round.go:hover{background:var(--brand-hover);}
.pg-inbox .round svg{width:20px;height:20px;}
.pg-inbox .round.plain.on{background:var(--brand-soft);color:var(--brand-text);}
.pg-inbox .att-menu{display:none;position:absolute;left:10px;bottom:calc(100% - 4px);background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow-lg);padding:6px;z-index:25;min-width:230px;}
.pg-inbox .att-menu.open{display:block;}
.pg-inbox .att-menu button{display:flex;align-items:center;gap:12px;width:100%;padding:9px 10px;border:none;background:none;border-radius:9px;font-size:13px;font-weight:600;text-align:left;}
.pg-inbox .att-menu button:hover{background:var(--surface-2);}
.pg-inbox .att-menu .ai{width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--brand-soft);color:var(--brand-strong);}
.pg-inbox .att-menu .ai svg{width:16px;height:16px;}
.pg-inbox .att-menu small{display:block;font-size:11px;color:var(--muted);font-weight:500;}
.pg-inbox .tray{display:flex;gap:8px;overflow-x:auto;padding:2px 0;}
.pg-inbox .tray-it{position:relative;flex-shrink:0;width:86px;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--surface-2);}
.pg-inbox .tray-it img{display:block;width:86px;height:64px;object-fit:cover;}
.pg-inbox .tray-it .tf{height:64px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--muted);}
.pg-inbox .tray-it .tf svg{width:22px;height:22px;}
.pg-inbox .tray-it .tn{font-size:10.5px;padding:3px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-top:1px solid var(--border);background:var(--surface);}
.pg-inbox .tray-it .rm{position:absolute;top:3px;right:3px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(10,15,25,0.6);color:#FFFFFF;display:flex;align-items:center;justify-content:center;padding:0;}
.pg-inbox .tray-it .rm svg{width:12px;height:12px;}
.pg-inbox .rec{display:flex;align-items:center;gap:10px;background:var(--surface-2);border:1px solid var(--border);border-radius:22px;padding:4px 6px 4px 8px;flex:1;min-width:0;height:44px;}
.pg-inbox .rec .dot{width:10px;height:10px;border-radius:50%;background:var(--bad);flex-shrink:0;animation:ibpulse 1s ease-in-out infinite;}
.pg-inbox .rec.paused .dot{animation:none;opacity:0.4;}
.pg-inbox .rec .ib-rtm{font-variant-numeric:tabular-nums;font-weight:800;font-size:14px;min-width:42px;}
.pg-inbox .rec .lv{flex:1;display:flex;align-items:center;justify-content:flex-end;gap:2px;height:28px;overflow:hidden;min-width:0;color:var(--brand-strong);}
.pg-inbox .rec .lv i{width:3px;flex-shrink:0;border-radius:2px;background:currentColor;}
.pg-inbox .rec .rl{font-size:11.5px;color:var(--muted);white-space:nowrap;}
@keyframes ibpulse{0%,100%{opacity:1;}50%{opacity:0.25;}}
@media (prefers-reduced-motion: reduce){ .pg-inbox .rec .dot{animation:none;} }
.pg-inbox .slash{position:absolute;left:10px;right:10px;bottom:calc(100% - 2px);background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-lg);z-index:24;max-height:260px;overflow-y:auto;}
.pg-inbox .slash .sh{padding:8px 12px 4px;font-size:10.5px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;}
.pg-inbox .slash button{display:block;width:100%;padding:8px 12px;border:none;background:none;text-align:left;border-top:1px solid var(--border);}
.pg-inbox .slash button.on, .pg-inbox .slash button:hover{background:var(--brand-soft-2);}
.pg-inbox .slash b{font-size:13px;} .pg-inbox .slash span{display:block;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
/* ---------- quick replies manager (modal, rendered in body) ---------- */
.ib-qrm{display:flex;flex-direction:column;gap:12px;}
.ib-qrm .qrm-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.ib-qrm .qrm-bar .select{width:auto;min-width:200px;}
.ib-qrm .qrm-bar .btn{margin-left:auto;}
.ib-qrm .qrm-row{border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:flex;gap:12px;align-items:flex-start;}
.ib-qrm .qrm-row .m{flex:1;min-width:0;}
.ib-qrm .qrm-row .t{font-weight:800;font-size:13.5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.ib-qrm .qrm-row .x{font-size:12.5px;color:var(--text-2);margin-top:4px;line-height:1.45;}
.ib-qrm .var{font-family:ui-monospace,Menlo,monospace;font-size:11px;background:var(--brand-soft);color:var(--brand-text);border-radius:5px;padding:0 4px;}
.ib-qrm .tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:7px;}
.ib-qrm .acts{display:flex;gap:4px;flex-shrink:0;}
.ib-qrm .acts .btn svg{width:13px;height:13px;}
.ib-qrm .qrm-ed{border:1px solid var(--brand-strong);border-radius:12px;padding:14px;background:var(--brand-soft-2);display:flex;flex-direction:column;gap:12px;}
.ib-qrm .vars{display:flex;gap:5px;flex-wrap:wrap;}
.ib-qrm .vars button{border:1px solid var(--border);background:var(--surface);border-radius:14px;padding:3px 9px;font-size:11.5px;font-weight:700;color:var(--text-2);}
.ib-qrm .vars button:hover{border-color:var(--brand-strong);color:var(--brand-text);}
.ib-qrm .units{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;}
.ib-qrm .units label{display:flex;align-items:center;gap:7px;border:1px solid var(--border);background:var(--surface);border-radius:8px;padding:7px 9px;font-size:12.5px;font-weight:600;cursor:pointer;min-width:0;}
.ib-qrm .units label span.ib-nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ib-qrm .units label.on{border-color:var(--brand-strong);background:var(--brand-soft);}
.ib-qrm .units input{accent-color:var(--brand-strong);width:15px;height:15px;margin:0;flex-shrink:0;}
.ib-qrm .scope{display:flex;gap:16px;flex-wrap:wrap;}
.ib-qrm .pv{background:var(--bg);border-radius:10px;padding:10px;}
.ib-qrm .pv .pvb{background:var(--brand);color:var(--brand-ink);border-radius:9px 0 9px 9px;padding:8px 10px;font-size:13px;margin-left:auto;max-width:90%;width:fit-content;white-space:pre-wrap;}
.ib-qrm .err{color:var(--bad);font-size:12px;font-weight:600;}
.ib-qrm .confirm{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:var(--bad);flex-wrap:wrap;}
.ib-lightbox{display:flex;justify-content:center;background:var(--bg);border-radius:10px;padding:10px;}
.ib-lightbox img, .ib-lightbox svg{max-width:100%;max-height:70vh;display:block;border-radius:8px;}
/* ---------- responsive ---------- */
@media (max-width:1100px){ .pg-inbox .ib{grid-template-columns:300px minmax(0,1fr);} .pg-inbox .ib-thread{padding:12px 3% 10px;} .pg-inbox .cmp-hint .k{display:none;}
  .pg-inbox .ib-stay{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;} .pg-inbox .ib-stay .when{white-space:nowrap;} .pg-inbox .ib-stay .ready{flex-wrap:nowrap;} .pg-inbox .ib-stay .asg span{display:none;} .pg-inbox .qr-bar .lbl{display:none;} }
@media (max-width:960px){ .pg-inbox{margin-bottom:-42px;} .pg-inbox .ib{height:calc(100vh - 84px);height:calc(100dvh - 84px);} }
@media (max-width:760px){
  /* fill the space between the top bar and the tab bar, so the composer is never behind the tab bar (JS refines the height) */
  .pg-inbox{margin:-14px -14px calc(-84px - env(safe-area-inset-bottom));}
  .pg-inbox .ib{display:block;height:calc(100vh - 59px - 61px);height:calc(100dvh - 59px - 61px - env(safe-area-inset-bottom));min-height:0;border:none;border-radius:0;box-shadow:none;}
  .pg-inbox .ib-tools{flex-wrap:wrap;}
  .pg-inbox .ib-tools .ib-search{flex:1 1 100%;height:40px;}
  .pg-inbox .ib-propsel{flex:1 1 100%;max-width:none;height:40px;}
  .pg-inbox .ib-filters .chip{min-height:40px;padding:6px 11px;}
  .pg-inbox .ib-ic{width:40px;height:40px;}
  .pg-inbox .qr{min-height:40px;}
  .pg-inbox .cmp-top .seg button{min-height:40px;}
  .pg-inbox .ib-stay .asg .select{height:40px;}
  .pg-inbox .trans-t{min-height:40px;}
  .pg-inbox .ib-list, .pg-inbox .ib-chat{height:100%;}
  .pg-inbox .ib.show-chat .ib-list{display:none;}
  .pg-inbox .ib:not(.show-chat) .ib-chat{display:none;}
  .pg-inbox .ib-list{border-right:none;}
  .pg-inbox .ib-back{display:inline-flex;}
  .pg-inbox .ib-head{padding:6px 4px 6px 2px;gap:2px;}
  .pg-inbox .ib-who{padding:2px;gap:9px;}
  .pg-inbox .ib-who .avatar{width:36px;height:36px;}
  .pg-inbox .ib-who-n .st{display:none;}
  .pg-inbox .ib-hacts .hide-sm{display:none;}
  .pg-inbox .ib-stay{padding:6px 10px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;}
  .pg-inbox .ib-stay .when{white-space:nowrap;}
  .pg-inbox .ib-stay .ready{flex-wrap:nowrap;}
  .pg-inbox .ib-stay .asg{margin-left:0;}
  .pg-inbox .ib-stay .asg span{display:none;}
  .pg-inbox .qr-bar .lbl{display:none;}
  .pg-inbox .ib-thread{padding:10px 10px 8px;}
  .pg-inbox .unread-div{margin:8px -10px;}
  .pg-inbox .msg{max-width:86%;}
  .pg-inbox .voice{min-width:200px;}
  .pg-inbox .img-btn, .pg-inbox .img-btn img{max-width:230px;}
  .pg-inbox .ib-compose{padding:6px 6px 8px;}
  .pg-inbox .cmp-hint{display:none;}
  .pg-inbox .cmp-hint.only{display:flex;font-size:12px;}
  .pg-inbox .round{width:40px;height:40px;}
  .ib-qrm .units{grid-template-columns:repeat(2,minmax(0,1fr));}
  .ib-qrm .qrm-row{flex-direction:column;}
}
`);

  O.css('inbox-live', `
.pg-inbox .xl{display:block;font-size:11px;margin-top:4px;opacity:0.85;}
.pg-inbox .xl button{border:none;background:none;padding:0;font:inherit;font-weight:700;color:inherit;text-decoration:underline;cursor:pointer;}
.pg-inbox .xl .orig{display:block;margin-top:3px;padding:5px 8px;border-radius:6px;background:rgba(127,127,127,0.12);font-style:italic;white-space:pre-wrap;}
.pg-inbox .via.bad{color:var(--bad);font-weight:700;}
.pg-inbox .tick.failed{color:var(--bad);font-weight:800;font-size:12px;line-height:1;}
.pg-inbox .cmp-route{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap;}
.pg-inbox .cmp-route select{height:28px;padding-top:0;padding-bottom:0;font-size:12px;max-width:240px;width:auto;}
.pg-inbox .cmp-xl{border:1px solid var(--border);background:var(--surface);border-radius:14px;padding:3px 9px;font-size:11.5px;font-weight:700;color:var(--text-2);white-space:nowrap;display:inline-flex;gap:4px;align-items:center;}
.pg-inbox .cmp-xl svg{width:13px;height:13px;}
.pg-inbox .cmp-xl.on{border-color:var(--brand-strong);background:var(--brand-soft-2);color:var(--brand-text);}
.pg-inbox .cmp-warn{font-size:11.5px;color:var(--text-2);background:var(--warn-soft);border-radius:8px;padding:6px 10px;margin:0 0 6px;}
.pg-inbox .ib-loose{margin:0 12px 8px;display:flex;align-items:center;gap:8px;width:calc(100% - 24px);padding:8px 10px;border:1px dashed var(--brand-strong);border-radius:10px;background:var(--brand-soft-2);color:var(--brand-text);font-size:12.5px;font-weight:700;text-align:left;}
.pg-inbox .ib-loose svg{width:15px;height:15px;}
.pg-inbox .ib-lfoot .lk{margin-left:auto;border:none;background:none;padding:0;font:inherit;font-weight:700;color:var(--brand-text);text-decoration:underline;white-space:nowrap;}
.pg-inbox .mvia{font-size:10px;opacity:0.75;margin-right:4px;}
.ib-loose-list{display:grid;gap:10px;}
.ib-loose-list .lc{border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:grid;gap:8px;}
.ib-loose-list .lc .lh{display:flex;gap:8px;align-items:center;font-weight:700;}
.ib-loose-list .lc .lh small{font-weight:400;color:var(--muted);}
.ib-loose-list .lc .lm{font-size:12.5px;color:var(--text-2);white-space:pre-wrap;max-height:90px;overflow:auto;}
.ib-loose-list .lc .lr{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.ib-loose-list .lc .lr select{flex:1;min-width:200px;}
.ib-xl-prev textarea{width:100%;min-height:110px;}
.ib-xl-prev .orig{font-size:12.5px;color:var(--muted);white-space:pre-wrap;border-left:3px solid var(--border);padding-left:8px;}
`);

  /* ------------------------------------------------------------------ live inbox (server mode) */
  var LANGS = [['en', 'English'], ['ms', 'Malay'], ['zh', 'Chinese'], ['bn', 'Bengali'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['ta', 'Tamil'], ['id', 'Indonesian'],
    ['th', 'Thai'], ['vi', 'Vietnamese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'],
    ['ru', 'Russian'], ['tr', 'Turkish'], ['nl', 'Dutch'], ['fa', 'Persian'], ['ur', 'Urdu'], ['tl', 'Filipino'], ['my', 'Burmese'], ['km', 'Khmer'], ['ne', 'Nepali']];
  function langName(code) { for (var i = 0; i < LANGS.length; i++) if (LANGS[i][0] === code) return LANGS[i][1]; return code ? String(code).toUpperCase() : ''; }
  var VIA = { whatsapp: 'WhatsApp', booking: 'Booking.com', airbnb: 'Airbnb', expedia: 'Expedia', channex: 'the booking site', guestapp: 'Guest app', email: 'Email', agoda: 'Agoda', tripcom: 'Trip.com' };
  var FEED_PLAT = { airbnb: 'airbnb', booking: 'booking', agoda: 'agoda', tripcom: 'ctrip', expedia: 'expedia' };
  var DAY_MS = 24 * 3600 * 1000;
  var live = { org: null, cfg: null, loading: false, busy: {}, media: {}, via: {}, xl: {}, origOpen: {} };
  function server() { return !!(O.auth && O.auth.enabled && O.auth.enabled() && O.sync.adapter && O.sync.adapter.name === 'server' && O.auth.orgId && O.auth.orgId() && O.auth.inbox); }
  function liveCfg() { return server() && live.org === O.auth.orgId() ? live.cfg : null; }
  /* live sending is on when the workspace has WhatsApp connected or booking-site messages switched on (and is not a demo) */
  function liveOn() { var c = liveCfg(); return !!(c && !c.demo && ((c.whatsapp.configured && c.whatsapp.number) || c.channex || emailOn())); }
  function emailOn() { var c = liveCfg(); return !!(c && !c.demo && c.email && c.email.reply); }
  function loadLive(after) {
    if (!server() || live.loading) return;
    if (live.org === O.auth.orgId() && live.cfg) { if (after) after(); return; }
    live.loading = true;
    O.auth.inbox('config').then(function (r) { live.org = O.auth.orgId(); live.cfg = r; }, function () { live.org = O.auth.orgId(); live.cfg = null; })
      .then(function () { live.loading = false; if (after) after(); });
  }
  /* how a chat can be answered: [{via, label, open, why}] (WhatsApp first when the guest wrote there last) */
  function routesFor(c) {
    var cfg = liveCfg(), b = bk(c), out = []; if (!cfg || cfg.demo) return out;
    var phone = c.wa || (b && b.guest && b.guest.phone) || (c.contact && c.contact.phone);
    if (cfg.whatsapp.configured && cfg.whatsapp.number && phone) {
      var t = Date.parse(c.waLastIn || ''), open = isFinite(t) && Date.now() - t < DAY_MS;
      out.push({ via: 'whatsapp', label: 'WhatsApp' + (canContacts() ? ' to ' + (c.wa ? '+' + c.wa : phone) : ''), open: open,
        why: open ? '' : (isFinite(t) ? 'The guest last wrote on WhatsApp more than 24 hours ago' : 'The guest has not written to your WhatsApp number yet') + ', so WhatsApp will not take a reply until they write again.' });
    }
    var ch = b && b.channel, cxOk = c.cx || c.cxBooking || (b && b.channex && b.channex.bookingId && /^(booking|airbnb|expedia)$/.test(ch || ''));
    if (cfg.channex && cxOk) {
      var name = VIA[ch] && /^(booking|airbnb|expedia)$/.test(ch) ? VIA[ch] : c.ota || 'the booking site';
      out.push({ via: 'channex', label: name + ' chat', open: true, why: '' });
    }
    if (emailOn() && c.em) out.push({ via: 'email', label: 'Email' + (canContacts() || !b ? ' to ' + c.em : ''), open: true, why: '' });
    var last = null; for (var i = c.messages.length - 1; i >= 0; i--) if (c.messages[i].from === 'guest' && c.messages[i].via) { last = c.messages[i].via; break; }
    var lead = last === 'email' ? 'email' : last && last !== 'whatsapp' ? 'channex' : null;
    if (lead) out = out.filter(function (x) { return x.via === lead; }).concat(out.filter(function (x) { return x.via !== lead; }));
    return out;
  }
  function routeOf(c) {
    var rs = routesFor(c), want = live.via[c.id];
    for (var i = 0; i < rs.length; i++) if (rs[i].via === want) return rs[i];
    for (var j = 0; j < rs.length; j++) if (rs[j].open) return rs[j];
    return rs[0] || null;
  }
  /* the guest's language: what they last wrote in */
  function guestLang(c) {
    if (c.lang) return c.lang;
    for (var i = c.messages.length - 1; i >= 0; i--) if (c.messages[i].from === 'guest' && c.messages[i].lang) return c.messages[i].lang;
    return '';
  }
  function myLang() { var c = liveCfg(); return (c && c.lang) || 'en'; }
  /* apply a conversation the server returned (as if it came over realtime, so it is not saved back) */
  function applyConv(conv) {
    if (!conv || !conv.data) return;
    O.sync.remote([{ coll: 'conversations', id: conv.id, data: conv.data, deleted: false }], []);
  }
  /* chats from numbers / booking-site threads no booking matched yet */
  function loose() { return D.conversations.filter(function (c) { return !c.bookingId && !c.kind && c.contact && c.messages && c.messages.length; }); }
  /* email from people no booking matched, and each booking site's notifications (the Updates tab) */
  function upds() {
    return D.conversations.filter(function (c) { return !c.bookingId && (c.kind === 'email' || c.kind === 'feed') && c.messages && c.messages.length; })
      .sort(function (a, b) { if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1; return lastTime(a) < lastTime(b) ? 1 : -1; });
  }
  function isUpd(c) { return !!c && !c.bookingId && (c.kind === 'email' || c.kind === 'feed'); }
  function updName(c) { return (c.contact && c.contact.name) || c.em || 'Email'; }

  function prop(id) { return D.propById[id] || { id: id, name: 'Removed property', short: 'Removed property', wifi: ['', ''], parking: '' }; }
  function bk(c) { return D.booking(c.bookingId); }
  /* Staff Access */
  function canSend() { return O.can('inbox.send'); }
  function canNote() { return O.can('inbox.notes'); }
  function canQR() { return O.can('inbox.quickReplies'); }
  function canEdit() { return O.can('inbox', 'edit'); }
  function canContacts() { return O.can('bookings.contacts'); }
  function canCodes() { return O.can('guestapp.doorCodes'); }
  var NO_SEND = 'Messaging guests is not part of your access';
  /* +60 12-345 6789 -> +60 ••-••• ••89 (core has no masking helper yet, see docs/notes/v4-finance.md) */
  function maskPhone(ph) {
    ph = String(ph || ''); var n = ph.replace(/\D/g, '').length, seen = 0;
    return ph.replace(/\d/g, function (ch) { seen++; return seen <= 2 || seen > n - 2 ? ch : '•'; });
  }
  /* door codes already sent in a chat stay hidden from people without door-code access */
  function codeSafe(c, text) {
    var raw = String(text || ''), b = bk(c);
    if (!canCodes() && b && b.doorCode && String(b.doorCode).length >= 3) raw = raw.split(String(b.doorCode)).join('••••');
    return raw;
  }
  function phoneOf(b) { return b && b.guest ? (canContacts() ? b.guest.phone || '' : maskPhone(b.guest.phone)) : ''; }
  /* chats whose booking still exists (a deleted booking takes its chat out of the list instead of breaking it) */
  function convs() { return D.conversations.filter(function (c) { var b = bk(c); return !!(b && b.guest); }); }
  function staff(id) { return D.staffById(id); }
  function firstName(n) { var p = String(n).split(' '); return p.length > 2 ? p.slice(0, 2).join(' ') : p[0]; }
  var SURNAME_FIRST = ['Tan', 'Lim', 'Zhang', 'Chen', 'Wang', 'Kim', 'Nguyen', 'Wong', 'Goh', 'Khoo', 'Koh', 'Ong', 'Lee'];
  function guestFirst(name) {
    if (/^The /.test(name)) return name.replace(/^The /, '').replace(/ Family$/, ' family');
    var parts = name.split(' ');
    return SURNAME_FIRST.indexOf(parts[0]) >= 0 ? name : parts[0];
  }
  function nowISO() { return D.NOW || (D.TODAY + 'T' + (D.NOW_TIME || '12:00')); } /* kept current by O.clock */
  function lastMsg(c) { return c.messages[c.messages.length - 1] || null; }
  function lastTime(c) { var m = lastMsg(c); return m ? m.time : (c.createdAt || D.NOW); }
  function sorted() {
    return convs().sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return lastTime(a) < lastTime(b) ? 1 : lastTime(a) > lastTime(b) ? -1 : 0;
    });
  }
  function conv(id) { return convs().filter(function (c) { return c.id === id; })[0] || upds().filter(function (c) { return c.id === id; })[0] || null; }
  function listTime(iso) {
    var day = iso.slice(0, 10), n = d.diff(day, D.TODAY);
    if (n === 0) return fmt.time(iso);
    if (n === 1) return 'Yesterday';
    if (n < 7) return DAYS[d.dow(day)];
    return d.fmtDM(day) + '/' + day.slice(0, 4);
  }
  function dayLabel(day) {
    var n = d.diff(day, D.TODAY);
    if (n === 0) return 'Today';
    if (n === 1) return 'Yesterday';
    if (n < 7) return DAYS[d.dow(day)];
    return d.dowName(day) + ', ' + d.fmtY(day);
  }
  function arrivingToday(b) { return b && b.status !== 'cancelled' && b.checkIn === D.TODAY; }
  function inHouse(b) { return b && b.status !== 'cancelled' && b.checkIn < D.TODAY && b.checkOut > D.TODAY; }
  function shortTime(t) { return fmt.time(t).replace(':00 ', ' '); }
  function listPhrase(b) {
    if (!b) return '';
    if (b.status === 'cancelled') return 'Cancelled';
    if (b.checkIn === D.TODAY) return 'Arrives today ' + shortTime(b.checkInTime);
    if (b.checkIn === d.add(D.TODAY, 1)) return 'Arrives tomorrow';
    if (b.checkIn > D.TODAY) return 'Arrives ' + d.fmt(b.checkIn);
    if (b.checkOut === D.TODAY) return b.status === 'checked_out' ? 'Checked out today' : 'Leaves today';
    if (b.checkOut > D.TODAY) return 'In-house to ' + d.fmt(b.checkOut);
    return 'Left ' + d.fmt(b.checkOut);
  }
  function stayPhrase(b) {
    if (!b) return '';
    if (b.status === 'cancelled') return 'Cancelled';
    if (b.checkIn === D.TODAY) return 'Arrives today ' + fmt.time(b.checkInTime);
    if (b.checkIn === d.add(D.TODAY, 1)) return 'Arrives tomorrow ' + fmt.time(b.checkInTime);
    if (b.checkIn > D.TODAY) return 'Arrives ' + d.fmt(b.checkIn);
    if (b.checkOut === D.TODAY) return (b.status === 'checked_out' ? 'Checked out today ' : 'Checks out today ') + fmt.time(b.checkOutTime);
    if (b.checkOut > D.TODAY) return 'In-house until ' + d.fmt(b.checkOut);
    return 'Checked out ' + d.fmt(b.checkOut);
  }
  function sizeText(bytes) { return bytes < 1024 ? bytes + ' B' : bytes < 1048576 ? Math.round(bytes / 1024) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB'; }
  function durText(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function ext(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toUpperCase().slice(0, 4) : 'FILE'; }
  function isPhone() { return window.matchMedia && window.matchMedia('(max-width: 760px)').matches; }
  function msgStatus(c, i) {
    var m = c.messages[i];
    if (m.status) return m.status;
    for (var j = i + 1; j < c.messages.length; j++) if (c.messages[j].from === 'guest') return 'read';
    return 'delivered';
  }
  function tickHTML(s) { if (s === 'failed') return '<span class="tick failed" aria-label="Not delivered">!</span>'; return s === 'sent' ? TICK1.replace('class="tick"', 'class="tick" aria-label="Sent"') : TICK2.replace('class="tick"', 'class="tick' + (s === 'read' ? ' read' : '') + '" aria-label="' + (s === 'read' ? 'Read' : 'Delivered') + '"'); }
  /* @mentions in internal notes: full staff names first ("@Wei Ling Tan", "@Wei Ling"), then any capitalised word */
  function mentionRe() {
    var names = [];
    D.staff.forEach(function (x) { names.push(x.name, firstName(x.name), x.name.split(' ')[0]); });
    names = names.filter(function (n, i) { return names.indexOf(n) === i; }).sort(function (a, b) { return b.length - a.length; });
    return new RegExp('@(' + names.map(function (n) { return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + '|[A-Z][a-z]+)(?![a-z])', 'g');
  }
  function waveFor(m, key) {
    if (m.wave && m.wave.length) return m.wave;
    var r = D.rng(D.hash(key)), out = [], prev = 0.5;
    for (var i = 0; i < 32; i++) { prev = Math.max(0.15, Math.min(1, prev * 0.5 + r() * 0.62)); out.push(prev); }
    return out;
  }

  /* quick replies: which apply to a property, and filling the variables from the booking */
  function repliesFor(pid) { return D.quickReplies.filter(function (q) { return !q.propertyIds || !q.propertyIds.length || q.propertyIds.indexOf(pid) >= 0; }).sort(function (a, b) { return (b.propertyIds.length ? 1 : 0) - (a.propertyIds.length ? 1 : 0); }); }
  function fill(text, b) {
    if (!b) return text;
    /* sent now: the door code (and for a unit type the unit number and Wi-Fi) only from 30 minutes before check-in (O.guestmsg) */
    var p = prop(b.propertyId), held = !b.idVerified || b.codeStatus === 'held', gp = O.guestPlace(b), t = O.unitType(b.unitTypeId) || O.typeOf(D.propById[b.propertyId]);
    var ci = O.guestmsg.ciTimeOf(b, D.propById[b.propertyId], t && O.building(t.buildingId)), link = O.guestLink && b.guestToken ? O.guestLink(b) : ''; /* never creates a token while previewing */
    var wifi = p.wifi || ['', ''];
    var g = O.guestmsg.guardVars({ door_code: b.doorCode, unit_no: gp.typed ? p.unitNo || '' : '', wifi_name: wifi[0], wifi_password: wifi[1] }, { b: b, sendAt: D.NOW, ciTime: ci, typed: gp.typed, link: link }).vars;
    wifi = [g.wifi_name, g.wifi_password];
    var timeHeld = g.door_code !== b.doorCode;
    var map = { guest_first: guestFirst(b.guest.name), property: gp.name, unit_no: g.unit_no, wifi_name: wifi[0], wifi_password: wifi[1], parking: p.parking, checkin_time: fmt.time(b.checkInTime), checkout_time: fmt.time(b.checkOutTime), door_code: !canCodes() ? '[door code left out]' : timeHeld ? g.door_code : held ? '[sent after the ID check]' : b.doorCode };
    return text.replace(/\{([a-z_]+)\}/g, function (m0, k) { return map[k] != null ? map[k] : m0; });
  }

  /* drawn photo for the demo message (no external images) */
  function sinkArt() {
    return '<svg class="art" viewBox="0 0 300 200" role="img" aria-label="Photo of a kitchen sink"><defs><linearGradient id="ibw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E8EBEF"/><stop offset="1" stop-color="#D5DAE1"/></linearGradient><linearGradient id="ibs" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C9CFD7"/><stop offset="1" stop-color="#9AA3AF"/></linearGradient></defs>' +
      '<rect width="300" height="200" fill="url(#ibw)"/><g stroke="#C3C9D2" stroke-width="1"><path d="M0 40h300M0 80h300M50 0v80M120 0v40M190 0v80M260 0v40M85 40v40M155 40v40M225 40v40"/></g>' +
      '<rect x="0" y="100" width="300" height="100" fill="#8C96A5"/><rect x="0" y="100" width="300" height="10" fill="#A9B1BC"/>' +
      '<rect x="55" y="112" width="190" height="72" rx="10" fill="url(#ibs)"/><rect x="65" y="118" width="170" height="60" rx="8" fill="#6B7684"/>' +
      '<ellipse cx="150" cy="160" rx="62" ry="12" fill="#7E8A99" opacity="0.9"/><ellipse cx="150" cy="158" rx="40" ry="7" fill="#93A0AF"/><circle cx="150" cy="165" r="6" fill="#3A4452"/>' +
      '<path d="M150 112V62a14 14 0 0 1 28 0v8" fill="none" stroke="#B9C0CA" stroke-width="7" stroke-linecap="round"/><rect x="138" y="100" width="24" height="12" rx="3" fill="#A3ABB6"/>' +
      '<circle cx="178" cy="80" r="2.5" fill="#6FA8DC"/><circle cx="178" cy="92" r="2" fill="#6FA8DC"/></svg>';
  }

  /* a chat started from a booking but never used is dropped when you move on (like an unsent new chat) */
  function pruneEmpty(keepId) {
    for (var i = D.conversations.length - 1; i >= 0; i--) { var c = D.conversations[i]; if (c.id !== keepId && c.createdAt && !c.messages.length && !c.wa && !c.cx) D.conversations.splice(i, 1); }
  }

  /* ------------------------------------------------------------------ list */
  function inProp(c) { var b = bk(c); return !st.prop || (b && b.propertyId === st.prop); }
  function filterCounts() {
    var all = convs().filter(inProp);
    return {
      all: all.length,
      unread: all.filter(function (c) { return c.unread > 0; }).length,
      today: all.filter(function (c) { return arrivingToday(bk(c)); }).length,
      inhouse: all.filter(function (c) { return inHouse(bk(c)); }).length
    };
  }
  function visibleConvs() {
    var q = st.q.toLowerCase();
    return sorted().filter(function (c) {
      var b = bk(c);
      if (!inProp(c)) return false;
      if (st.filter === 'unread' && !(c.unread > 0) && c.id !== st.sel) return false;
      if (st.filter === 'today' && !arrivingToday(b)) return false;
      if (st.filter === 'inhouse' && !inHouse(b)) return false;
      if (q) {
        var hay = (b ? b.guest.name + ' ' + prop(b.propertyId).name + ' ' + b.id : '') + ' ' + c.messages.map(function (m) { return m.text || ''; }).join(' ');
        if (hay.toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function previewHTML(c) {
    var m = lastMsg(c);
    if (!m) return '<span class="sys">No messages yet</span>';
    var who = '';
    if (m.from === 'staff') who = (m.staffId === O.state.viewer ? 'You' : firstName(staff(m.staffId) ? staff(m.staffId).name : 'Team')) + ': ';
    if (m.from === 'note') who = 'Note: ';
    var ticks = m.from === 'staff' ? tickHTML(msgStatus(c, c.messages.length - 1)) : '';
    var body;
    if (m.from === 'system') return '<span class="sys">' + esc(m.text) + '</span>';
    if (m.type === 'voice') body = O.icon('mic') + 'Voice message (' + durText(m.duration) + ')';
    else if (m.type === 'image') body = O.icon('image') + esc(m.caption || 'Photo');
    else if (m.type === 'file') body = O.icon('file') + esc(m.name || m.text);
    else body = esc(codeSafe(c, m.text));
    return ticks + (who ? '<span class="who">' + esc(who) + '</span>' : '') + body;
  }
  function rowHTML(c) {
    var b = bk(c), p = b ? prop(b.propertyId) : null, m = lastMsg(c), unread = c.unread > 0;
    var soon = b && (arrivingToday(b) || b.checkIn === d.add(D.TODAY, 1));
    return '<button type="button" class="cv' + (c.id === st.sel ? ' on' : '') + (unread ? ' unread' : '') + '" data-conv="' + c.id + '" aria-label="' + esc((b ? b.guest.name : 'Guest') + (unread ? ', ' + c.unread + ' unread' : '')) + '">' +
      '<span class="cv-av">' + U.avatar(b ? b.guest.name : '?') + (b ? U.platIcon(b.channel) : '') + '</span>' +
      '<span class="cv-main"><span class="cv-l1"><span class="cv-name">' + esc(b ? b.guest.name : 'Guest') + '</span><span class="cv-time">' + esc(m ? listTime(m.time) : '') + '</span></span>' +
      '<span class="cv-l2"><span class="cv-st">' + (p ? esc(p.short) + ' · ' : '') + '<span class="' + (soon ? 'soon' : '') + '">' + esc(listPhrase(b)) + '</span></span>' + (b && b.sameDay ? '<span class="sd">Same-day</span>' : '') + '</span>' +
      '<span class="cv-l3"><span class="cv-prev">' + previewHTML(c) + '</span>' + (c.pinned ? '<span class="cv-pin" title="Pinned" aria-label="Pinned">' + PIN_SVG + '</span>' : '') + (unread ? '<span class="cv-badge">' + c.unread + '</span>' : '') + '</span></span></button>';
  }
  function listHTML() {
    var fc = filterCounts();
    var filters = [['all', 'All', null], ['unread', 'Unread', fc.unread], ['today', 'Arriving today', fc.today], ['inhouse', 'In-house', fc.inhouse]].map(function (f) {
      return '<button type="button" class="chip' + (st.filter === f[0] ? ' on' : '') + '" data-filter="' + f[0] + '" aria-pressed="' + (st.filter === f[0]) + '">' + f[1] + (f[2] != null ? ' <span class="n">' + f[2] + '</span>' : '') + '</button>';
    }).join('');
    var nu = upds().filter(function (c) { return c.unread > 0; }).length, ng = convs().filter(function (c) { return c.unread > 0; }).length;
    var tabs = '<div class="ib-tabs" role="tablist" aria-label="Show">' +
      '<button type="button" role="tab" data-tab="guests" aria-selected="' + (st.tab !== 'updates') + '" class="' + (st.tab !== 'updates' ? 'on' : '') + '">Guests' + (ng ? ' <span class="n">' + ng + '</span>' : '') + '</button>' +
      '<button type="button" role="tab" data-tab="updates" aria-selected="' + (st.tab === 'updates') + '" class="' + (st.tab === 'updates' ? 'on' : '') + '">Email &amp; updates' + (nu ? ' <span class="n">' + nu + '</span>' : '') + '</button></div>';
    if (st.tab === 'updates') {
      return '<div class="ib-lhead"><h2>Chats</h2></div>' + tabs +
        '<div class="ib-tools"><label class="ib-search">' + O.icon('search') + '<input type="search" data-f="q" placeholder="Search email and updates" aria-label="Search email and updates" value="' + esc(st.q) + '"></label></div>' +
        '<div class="ib-rows">' + rowsHTML() + '</div>' +
        '<div class="ib-lfoot">' + footHTML() + '</div>';
    }
    return '<div class="ib-lhead"><h2>Chats</h2>' +
      (canSend() ? '<button type="button" class="ib-ic" data-act="newchat" title="New conversation" aria-label="New conversation">' + O.icon('plus') + '</button>' : '') +
      (canQR() ? '<button type="button" class="ib-ic" data-act="manage" title="Quick replies" aria-label="Manage quick replies">' + O.icon('sparkle') + '</button>' : '') + '</div>' +
      tabs + '<div class="ib-tools"><label class="ib-search">' + O.icon('search') + '<input type="search" data-f="q" placeholder="Search chats" aria-label="Search guests, units or messages" value="' + esc(st.q) + '"></label>' +
      propSelectHTML() + '</div>' +
      '<div class="ib-filters" role="group" aria-label="Filter chats">' + filters + '</div>' +
      '<div class="ib-loose-wrap">' + looseHTML() + '</div>' +
      '<div class="ib-rows">' + rowsHTML() + '</div>' +
      '<div class="ib-lfoot">' + footHTML() + '</div>';
  }
  function footHTML() {
    var cfg = liveCfg(), owner = O.auth && O.auth.role && O.auth.role() === 'owner', set = owner || canEdit() ? '<button type="button" class="lk" data-act="livesettings">Settings</button>' : '';
    if (!server()) return O.icon('whatsapp') + '<span>Replies reach guests on WhatsApp. Sending is not connected in this version.</span>';
    if (!cfg) return O.icon('whatsapp') + '<span>' + (live.loading ? 'Checking the WhatsApp connection…' : 'Live messaging could not be checked.') + '</span>' + set;
    if (cfg.demo) return O.icon('whatsapp') + '<span>Demo workspace: replies stay in Orbique and are not sent to guests.</span>';
    var parts = [];
    if (cfg.whatsapp.configured && cfg.whatsapp.number) parts.push('WhatsApp ' + (cfg.whatsapp.number.phone || ''));
    if (cfg.channex) parts.push('Booking.com, Airbnb and Expedia');
    if (cfg.email && cfg.email.configured && cfg.email.address) parts.push('email');
    return O.icon('whatsapp') + '<span>' + (parts.length ? 'Live: ' + esc(parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]) : 'Sending is not connected yet.') + '</span>' + set;
  }
  function looseHTML() {
    var n = loose().length; if (!n) return '';
    return '<button type="button" class="ib-loose" data-act="loose">' + O.icon('chat') + '<span>' + (n === 1 ? '1 new chat is' : n + ' new chats are') + ' not linked to a booking yet</span></button>';
  }
  /* All properties or one; units without chats are listed too, archived ones only when they still have chats */
  function propSelectHTML() {
    var n = {}; convs().forEach(function (c) { var b = bk(c); n[b.propertyId] = (n[b.propertyId] || 0) + 1; });
    var opts = D.properties.filter(function (p) { return !p.archived || n[p.id] || p.id === st.prop; });
    return '<label class="sr-only" for="ib-prop">Property</label><select id="ib-prop" class="select ib-propsel' + (st.prop ? ' on' : '') + '" data-f="prop" title="Show chats for one property">' +
      '<option value="">All properties</option>' + opts.map(function (p) { return '<option value="' + p.id + '"' + (p.id === st.prop ? ' selected' : '') + '>' + esc(p.short) + (n[p.id] ? ' (' + n[p.id] + ')' : '') + '</option>'; }).join('') + '</select>';
  }
  function visibleUpds() {
    var q = st.q.toLowerCase();
    return upds().filter(function (c) {
      if (!q) return true;
      var hay = updName(c) + ' ' + (c.em || '') + ' ' + c.messages.map(function (m) { return (m.subject || '') + ' ' + (m.text || ''); }).join(' ');
      return hay.toLowerCase().indexOf(q) >= 0;
    });
  }
  function updRowHTML(c) {
    var m = lastMsg(c), unread = c.unread > 0, feed = c.kind === 'feed';
    var av = feed ? '<span class="cv-feed">' + (FEED_PLAT[c.feed] ? U.platIcon(FEED_PLAT[c.feed]) : O.icon(c.feed === 'email' ? 'chat' : 'alert')) + '</span>' : U.avatar(updName(c));
    var sub = feed ? 'Notifications' : 'Email' + (c.ota ? ' via ' + c.ota : '');
    var prev = m ? (m.from === 'system' ? esc(m.text) : (m.from === 'staff' ? '<span class="who">You: </span>' : '') + esc(m.subject && m.from === 'guest' ? m.subject + ' · ' + m.text : m.text)) : '';
    return '<button type="button" class="cv' + (c.id === st.sel ? ' on' : '') + (unread ? ' unread' : '') + '" data-conv="' + c.id + '" aria-label="' + esc(updName(c) + (unread ? ', ' + c.unread + ' unread' : '')) + '">' +
      '<span class="cv-av">' + av + '</span>' +
      '<span class="cv-main"><span class="cv-l1"><span class="cv-name">' + esc(updName(c)) + '</span><span class="cv-time">' + esc(m ? listTime(m.time) : '') + '</span></span>' +
      '<span class="cv-l2"><span class="cv-st">' + esc(sub) + '</span></span>' +
      '<span class="cv-l3"><span class="cv-prev">' + prev + '</span>' + (c.pinned ? '<span class="cv-pin" title="Pinned" aria-label="Pinned">' + PIN_SVG + '</span>' : '') + (unread ? '<span class="cv-badge">' + c.unread + '</span>' : '') + '</span></span></button>';
  }
  function rowsHTML() {
    if (st.tab === 'updates') {
      var ul = visibleUpds();
      if (ul.length) return ul.map(updRowHTML).join('');
      var cfg0 = liveCfg();
      return '<div class="ib-empty">' + U.empty(st.q ? 'Nothing matches "' + st.q + '".' : 'No email or booking-site updates yet.' + (cfg0 && cfg0.email && cfg0.email.address ? ' Forward your booking email to ' + cfg0.email.address + ' to see it here.' : ''), '∅') +
        (st.q ? '<button type="button" class="btn btn-ghost" data-act="clearq">Clear the search</button>' : (O.auth && O.auth.role && O.auth.role() === 'owner') || canEdit() ? '<button type="button" class="btn btn-ghost" data-act="livesettings">Set up email</button>' : '') + '</div>';
    }
    var list = visibleConvs();
    if (list.length) return list.map(rowHTML).join('');
    /* one sentence plus the main action */
    var ps = st.prop ? prop(st.prop).short : '', any = convs().length > 0, here = convs().filter(inProp).length > 0, msg, btn = '';
    if (!any) {
      msg = 'No guest chats yet.';
      if (!D.properties.length) { if (O.can('properties.create')) btn = '<button type="button" class="btn btn-primary" data-go="properties">' + O.icon('plus') + 'Add your first property</button>'; }
      else if (!D.bookings.some(function (x) { return x.status !== 'cancelled' && x.checkOut >= D.TODAY; })) { if (O.can('bookings.create')) btn = '<button type="button" class="btn btn-primary" data-go="bookings">' + O.icon('plus') + 'Add a booking</button>'; }
      else if (canSend()) btn = '<button type="button" class="btn btn-primary" data-act="newchat">' + O.icon('plus') + 'Start a chat</button>';
    }
    else if (st.prop && !here) { msg = 'No chats with guests at ' + ps + ' yet.'; btn = '<button type="button" class="btn btn-ghost" data-act="allprops">Show all properties</button>'; }
    else {
      msg = st.q ? 'No chats match "' + st.q + '"' : st.filter === 'unread' ? 'No unread chats' : st.filter === 'today' ? 'No chats with guests arriving today' : st.filter === 'inhouse' ? 'No chats with in-house guests' : 'No chats';
      msg += (st.prop ? ' at ' + ps : '') + (st.filter === 'unread' && !st.q ? '. You are all caught up.' : '.');
      btn = st.prop ? '<button type="button" class="btn btn-ghost" data-act="allprops">Show all properties</button>' : st.q ? '<button type="button" class="btn btn-ghost" data-act="clearq">Clear the search</button>' : st.filter !== 'all' ? '<button type="button" class="btn btn-ghost" data-filter="all">Show all chats</button>' : '';
    }
    return '<div class="ib-empty">' + U.empty(msg, st.filter === 'unread' && !st.q ? '✓' : '∅') + btn + '</div>';
  }

  /* ------------------------------------------------------------------ chat */
  function headHTML(c) {
    var b = bk(c), p = prop(b.propertyId), canBk = O.allowed('bookings');
    var who = U.avatar(b.guest.name, 'lg') +
      '<span class="ib-who-t"><span class="ib-who-n"><span class="ib-nm">' + esc(b.guest.name) + '</span>' + U.status(b.status) + '</span>' +
      '<span class="ib-who-s">' + U.platIcon(b.channel) + '<span>' + esc(p.name) + ' · ' + esc(d.fmtRange(b.checkIn, b.checkOut)) + ' · ' + fmt.plural(b.nights, 'night') + ' · ' + fmt.plural(b.guests, 'guest') + '</span></span></span>';
    var tel = (b.guest.phone || '').replace(/[^+\d]/g, '');
    var menu = (canBk ? '<button type="button" data-act="booking" class="sm-only">' + O.icon('bookings') + 'Open booking ' + esc(b.id) + '</button>' : '') +
      (canEdit() ? '<button type="button" data-act="unread">' + O.icon('chat') + 'Mark as unread</button>' +
        '<button type="button" data-act="pin">' + PIN_SVG + (c.pinned ? 'Unpin chat' : 'Pin chat to top') + '</button>' : '') +
      (O.can('invoices.send') && b.invoiceNo ? '<button type="button" data-act="invoice">' + O.icon('invoices') + 'Send invoice ' + esc(b.invoiceNo) + '</button>' : '') +
      (canQR() ? '<button type="button" data-act="manage">' + O.icon('sparkle') + 'Manage quick replies</button>' : '');
    return '<header class="ib-head">' +
      '<button type="button" class="ib-ic ib-back" data-act="back" aria-label="Back to chats">' + O.icon('left') + '</button>' +
      (canBk ? '<button type="button" class="ib-who" data-act="booking" title="Open booking ' + esc(b.id) + '">' + who + '</button>' : '<div class="ib-who static">' + who + '</div>') +
      '<div class="ib-hacts">' +
      (canBk ? '<button type="button" class="ib-ic hide-sm" data-act="booking" title="Open booking" aria-label="Open booking">' + O.icon('bookings') + '</button>' : '') +
      (canCodes() ? '<button type="button" class="ib-ic" data-act="lock" title="Change door code" aria-label="Change door code">' + O.icon('key') + '</button>' : '') +
      (canContacts() && tel ? '<a class="ib-ic" href="tel:' + esc(tel) + '" title="Call ' + esc(b.guest.phone) + '" aria-label="Call ' + esc(b.guest.name) + '">' + O.icon('whatsapp') + '</a>'
        : '<button type="button" class="ib-ic" disabled title="Your access does not include guest phone numbers" aria-label="Call ' + esc(b.guest.name) + ' (not available)">' + O.icon('whatsapp') + '</button>') +
      (menu ? '<div class="ib-more"><button type="button" class="ib-ic" data-act="more" aria-haspopup="true" aria-label="More options">' + O.icon('more') + '</button><div class="ib-menu" role="menu">' + menu + '</div></div>' : '') +
      '</div></header>';
  }
  function updHeadHTML(c) {
    var feed = c.kind === 'feed';
    var who = (feed ? '<span class="cv-feed lg">' + (FEED_PLAT[c.feed] ? U.platIcon(FEED_PLAT[c.feed]) : O.icon(c.feed === 'email' ? 'chat' : 'alert')) + '</span>' : U.avatar(updName(c), 'lg')) +
      '<span class="ib-who-t"><span class="ib-who-n"><span class="ib-nm">' + esc(updName(c)) + '</span></span>' +
      '<span class="ib-who-s"><span>' + esc(feed ? 'Notifications from the site, read only' : (c.em || '') + (c.ota ? ' · through ' + c.ota : '')) + '</span></span></span>';
    var menu = canEdit() ? '<button type="button" data-act="unread">' + O.icon('chat') + 'Mark as unread</button><button type="button" data-act="pin">' + PIN_SVG + (c.pinned ? 'Unpin' : 'Pin to top') + '</button>' : '';
    return '<header class="ib-head">' +
      '<button type="button" class="ib-ic ib-back" data-act="back" aria-label="Back to chats">' + O.icon('left') + '</button>' +
      '<div class="ib-who static">' + who + '</div><div class="ib-hacts">' +
      (menu ? '<div class="ib-more"><button type="button" class="ib-ic" data-act="more" aria-haspopup="true" aria-label="More options">' + O.icon('more') + '</button><div class="ib-menu" role="menu">' + menu + '</div></div>' : '') +
      '</div></header>';
  }
  function updComposerHTML(c) {
    if (c.kind !== 'email') return '';
    if (!canSend()) return '<div class="ib-compose"><div class="ib-ro">' + O.icon('lock') + '<span>You can read this email. Replying is not part of your access.</span></div></div>';
    if (!emailOn()) return '<div class="ib-compose"><div class="ib-ro">' + O.icon('alert') + '<span>Replying by email is not set up yet. Reply from your own mailbox for now.</span></div></div>';
    var draft = st.drafts[c.id] || '';
    return '<div class="ib-compose"><div class="cmp-top"><span class="cmp-hint only"><span class="cmp-route">' + O.icon('chat') + '<span class="ellipsis">Email to ' + esc(c.em) + '</span></span></span></div>' +
      '<div class="cmp-bar"><div class="cmp-box"><label class="sr-only" for="ib-input">Message</label><textarea id="ib-input" rows="1" data-f="msg" title="Enter sends, Shift + Enter adds a new line" placeholder="Reply to ' + esc(updName(c)) + '">' + esc(draft) + '</textarea></div>' +
      '<button type="button" class="round go" data-act="send" aria-label="Send">' + O.icon('send') + '</button></div></div>';
  }
  /* links in emails (a forwarding confirmation, a payout statement) open in a new tab; everything else stays text */
  function linkify(text) {
    return esc(text).replace(/https?:\/\/[^\s<>"')]+/g, function (u) { var clean = u.replace(/&amp;/g, '&'); return '<a href="' + esc(clean) + '" target="_blank" rel="noopener noreferrer nofollow">' + u + '</a>'; });
  }
  /* arrival readiness chips; once the guest is in-house the turnover chip no longer applies */
  function readyHTML(b) {
    var list = O.readiness(b).filter(function (r) { return !(r.key === 'clean' && b.checkIn < D.TODAY); });
    return '<div class="ready">' + list.map(function (r) { return '<span class="rd ' + r.state + '">' + esc(r.label) + '</span>'; }).join('') + '</div>';
  }
  function stayHTML(c) {
    var b = bk(c), live = b.status !== 'cancelled' && b.checkOut > D.TODAY;
    return '<div class="ib-stay"><span class="when">' + O.icon('clock') + esc(stayPhrase(b)) + '</span>' +
      (live ? readyHTML(b) : '<span class="muted">' + esc(b.id) + ' · ' + esc(U.platName(b.channel)) + '</span>') +
      (canEdit() ? '<label class="asg"><span>Handled by</span><select class="select" data-f="assign" aria-label="Assign conversation">' + D.staff.map(function (s) { return '<option value="' + s.id + '"' + (s.id === c.assigneeId ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label>'
        : '<span class="asg"><span>Handled by</span><span class="who-plain">' + esc((staff(c.assigneeId) || { name: 'Nobody yet' }).name) + '</span></span>') + '</div>';
  }
  function xlHTML(m, key) {
    if (m.from === 'guest' && m.tr && m.tr.text) {
      var open = live.origOpen[key];
      return '<span class="xl">Translated from ' + esc(langName(m.lang) || 'the guest\'s language') + ' · <button type="button" data-orig="' + key + '">' + (open ? 'Hide original' : 'Show original') + '</button>' + (open ? '<span class="orig">' + esc(m.caption || m.text) + '</span>' : '') + '</span>';
    }
    if (m.from === 'staff' && m.orig) {
      var o2 = live.origOpen[key];
      return '<span class="xl">Sent in ' + esc(langName(m.lang) || 'the guest\'s language') + ' · <button type="button" data-orig="' + key + '">' + (o2 ? 'Hide what you wrote' : 'Show what you wrote') + '</button>' + (o2 ? '<span class="orig">' + esc(m.orig) + '</span>' : '') + '</span>';
    }
    var cfg = liveCfg();
    if (m.from === 'guest' && m.xid && cfg && cfg.translate && !m.tr && String(m.caption || m.text || '').trim() && m.type !== 'voice' && !(m.lang && m.lang === myLang())) {
      return '<span class="xl"><button type="button" data-xl="' + key + '">' + (live.busy['xl' + key] ? 'Translating…' : 'Translate') + '</button></span>';
    }
    return '';
  }
  function bubbleInner(c, m, i) {
    var key = c.id + ':' + i;
    if (m.media && m.media.id && !m.url) {
      var kind = m.type === 'image' ? 'Photo' : m.type === 'voice' ? 'Voice message' : m.name || m.text || 'File';
      return { media: true, file: true, cap: m.caption, html: '<div class="fileb"><span class="fi ' + (m.type === 'image' ? 'img' : 'gen') + '">' + O.icon(m.type === 'image' ? 'image' : m.type === 'voice' ? 'mic' : 'file') + '</span><span class="fn"><b>' + esc(kind) + '</b><span>On WhatsApp</span></span><button type="button" class="dl" data-wamedia="' + key + '" aria-label="Open ' + esc(kind) + '">' + (live.busy['m' + key] ? '…' : O.icon('download')) + '</button></div>' + (m.caption ? '<div class="cap">' + esc(m.tr && m.tr.text ? m.tr.text : m.caption) + xlHTML(m, key) + '</div>' : '') };
    }
    if (m.type === 'image') {
      var img = m.url ? '<img src="' + esc(m.url) + '" alt="' + esc(m.name || 'Photo') + '">' : m.art === 'sink' ? sinkArt() : '<span class="fileb">' + O.icon('image') + esc(m.text) + '</span>';
      return { media: true, cap: m.caption, html: '<button type="button" class="img-btn" data-img="' + key + '" aria-label="Open photo">' + img + '</button>' + (m.caption ? '<div class="cap">' + esc(m.caption) + '</div>' : '') };
    }
    if (m.type === 'file') {
      var e = ext(m.name || m.text), kind = e === 'PDF' ? '' : /DOC|TXT|XLS|CSV|PPT/.test(e) ? 'doc' : /PNG|JPG|JPEG|GIF|HEIC|WEBP/.test(e) ? 'img' : 'gen';
      return { media: true, cap: m.caption, html: '<div class="fileb"><span class="fi ' + kind + '">' + esc(e) + '</span><span class="fn"><b>' + esc(m.name || m.text) + '</b><span>' + esc(m.size || '') + (m.size ? ' · ' : '') + esc(e) + '</span></span>' + (m.url ? '<button type="button" class="dl" data-dl="' + key + '" aria-label="Download ' + esc(m.name) + '">' + O.icon('download') + '</button>' : '') + '</div>' + (m.caption ? '<div class="cap">' + esc(m.caption) + '</div>' : '') };
    }
    if (m.type === 'voice') {
      var wave = waveFor(m, key), b = bk(c);
      var who = m.from === 'guest' ? b.guest.name : (staff(m.staffId) || { name: 'Team' }).name;
      return { voice: true, html: '<div class="voice" data-vkey="' + key + '">' +
        (m.from === 'guest' ? '<span class="vav">' + U.avatar(who) + O.icon('mic') + '</span>' : '') +
        '<button type="button" class="vp" data-play="' + key + '" aria-label="Play voice message, ' + durText(m.duration) + '">' + PLAY_SVG + '</button>' +
        '<span class="vw"><span class="wave" aria-hidden="true">' + wave.map(function (h) { return '<i style="height:' + Math.round(18 + h * 82) + '%"></i>'; }).join('') + '</span>' +
        '<span class="vd" data-vd="' + key + '">' + durText(m.duration) + '</span></span>' +
        (m.from !== 'guest' ? '<span class="vav">' + U.avatar(who) + O.icon('mic') + '</span>' : '') + '</div>' +
        (m.transcript ? '<button type="button" class="trans-t" data-trans="' + key + '">' + (st['tr' + key] ? 'Hide transcript' : 'Show transcript') + '</button>' + (st['tr' + key] ? '<div class="trans">' + esc(m.transcript) + '</div>' : '') : '') };
    }
    var txt = esc(codeSafe(c, m.from === 'guest' && m.tr && m.tr.text ? m.tr.text : m.text));
    if (m.from === 'note') txt = txt.replace(mentionRe(), '<b class="mention">@$1</b>');
    return { html: '<span class="txt">' + txt + '</span>' + xlHTML(m, key) + actsHTML(c, m, i) };
  }
  /* a booking site's answer buttons on a guest message (an Agoda special request: Accepted / Subject to availability /
     Not accepted). Each opens the site's own page, which records the answer; the chat remembers which one was picked. */
  function actOk(a) { return !!a && typeof a.label === 'string' && typeof a.url === 'string' && a.url.length <= 2000 && /^https:\/\/portal\.agoda\.com\/[^\s"'<>\\?#]*\/PropertyMessage\/[^\s"'<>\\]*$/i.test(a.url); }
  function actsHTML(c, m, i) {
    var all = m.from === 'guest' && Array.isArray(m.actions) ? m.actions : [], list = [];
    all.forEach(function (a, k) { if (list.length < 4 && actOk(a)) list.push({ a: a, k: k }); });
    if (!list.length) return '';
    var pick = m.xid && c.picks && c.picks[m.xid], site = c.ota || 'the booking site';
    var head = pick ? 'You answered <b>' + esc(pick.label) + '</b> on ' + esc(site) + (typeof pick.at === 'string' && pick.at.length >= 16 ? ' · ' + esc(fmt.dateTime(pick.at)) : '') + (staff(pick.staffId) ? ' · ' + esc(staff(pick.staffId).name) : '')
      : canSend() ? 'Answer the request on ' + esc(site) + ':' : esc(site) + ' asks for an answer. Someone who can reply to guests can give it.';
    return '<div class="acts"><span class="acts-h">' + head + '</span>' + list.map(function (it) {
      var a = it.a, k = it.k;   /* k: its place in m.actions, which the click looks up */
      return canSend() ? '<a class="act' + (pick && pick.label === a.label ? ' on' : '') + '" href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer nofollow" data-pickact="' + i + ':' + k + '">' + esc(a.label) + '</a>'
        : '<span class="act">' + esc(a.label) + '</span>';
    }).join('') + '</div>';
  }
  function threadHTML(c) {
    if (!c.messages.length) {
      var b0 = bk(c);
      var r0 = liveOn() ? routeOf(c) : null;
      return '<div class="ib-hello"><b>Start the conversation with ' + esc(b0.guest.name) + '</b><br>' + (!canSend() ? 'No messages yet.'
        : liveOn() ? (r0 && r0.open ? 'Your first message goes by ' + esc(r0.label) + '. Use a quick reply below or type a message.' : 'WhatsApp only takes a reply after the guest has written to your WhatsApp number. Share the number in your booking confirmation' + (routesFor(c).some(function (x) { return x.via === 'channex'; }) ? ', or reply through the booking site below' : '') + '.')
        : 'Your first message goes to ' + esc(phoneOf(b0)) + ' on WhatsApp. Use a quick reply below or type a message.') + '</div>';
    }
    var out = [], prevDay = null, prevKey = null, prevTime = null, b = bk(c), mark = st.unreadMark[c.id];
    var firstUnread = mark ? mark.i : -1;
    c.messages.forEach(function (m, i) {
      var day = m.time.slice(0, 10);
      if (day !== prevDay) { out.push('<div class="day">' + esc(dayLabel(day)) + '</div>'); prevDay = day; prevKey = null; }
      if (i === firstUnread) { out.push('<div class="unread-div" role="separator">' + fmt.plural(mark.n, 'unread message') + '</div>'); prevKey = null; }
      if (m.from === 'system') {
        var extra = (m.body ? '<details class="sysb"><summary>' + (m.subject ? 'Show the email' : 'Show more') + '</summary><div class="sysb-t">' + linkify(m.body) + '</div></details>' : '') +
          (m.link && m.link.page ? '<button type="button" class="lk" data-golink="' + i + '">' + (m.link.page === 'reviews' ? 'Open the review' : 'Open') + '</button>' : '');
        out.push('<div class="sysm' + (extra ? ' rich' : '') + '">' + O.icon(m.via === 'email' ? 'chat' : 'alert') + '<span>' + esc(m.text) + extra + '</span><span class="t">' + fmt.time(m.time) + '</span></div>'); prevKey = null; return;
      }
      var side = m.from === 'guest' ? 'in' : m.from === 'note' ? 'inote' : 'out';
      var key = side + (m.staffId || (m.app ? 'app' : ''));
      var gapMin = prevTime ? (Date.parse(m.time + ':00Z') - Date.parse(prevTime + ':00Z')) / 60000 : 99;
      var first = key !== prevKey || gapMin > 10;
      prevKey = key; prevTime = m.time;
      var inner = bubbleInner(c, m, i);
      var who = '';
      if (side === 'inote') who = '<div class="who">' + O.icon('lock') + 'Internal note · ' + esc((staff(m.staffId) || { name: 'Team' }).name) + '</div>';
      else if (side === 'out' && first) who = '<div class="who">' + esc(m.app && !m.staffId ? 'From the WhatsApp app' : (staff(m.staffId) || { name: 'Team' }).name) + '</div>';
      var status = side === 'out' ? msgStatus(c, i) : null;
      var meta = '<span class="meta">' + (m.via && VIA[m.via] && side === 'in' ? '<span class="mvia">' + esc(VIA[m.via]) + '</span>' : '') + fmt.time(m.time) + (status ? tickHTML(status) : '') + '</span>';
      if (m.via === 'email' && side === 'in' && (m.subject || (m.files && m.files.length))) inner = { html: (m.subject ? '<div class="subj">' + esc(m.subject) + '</div>' : '') + inner.html + (m.files && m.files.length ? '<div class="efiles">' + O.icon('clip') + 'In the original email: ' + esc(m.files.join(', ')) + '</div>' : '') };
      var cls = 'bub' + (inner.media ? ' media' + (inner.cap ? ' hascap' : '') + (m.type === 'file' || inner.file ? ' isfile' : '') : '') + (inner.voice ? ' vbub' : '');
      out.push('<div class="msg ' + side + (first ? ' first' : '') + '" data-i="' + i + '"><div class="' + cls + '">' + who + inner.html + (inner.voice ? meta.replace('class="meta"', 'class="meta"') : meta) + '</div>' +
        (side === 'out' && status === 'failed' ? '<div class="via bad">Not delivered' + (m.error ? ': ' + esc(m.error) : '') + '</div>'
          : side === 'out' && i === c.messages.length - 1 ? '<div class="via">' + (status === 'read' ? 'Read' : status === 'delivered' ? 'Delivered' : 'Sent') + ' · ' + (m.via === 'email' ? 'Email to ' + esc(c.em || '') : m.via && m.via !== 'whatsapp' ? esc(VIA[m.via] || 'the booking site') + ' chat' : 'WhatsApp to ' + esc(m.via ? (c.wa && canContacts() ? '+' + c.wa : phoneOf(b)) : phoneOf(b))) + '</div>' : '') + '</div>');
    });
    return out.join('');
  }
  function qrBarHTML(c) {
    var b = bk(c), list = repliesFor(b.propertyId);
    return '<div class="qr-bar" role="group" aria-label="Quick replies"><span class="lbl">' + O.icon('sparkle') + 'Quick replies</span>' +
      list.map(function (q) {
        var unit = q.propertyIds.length ? '<span class="unit" title="Tagged to ' + esc(q.propertyIds.map(function (x) { return prop(x).short; }).join(', ')) + '">' + O.icon('home') + esc(prop(b.propertyId).short) + (q.propertyIds.length > 1 ? ' +' + (q.propertyIds.length - 1) : '') + '</span>' : '';
        return '<button type="button" class="qr" data-qr="' + q.id + '" title="' + esc(fill(q.text, b)) + '">' + esc(q.title) + unit + '</button>';
      }).join('') +
      (canQR() ? '<button type="button" class="qr manage" data-act="manage">' + O.icon('edit') + 'Manage</button>' : '') + '</div>';
  }
  function trayHTML(c) {
    var list = st.pending[c.id] || [];
    if (!list.length) return '';
    return '<div class="tray" aria-label="Attachments to send">' + list.map(function (a, i) {
      return '<div class="tray-it">' + (a.kind === 'image' ? '<img src="' + esc(a.url) + '" alt="">' : '<div class="tf">' + O.icon(a.kind === 'audio' ? 'mic' : 'file') + '<span class="xs">' + esc(a.kind === 'audio' ? 'Audio' : ext(a.name)) + '</span></div>') +
        '<div class="tn" title="' + esc(a.name) + '">' + esc(a.name) + '</div><button type="button" class="rm" data-rm="' + i + '" aria-label="Remove ' + esc(a.name) + '">' + O.icon('x') + '</button></div>';
    }).join('') + '</div>';
  }
  function modes() { var m = []; if (canSend()) m.push(['reply', 'Reply to guest']); if (canNote()) m.push(['note', 'Internal note']); return m; }
  function composerHTML(c) {
    var ms = modes();
    if (!ms.length) return '<div class="ib-compose"><div class="ib-ro">' + O.icon('lock') + '<span>You can read this chat. Replying to guests and writing notes are not part of your access.</span></div></div>';
    if (!ms.some(function (x) { return x[0] === st.mode; })) st.mode = ms[0][0];
    var b = bk(c), note = st.mode === 'note', rec = st.rec && st.rec.convId === c.id;
    var draft = st.drafts[c.id] || '', hasStuff = draft.trim() || (st.pending[c.id] || []).length;
    return '<div class="ib-compose' + (note ? ' is-note' : '') + '">' +
      '<div class="att-menu" role="menu">' +
      '<button type="button" data-pick="photo"><span class="ai">' + O.icon('image') + '</span><span>Photos<small>Shows as a picture in the chat</small></span></button>' +
      '<button type="button" data-pick="camera"><span class="ai">' + O.icon('camera') + '</span><span>Camera<small>Take a photo on a phone or tablet</small></span></button>' +
      '<button type="button" data-pick="doc"><span class="ai">' + O.icon('file') + '</span><span>Document<small>PDF, Word, Excel or any file</small></span></button>' +
      '<button type="button" data-pick="audio"><span class="ai">' + O.icon('mic') + '</span><span>Audio file<small>Send a recording as a voice note</small></span></button></div>' +
      (canSend() ? '<div class="qr-wrap">' + qrBarHTML(c) + '</div>' : '') +
      '<div class="tray-wrap">' + trayHTML(c) + '</div>' +
      (!note && liveOn() && routeOf(c) && !routeOf(c).open ? '<div class="cmp-warn">' + esc(routeOf(c).why) + '</div>' : '') +
      '<div class="cmp-top">' + (ms.length > 1 ? U.seg(ms, st.mode, 'data-mode') : '') +
      '<span class="cmp-hint' + (ms.length > 1 ? '' : ' only') + '">' + (note ? O.icon('lock') + '<span>' + (ms.length > 1 ? 'Only your team sees notes. Type @ and a name to mention someone.' : 'Your access allows internal notes only. The guest does not see them.') + '</span>'
        : liveOn() ? routeHTML(c) : O.icon('whatsapp') + '<span class="ellipsis">To ' + esc(phoneOf(b)) + ' on WhatsApp</span>') + (canSend() && !liveOn() ? '<span class="k">Type / for quick replies</span>' : '') + '</span></div>' +
      '<div class="cmp-bar">' + (rec ? recHTML() :
        '<button type="button" class="round plain" data-act="attach" aria-label="Attach a photo, file or audio" aria-haspopup="true" title="Attach">' + O.icon('clip') + '</button>' +
        '<div class="cmp-box"><label class="sr-only" for="ib-input">' + (note ? 'Internal note' : 'Message') + '</label><textarea id="ib-input" rows="1" data-f="msg" title="Enter sends, Shift + Enter adds a new line" placeholder="' + (note ? 'Write an internal note' : 'Message ' + esc(guestFirst(b.guest.name))) + '">' + esc(draft) + '</textarea></div>' +
        (hasStuff ? '<button type="button" class="round go" data-act="send" aria-label="Send">' + O.icon('send') + '</button>'
          : '<button type="button" class="round go" data-act="record" aria-label="Record a voice note" title="Record a voice note">' + O.icon('mic') + '</button>')) + '</div>' +
      '<input type="file" hidden data-in="photo" accept="image/*" multiple>' +
      '<input type="file" hidden data-in="camera" accept="image/*" capture="environment">' +
      '<input type="file" hidden data-in="doc" multiple>' +
      '<input type="file" hidden data-in="audio" accept="audio/*">' +
      '</div>';
  }
  /* why routesFor(c) found nothing, in words the team can act on */
  function noRouteWhy(c) {
    var cfg = liveCfg() || {}, b = bk(c), phone = c.wa || (b && b.guest && b.guest.phone) || (c.contact && c.contact.phone);
    var site = b && VIA[b.channel] && /^(booking|airbnb|expedia)$/.test(b.channel) ? VIA[b.channel] : null;
    if (site && !(b.channex && b.channex.bookingId)) return 'This ' + site + ' booking was entered by hand, so it is not linked to the ' + site + ' chat. Message the guest from ' + site + ' itself' + (phone ? ', or connect WhatsApp under Inbox settings.' : '.');
    if (phone && !(cfg.whatsapp && cfg.whatsapp.configured && cfg.whatsapp.number)) return 'WhatsApp is not connected yet, so the guest\'s phone number cannot be used. Connect it under Inbox settings.';
    return 'No way to reach this guest yet: add a phone number to the booking.';
  }
  function routeHTML(c) {
    var rs = routesFor(c), r = routeOf(c), cfg = liveCfg();
    if (!rs.length) { var why = noRouteWhy(c); return O.icon('alert') + '<span class="ellipsis" title="' + esc(why) + '">' + esc(why) + '</span>'; }
    var pick = rs.length > 1 ? '<label class="sr-only" for="ib-via">Send by</label><select id="ib-via" class="select" data-f="via">' + rs.map(function (x) { return '<option value="' + x.via + '"' + (x === r ? ' selected' : '') + '>' + esc(x.label) + (x.open ? '' : ' (closed)') + '</option>'; }).join('') + '</select>'
      : '<span class="ellipsis">' + esc(r.label) + '</span>';
    var gl = guestLang(c), on = !!live.xl[c.id];
    var xl = cfg && cfg.translate ? '<button type="button" class="cmp-xl' + (on ? ' on' : '') + '" data-act="xltoggle" aria-pressed="' + on + '" title="Check the reply in the guest\'s language before it goes">' + O.icon('lang') + (on ? 'Translate to ' + esc(langName(gl) || 'guest\'s language') : 'Translate') + '</button>' : '';
    return '<span class="cmp-route">' + O.icon(r.via === 'whatsapp' ? 'whatsapp' : 'chat') + pick + xl + '</span>';
  }
  function recHTML() {
    var r = st.rec;
    return '<button type="button" class="round plain" data-act="reccancel" aria-label="Delete recording" title="Delete recording">' + O.icon('trash') + '</button>' +
      '<div class="rec' + (r && r.paused ? ' paused' : '') + '" role="status" aria-live="off"><span class="dot" aria-hidden="true"></span><span class="ib-rtm">' + durText(r ? r.elapsed : 0) + '</span><span class="lv" aria-hidden="true"></span><span class="rl">' + (r && r.paused ? 'Paused' : 'Recording') + '</span></div>' +
      '<button type="button" class="round plain" data-act="recpause" aria-label="' + (r && r.paused ? 'Resume recording' : 'Pause recording') + '">' + (r && r.paused ? O.icon('mic') : PAUSE_SVG) + '</button>' +
      '<button type="button" class="round go" data-act="recsend" aria-label="Send voice note">' + O.icon('send') + '</button>';
  }

  /* ------------------------------------------------------------------ voice playback */
  function stopPlayer() {
    if (player.audio) { try { player.audio.pause(); } catch (e) {} }
    if (player.synth && window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    cancelAnimationFrame(player.raf);
    var key = player.key;
    player.key = null; player.audio = null; player.synth = false;
    if (key) paintVoice(key, 0, null);
  }
  function msgByKey(key) { var p = key.split(':'), c = conv(p[0]); return c ? c.messages[+p[1]] : null; }
  function paintVoice(key, prog, cur) {
    var el = document.querySelector('.pg-inbox [data-vkey="' + key + '"]'); if (!el) return;
    var bars = el.querySelectorAll('.wave i'), n = Math.round(prog * bars.length);
    for (var i = 0; i < bars.length; i++) bars[i].classList.toggle('p', i < n);
    var btn = el.querySelector('.vp'); var playing = player.key === key;
    if (btn && btn.dataset.state !== String(playing)) { btn.innerHTML = playing ? PAUSE_SVG : PLAY_SVG; btn.dataset.state = String(playing); btn.setAttribute('aria-label', playing ? 'Pause voice message' : 'Play voice message'); }
    var m = msgByKey(key), vd = el.querySelector('.vd');
    if (vd && m) vd.textContent = cur != null ? durText(cur) : durText(m.duration);
  }
  function togglePlay(key) {
    if (player.key === key) { stopPlayer(); return; }
    stopPlayer();
    var m = msgByKey(key); if (!m) return;
    player.key = key; player.dur = m.duration || 1; player.t0 = performance.now();
    if (m.url) {
      var a = new Audio(m.url); player.audio = a;
      a.onended = stopPlayer;
      a.play().catch(function () { U.toast('This recording could not be played in this browser', 'bad'); stopPlayer(); });
    } else if (m.transcript && window.speechSynthesis && window.SpeechSynthesisUtterance) {
      /* the demo voice note has no recording: read its transcript aloud so play does something real */
      try { var u = new window.SpeechSynthesisUtterance(m.transcript); u.rate = 1.02; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); player.synth = true; } catch (e) {}
    }
    (function loop() {
      if (player.key !== key) return;
      var t = player.audio ? player.audio.currentTime : (performance.now() - player.t0) / 1000;
      var prog = Math.min(1, t / player.dur);
      paintVoice(key, prog, t);
      if (!player.audio && prog >= 1) { stopPlayer(); return; }
      player.raf = requestAnimationFrame(loop);
    })();
  }

  /* ------------------------------------------------------------------ quick replies manager */
  function manageQuickReplies(currentPid, onChange) {
    if (!canQR()) { U.toast('Editing quick replies is not part of your access', 'bad'); return; }
    var ui = { unit: '', editing: null, confirm: null, err: '' };
    var sample = (st.sel && conv(st.sel) && bk(conv(st.sel))) || D.bookings.filter(function (x) { return x.checkIn === D.TODAY; })[0];
    var body = O.html('<div class="ib-qrm"></div>');
    function tagsHTML(q) {
      return q.propertyIds.length ? q.propertyIds.map(function (pid) { return '<span class="pill brand">' + esc(prop(pid).short) + '</span>'; }).join('') : '<span class="pill neutral">All units</span>';
    }
    function hl(text) { return esc(text).replace(/\{([a-z_]+)\}/g, '<span class="var">{$1}</span>'); }
    function editorHTML() {
      var q = ui.editing, specific = q.propertyIds.length > 0 || q._specific;
      var sb = sample && (q.propertyIds.length && q.propertyIds.indexOf(sample.propertyId) < 0 ? D.bookings.filter(function (x) { return x.propertyId === q.propertyIds[0] && x.checkOut > D.TODAY && x.status !== 'cancelled'; })[0] || sample : sample);
      return '<div class="qrm-ed"><b>' + (q.id ? 'Edit quick reply' : 'New quick reply') + '</b>' +
        '<div class="field"><label for="qr-title">Name (shown on the button)</label><input id="qr-title" class="input" data-e="title" maxlength="40" value="' + esc(q.title) + '" placeholder="For example: Pool hours"></div>' +
        '<div class="field"><label for="qr-text">Message</label><textarea id="qr-text" class="textarea" data-e="text" rows="3" placeholder="Write the message. Add details from the booking with the buttons below.">' + esc(q.text) + '</textarea>' +
        '<div class="vars">' + VARS.map(function (v) { return '<button type="button" data-var="' + v[0] + '">+ ' + v[1] + '</button>'; }).join('') + '</div></div>' +
        '<div class="field"><label>Use for</label><div class="scope"><label class="check"><input type="radio" name="qr-scope" value="all"' + (specific ? '' : ' checked') + '><span>All units</span></label><label class="check"><input type="radio" name="qr-scope" value="some"' + (specific ? ' checked' : '') + '><span>Only these units</span></label></div>' +
        (specific ? '<div class="units">' + D.properties.map(function (p) { var on = q.propertyIds.indexOf(p.id) >= 0; return '<label class="' + (on ? 'on' : '') + '"><input type="checkbox" data-unit="' + p.id + '"' + (on ? ' checked' : '') + '><span class="prop-dot" style="background:' + U.propColor(p.id) + '"></span><span class="ib-nm">' + esc(p.short) + '</span></label>'; }).join('') + '</div>' : '') + '</div>' +
        (sb ? '<div class="field"><label>Preview for ' + esc(sb.guest.name) + ' at ' + esc(prop(sb.propertyId).short) + '</label><div class="pv"><div class="pvb">' + esc(fill(q.text || 'Your message appears here.', sb)) + '</div></div></div>' : '') +
        (ui.err ? '<div class="err">' + esc(ui.err) + '</div>' : '') +
        '<div class="row-flex"><button type="button" class="btn btn-primary btn-sm" data-q="save">' + (q.id ? 'Save changes' : 'Add quick reply') + '</button><button type="button" class="btn btn-ghost btn-sm" data-q="cancel">Cancel</button></div></div>';
    }
    function paint() {
      var list = D.quickReplies.filter(function (q) { return !ui.unit || !q.propertyIds.length || q.propertyIds.indexOf(ui.unit) >= 0; });
      body.innerHTML = '<div class="qrm-bar"><label class="sr-only" for="qr-unit">Show replies for</label><select id="qr-unit" class="select" data-q-unit>' + U.propOptions(ui.unit, { all: 'Every unit' }).replace('>Every unit<', '>Show replies for every unit<') + '</select>' +
        '<span class="small muted">' + fmt.plural(list.length, 'reply', 'replies') + '</span>' +
        (ui.editing && !ui.editing.id ? '' : '<button type="button" class="btn btn-primary btn-sm" data-q="add">' + O.icon('plus') + 'Add quick reply</button>') + '</div>' +
        (ui.editing && !ui.editing.id ? editorHTML() : '') +
        (list.length ? list.map(function (q) {
          if (ui.editing && ui.editing.id === q.id) return editorHTML();
          return '<div class="qrm-row"><div class="m"><div class="t">' + esc(q.title) + '</div><div class="x">' + hl(q.text) + '</div><div class="tags">' + tagsHTML(q) + '</div>' +
            (ui.confirm === q.id ? '<div class="confirm" style="margin-top:8px">Delete "' + esc(q.title) + '"? <button type="button" class="btn btn-danger btn-xs" data-q="del" data-id="' + q.id + '">Delete</button><button type="button" class="btn btn-ghost btn-xs" data-q="keep">Keep</button></div>' : '') + '</div>' +
            '<div class="acts"><button type="button" class="btn btn-ghost btn-xs" data-q="edit" data-id="' + q.id + '">' + O.icon('edit') + 'Edit</button><button type="button" class="btn btn-ghost btn-xs" data-q="ask" data-id="' + q.id + '" aria-label="Delete ' + esc(q.title) + '">' + O.icon('trash') + '</button></div></div>';
        }).join('') : U.empty('No quick replies for this unit yet. Add one above.'));
      var ta = O.$('[data-e=text]', body); if (ta) ta.dataset.caret = ta.value.length;
    }
    function readEditor() {
      var q = ui.editing; if (!q) return;
      var t = O.$('[data-e=title]', body), x = O.$('[data-e=text]', body);
      if (t) q.title = t.value; if (x) q.text = x.value;
    }
    body.addEventListener('click', function (e) {
      var x = e.target.closest('[data-q], [data-var]'); if (!x) return;
      if (x.dataset.var) {
        var ta = O.$('[data-e=text]', body), token = '{' + x.dataset.var + '}';
        var s = ta.selectionStart != null ? ta.selectionStart : ta.value.length, en = ta.selectionEnd != null ? ta.selectionEnd : s;
        ta.value = ta.value.slice(0, s) + token + ta.value.slice(en); ui.editing.text = ta.value;
        ta.focus(); ta.setSelectionRange(s + token.length, s + token.length); updatePreview(); return;
      }
      var a = x.dataset.q, q = x.dataset.id ? D.quickReplies.filter(function (k) { return k.id === x.dataset.id; })[0] : null;
      if (a === 'add') { ui.editing = { title: '', text: '', propertyIds: currentPid && ui.unit ? [ui.unit] : [], _specific: !!ui.unit }; ui.err = ''; paint(); O.$('[data-e=title]', body).focus(); }
      if (a === 'edit' && q) { ui.editing = { id: q.id, title: q.title, text: q.text, propertyIds: q.propertyIds.slice() }; ui.err = ''; ui.confirm = null; paint(); O.$('[data-e=title]', body).focus(); }
      if (a === 'cancel') { ui.editing = null; ui.err = ''; paint(); }
      if (a === 'ask' && q) { ui.confirm = q.id; paint(); }
      if (a === 'keep') { ui.confirm = null; paint(); }
      if (a === 'del' && q) { D.quickReplies.splice(D.quickReplies.indexOf(q), 1); ui.confirm = null; U.toast('Quick reply "' + q.title + '" deleted'); paint(); onChange(); }
      if (a === 'save') {
        readEditor();
        var ed = ui.editing, some = O.$('input[name=qr-scope][value=some]', body).checked;
        if (!ed.title.trim()) { ui.err = 'Give the quick reply a name.'; paint(); return; }
        if (!ed.text.trim()) { ui.err = 'Write the message text.'; paint(); return; }
        if (some && !ed.propertyIds.length) { ui.err = 'Choose at least one unit, or pick "All units".'; paint(); return; }
        var pids = some ? ed.propertyIds.slice() : [];
        if (ed.id) { var orig = D.quickReplies.filter(function (k) { return k.id === ed.id; })[0]; orig.title = ed.title.trim(); orig.text = ed.text.trim(); orig.propertyIds = pids; }
        else D.quickReplies.push({ id: O.uid('Q'), title: ed.title.trim(), text: ed.text.trim(), propertyIds: pids });
        U.toast('Quick reply "' + ed.title.trim() + '" saved for ' + (pids.length ? pids.map(function (p) { return prop(p).short; }).join(', ') : 'all units'));
        ui.editing = null; ui.err = ''; paint(); onChange();
      }
    });
    function updatePreview() {
      var pv = O.$('.pvb', body); if (!pv || !ui.editing) return;
      var sb = sample; pv.textContent = fill(ui.editing.text || 'Your message appears here.', sb);
    }
    body.addEventListener('input', function (e) {
      if (!ui.editing) return;
      if (e.target.dataset.e === 'text') { ui.editing.text = e.target.value; updatePreview(); }
      if (e.target.dataset.e === 'title') ui.editing.title = e.target.value;
    });
    body.addEventListener('change', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-q-unit')) { readEditor(); ui.unit = t.value; paint(); return; }
      if (!ui.editing) return;
      if (t.name === 'qr-scope') { readEditor(); ui.editing._specific = t.value === 'some'; if (t.value === 'all') ui.editing.propertyIds = []; else if (!ui.editing.propertyIds.length && currentPid) ui.editing.propertyIds = [currentPid]; paint(); return; }
      if (t.dataset.unit) { readEditor(); var i = ui.editing.propertyIds.indexOf(t.dataset.unit); if (t.checked && i < 0) ui.editing.propertyIds.push(t.dataset.unit); if (!t.checked && i >= 0) ui.editing.propertyIds.splice(i, 1); t.closest('label').classList.toggle('on', t.checked); }
    });
    paint();
    U.modal({ title: 'Quick replies', sub: 'Saved answers your team sends in one tap. Tag each one to the units it applies to, or to all units.', size: 'wide', body: body, autofocus: false, actions: [{ label: 'Done', kind: 'primary' }] });
  }

  /* ------------------------------------------------------------------ page */
  O.page('inbox', {
    desc: 'Guest conversations from every channel, one chat per stay',
    noDataRerender: true,
    render: function (root, ctx) {
      if (st.rec) cancelRecording(true);
      stopPlayer();
      var pr = ctx.params || {};
      if (st.prop === null) st.prop = O.store.get('inbox:prop', '') || '';
      if (st.prop && (!D.propById[st.prop] || !O.inView(st.prop))) { st.prop = ''; O.store.set('inbox:prop', ''); }
      if (ctx.fresh && pr.bookingId) {
        var c0 = D.conversations.filter(function (c) { return c.bookingId === pr.bookingId; })[0], b0 = D.booking(pr.bookingId);
        if (!c0 && b0 && canSend()) { c0 = { id: O.uid('C'), bookingId: pr.bookingId, unread: 0, messages: [], createdAt: nowISO(), assigneeId: O.state.viewer }; D.conversations.push(c0); }
        if (c0 && conv(c0.id)) {
          st.sel = c0.id; st.view = 'chat'; st.filter = 'all'; st.q = ''; st.tab = 'guests';
          if (st.prop && b0 && b0.propertyId !== st.prop) { st.prop = ''; O.store.set('inbox:prop', ''); } /* the chat asked for must be in the list */
        } else if (b0 && !canSend()) U.toast('There is no chat with ' + b0.guest.name + ' yet, and messaging guests is not part of your access', 'bad');
        ctx.params = {};
      } else if (ctx.fresh) { st.view = 'list'; }
      pruneEmpty(st.sel);
      if (!st.sel || !conv(st.sel)) { st.sel = isPhone() ? null : ((st.tab === 'updates' ? visibleUpds() : visibleConvs())[0] || {}).id || null; }

      root.innerHTML = '<div class="pg-inbox"><div class="ib' + (st.view === 'chat' && st.sel ? ' show-chat' : '') + '"><section class="ib-list" aria-label="Chats">' + listHTML() + '</section><section class="ib-chat" aria-label="Conversation"></section></div></div>';
      var page = O.$('.pg-inbox', root), ib = O.$('.ib', page), chat = O.$('.ib-chat', page), listEl = O.$('.ib-list', page);
      /* phone: exactly the space between the top bar and the tab bar */
      function fit() {
        if (!document.body.contains(ib)) return;
        if (!isPhone()) { ib.style.height = ''; return; }
        var tb = O.$('.tabbar'), tbh = tb && getComputedStyle(tb).display !== 'none' ? tb.getBoundingClientRect().height : 0;
        ib.style.height = Math.max(320, Math.round(window.innerHeight - (ib.getBoundingClientRect().top + window.scrollY) - tbh)) + 'px';
      }
      fit(); window.addEventListener('resize', fit); ctx.onLeave(function () { window.removeEventListener('resize', fit); });

      /* ---------- painting ---------- */
      function paintRows() { O.$('.ib-rows', listEl).innerHTML = rowsHTML(); }
      function paintTabs() { var t = O.$('.ib-tabs', listEl); if (!t) return; var w = document.createElement('div'); w.innerHTML = listHTML(); var nt = O.$('.ib-tabs', w); if (nt) t.outerHTML = nt.outerHTML; }
      function paintFilters() { var fc = filterCounts(); O.$$('[data-filter]', listEl).forEach(function (b) { b.classList.toggle('on', b.dataset.filter === st.filter); b.setAttribute('aria-pressed', b.dataset.filter === st.filter); var n = O.$('.n', b); if (n) n.textContent = fc[b.dataset.filter]; }); }
      function paintChat(full) {
        var c = conv(st.sel);
        if (!c) { chat.innerHTML = '<div class="ib-none"><span class="art">' + O.icon('chat') + '</span>' + (convs().length ? '<h3>Choose a chat</h3><div>Pick a guest on the left to read and reply. Messages, photos, files and voice notes all live in one thread per stay.</div>' : '<h3>Guest chats show up here</h3><div>When a guest books or messages you, their chat opens here with the stay details next to it.</div>') + '</div>'; return; }
        if (isUpd(c)) {
          if (full || !O.$('.ib-thread', chat)) {
            chat.innerHTML = updHeadHTML(c) + '<div class="ib-thread" role="log" aria-live="polite" aria-label="Messages"></div>' + updComposerHTML(c);
            wireComposer(); paintThread(true); return;
          }
          var uh = O.$('.ib-head', chat); uh.outerHTML = updHeadHTML(c);
          paintThread(false); return;
        }
        if (full || !O.$('.ib-thread', chat)) {
          chat.innerHTML = headHTML(c) + stayHTML(c) + '<div class="ib-thread" role="log" aria-live="polite" aria-label="Messages"></div>' + composerHTML(c);
          wireComposer();
          paintThread(true);
          return;
        }
        var head = O.$('.ib-head', chat); head.outerHTML = headHTML(c);
        var stay = O.$('.ib-stay', chat); stay.outerHTML = stayHTML(c);
        var qw = O.$('.qr-wrap', chat); if (qw) qw.innerHTML = qrBarHTML(c);
        paintThread(false);
      }
      chat.addEventListener('load', function (e) {
        if (e.target.tagName !== 'IMG') return;
        var th = O.$('.ib-thread', chat); if (th && th.scrollHeight - th.scrollTop - th.clientHeight < 420) th.scrollTop = th.scrollHeight;
      }, true);
      function paintThread(toBottom) {
        var c = conv(st.sel), th = O.$('.ib-thread', chat); if (!c || !th) return;
        var atBottom = th.scrollHeight - th.scrollTop - th.clientHeight < 60;
        th.innerHTML = threadHTML(c);
        if (player.key && player.key.indexOf(c.id + ':') === 0) paintVoice(player.key, 0, null);
        if (toBottom || atBottom) th.scrollTop = th.scrollHeight;
      }
      function paintSendBtn() {
        var c = conv(st.sel); if (!c || st.rec || isUpd(c)) return;
        var ta = O.$('#ib-input', chat), bar = O.$('.cmp-bar', chat); if (!bar) return;
        var has = (ta && ta.value.trim()) || (st.pending[c.id] || []).length;
        var btn = O.$('.round.go', bar); if (!btn) return;
        var want = has ? 'send' : 'record';
        if (btn.dataset.act === want) return;
        btn.dataset.act = want; btn.innerHTML = O.icon(has ? 'send' : 'mic');
        btn.setAttribute('aria-label', has ? 'Send' : 'Record a voice note'); btn.title = has ? 'Send' : 'Record a voice note';
      }
      function paintTray() { var c = conv(st.sel), w = O.$('.tray-wrap', chat); if (c && w) w.innerHTML = trayHTML(c); paintSendBtn(); }
      function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; }
      function wireComposer() {
        var ta = O.$('#ib-input', chat);
        if (ta) { autosize(ta); }
        O.$$('input[type=file][data-in]', chat).forEach(function (inp) {
          inp.addEventListener('change', function () { addFiles(inp.dataset.in, inp.files); inp.value = ''; });
        });
      }
      function rebuildComposer() {
        var c = conv(st.sel), old = O.$('.ib-compose', chat); if (!c || !old) { if (c && isUpd(c) && !old && updComposerHTML(c)) chat.insertAdjacentHTML('beforeend', updComposerHTML(c)); return; }
        old.outerHTML = isUpd(c) ? updComposerHTML(c) : composerHTML(c); wireComposer();
      }

      /* ---------- selecting chats ---------- */
      function select(id, focus) {
        if (st.rec && st.rec.convId !== id) cancelRecording(false, 'Recording discarded because you opened another chat');
        var c = conv(id); if (!c) return;
        if (st.sel !== id) { st.mode = 'reply'; delete st.unreadMark[st.sel]; pruneEmpty(id); }
        st.sel = id; st.view = 'chat'; ib.classList.add('show-chat');
        if (c.unread) { st.unreadMark[id] = { i: Math.max(0, c.messages.length - c.unread), n: c.unread }; c.unread = 0; }
        paintRows(); paintFilters(); paintTabs(); paintChat(true);
        if (focus !== false && !isPhone()) { var ta = O.$('#ib-input', chat); if (ta) ta.focus(); }
        O.emit('data', { type: 'inbox-read', id: id });
      }

      /* ---------- sending ---------- */
      function push(c, msg) {
        c.messages.push(msg);
        delete st.unreadMark[c.id]; /* like WhatsApp: replying clears the unread divider */
        if (msg.from === 'staff') {
          setTimeout(function () { if (msg.status === 'sent') { msg.status = 'delivered'; if (st.sel === c.id) paintThread(false); paintRows(); } }, 1400);
        }
      }
      function send() {
        var c = conv(st.sel); if (!c) return;
        if (st.mode === 'note' ? !canNote() : !canSend()) { U.toast(st.mode === 'note' ? 'Writing internal notes is not part of your access' : NO_SEND, 'bad'); return; }
        var ta = O.$('#ib-input', chat), text = ta ? ta.value.trim() : '', files = st.pending[c.id] || [];
        if (!text && !files.length) return;
        if (st.mode !== 'note' && liveOn()) { sendLive(c, text, files); return; }
        var from = st.mode === 'note' ? 'note' : 'staff', base = { from: from, staffId: O.state.viewer };
        files.forEach(function (a, i) {
          var cap = i === files.length - 1 && text ? text : '';
          if (a.kind === 'audio') push(c, Object.assign({}, base, { type: 'voice', text: 'Voice message', url: a.url, duration: a.duration || 0, name: a.name, time: nowISO(), status: from === 'staff' ? 'sent' : undefined }));
          else push(c, Object.assign({}, base, { type: a.kind === 'image' ? 'image' : 'file', text: a.name, name: a.name, size: sizeText(a.size), url: a.url, mime: a.mime, caption: cap, time: nowISO(), status: from === 'staff' ? 'sent' : undefined }));
          if (cap) text = '';
        });
        if (text) push(c, Object.assign({}, base, { type: 'text', text: text, time: nowISO(), status: from === 'staff' ? 'sent' : undefined }));
        st.pending[c.id] = []; st.drafts[c.id] = '';
        if (ta) { ta.value = ''; ta.placeholder = st.mode === 'note' ? 'Write an internal note' : 'Message ' + guestFirst(bk(c).guest.name); autosize(ta); }
        delete st.unreadMark[c.id];
        paintTray(); paintThread(true); paintRows();
        if (from === 'staff' && !st.told) { st.told = true; U.toast('Sent to ' + bk(c).guest.name + ' on WhatsApp. Sending is not connected in this version.'); }
        if (from === 'note') U.toast('Internal note added. The guest cannot see it.');
        O.emit('data', { type: 'message', id: c.id });
      }

      /* ---------- live sending (api/messages.js) ---------- */
      function sendLive(c, text, files) {
        if (files.length) { U.toast('Photos, files and voice notes cannot go to guests from Orbique yet. Send them as an internal note, or from WhatsApp on your phone.', 'bad'); return; }
        if (!text) return;
        var r = routeOf(c);
        if (!r) { U.toast(noRouteWhy(c), 'bad'); return; }
        if (!r.open) { U.toast(r.why, 'bad'); return; }
        if (live.busy['send' + c.id]) return;
        var cfg = liveCfg();
        if (live.xl[c.id] && cfg && cfg.translate) { previewThenSend(c, r, text); return; }
        deliver(c, r, { text: text }, text);
      }
      function deliver(c, r, payload, typed) {
        live.busy['send' + c.id] = true;
        var btn = O.$('.round.go', chat); if (btn) btn.disabled = true;
        O.auth.inbox('send', Object.assign({ conversationId: c.id, via: r.via }, payload)).then(function (res) {
          applyConv(res.conversation);
          var ta = O.$('#ib-input', chat);
          if (ta && ta.value.trim() === typed) { ta.value = ''; autosize(ta); }
          if ((st.drafts[c.id] || '').trim() === typed) st.drafts[c.id] = '';
          delete st.unreadMark[c.id];
          if (st.sel === c.id) paintThread(true);
          paintRows();
        }, function (e) { U.toast(e.message || 'The message was not sent. Please try again.', 'bad'); }).then(function () {
          live.busy['send' + c.id] = false;
          var b2 = O.$('.round.go', chat); if (b2) b2.disabled = false;
          paintSendBtn();
        });
      }
      function previewThenSend(c, r, text) {
        var lang = guestLang(c);
        var body = O.html('<div class="stack ib-xl-prev"><div class="field"><label for="ib-xl-lang">Guest\'s language</label><select id="ib-xl-lang" class="select"><option value="">Choose a language</option>' +
          LANGS.filter(function (l) { return l[0] !== myLang(); }).map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === lang ? ' selected' : '') + '>' + esc(l[1]) + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="ib-xl-out">What the guest gets</label><textarea id="ib-xl-out" class="textarea" rows="5" placeholder="Choose the guest\'s language"></textarea></div>' +
          '<div class="field"><label>What you wrote</label><div class="orig">' + esc(text) + '</div></div>' +
          '<div class="note">Check door codes, times and prices before sending. You can edit the translation.</div></div>');
        var sel = O.$('#ib-xl-lang', body), out = O.$('#ib-xl-out', body), seq = 0;
        function run() {
          var to = sel.value, my = ++seq; out.value = '';
          if (!to) { out.placeholder = 'Choose the guest\'s language'; return; }
          out.placeholder = 'Translating…';
          O.auth.inbox('preview', { text: text, to: to }).then(function (res) { if (my === seq) { out.value = res.text; out.placeholder = ''; } }, function (e) { if (my === seq) out.placeholder = e.message || 'Translation failed. Try again.'; });
        }
        sel.addEventListener('change', run);
        U.modal({ title: 'Check the translation', sub: 'Sent by ' + r.label, body: body, autofocus: false, actions: [
          { label: 'Cancel' },
          { label: 'Send what I wrote', onClick: function () { deliver(c, r, { text: text }, text); } },
          { label: 'Send translation', kind: 'primary', onClick: function () {
            var t = out.value.trim(); if (!t) { U.toast('Wait for the translation, or choose the guest\'s language', 'bad'); return false; }
            deliver(c, r, { text: t, orig: text, origLang: myLang(), lang: sel.value }, text);
          } }
        ] });
        if (lang) run();
      }
      function translateMsg(key) {
        var p = key.split(':'), c = conv(p[0]); if (!c || live.busy['xl' + key]) return;
        live.busy['xl' + key] = true; paintThread(false);
        O.auth.inbox('translate', { conversationId: c.id, index: +p[1] }).then(function (res) {
          if (res.conversation) applyConv(res.conversation);
          if (res.same) U.toast('This message is already in ' + langName(myLang()));
        }, function (e) { U.toast(e.message || 'Translation failed. Please try again.', 'bad'); }).then(function () { delete live.busy['xl' + key]; paintThread(false); });
      }
      function openWaMedia(key) {
        var p = key.split(':'), c = conv(p[0]), m = c && c.messages[+p[1]]; if (!m) return;
        function show(f) {
          var from = m.from === 'guest' ? (bk(c) ? bk(c).guest.name : 'Guest') : 'Team', sub = 'From ' + from + ' · ' + fmt.dateTime(m.time);
          if (/^image\//.test(f.mime)) U.modal({ title: f.name || 'Photo', sub: sub, size: 'wide', body: '<div class="ib-lightbox"><img src="' + esc(f.url) + '" alt="Photo from the guest"></div>', actions: [{ label: 'Download', onClick: function () { O.download(f.name || 'photo.jpg', f.blob, f.mime); return false; } }, { label: 'Close', kind: 'primary' }] });
          else if (/^(audio|video)\//.test(f.mime)) U.modal({ title: m.type === 'voice' ? 'Voice message' : f.name || 'Video', sub: sub, body: '<' + (/^audio/.test(f.mime) ? 'audio' : 'video') + ' controls autoplay style="width:100%" src="' + esc(f.url) + '"></' + (/^audio/.test(f.mime) ? 'audio' : 'video') + '>', actions: [{ label: 'Download', onClick: function () { O.download(f.name || 'voice.ogg', f.blob, f.mime); return false; } }, { label: 'Close', kind: 'primary' }] });
          else O.download(f.name || 'file', f.blob, f.mime);
        }
        if (live.media[key]) { show(live.media[key]); return; }
        if (live.busy['m' + key]) return;
        live.busy['m' + key] = true; paintThread(false);
        O.auth.inbox('media', { conversationId: c.id, index: +p[1] }).then(function (res) {
          var bin = atob(res.data), bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          var blob = new Blob([bytes], { type: res.mime }), f = { blob: blob, mime: res.mime, name: res.name || m.name || null, url: URL.createObjectURL(blob) };
          live.media[key] = f; show(f);
        }, function (e) { U.toast(e.message || 'The file could not be opened.', 'bad'); }).then(function () { delete live.busy['m' + key]; paintThread(false); });
      }
      /* chats that match no booking: link each to the right stay */
      function looseModal() {
        var list = loose(); if (!list.length) return;
        var today = D.TODAY, pool = D.bookings.filter(function (b) { return b.guest && b.status !== 'cancelled' && b.checkOut >= d.add(today, -30); });
        function score(c, b) { var n = String((c.contact && c.contact.name) || '').toLowerCase(), g = String(b.guest.name || '').toLowerCase(); return n && g && (g.indexOf(n.split(' ')[0]) >= 0 || n.indexOf(g.split(' ')[0]) >= 0) ? 0 : 1; }
        var body = O.html('<div class="ib-loose-list">' + list.map(function (c) {
          var name = (c.contact && c.contact.name) || 'Unknown guest', vias = c.messages.map(function (m) { return m.via; }).filter(Boolean), via = VIA[vias[vias.length - 1]] || 'WhatsApp';
          var phone = c.contact && c.contact.phone && canContacts() ? ' · ' + c.contact.phone : '';
          var opts = pool.slice().sort(function (a, b) { return score(c, a) - score(c, b) || (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0); });
          var msgs = c.messages.filter(function (m) { return m.from === 'guest' || m.from === 'system'; }).slice(-3).map(function (m) { return (m.tr && m.tr.text) || m.text || ''; }).join('\n');
          return '<div class="lc" data-lc="' + c.id + '"><div class="lh">' + U.avatar(name) + '<span>' + esc(name) + '<br><small>' + esc(via + phone) + '</small></span></div>' +
            '<div class="lm">' + esc(msgs) + '</div>' +
            (canEdit() ? '<div class="lr"><select class="select" aria-label="Booking for ' + esc(name) + '"><option value="">Choose the booking</option>' + opts.map(function (b) { return '<option value="' + b.id + '">' + esc(b.guest.name) + ' · ' + esc(b.propertyId ? prop(b.propertyId).short : 'No unit yet') + ' · ' + esc(d.fmtRange(b.checkIn, b.checkOut)) + '</option>'; }).join('') + '</select><button type="button" class="btn btn-primary btn-sm" data-link="' + c.id + '">Link</button></div>' : '<div class="small muted">Someone with edit access to the inbox can link this chat.</div>') + '</div>';
        }).join('') + '</div>');
        var mod = U.modal({ title: 'Chats to link', sub: 'These came from numbers or booking-site threads that match no booking. Link each to the guest\'s stay so replies and the stay details sit together.', size: 'wide', body: body, autofocus: false, actions: [{ label: 'Close', kind: 'primary' }] });
        body.addEventListener('click', function (e) {
          var x = e.target.closest('[data-link]'); if (!x) return;
          var sel = O.$('select', x.closest('.lc')), bid = sel && sel.value;
          if (!bid) { U.toast('Choose the booking first', 'bad'); return; }
          var id = linkLoose(x.dataset.link, bid);
          x.closest('.lc').remove();
          if (!O.$('.lc', body)) mod.close();
          if (id) select(id);
        });
      }
      function linkLoose(cid, bid) {
        var i = -1; for (var k = 0; k < D.conversations.length; k++) if (D.conversations[k].id === cid) i = k;
        if (i < 0) return null;
        var c = D.conversations[i], t = D.conversations.filter(function (x) { return x.bookingId === bid && x !== c; })[0];
        if (!t) { c.bookingId = bid; delete c.contact; O.emit('data', { type: 'inbox-link', id: c.id }); return c.id; }
        t.messages = t.messages.concat(c.messages).map(function (m, j) { return [m, j]; })
          .sort(function (a, b) { return a[0].time < b[0].time ? -1 : a[0].time > b[0].time ? 1 : a[1] - b[1]; }).map(function (x) { return x[0]; });
        t.unread = (t.unread || 0) + (c.unread || 0);
        ['wa', 'waLastIn', 'cx', 'cxBooking', 'ota', 'lang'].forEach(function (key) { if (c[key] && !t[key]) t[key] = c[key]; });
        D.conversations.splice(i, 1);
        O.emit('data', { type: 'inbox-link', id: t.id });
        return t.id;
      }
      function sitesHTML() {
        var cfg = liveCfg() || {}, s0 = cfg.sites, owner = O.auth.role && O.auth.role() === 'owner';
        var on = s0 && s0.on, errs = s0 ? s0.buildings.filter(function (x) { return x.error; }) : [];
        return '<div class="small">' + (on ? 'On: guest messages, inquiries and reviews from Booking.com, Airbnb and Expedia come into this inbox and the Reviews page, and replies go back to the site.' + (s0.at ? ' Switched on ' + esc(fmt.dateTime(String(s0.at).slice(0, 16))) + '.' : '')
          : 'Bring guest messages, inquiries and reviews from Booking.com, Airbnb and Expedia into Orbique, and answer them here. This switches on Channex\'s Messaging & Reviews app for your connected buildings (Channex bills it to your Channex account: about USD 0.50 per unit a month).') + ' Agoda and Trip.com do not offer messages through the channel manager; their emails can come in through your booking email below.</div>' +
          (errs.length ? '<div class="note">' + errs.map(function (x) { return esc(x.error); }).join('<br>') + '</div>' : '') +
          (owner ? '<div><button type="button" class="btn ' + (on ? 'btn-ghost' : 'btn-primary') + ' btn-sm" data-sites="on">' + (on ? 'Check again and fetch reviews' : 'Switch on messages and reviews') + '</button></div>' : on ? '' : '<div class="note">Ask the account owner to switch this on.</div>');
      }
      function emailHTML() {
        var cfg = liveCfg() || {}, em = cfg.email || {};
        if (!em.address) return '<div class="note">Email is not set up on the server yet. Orbique needs receiving switched on for its email domain in Resend (see Putting Orbique online, Booking email).</div>';
        return '<div class="small">Every email sent to this address comes into the inbox: guests\' emails as chats you can answer, and the booking sites\' emails (new bookings, changes, payouts, reviews) as updates on the stay, or under Email &amp; updates.</div>' +
          '<div class="row-flex"><code class="grow" style="user-select:all;word-break:break-all">' + esc(em.address) + '</code><button type="button" class="btn btn-ghost btn-sm" data-copy="' + esc(em.address) + '">Copy</button></div>' +
          '<div class="small"><b>How to set it up:</b> use one email for all your bookings, for example bookings@yourcompany.com. Give it to Booking.com, Airbnb, Agoda, Trip.com and Expedia as the reservation email. Then, in that mailbox, forward every email to the address above (Gmail: Settings, Forwarding and POP/IMAP, Add a forwarding address; the confirmation email Gmail sends shows up under Email &amp; updates, so you can confirm it from here).</div>' +
          (em.configured ? '' : '<div class="note">Receiving is not finished on the server yet (RESEND_WEBHOOK_SECRET), so emails do not arrive yet.</div>');
      }
      function waNumberHTML(n, owner, signup) {
        var sy = n.sync || {}, bits = [];
        if (n.coexist) bits.push('Also on the WhatsApp Business app on your phone. Messages you send from the phone show here as "From the WhatsApp app".');
        if (n.coexist && sy.history) bits.push(sy.history.ok ? 'The chats of the last 6 months were asked for on ' + esc(d.fmt(String(sy.history.at).slice(0, 10))) + ' and come in over the next hours (if you agreed to share them on the phone).' : 'WhatsApp did not share the older chats. New messages still come in.');
        return '<div class="row-flex"><span class="grow">Connected: <b>' + esc(n.phone || '') + '</b>' + (n.name ? ' (' + esc(n.name) + ')' : '') + '</span>' + (owner ? '<button type="button" class="btn btn-ghost btn-sm" data-wa="off">Disconnect</button>' : '') + '</div>' +
          (sy.disconnected ? '<div class="note">The number was disconnected from Orbique on the phone, so messages no longer come in. Connect it again to carry on.</div>' + (owner && signup ? '<div><button type="button" class="btn btn-primary btn-sm" data-wa="fb">Connect with Facebook again</button></div>' : '') : '') +
          (bits.length ? '<div class="small muted">' + bits.join(' ') + '</div>' : '') +
          (n.coexist && owner ? '<div class="small muted">To stop it fully, also disconnect it on the phone: WhatsApp Business app, Settings, Account, Business Platform.</div>' : '');
      }
      /* Meta's Embedded Signup pop-up for a number on the WhatsApp Business app (coexistence). Meta sends the chosen
         account (and sometimes the number) in a window message, and a one-time code (valid about 30 seconds) in the
         login callback; both go to the server at once. */
      function fbSdk(s) { /* loads once per page; the state lives on window because this code runs again on every render */
        var st = window.__orbiqueFb || (window.__orbiqueFb = {});
        if (st.ready && window.FB) return Promise.resolve(window.FB);
        if (st.p) return st.p;
        st.p = new Promise(function (resolve, reject) {
          function ready() {
            if (!window.FB) { st.p = null; reject(new Error('Facebook did not load.')); return; }
            if (!st.ready) window.FB.init({ appId: s.appId, autoLogAppEvents: true, xfbml: false, version: s.version });
            st.ready = true; resolve(window.FB);
          }
          if (window.FB) { ready(); return; }
          var t = setTimeout(function () { st.p = null; reject(new Error('Facebook did not load. Check your connection and try again.')); }, 20000);
          window.fbAsyncInit = function () { clearTimeout(t); ready(); };
          var el = document.createElement('script');
          el.src = 'https://connect.facebook.net/en_US/sdk.js'; el.async = true; el.defer = true; el.crossOrigin = 'anonymous';
          el.onerror = function () { clearTimeout(t); st.p = null; reject(new Error('Could not load Facebook. Check that nothing blocks connect.facebook.net and try again.')); };
          document.body.appendChild(el);
        });
        return st.p;
      }
      function fbReady() { var st = window.__orbiqueFb; return st && st.ready && window.FB ? window.FB : null; }
      /* FB.login runs straight from the click (FB must be loaded already: settingsModal loads it), so the pop-up is not blocked */
      function fbSignup(s, FB) {
        return (function () {
          return new Promise(function (resolve, reject) {
            var code = '', got = null, done = false, waitT = null;
            function finish(err) {
              if (done) return;
              if (!err && !(code && got)) return;
              done = true; clearTimeout(waitT); window.removeEventListener('message', onMsg);
              if (err) reject(err); else resolve({ code: code, wabaId: got.waba_id || '', phoneNumberId: got.phone_number_id || '' });
            }
            function onMsg(e) {
              var host = ''; try { host = new URL(e.origin).hostname; } catch (x) { return; }
              if (!/(^|\.)facebook\.com$/.test(host)) return;
              var d = e.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (x) { return; } }
              if (!d || d.type !== 'WA_EMBEDDED_SIGNUP') return;
              var ev = String(d.event || ''), data = d.data || {};
              if (ev.indexOf('FINISH') === 0) { got = { waba_id: String(data.waba_id || ''), phone_number_id: String(data.phone_number_id || '') }; finish(); }
              else if (data.error_message) finish(new Error(String(data.error_message)));
              else if (ev === 'CANCEL') finish(new Error(data.current_step ? 'The Facebook window was closed at the step "' + data.current_step + '". Nothing was connected.' : 'The Facebook window was closed. Nothing was connected.'));
              else if (ev === 'ERROR') finish(new Error('Facebook reported an error. Nothing was connected.'));
            }
            window.addEventListener('message', onMsg);
            FB.login(function (r) {
              code = r && r.authResponse && r.authResponse.code ? String(r.authResponse.code) : '';
              if (!code) { waitT = setTimeout(function () { finish(new Error('Facebook did not finish the sign-in. Nothing was connected.')); }, 3000); return; }
              // the account message can come a moment after the code; without it the server finds the account itself
              if (!got) waitT = setTimeout(function () { got = got || {}; finish(); }, 2500);
              finish();
            }, { config_id: s.configId, response_type: 'code', override_default_response_type: true, extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' } });
          });
        })();
      }
      function settingsModal() {
        var cfg = liveCfg() || { whatsapp: {} }, owner = O.auth.role && O.auth.role() === 'owner', wa = cfg.whatsapp || {};
        var setv = D.inboxSettings || {}, lang = setv.lang || cfg.lang || 'en', auto = setv.autoTranslate !== false;
        var byId = '<div class="field"><label for="ib-pnid">Phone number ID from Meta</label><input id="ib-pnid" class="input" inputmode="numeric" placeholder="For example 109876543210987"><div class="small muted">Meta for Developers, your app, WhatsApp, API Setup: the "Phone number ID" under your business number.</div></div><button type="button" class="btn ' + (wa.signup ? 'btn-ghost' : 'btn-primary') + ' btn-sm" data-wa="on">Connect by Phone number ID</button>';
        var waHTML = !wa.configured ? '<div class="note">WhatsApp is not set up on the server yet. Orbique needs WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN in Vercel, with WHATSAPP_APP_ID and WHATSAPP_CONFIG_ID to connect with Facebook (see Putting Orbique online, WhatsApp).</div>'
          : wa.number ? waNumberHTML(wa.number, owner, !!wa.signup)
          : !owner ? '<div class="note">Ask the account owner to connect your WhatsApp business number.</div>'
          : (wa.signup ? '<div class="small">Connect the number you use on the <b>WhatsApp Business app</b>. It keeps working on your phone: messages you send from the phone show here too, and the chats of the last 6 months come in once.</div>' +
              '<div><button type="button" class="btn btn-primary btn-sm" data-wa="fb">' + O.icon('whatsapp') + 'Connect with Facebook</button></div>' +
              '<div class="small muted">A Facebook window opens. Choose your business, then "Connect your existing WhatsApp Business app", enter the number and confirm on your phone with the QR code the window shows (WhatsApp Business app 2.24.17 or newer). Use a computer browser for this step.</div>' +
              (wa.manual ? '<details><summary class="small">Or connect a number that is only on the Cloud API</summary><div class="stack" style="margin-top:8px">' + byId + '</div></details>' : '')
            : byId);
        var trHTML = cfg.translate ? '<div class="field"><label for="ib-lang">Show guest messages in</label><select id="ib-lang" class="select"' + (canEdit() ? '' : ' disabled') + '>' + LANGS.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === lang ? ' selected' : '') + '>' + esc(l[1]) + '</option>'; }).join('') + '</select></div>' +
            '<label class="row-flex"><input type="checkbox" id="ib-auto"' + (auto ? ' checked' : '') + (canEdit() ? '' : ' disabled') + '> <span>Translate new guest messages as they arrive</span></label>'
          : '<div class="note">Translation is not set up on the server yet (ANTHROPIC_API_KEY in Vercel).</div>';
        var body = O.html('<div class="stack"><div class="section-title" style="margin-top:0">WhatsApp</div>' + waHTML +
          '<div class="section-title">Translation</div>' + trHTML +
          (cfg.channex ? '<div class="section-title">Booking sites</div>' + sitesHTML() : '') +
          '<div class="section-title">Booking email</div>' + emailHTML() + '</div>');
        var mod = U.modal({ title: 'Inbox settings', body: body, autofocus: false, actions: [{ label: 'Done', kind: 'primary' }] });
        function reload() { live.cfg = null; live.org = null; loadLive(function () { repaintLive(); }); }
        if (owner && wa.signup && O.$('[data-wa="fb"]', body)) fbSdk(wa.signup).catch(function () {}); /* ready before the click */
        body.addEventListener('click', function (e) {
          var cp = e.target.closest('[data-copy]');
          if (cp) { var val = cp.dataset.copy; (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(val) : Promise.reject()).then(function () { U.toast('Address copied'); }, function () { U.toast('Select the address and copy it', 'bad'); }); return; }
          var sx = e.target.closest('[data-sites]');
          if (sx) {
            sx.disabled = true; sx.textContent = 'Switching on and fetching reviews…';
            O.auth.inbox('sites-on').then(function (r) {
              var n = r.buildings.reduce(function (a, x) { return { rv: a.rv + (x.reviews || 0), ms: a.ms + (x.messages || 0) }; }, { rv: 0, ms: 0 });
              var bad = r.buildings.filter(function (x) { return x.error; });
              U.toast(bad.length ? bad[0].error : 'Messages and reviews are on. ' + fmt.plural(n.rv, 'review') + ' and ' + fmt.plural(n.ms, 'earlier message') + ' came in.', bad.length ? 'bad' : 'ok');
              mod.close(); reload();
            }, function (er) { sx.disabled = false; sx.textContent = 'Switch on messages and reviews'; U.toast(er.message, 'bad'); });
            return;
          }
          var x = e.target.closest('[data-wa]'); if (!x) return;
          x.disabled = true;
          if (x.dataset.wa === 'fb') {
            var label = x.innerHTML, FB = fbReady();
            if (!FB) { x.disabled = false; U.toast('Facebook is still loading. Try again in a moment.', 'bad'); fbSdk(wa.signup).catch(function (er) { U.toast(er.message, 'bad'); }); return; }
            x.textContent = 'Waiting for Facebook…';
            fbSignup(wa.signup, FB).then(function (r) {
              x.textContent = 'Connecting…';
              return O.auth.inbox('whatsapp-signup', r);
            }).then(function (r) {
              var hist = r.number && r.number.coexist && r.sync && r.sync.history && !r.sync.history.error;
              U.toast('WhatsApp connected: ' + ((r.number && r.number.phone) || '') + (hist ? '. Your earlier chats come in over the next hours.' : r.number && r.number.coexist ? '. WhatsApp did not share the earlier chats; new messages come in.' : ''));
              mod.close(); reload();
            }, function (er) { x.disabled = false; x.innerHTML = label; U.toast(er.message, 'bad'); });
            return;
          }
          var call = x.dataset.wa === 'on' ? O.auth.inbox('whatsapp-connect', { phoneNumberId: (O.$('#ib-pnid', body).value || '').trim() }) : O.auth.inbox('whatsapp-disconnect');
          call.then(function (r) { U.toast(r.number ? 'WhatsApp connected: ' + (r.number.phone || '') : 'WhatsApp disconnected'); mod.close(); reload(); }, function (er) { x.disabled = false; U.toast(er.message, 'bad'); });
        });
        body.addEventListener('change', function (e) {
          if (!canEdit() || (e.target.id !== 'ib-lang' && e.target.id !== 'ib-auto')) return;
          D.inboxSettings = { lang: O.$('#ib-lang', body).value, autoTranslate: O.$('#ib-auto', body).checked };
          if (live.cfg) { live.cfg.lang = D.inboxSettings.lang; live.cfg.autoTranslate = D.inboxSettings.autoTranslate; }
          O.emit('data', { type: 'inbox-settings' });
        });
      }
      function repaintLive() {
        if (!document.body.contains(page)) return;
        var f = O.$('.ib-lfoot', listEl); if (f) f.innerHTML = footHTML();
        var lw = O.$('.ib-loose-wrap', listEl); if (lw) lw.innerHTML = looseHTML();
        if (conv(st.sel)) { rebuildComposer(); paintThread(false); }
      }

      /* ---------- attachments ---------- */
      function addFiles(kind, fileList) {
        var c = conv(st.sel); if (!c || !fileList || !fileList.length) return;
        var list = st.pending[c.id] = st.pending[c.id] || [];
        Array.prototype.slice.call(fileList).forEach(function (f) {
          if (f.size > 25 * 1048576) { U.toast(f.name + ' is larger than 25 MB, the WhatsApp limit', 'bad'); return; }
          var isImg = /^image\//.test(f.type), isAudio = kind === 'audio' || (/^audio\//.test(f.type) && kind !== 'doc');
          var a = { kind: isAudio ? 'audio' : isImg && kind !== 'doc' ? 'image' : 'file', name: f.name, size: f.size, mime: f.type, url: URL.createObjectURL(f) };
          if (a.kind === 'audio') {
            var au = new Audio(); au.preload = 'metadata';
            au.onloadedmetadata = function () { if (isFinite(au.duration)) a.duration = au.duration; };
            au.src = a.url;
          }
          list.push(a);
        });
        paintTray();
        var ta = O.$('#ib-input', chat); if (ta) { ta.placeholder = 'Add a caption (optional)'; ta.focus(); }
      }

      /* ---------- voice notes ---------- */
      function micProblem(reason) {
        U.modal({
          title: 'Microphone not available', autofocus: false,
          body: '<div class="stack"><div class="note warn">' + esc(reason) + '</div><div>You can still send a voice note: choose an audio file, for example a recording made with your phone\'s voice recorder. It is sent as a voice message the guest can play.</div></div>',
          actions: [{ label: 'Cancel' }, { label: 'Choose audio file', kind: 'primary', onClick: function () { var inp = O.$('input[data-in=audio]', chat); if (inp) inp.click(); } }]
        });
      }
      function startRecording() {
        var c = conv(st.sel); if (!c) return;
        if (st.mode === 'note' ? !canNote() : !canSend()) { U.toast(NO_SEND, 'bad'); return; }
        var md = navigator.mediaDevices;
        if (!md || !md.getUserMedia || !window.MediaRecorder) { micProblem('This browser cannot record audio on this page' + (window.isSecureContext === false ? ' because the page is not served securely (https)' : '') + '.'); return; }
        var btn = O.$('[data-act=record]', chat); if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
        md.getUserMedia({ audio: true }).then(function (stream) {
          if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
          if (st.sel !== c.id || !document.body.contains(chat)) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
          var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
          var mime = types.filter(function (t) { return window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(t); })[0];
          var mr;
          try { mr = mime ? new window.MediaRecorder(stream, { mimeType: mime }) : new window.MediaRecorder(stream); }
          catch (e) { stream.getTracks().forEach(function (t) { t.stop(); }); micProblem('This browser cannot record audio here (' + e.message + ').'); return; }
          var r = st.rec = { convId: c.id, stream: stream, mr: mr, chunks: [], levels: [], elapsed: 0, last: performance.now(), paused: false, mode: st.mode };
          try { var AC = window.AudioContext || window.webkitAudioContext; r.ac = new AC(); var src = r.ac.createMediaStreamSource(stream); r.an = r.ac.createAnalyser(); r.an.fftSize = 512; src.connect(r.an); r.buf = new Uint8Array(r.an.fftSize); } catch (e) { r.an = null; }
          mr.ondataavailable = function (e) { if (e.data && e.data.size) r.chunks.push(e.data); };
          mr.start(250);
          rebuildComposer();
          r.timer = setInterval(function () { tickRecording(); }, 100);
        }).catch(function (err) {
          if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
          var n = err && err.name;
          micProblem(n === 'NotAllowedError' || n === 'PermissionDeniedError' ? 'Microphone access was blocked here. In the live app the browser asks once for permission; in this preview, recording is not allowed.'
            : n === 'NotFoundError' || n === 'DevicesNotFoundError' ? 'No microphone was found on this device.'
              : n === 'NotReadableError' ? 'The microphone is being used by another app.'
                : n === 'SecurityError' ? 'This page is not allowed to use the microphone.'
                  : 'The microphone could not be started' + (err && err.message ? ' (' + err.message + ')' : '') + '.');
        });
      }
      function tickRecording() {
        var r = st.rec; if (!r) return;
        var recEl = O.$('.rec', chat);
        if (!recEl || !document.body.contains(recEl)) { cancelRecording(true); return; }
        var now = performance.now();
        if (!r.paused) r.elapsed += (now - r.last) / 1000;
        r.last = now;
        var lvl = 0.08;
        if (r.an && !r.paused) { r.an.getByteTimeDomainData(r.buf); var sum = 0; for (var i = 0; i < r.buf.length; i++) { var v = (r.buf[i] - 128) / 128; sum += v * v; } lvl = Math.min(1, Math.sqrt(sum / r.buf.length) * 4.5); }
        if (!r.paused) r.levels.push(lvl);
        O.$('.ib-rtm', recEl).textContent = durText(r.elapsed);
        var lv = O.$('.lv', recEl), show = r.levels.slice(-60);
        lv.innerHTML = show.map(function (x) { return '<i style="height:' + Math.round(10 + x * 90) + '%"></i>'; }).join('');
        if (r.elapsed >= 300) { U.toast('Voice notes are limited to 5 minutes, so this one was sent'); finishRecording(true); }
      }
      function releaseRec(r) {
        clearInterval(r.timer);
        try { r.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        try { if (r.ac) r.ac.close(); } catch (e) {}
      }
      function finishRecording(sendIt) {
        var r = st.rec; if (!r) return;
        st.rec = null;
        var c = conv(r.convId);
        r.mr.onstop = function () {
          releaseRec(r);
          if (!sendIt || !c) return;
          if (r.elapsed < 1) { U.toast('Voice note too short. Hold on for at least a second.', 'bad'); return; }
          var blob = new Blob(r.chunks, { type: r.mr.mimeType || 'audio/webm' });
          var url = URL.createObjectURL(blob), n = 32, lv = r.levels, wave = [];
          for (var i = 0; i < n; i++) { var seg = lv.slice(Math.floor(i * lv.length / n), Math.floor((i + 1) * lv.length / n)); var mx = seg.length ? Math.max.apply(null, seg) : 0.1; wave.push(Math.max(0.12, Math.min(1, mx * 1.3))); }
          var from = r.mode === 'note' ? 'note' : 'staff';
          push(c, { from: from, staffId: O.state.viewer, type: 'voice', text: 'Voice message', url: url, duration: r.elapsed, size: sizeText(blob.size), wave: wave, time: nowISO(), status: from === 'staff' ? 'sent' : undefined });
          if (st.sel === c.id) paintThread(true);
          paintRows();
          U.toast(from === 'note' ? 'Voice note added for your team' : 'Voice note (' + durText(r.elapsed) + ') sent to ' + bk(c).guest.name);
          O.emit('data', { type: 'message', id: c.id });
        };
        try { if (r.mr.state !== 'inactive') r.mr.stop(); else r.mr.onstop(); } catch (e) { r.mr.onstop(); }
        if (st.sel === r.convId && document.body.contains(chat)) rebuildComposer();
      }
      function togglePause() {
        var r = st.rec; if (!r) return;
        try { if (r.paused) { r.mr.resume(); r.paused = false; } else { r.mr.pause(); r.paused = true; } } catch (e) { return; }
        r.last = performance.now();
        var bar = O.$('.cmp-bar', chat); if (bar) { bar.innerHTML = recHTML(); tickRecording(); }
      }
      cancelRecording = function (silent, msg) {
        var r = st.rec; if (!r) return;
        st.rec = null;
        r.mr.onstop = function () { releaseRec(r); };
        try { if (r.mr.state !== 'inactive') r.mr.stop(); else releaseRec(r); } catch (e) { releaseRec(r); }
        if (!silent) U.toast(msg || 'Recording deleted');
        if (document.body.contains(chat)) rebuildComposer();
      };

      /* ---------- slash quick replies ---------- */
      function slashMatches(c, q) {
        q = q.toLowerCase();
        return repliesFor(bk(c).propertyId).filter(function (r) { return !q || r.title.toLowerCase().indexOf(q) >= 0 || r.text.toLowerCase().indexOf(q) >= 0; }).slice(0, 6);
      }
      function paintSlash() {
        var c = conv(st.sel), ta = O.$('#ib-input', chat), comp = O.$('.ib-compose', chat); if (!c || !ta || !comp || isUpd(c)) return;
        var old = O.$('.slash', comp); if (old) old.remove();
        var m = canSend() ? /^\/(\S*)$/.exec(ta.value) : null; /* quick replies are guest messages */
        if (!m) { st.slash = null; return; }
        var list = slashMatches(c, m[1]); st.slash = list;
        if (st.qrSel >= list.length) st.qrSel = 0;
        var b = bk(c);
        comp.insertAdjacentHTML('afterbegin', '<div class="slash" role="listbox" aria-label="Quick replies"><div class="sh">Quick replies' + (m[1] ? ' matching "' + esc(m[1]) + '"' : '') + '</div>' +
          (list.length ? list.map(function (q, i) { return '<button type="button" role="option" class="' + (i === st.qrSel ? 'on' : '') + '" data-qr="' + q.id + '"><b>' + esc(q.title) + '</b><span>' + esc(fill(q.text, b)) + '</span></button>'; }).join('') : '<div class="sh" style="text-transform:none;font-weight:600;padding-bottom:10px">No quick reply matches. Press Esc to keep typing.</div>') + '</div>');
      }
      function useQuickReply(id) {
        var c = conv(st.sel), q = D.quickReplies.filter(function (k) { return k.id === id; })[0], ta = O.$('#ib-input', chat); if (!c || !q || !ta) return;
        var b = bk(c), text = fill(q.text, b);
        var cur = ta.value.replace(/^\/\S*$/, '');
        ta.value = cur.trim() ? cur.replace(/\s*$/, '') + '\n' + text : text;
        st.drafts[c.id] = ta.value; st.slash = null; var sl = O.$('.slash', chat); if (sl) sl.remove();
        autosize(ta); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); paintSendBtn();
        if (/\{door_code\}/.test(q.text) && !canCodes()) U.toast('Door codes are not part of your access, so the code was left out', 'bad');
        else if (/\{door_code\}/.test(q.text) && (!b.idVerified || b.codeStatus === 'held')) U.toast(b.guest.name + ' has not verified their ID yet, so the door code was left out', 'bad');
      }

      /* ---------- new conversation ---------- */
      function newChat() {
        if (!canSend()) { U.toast(NO_SEND, 'bad'); return; }
        var have = {}; D.conversations.forEach(function (c) { have[c.bookingId] = 1; });
        var opts = D.bookings.filter(function (b) { return !have[b.id] && b.guest && (!st.prop || b.propertyId === st.prop) && b.status !== 'cancelled' && b.status !== 'checked_out' && b.checkOut >= D.TODAY && b.checkIn <= d.add(D.TODAY, 21); }).sort(function (a, b) { return a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0; });
        if (!opts.length) {
          var at = st.prop ? ' at ' + prop(st.prop).short : '';
          var any = D.bookings.some(function (b) { return b.guest && (!st.prop || b.propertyId === st.prop) && b.status !== 'cancelled' && b.status !== 'checked_out' && b.checkOut >= D.TODAY && b.checkIn <= d.add(D.TODAY, 21); });
          U.toast(any ? 'Every current and upcoming guest' + at + ' already has a chat' : 'No current or upcoming bookings' + at + ' to start a chat for');
          return;
        }
        U.modal({
          title: 'New conversation', sub: 'Message a guest who is staying now or arriving in the next three weeks',
          body: '<div class="stack"><div class="field"><label for="ib-nb">Guest and stay</label><select id="ib-nb" class="select">' + opts.map(function (b) { return '<option value="' + b.id + '">' + esc(b.guest.name) + ' · ' + esc(prop(b.propertyId).short) + ' · ' + esc(d.fmtRange(b.checkIn, b.checkOut)) + ' · ' + esc(stayPhrase(b)) + '</option>'; }).join('') + '</select></div><div class="note">The chat opens on WhatsApp with the guest\'s number from the booking.</div></div>',
          actions: [{ label: 'Cancel' }, { label: 'Start chat', kind: 'primary', onClick: function (close, el) {
            var id = O.$('#ib-nb', el).value;
            var c = { id: O.uid('C'), bookingId: id, unread: 0, messages: [], createdAt: nowISO(), assigneeId: O.state.viewer };
            D.conversations.push(c); st.filter = 'all'; st.q = ''; var qi = O.$('[data-f=q]', listEl); if (qi) qi.value = '';
            select(c.id);
          } }]
        });
      }

      /* ---------- events ---------- */
      /* an answer link opens the booking site's page, which records the answer; the chat notes which one was picked
         (data-pickact: the message's index, then the answer's index in m.actions) */
      function pickAct(x, c) {
        var pq = x.dataset.pickact.split(':'), pm = c && c.messages[+pq[0]], pa = pm && Array.isArray(pm.actions) && pm.actions[+pq[1]];
        if (!pm || !pm.xid || !actOk(pa) || !canSend()) return;
        c.picks = c.picks || {};
        c.picks[pm.xid] = { label: pa.label, at: nowISO(), staffId: O.state.viewer };
        O.emit('data', { type: 'inbox-pick', id: c.id });
        setTimeout(function () { paintThread(false); }, 0);
      }
      /* a middle click opens the link in a new tab too */
      page.addEventListener('auxclick', function (e) { var x = e.button === 1 && e.target.closest && e.target.closest('[data-pickact]'); if (x) pickAct(x, conv(st.sel)); });
      page.addEventListener('click', function (e) {
        var x, c = conv(st.sel);
        var menu = O.$('.ib-menu.open', page); if (menu && !e.target.closest('.ib-more')) menu.classList.remove('open');
        var am = O.$('.att-menu.open', page); if (am && !e.target.closest('.att-menu') && !e.target.closest('[data-act=attach]')) am.classList.remove('open');
        if ((x = e.target.closest('[data-go]'))) { O.go(x.dataset.go); return; }
        if ((x = e.target.closest('[data-conv]'))) { select(x.dataset.conv); return; }
        if ((x = e.target.closest('[data-filter]'))) { st.filter = x.dataset.filter; paintFilters(); paintRows(); return; }
        if ((x = e.target.closest('[data-tab]'))) {
          if (st.tab === x.dataset.tab) return;
          st.tab = x.dataset.tab; st.q = ''; listEl.innerHTML = listHTML();
          if (!isPhone()) { var f0 = (st.tab === 'updates' ? visibleUpds() : visibleConvs())[0]; if (f0) select(f0.id, false); else { st.sel = null; paintChat(true); } }
          return;
        }
        if ((x = e.target.closest('[data-pickact]'))) { pickAct(x, c); return; }
        if ((x = e.target.closest('[data-golink]'))) { var gm = c && c.messages[+x.dataset.golink]; if (gm && gm.link && O.allowed(gm.link.page)) O.go(gm.link.page, gm.link.id ? { id: gm.link.id } : {}); return; }
        if ((x = e.target.closest('[data-qr]'))) { useQuickReply(x.dataset.qr); return; }
        if ((x = e.target.closest('[data-play]'))) { togglePlay(x.dataset.play); return; }
        if ((x = e.target.closest('[data-xl]'))) { translateMsg(x.dataset.xl); return; }
        if ((x = e.target.closest('[data-orig]'))) { live.origOpen[x.dataset.orig] = !live.origOpen[x.dataset.orig]; paintThread(false); return; }
        if ((x = e.target.closest('[data-wamedia]'))) { openWaMedia(x.dataset.wamedia); return; }
        if ((x = e.target.closest('[data-trans]'))) { var k = 'tr' + x.dataset.trans; st[k] = !st[k]; paintThread(false); return; }
        if ((x = e.target.closest('[data-rm]'))) { var pl = st.pending[st.sel] || []; var a = pl.splice(+x.dataset.rm, 1)[0]; if (a) try { URL.revokeObjectURL(a.url); } catch (er) {} paintTray(); return; }
        if ((x = e.target.closest('[data-pick]'))) { O.$('.att-menu', chat).classList.remove('open'); var inp = O.$('input[data-in=' + x.dataset.pick + ']', chat); if (inp) inp.click(); return; }
        if ((x = e.target.closest('[data-mode]'))) { st.mode = x.dataset.mode; var ta0 = O.$('#ib-input', chat); if (ta0) st.drafts[st.sel] = ta0.value; rebuildComposer(); var ta1 = O.$('#ib-input', chat); if (ta1) ta1.focus(); return; }
        if ((x = e.target.closest('[data-img]'))) {
          var p = x.dataset.img.split(':'), cc = conv(p[0]), m = cc && cc.messages[+p[1]]; if (!m) return;
          var from = m.from === 'guest' ? bk(cc).guest.name : (staff(m.staffId) || { name: 'Team' }).name;
          U.modal({ title: m.name || m.caption || (m.text && /^photo:/i.test(m.text) ? m.text : 'Photo'), sub: 'From ' + from + ' · ' + fmt.dateTime(m.time), size: 'wide', body: '<div class="ib-lightbox">' + (m.url ? '<img src="' + esc(m.url) + '" alt="' + esc(m.name || 'Photo') + '">' : sinkArt()) + '</div>' + (m.caption ? '<p>' + esc(m.caption) + '</p>' : ''),
            actions: m.url ? [{ label: 'Download', onClick: function () { fetch(m.url).then(function (r) { return r.blob(); }).then(function (bl) { O.download(m.name || 'photo.jpg', bl, m.mime); }); return false; } }, { label: 'Close', kind: 'primary' }] : [{ label: 'Close', kind: 'primary' }] });
          return;
        }
        if ((x = e.target.closest('[data-dl]'))) { var q2 = x.dataset.dl.split(':'), c2 = conv(q2[0]), m2 = c2 && c2.messages[+q2[1]]; if (m2 && m2.url) fetch(m2.url).then(function (r) { return r.blob(); }).then(function (bl) { O.download(m2.name || 'file', bl, m2.mime); }, function () { if (/^https:/.test(m2.url)) window.open(m2.url, '_blank', 'noopener'); }); return; }
        if (!(x = e.target.closest('[data-act]'))) return;
        var act = x.dataset.act;
        if (act === 'newchat') newChat();
        if (act === 'livesettings') { settingsModal(); return; }
        if (act === 'loose') { looseModal(); return; }
        if (act === 'allprops') { setProp(''); return; }
        if (act === 'clearq') { st.q = ''; var qx = O.$('[data-f=q]', listEl); if (qx) qx.value = ''; paintRows(); return; }
        if (act === 'manage') { var mm = O.$('.ib-menu.open', page); if (mm) mm.classList.remove('open'); manageQuickReplies(c && bk(c) ? bk(c).propertyId : null, function () { O.emit('data', { type: 'quickreplies' }); }); }
        if (!c) return;
        var b = bk(c);
        if (act === 'back') { st.view = 'list'; ib.classList.remove('show-chat'); delete st.unreadMark[c.id]; if (st.rec) cancelRecording(false, 'Recording discarded'); return; }
        if (act === 'booking') { if (O.allowed('bookings')) O.booking.open(b.id); return; }
        if (act === 'lock') { if (canCodes()) O.lock.change({ bookingId: b.id, propertyId: b.propertyId }); return; }
        if (act === 'more') { O.$('.ib-menu', chat).classList.toggle('open'); return; }
        if ((act === 'unread' || act === 'pin') && !canEdit()) { U.toast('Your access to the inbox is read only', 'bad'); return; }
        if (act === 'unread') { c.unread = Math.max(1, c.unread || 0); delete st.unreadMark[c.id]; if (st.rec) cancelRecording(true); st.sel = null; st.view = 'list'; ib.classList.remove('show-chat'); paintRows(); paintFilters(); paintChat(true); U.toast((b ? 'Chat with ' + b.guest.name : updName(c)) + ' marked as unread'); O.emit('data', { type: 'inbox-unread' }); return; }
        if (act === 'pin') { c.pinned = !c.pinned; paintRows(); paintChat(false); U.toast(c.pinned ? 'Chat pinned to the top' : 'Chat unpinned'); return; }
        if (act === 'invoice') { if (O.can('invoices.send')) O.invoice.send(b, b.paidAt ? ['invoice', 'receipt'] : ['invoice']); else U.toast('Your access does not include sending invoices and receipts', 'bad'); return; }
        if (act === 'attach') { O.$('.att-menu', chat).classList.toggle('open'); return; }
        if (act === 'xltoggle') { live.xl[c.id] = !live.xl[c.id]; var tx = O.$('#ib-input', chat); if (tx) st.drafts[c.id] = tx.value; rebuildComposer(); var ty = O.$('#ib-input', chat); if (ty) ty.focus(); return; }
        if (act === 'send') { send(); return; }
        if (act === 'record') { startRecording(); return; }
        if (act === 'recsend') { finishRecording(true); return; }
        if (act === 'reccancel') { cancelRecording(false); return; }
        if (act === 'recpause') { togglePause(); return; }
      });
      page.addEventListener('input', function (e) {
        var t = e.target;
        if (t.dataset.f === 'q') { st.q = t.value.trim(); paintRows(); return; }
        if (t.dataset.f === 'msg') { st.drafts[st.sel] = t.value; autosize(t); paintSendBtn(); st.qrSel = 0; paintSlash(); }
      });
      page.addEventListener('keydown', function (e) {
        var t = e.target;
        if (t.dataset.f !== 'msg') { if (e.key === 'Escape') { var mm = O.$('.ib-menu.open, .att-menu.open', page); if (mm) mm.classList.remove('open'); } return; }
        if (st.slash) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); var n = st.slash.length; if (n) { st.qrSel = (st.qrSel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; paintSlash(); } return; }
          if ((e.key === 'Enter' || e.key === 'Tab') && st.slash.length) { e.preventDefault(); useQuickReply(st.slash[st.qrSel].id); return; }
          if (e.key === 'Escape') { e.preventDefault(); st.slash = null; var sl = O.$('.slash', chat); if (sl) sl.remove(); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isPhone()) { e.preventDefault(); send(); }
      });
      page.addEventListener('change', function (e) {
        var t = e.target;
        if (t.dataset.f === 'prop') { setProp(t.value); return; }
        if (t.dataset.f === 'via') { var cv = conv(st.sel); if (!cv) return; live.via[cv.id] = t.value; var td = O.$('#ib-input', chat); if (td) st.drafts[cv.id] = td.value; rebuildComposer(); return; }
        if (t.dataset.f === 'assign') { var c = conv(st.sel); if (!c || !canEdit()) return; c.assigneeId = t.value; var s = staff(t.value); U.toast('Chat with ' + bk(c).guest.name + ' assigned to ' + s.name + '. ' + firstName(s.name) + ' was notified.'); paintRows(); O.emit('data', { type: 'inbox-assign', id: c.id }); }
      });
      /* property filter: remembered on this device; on a computer the open chat follows the filter */
      function setProp(pid) {
        st.prop = pid && D.propById[pid] ? pid : '';
        O.store.set('inbox:prop', st.prop);
        var sel = O.$('[data-f=prop]', listEl);
        if (sel) { sel.outerHTML = propSelectHTML(); }
        paintFilters(); paintRows();
        var cur = conv(st.sel);
        if (!isPhone() && (!cur || !inProp(cur))) {
          var first = visibleConvs()[0];
          if (first) select(first.id, false); else { st.sel = null; paintRows(); paintChat(true); }
        }
      }
      /* other pages and modals change data (door codes, ID checks, quick replies, new messages): refresh in place, keep the composer */
      ctx.on('data', function (p) {
        if (!document.body.contains(page)) return;
        var lw = O.$('.ib-loose-wrap', listEl); if (lw) lw.innerHTML = looseHTML();
        /* a message arriving in the open chat is read at once, like WhatsApp */
        var oc = conv(st.sel);
        if (oc && oc.unread && (st.view === 'chat' || !isPhone()) && document.visibilityState !== 'hidden') {
          st.unreadMark[oc.id] = { i: Math.max(0, oc.messages.length - oc.unread), n: oc.unread }; oc.unread = 0;
          O.emit('data', { type: 'inbox-read', id: oc.id }); return;
        }
        paintFilters(); paintRows(); paintTabs();
        if (oc && liveOn()) { var sig = JSON.stringify(routesFor(oc).map(function (r) { return [r.via, r.open]; })); if (chat.dataset.rsig && chat.dataset.rsig !== sig) rebuildComposer(); chat.dataset.rsig = sig; }
        if (conv(st.sel)) paintChat(false); else if (st.sel) { st.sel = null; paintChat(true); }
        if (p && p.type === 'quickreplies') { var w = O.$('.qr-wrap', chat), c = conv(st.sel); if (w && c) w.innerHTML = qrBarHTML(c); }
      });

      paintChat(true);
      loadLive(repaintLive);
      var sc = O.$('.cv.on', listEl); if (sc && sc.scrollIntoView) { var rows = O.$('.ib-rows', listEl); if (sc.offsetTop > rows.clientHeight) rows.scrollTop = sc.offsetTop - 60; }
      var cur = conv(st.sel);
      if (cur && cur.unread && (st.view === 'chat' || !isPhone())) { st.unreadMark[cur.id] = { i: Math.max(0, cur.messages.length - cur.unread), n: cur.unread }; cur.unread = 0; paintRows(); paintFilters(); paintThread(true); O.emit('data', { type: 'inbox-read', id: cur.id }); }
    }
  });
  var cancelRecording = function () {};
})();
