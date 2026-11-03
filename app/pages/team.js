/* Orbique — Team chat (nav id 'team'): staff messaging, apart from the guest Inbox.
   Arnob: "we need a different messaging section for staff messaging between all the staff or selected staff"
   - All staff: one chat for everyone on the team (every active staff member with Team chat in Staff Access, the account
     owner included), always first in the list.
   - Direct chats with one person, and groups with chosen staff: the maker (or the account owner) names the group,
     renames it and adds or removes people; anyone in a group may leave it.
   - Text, photos and files; unread counts per chat and on the menu; the newest message at the bottom; live updates;
     a phone alert to the others in the chat (not the sender), which each person can mute per chat.
   Rules and words: api/_lib/shared/teamchat.cjs (O.teamchat; every visible word is in its STR). Staff Access: the
   'team' section, on (Edit) for every role by default; View reads, Edit also writes and starts chats.
   Where it is kept:
     signed in:       Supabase tables team_chats, team_chat_members, team_messages (supabase/migrations/0024_team_chat.sql)
                      read and written here with the member's own session, so row level security decides who reads a
                      chat; chats change through the team_* functions; files in the private bucket team-files at
                      <org id>/<chat id>/<file>, opened with signed addresses; live through Supabase realtime with a
                      poll as the fallback; after sending, /api/alerts 'team-message' sends the phone alerts.
     local test copy: this browser's storage (O.store 'teamChat:<workspace>'), with sample chats; switching the viewer
                      shows that person's chats; files up to 1.5 MB are kept in the browser.
   Phone (<= 760 px): the chat list first, a chat full screen with a back button, like the Inbox.
   docs/notes/team-chat.md */
(function () {
  var O = window.O, D = O.data, d = O.d, U = O.ui, esc = O.esc, TC = O.teamchat;
  if (!TC) return;
  var t = TC.t, BUCKET = 'team-files', SIGNED_SECONDS = 3600, PAGE = 200;

  /* ------------------------------------------------------------------ styles */
  O.css('team', `
.pg-team{margin-bottom:-48px;}
.pg-team svg{width:18px;height:18px;flex-shrink:0;}
.pg-team .tc{display:grid;grid-template-columns:340px minmax(0,1fr);height:calc(100vh - 100px);height:calc(100dvh - 100px);min-height:520px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--shadow);overflow:hidden;}
.pg-team .tc-list{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--border);}
.pg-team .tc-lhead{display:flex;align-items:center;gap:8px;padding:12px 12px 8px 16px;}
.pg-team .tc-lhead h2{font-size:17px;font-weight:800;flex:1;}
.pg-team .tc-search{margin:0 12px 10px;display:flex;align-items:center;gap:8px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:0 10px;height:38px;}
.pg-team .tc-search svg{width:15px;height:15px;color:var(--faint);}
.pg-team .tc-search input{border:none;background:none;outline:none;width:100%;font-size:13px;color:var(--text);}
.pg-team .tc-rows{flex:1;overflow-y:auto;border-top:1px solid var(--border);}
.pg-team .tc-row{display:flex;gap:12px;align-items:center;width:100%;padding:10px 14px 10px 16px;background:none;border:none;border-bottom:1px solid var(--border);text-align:left;color:var(--text);cursor:pointer;}
.pg-team .tc-row:hover{background:var(--surface-2);}
.pg-team .tc-row.on{background:var(--brand-soft-2);box-shadow:inset 3px 0 0 var(--brand-strong);}
.pg-team .tc-row .avatar, .pg-team .tc-av{width:44px;height:44px;font-size:14.5px;}
.pg-team .tc-av{border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--brand);color:var(--brand-ink);flex-shrink:0;}
.pg-team .tc-av svg{width:22px;height:22px;}
.pg-team .tc-main{flex:1;min-width:0;}
.pg-team .tc-l1{display:flex;align-items:baseline;gap:8px;}
.pg-team .tc-name{font-weight:700;font-size:14px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pg-team .tc-time{font-size:11.5px;color:var(--muted);white-space:nowrap;}
.pg-team .tc-l2{display:flex;align-items:center;gap:6px;margin-top:2px;}
.pg-team .tc-prev{flex:1;min-width:0;font-size:13px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pg-team .tc-prev .who{color:var(--muted);}
.pg-team .tc-row.unread .tc-name{font-weight:800;}
.pg-team .tc-row.unread .tc-time{color:var(--brand-text);font-weight:700;}
.pg-team .tc-row.unread .tc-prev{color:var(--text);font-weight:600;}
.pg-team .tc-badge{min-width:20px;height:20px;border-radius:10px;padding:0 6px;background:var(--brand);color:var(--brand-ink);font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums;}
.pg-team .tc-mute{color:var(--faint);display:inline-flex;}
.pg-team .tc-mute svg{width:14px;height:14px;}
.pg-team .tc-empty{padding:24px 16px;text-align:center;color:var(--muted);font-size:13px;}
.pg-team .tc-chat{display:flex;flex-direction:column;min-width:0;min-height:0;}
.pg-team .tc-head{display:flex;align-items:center;gap:10px;padding:8px 10px 8px 14px;border-bottom:1px solid var(--border);min-height:60px;}
.pg-team .tc-head .avatar, .pg-team .tc-head .tc-av{width:40px;height:40px;font-size:14px;}
.pg-team .tc-who{flex:1;min-width:0;display:flex;align-items:center;gap:11px;background:none;border:none;padding:4px;border-radius:10px;text-align:left;color:var(--text);cursor:pointer;}
.pg-team .tc-who:hover{background:var(--surface-2);}
.pg-team .tc-who-t{min-width:0;display:flex;flex-direction:column;}
.pg-team .tc-who-n{display:block;font-weight:800;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pg-team .tc-who-s{display:block;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;}
.pg-team .tc-ic{width:38px;height:38px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;border:none;background:none;color:var(--text-2);flex-shrink:0;cursor:pointer;}
.pg-team .tc-ic:hover{background:var(--surface-2);}
.pg-team .tc-ic.on{color:var(--brand-text);}
.pg-team .tc-back{display:none;}
.pg-team .tc-thread{flex:1;overflow-y:auto;padding:14px 6% 10px;background-color:var(--bg);background-image:radial-gradient(circle at 1px 1px,var(--border) 1px,transparent 0);background-size:18px 18px;display:flex;flex-direction:column;gap:2px;}
.pg-team .tc-thread > :first-child{margin-top:auto;}
.pg-team .tc-day{align-self:center;margin:10px 0 8px;background:var(--surface);color:var(--text-2);font-size:11.5px;font-weight:700;padding:4px 12px;border-radius:8px;box-shadow:0 1px 0.5px rgba(16,24,40,0.12);}
.pg-team .tc-hello{align-self:center;max-width:360px;text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;font-size:13px;color:var(--text-2);margin:auto 0;}
.pg-team .tc-msg{display:flex;flex-direction:column;max-width:min(560px,78%);}
.pg-team .tc-msg.in{align-self:flex-start;}
.pg-team .tc-msg.out{align-self:flex-end;}
.pg-team .tc-msg.first{margin-top:8px;}
.pg-team .tc-bub{position:relative;display:flow-root;padding:6px 9px 8px 10px;border-radius:9px;font-size:13.5px;line-height:1.42;box-shadow:0 1px 0.5px rgba(16,24,40,0.13);overflow-wrap:anywhere;}
.pg-team .tc-msg.in .tc-bub{background:var(--surface);color:var(--text);}
.pg-team .tc-msg.out .tc-bub{background:var(--brand);color:var(--brand-ink);}
.pg-team .tc-msg.first.in .tc-bub{border-top-left-radius:0;}
.pg-team .tc-msg.first.out .tc-bub{border-top-right-radius:0;}
.pg-team .tc-bub .who{font-size:11.5px;font-weight:800;margin-bottom:2px;}
.pg-team .tc-bub .txt{white-space:pre-wrap;}
.pg-team .tc-bub .txt a{color:inherit;text-decoration:underline;}
.pg-team .tc-bub .meta{float:right;margin:8px 0 -5px 12px;font-size:10.5px;line-height:1.2;opacity:0.72;white-space:nowrap;}
.pg-team .tc-msg.in .tc-bub .meta{color:var(--muted);opacity:1;}
.pg-team .tc-msg.pending .tc-bub{opacity:0.7;}
.pg-team .tc-img{display:block;padding:0;border:none;background:var(--surface-2);border-radius:7px;overflow:hidden;cursor:zoom-in;max-width:280px;min-width:120px;min-height:90px;margin:2px 0 4px;}
.pg-team .tc-img img{display:block;max-width:280px;width:100%;max-height:320px;object-fit:cover;}
.pg-team .tc-file{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:7px;background:rgba(127,127,127,0.12);min-width:200px;max-width:300px;margin:2px 0 4px;color:inherit;text-decoration:none;border:none;text-align:left;cursor:pointer;font:inherit;}
.pg-team .tc-file b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pg-team .tc-file span{font-size:11px;opacity:0.75;}
.pg-team .tc-file .fn{flex:1;min-width:0;}
.pg-team .tc-compose{border-top:1px solid var(--border);background:var(--surface);padding:8px 10px 10px;display:flex;align-items:flex-end;gap:6px;}
.pg-team .tc-compose textarea{flex:1;min-width:0;resize:none;border:1px solid var(--border);border-radius:20px;padding:9px 14px;font:inherit;font-size:14px;line-height:1.35;max-height:140px;min-height:40px;background:var(--surface-2);color:var(--text);outline:none;}
.pg-team .tc-compose textarea:focus{border-color:var(--brand-strong);background:var(--surface);}
.pg-team .tc-send{width:40px;height:40px;border-radius:50%;border:none;background:var(--brand);color:var(--brand-ink);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;}
.pg-team .tc-send[disabled]{opacity:0.5;cursor:default;}
.pg-team .tc-ro{margin:8px 10px 10px;display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted);background:var(--surface-2);border:1px dashed var(--border-strong);border-radius:12px;padding:10px 12px;}
.pg-team .tc-none{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;padding:30px;color:var(--muted);background:var(--surface-2);}
.pg-team .tc-none .art{width:110px;height:110px;border-radius:50%;background:var(--brand-soft);display:flex;align-items:center;justify-content:center;color:var(--brand-strong);}
.pg-team .tc-none .art svg{width:48px;height:48px;}
.pg-team .tc-none h3{color:var(--text);font-size:18px;}
.pg-team .tc-err{margin:10px 12px;}
.tc-people{display:flex;flex-direction:column;gap:2px;max-height:52vh;overflow-y:auto;}
.tc-person{display:flex;align-items:center;gap:10px;padding:8px 6px;border-radius:10px;min-height:48px;}
.tc-person:hover{background:var(--surface-2);}
.tc-person .grow{min-width:0;flex:1;display:flex;flex-direction:column;}
.tc-person .nm{display:block;font-weight:700;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tc-person .rl{display:block;font-size:12px;color:var(--muted);}
.tc-person input[type=checkbox]{width:18px;height:18px;accent-color:var(--brand-strong);flex-shrink:0;}
button.tc-person{width:100%;background:none;border:none;text-align:left;color:var(--text);cursor:pointer;font:inherit;}
.tc-dets{display:flex;flex-direction:column;gap:14px;}
.tc-dets .acts{display:flex;flex-wrap:wrap;gap:8px;}
.tc-lightbox{display:flex;justify-content:center;background:var(--bg);border-radius:10px;padding:10px;}
.tc-lightbox img{max-width:100%;max-height:70vh;display:block;border-radius:8px;}
@media (max-width:1100px){ .pg-team .tc{grid-template-columns:290px minmax(0,1fr);} .pg-team .tc-thread{padding:12px 3% 10px;} }
@media (max-width:960px){ .pg-team{margin-bottom:-42px;} .pg-team .tc{height:calc(100vh - 84px);height:calc(100dvh - 84px);} }
@media (max-width:760px){
  .pg-team{margin:-14px -14px calc(-84px - env(safe-area-inset-bottom));}
  .pg-team .tc{display:block;height:calc(100vh - 59px - 61px);height:calc(100dvh - 59px - 61px - env(safe-area-inset-bottom));min-height:0;border:none;border-radius:0;box-shadow:none;}
  .pg-team .tc-list, .pg-team .tc-chat{height:100%;}
  .pg-team .tc.show-chat .tc-list{display:none;}
  .pg-team .tc:not(.show-chat) .tc-chat{display:none;}
  .pg-team .tc-list{border-right:none;}
  .pg-team .tc-back{display:inline-flex;}
  .pg-team .tc-head{padding:6px 4px 6px 2px;gap:2px;}
  .pg-team .tc-who{padding:2px;gap:9px;}
  .pg-team .tc-head .avatar, .pg-team .tc-head .tc-av{width:36px;height:36px;}
  .pg-team .tc-ic{width:42px;height:42px;}
  .pg-team .tc-thread{padding:10px 10px 8px;}
  .pg-team .tc-msg{max-width:86%;}
  .pg-team .tc-img, .pg-team .tc-img img{max-width:230px;}
  .pg-team .tc-search{height:42px;}
  .pg-team .tc-compose textarea{font-size:16px;}
  .pg-team .tc-send{width:44px;height:44px;}
}
`);

  /* ------------------------------------------------------------------ where it is kept */
  var S = fresh();
  function fresh() { return { org: null, loaded: false, loading: null, error: null, level: 'none', chats: [], msgs: {}, msgLoading: {}, urls: {}, ch: null, rtOk: false, poll: null, reloadT: null, me: null }; }
  function live() { return !!(O.auth && O.auth.enabled && O.auth.enabled() && O.auth.orgId && O.auth.orgId()); }
  function orgKey() { return live() ? 'live:' + O.auth.orgId() : 'local:' + (O.state.workspace || ''); }
  function sb() { return O.auth.supabase(); }
  function me() { return O.state.viewer; }
  function check() { if (S.org !== orgKey()) { stopLive(); S = fresh(); S.org = orgKey(); } }
  function readOnly() { return !!((O.auth && O.auth.readOnly && O.auth.readOnly()) || (O.sync && O.sync.readOnly)); }
  function canWrite() { return O.can('team', 'edit') && !readOnly(); }
  function errText(e, fallback) {
    var m = e && (e.message || e.error_description || e.msg) || '';
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) return t('offline');
    if (e && (e.code === '42501' || /row-level security|permission denied|not allowed|unauthori[sz]ed/i.test(m))) return t('noAccess');
    if (e && e.code === '22023' && m) return m.charAt(0).toUpperCase() + m.slice(1) + '.';
    return e && e.tc ? m : fallback || t('loadFailed');
  }
  function err(key, vars) { var e = new Error(t(key, vars)); e.tc = true; return e; }
  function nameOf(id) { var s = id && D.staffById(id); return s ? s.name : t('formerStaff'); }
  function roleOf(id) { var s = id && D.staffById(id); return s ? s.roleLabel || '' : ''; }
  function teamIds() { return O.activeStaff().filter(function (s) { return O.can('team', 'view', s.id); }).map(function (s) { return s.id; }); }
  function chatById(id) { check(); for (var i = 0; i < S.chats.length; i++) if (S.chats[i].id === id) return S.chats[i]; return null; }
  function nowIso() { /* the app's clock (D.NOW, Malaysia time) with this second, so tests that pin the clock still get order */
    var base = Date.parse(D.NOW + ':00+08:00'); if (isNaN(base)) base = Date.now();
    return new Date(base + new Date().getSeconds() * 1000 + new Date().getMilliseconds()).toISOString();
  }
  function localOf(iso) { return new Date(TC.ms(iso) + 8 * 36e5).toISOString().slice(0, 16); } /* Malaysia time 'YYYY-MM-DDTHH:MM' */

  /* ---- the local test copy ---- */
  function lkey() { return 'teamChat:' + (O.state.workspace || ''); }
  function ldb() {
    var db = O.store.get(lkey(), null);
    if (!db || !Array.isArray(db.chats)) { db = demoDb(); lsave(db); }
    return TC.ensureAll(db, nowIso());
  }
  function lsave(db) {
    try { localStorage.setItem('orbique4:' + lkey(), JSON.stringify(db)); return true; }
    catch (e) { U.toast(t('fileTooBig', { mb: 1.5 }), 'bad'); return false; }
  }
  function lopts() { return { now: nowIso(), uid: function (p) { return O.uid(p).replace(/[^A-Za-z0-9_-]/g, ''); }, active: teamIds(), isOwner: O.isOwner(), canSend: canWrite() }; }
  function loadLocal() {
    var db = ldb(), o = lopts(), mine = me();
    S.level = O.sectionLevel(mine, 'team'); S.me = mine;
    S.chats = TC.list(db, mine, o);
    S.chats.forEach(function (c) { S.msgs[c.id] = TC.thread(db, c.id); });
    return Promise.resolve(S.chats);
  }
  /* sample chats for the demo, relative to the app's clock; every value is made up */
  function demoDb() {
    var base = Date.parse((D.NOW || '2026-10-06T10:15') + ':00+08:00'), at = function (min) { return new Date(base - min * 60000).toISOString(); };
    var ids = (D.staff || []).map(function (s) { return s.id; }), has = function (id) { return ids.indexOf(id) >= 0; };
    var db = { v: 1, chats: [], members: [], messages: [] }, n = 0;
    function chat(id, kind, name, by, min, people) {
      db.chats.push({ id: id, kind: kind, name: name || '', dmKey: kind === 'direct' ? TC.dmKey(people[0], people[1]) : null, createdBy: by, createdAt: at(min), lastAt: at(min) });
      (people || []).forEach(function (p) { db.members.push({ chatId: id, staffId: p, addedBy: by, addedAt: at(min), lastReadAt: null, muted: false }); });
    }
    function msg(chatId, who, min, body) { if (!has(who)) return; db.messages.push({ id: 'm-demo-' + (++n), chatId: chatId, sender: who, body: body, file: null, at: at(min) }); }
    function read(chatId, who, min) { var r = db.members.filter(function (m) { return m.chatId === chatId && m.staffId === who; })[0]; if (!r) { r = { chatId: chatId, staffId: who, addedBy: who, addedAt: at(min), lastReadAt: null, muted: false }; db.members.push(r); } r.lastReadAt = at(min); }
    chat('all', 'all', '', null, 60 * 24 * 30, []);
    msg('all', 's2', 60 * 26, 'Morning all. Two check-ins at Bayfront today, both before 3 pm. Please have 3B ready by 1 pm.');
    msg('all', 's3', 60 * 26 - 12, 'On it. Fresh linen for 3B is already in the car.');
    msg('all', 's6', 60 * 3, 'Aircon in the Marina Suite master bedroom is serviced and the filter changed.');
    msg('all', 's2', 35, 'Reminder: team meeting on Friday at 10 am at the office. Bring your questions about the new checklists.');
    ids.forEach(function (id) { read('all', id, 60 * 3 + 1); });
    read('all', 's2', 34); read('all', 's6', 60 * 3 - 1);
    if (has('s3') && has('s5')) {
      chat('g-demo-hk', 'group', 'Housekeeping', 's3', 60 * 24 * 10, ['s3', 's5', 's2', 's1'].filter(has));
      msg('g-demo-hk', 's3', 60 * 20, 'Siti, can you take Highland Villa 2 tomorrow? I will do both Bayfront units.');
      msg('g-demo-hk', 's5', 60 * 19, 'Yes, no problem. I will pick up the key at 9.');
      msg('g-demo-hk', 's3', 50, 'We are low on bath towels. I put it on the inventory list.');
      read('g-demo-hk', 's3', 49); read('g-demo-hk', 's5', 60 * 19); read('g-demo-hk', 's2', 60 * 19); read('g-demo-hk', 's1', 60 * 19);
    }
    if (has('s1') && has('s2')) {
      chat('d-demo-12', 'direct', '', 's2', 60 * 24 * 5, ['s1', 's2']);
      msg('d-demo-12', 's2', 60 * 5, 'Can you approve the plumber\'s quote for the Marina Suite basin? RM 380.');
      msg('d-demo-12', 's1', 60 * 5 - 20, 'Approved. Please go ahead.');
      read('d-demo-12', 's1', 60 * 5 - 20); read('d-demo-12', 's2', 60 * 5 - 19);
    }
    db.chats.forEach(function (c) { var last = TC.thread(db, c.id).pop(); if (last) c.lastAt = last.at; });
    return db;
  }

  /* ---- signed in ---- */
  function fromRow(c) {
    return { id: c.id, kind: c.kind, name: c.name || '', dmKey: c.dmKey || null, createdBy: c.createdBy || null, createdAt: c.createdAt, lastAt: c.lastAt,
      members: c.kind === 'all' ? teamIds() : (c.members || []), unread: Number(c.unread) || 0, muted: !!c.muted,
      last: c.last ? { id: c.last.id, chatId: c.id, sender: c.last.sender, body: c.last.body || '', file: c.last.file || null, at: c.last.at } : null,
      canManage: c.kind === 'group' && (c.createdBy === me() || O.isOwner()) };
  }
  function msgFromRow(r) { return { id: r.id, chatId: r.chat_id, sender: r.sender, body: r.body || '', file: r.file || null, at: r.created_at }; }
  function loadLive() {
    var key = S.org;
    return sb().rpc('team_list', { p_org: O.auth.orgId() }).then(function (r) {
      if (r.error) throw r.error;
      if (S.org !== key) return [];
      var v = r.data || {};
      S.level = v.level || 'none'; S.me = v.me || me();
      S.chats = TC.sortChats((v.chats || []).map(fromRow));
      return S.chats;
    });
  }
  function loadMsgsLive(chatId) {
    var key = S.org;
    return sb().from('team_messages').select('id, chat_id, sender, body, file, created_at').eq('org_id', O.auth.orgId()).eq('chat_id', chatId)
      .order('created_at', { ascending: false }).limit(PAGE).then(function (r) {
        if (r.error) throw r.error;
        if (S.org !== key) return [];
        var list = (r.data || []).map(msgFromRow).reverse(), have = S.msgs[chatId] || [];
        /* keep messages that arrived live meanwhile */
        have.forEach(function (m) { if (!list.some(function (x) { return x.id === m.id; }) && !m.pending && TC.ms(m.at) > TC.ms(list.length ? list[list.length - 1].at : 0)) list.push(m); });
        S.msgs[chatId] = list;
        return list;
      });
  }

  /* ---- shared ---- */
  var TCX = O.teamChat = {};
  TCX.allowed = function () { return O.can('team', 'view'); };
  TCX.live = live;
  TCX.unreadTotal = function () {
    check(); if (!TCX.allowed()) return 0;
    if (!live() && O._started && (!S.loaded || S.me !== me())) { loadLocal(); S.loaded = true; }   /* the local copy reads its storage at once */
    return TC.totalUnread(S.chats);
  };
  TCX.state = function () { check(); return { loaded: S.loaded, error: S.error, chats: S.chats.slice(), level: S.level, realtime: S.rtOk }; };
  TCX.load = function (force) {
    check();
    if (!TCX.allowed()) { S.chats = []; return Promise.resolve([]); }
    if (!live()) { return loadLocal().then(function (c) { S.loaded = true; S.error = null; changed(); return c; }); }
    if (S.loading && !force) return S.loading;
    var key = S.org;
    S.loading = loadLive().then(function (c) {
      if (S.org !== key) return [];
      S.loaded = true; S.error = null; S.loading = null; startLive(); changed(); return c;
    }, function (e) {
      if (S.org !== key) return [];
      S.loading = null; S.error = errText(e); changed(); throw e;
    });
    return S.loading;
  };
  TCX.messages = function (chatId) { check(); return S.msgs[chatId] || null; };
  TCX.loadMessages = function (chatId) {
    check();
    if (!live()) { var db = ldb(); S.msgs[chatId] = TC.thread(db, chatId); return Promise.resolve(S.msgs[chatId]); }
    if (S.msgLoading[chatId]) return S.msgLoading[chatId];
    S.msgLoading[chatId] = loadMsgsLive(chatId).then(function (l) { delete S.msgLoading[chatId]; return l; }, function (e) { delete S.msgLoading[chatId]; throw e; });
    return S.msgLoading[chatId];
  };
  function softReload() { clearTimeout(S.reloadT); S.reloadT = setTimeout(function () { TCX.load(true).catch(function () {}); }, 350); }
  /* something changed: the menu badge and the page (when open) follow */
  var listeners = [];
  function changed(what) { if (O.paintBadges) O.paintBadges(); listeners.slice().forEach(function (fn) { try { fn(what || {}); } catch (e) { console.error(e); } }); }

  TCX.markRead = function (chatId) {
    check(); var c = chatById(chatId); if (!c) return Promise.resolve();
    var had = c.unread; c.unread = 0; if (had) changed({ list: true });
    if (!live()) { var db = ldb(); if (TC.markRead(db, me(), chatId, lopts()).ok) lsave(db); return Promise.resolve(); }
    if (readOnly()) return Promise.resolve();
    return sb().rpc('team_read', { p_org: O.auth.orgId(), p_chat: chatId }).then(function (r) { if (r.error) throw r.error; });
  };
  TCX.setMuted = function (chatId, muted) {
    check(); var c = chatById(chatId); if (!c) return Promise.reject(err('notMember'));
    if (!live()) { var db = ldb(), r = TC.setMuted(db, me(), chatId, muted, lopts()); if (!r.ok) return Promise.reject(err(r.error)); lsave(db); c.muted = !!muted; changed({ list: true, head: true }); return Promise.resolve(); }
    if (readOnly()) return Promise.reject(err('paused'));
    return sb().rpc('team_mute', { p_org: O.auth.orgId(), p_chat: chatId, p_muted: !!muted }).then(function (r) { if (r.error) throw r.error; c.muted = !!muted; changed({ list: true, head: true }); });
  };
  /* kind 'direct' (staff: [one id]) or 'group' (name, staff) -> chat id */
  TCX.open = function (kind, name, staff) {
    check();
    if (!canWrite()) return Promise.reject(err(readOnly() ? 'paused' : 'viewOnly'));
    if (!live()) {
      var db = ldb(), o = lopts(), r = kind === 'direct' ? TC.openDirect(db, me(), staff[0], o) : TC.createGroup(db, me(), name, staff, o);
      if (!r.ok) return Promise.reject(Object.assign(new Error(r.error), { tc: true }));
      lsave(db); return TCX.load(true).then(function () { return r.id; });
    }
    return sb().rpc('team_open', { p_org: O.auth.orgId(), p_kind: kind, p_name: name || null, p_staff: staff }).then(function (r) {
      if (r.error) throw r.error;
      return TCX.load(true).then(function () { return r.data; });
    });
  };
  /* ch = {name?, add?, remove?} */
  TCX.manage = function (chatId, ch) {
    check();
    if (!canWrite()) return Promise.reject(err(readOnly() ? 'paused' : 'viewOnly'));
    if (!live()) {
      var db = ldb(), r = TC.manage(db, me(), chatId, ch, lopts());
      if (!r.ok) return Promise.reject(Object.assign(new Error(r.error), { tc: true }));
      lsave(db); return TCX.load(true);
    }
    return sb().rpc('team_manage', { p_org: O.auth.orgId(), p_chat: chatId, p_name: ch.name == null ? null : ch.name, p_add: ch.add || [], p_remove: ch.remove || [] }).then(function (r) {
      if (r.error) throw r.error; return TCX.load(true);
    });
  };

  /* ---- sending ---- */
  TCX.send = function (chatId, body, file) {
    check();
    var c = chatById(chatId); if (!c) return Promise.reject(err('notMember'));
    if (!canWrite()) return Promise.reject(err(readOnly() ? 'paused' : 'viewOnly'));
    body = TC.cleanBody(body);
    if (!body && !file) return Promise.resolve(null);
    if (!live()) {
      return (file ? localFile(file) : Promise.resolve(null)).then(function (f) {
        var db = ldb(), r = TC.addMessage(db, me(), chatId, { body: body, file: f }, lopts());
        if (!r.ok) throw Object.assign(new Error(r.error), { tc: true });
        if (!lsave(db)) throw err('sendFailed');
        S.msgs[chatId] = TC.thread(db, chatId);
        return TCX.load(true).then(function () { return r.message; });
      });
    }
    /* signed in: shown at once as "sending", replaced by the saved row */
    var temp = { id: 'tmp-' + O.uid('m'), chatId: chatId, sender: me(), body: body, file: file ? { name: file.name, mime: file.type, size: file.size } : null, at: new Date().toISOString(), pending: true };
    (S.msgs[chatId] = S.msgs[chatId] || []).push(temp); changed({ thread: chatId });
    var key = S.org, path = null;
    var up = file ? upload(chatId, file).then(function (meta) { path = meta.path; return meta; }) : Promise.resolve(null);
    return up.then(function (meta) {
      return sb().from('team_messages').insert({ org_id: O.auth.orgId(), chat_id: chatId, sender: me(), body: body, file: meta }).select('id, chat_id, sender, body, file, created_at').single();
    }).then(function (r) {
      if (r.error) throw r.error;
      if (S.org !== key) return null;
      var m = msgFromRow(r.data), list = S.msgs[chatId] || [];
      var i = list.indexOf(temp); if (i >= 0) list.splice(i, 1);
      if (!list.some(function (x) { return x.id === m.id; })) list.push(m);
      c.last = m; c.lastAt = m.at; c.unread = 0; TC.sortChats(S.chats);
      changed({ thread: chatId, list: true });
      O.auth.call('/api/alerts', { action: 'team-message', orgId: O.auth.orgId(), messageId: m.id }).catch(function (e) { console.warn('team alert', e && e.message); });
      return m;
    }).catch(function (e) {
      var list = S.msgs[chatId] || [], i = list.indexOf(temp); if (i >= 0) list.splice(i, 1);
      changed({ thread: chatId });
      if (path) sb().storage.from(BUCKET).remove([path]).catch(function () {});
      throw e && e.tc ? e : err(/row-level|permission|42501/i.test((e && (e.message || e.code)) || '') ? 'noAccess' : 'sendFailed');
    });
  };
  function upload(chatId, file) {
    var why = TC.checkFile(file.type, file.size, TC.FILE_MAX);
    if (why) return Promise.reject(Object.assign(new Error(why), { tc: true }));
    return shrink(file).then(function (blob) {
      var mime = blob.type || file.type, name = blob === file ? file.name : String(file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
      var path = O.auth.orgId() + '/' + chatId + '/' + O.uid('f').toLowerCase().replace(/[^a-z0-9_-]/g, '') + '-' + TC.safeName(name);
      return sb().storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false }).then(function (r) {
        if (r.error) throw Object.assign(new Error(/row-level|policy|unauthori[sz]ed|403/i.test(r.error.message || '') ? t('noAccess') : t('sendFailed')), { tc: true });
        return { path: path, name: String(name).slice(0, 120), mime: mime, size: blob.size || file.size };
      });
    });
  }
  /* photos: at most 1600 px on the long side as JPEG (GIF, HEIC and small photos go as they are) */
  function shrink(file, max, quality) {
    max = max || 1600; quality = quality || 0.85;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 350000 || typeof document === 'undefined') return Promise.resolve(file);
    return new Promise(function (res) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        URL.revokeObjectURL(url);
        var k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)), cv = document.createElement('canvas');
        cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
        var cx = cv.getContext('2d'); cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height);
        if (!cv.toBlob) { res(file); return; }
        cv.toBlob(function (b) { res(b && b.size < file.size ? b : file); }, 'image/jpeg', quality);
      };
      im.onerror = function () { URL.revokeObjectURL(url); res(file); };
      im.src = url;
    });
  }
  /* the local test copy keeps a file in the message itself (photos made smaller first) */
  function localFile(file) {
    var why = TC.checkFile(file.type, file.size, /^image\//.test(file.type) ? TC.FILE_MAX : TC.LOCAL_FILE_MAX);
    if (why) return Promise.reject(Object.assign(new Error(why), { tc: true }));
    return shrink(file, 1024, 0.7).then(function (blob) {
      if (blob.size > TC.LOCAL_FILE_MAX) throw err('fileTooBig', { mb: 1.5 });
      return new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () { res({ data: String(fr.result), name: String(file.name || 'file').slice(0, 120), mime: blob.type || file.type, size: blob.size }); };
        fr.onerror = function () { rej(err('sendFailed')); };
        fr.readAsDataURL(blob);
      });
    });
  }
  /* where a file opens: its data (local) or a signed address (cached for most of an hour) */
  TCX.fileUrl = function (f) {
    if (!f) return Promise.resolve(null);
    if (f.data) return Promise.resolve(f.data);
    if (!f.path || !live()) return Promise.resolve(null);
    var hit = S.urls[f.path]; if (hit && hit.until > Date.now()) return Promise.resolve(hit.url);
    return sb().storage.from(BUCKET).createSignedUrl(f.path, SIGNED_SECONDS).then(function (r) {
      if (r.error || !r.data || !r.data.signedUrl) return null;
      S.urls[f.path] = { url: r.data.signedUrl, until: Date.now() + (SIGNED_SECONDS - 600) * 1000 };
      return r.data.signedUrl;
    }, function () { return null; });
  };

  /* ---- live: Supabase realtime (row level security decides what reaches whom), with a poll as the fallback ---- */
  function startLive() {
    if (!live() || S.ch) return;
    var org = O.auth.orgId(), key = S.org;
    try {
      S.ch = sb().channel('orbique-team-' + org)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_messages', filter: 'org_id=eq.' + org }, function (p) { if (S.org === key) onLiveMessage(p && p.new); })
        /* chat rows change when a chat is made, renamed or its people change (membership rows are not published) */
        .on('postgres_changes', { event: '*', schema: 'public', table: 'team_chats', filter: 'org_id=eq.' + org }, function () { if (S.org === key) softReload(); })
        .subscribe(function (status) { S.rtOk = status === 'SUBSCRIBED'; });
    } catch (e) { S.ch = null; }
    S.poll = setInterval(function () {
      if (document.hidden || S.org !== key) return;
      TCX.load(true).then(function () { var id = U_STATE.openId; if (id && O.state.page === 'team') return TCX.loadMessages(id).then(function () { changed({ thread: id }); }); }).catch(function () {});
    }, 45000);
  }
  function stopLive() {
    if (S.ch) { try { sb().removeChannel(S.ch); } catch (e) {} S.ch = null; }
    if (S.poll) { clearInterval(S.poll); S.poll = null; }
    clearTimeout(S.reloadT);
  }
  function onLiveMessage(row) {
    if (!row || !row.id) return;
    var m = msgFromRow(row), c = chatById(m.chatId), list = S.msgs[m.chatId];
    if (list && !list.some(function (x) { return x.id === m.id; })) {
      if (m.sender === me()) { var tmp = list.filter(function (x) { return x.pending && x.body === m.body; })[0]; if (tmp) list.splice(list.indexOf(tmp), 1); }
      list.push(m);
    }
    if (!c) { softReload(); return; }
    var mine = m.sender === me(), open = O.state.page === 'team' && U_STATE.openId === m.chatId && !document.hidden;
    if (TC.ms(m.at) >= TC.ms(c.lastAt)) { c.last = m; c.lastAt = m.at; }
    if (!mine && !open) c.unread = (c.unread || 0) + 1;
    TC.sortChats(S.chats);
    if (!mine && !c.muted && O.alertSound) O.alertSound.play();
    if (!mine && open) TCX.markRead(m.chatId).catch(function () {});
    if (!mine && !open && O.state.page !== 'team') U.toast(TC.pushText(c, nameOf(m.sender), m).title + ': ' + TC.pushText(c, nameOf(m.sender), m).body);
    changed({ thread: m.chatId, list: true });
  }
  /* the phone app with Orbique open (app/native/bridge.js): the realtime message rings already; catch up if it did not */
  TCX.onPush = function (n) { if (!S.rtOk) TCX.load(true).catch(function () {}); else if (O.state.page !== 'team' && n && n.title) U.toast(n.title + (n.body ? ': ' + String(n.body).split('\n')[0] : '')); };

  /* start once the workspace is open (for the menu badge), again when the workspace or the viewer changes */
  function boot() { if (!O._started) return; check(); if (TCX.allowed()) TCX.load(false).catch(function () {}); else { S.chats = []; changed(); } }
  (function wait(tries) { if (O._started) { boot(); return; } if (tries > 0) setTimeout(function () { wait(tries - 1); }, 200); })(600);
  O.on('workspace', function () { setTimeout(boot, 0); });
  O.on('viewer', function () { if (!live()) setTimeout(boot, 0); });
  O.navBadges.team = function () { return TCX.unreadTotal(); };

  /* ------------------------------------------------------------------ the page */
  var U_STATE = { openId: null, q: '', view: 'list', drafts: {} };
  function isPhone() { return window.matchMedia ? window.matchMedia('(max-width: 760px)').matches : window.innerWidth <= 760; }
  var ICON_ALL = O.icon('team'), BELL_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.7 21a2 2 0 0 1-3.4 0M18.6 13A17 17 0 0 1 18 8M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14M18 8a6 6 0 0 0-9.3-5M3 3l18 18"/></svg>';
  function title(c) { return TC.chatTitle(c, me(), function (id) { return id ? nameOf(id) : ''; }, c.members); }
  function otherOf(c) { if (!c || c.kind !== 'direct') return null; var ids = (c.dmKey || '').split(':'); return ids[0] === me() ? ids[1] : ids[0]; }
  function avatarOf(c, size) {
    if (c.kind === 'all') return '<span class="tc-av" aria-hidden="true">' + ICON_ALL + '</span>';
    return U.avatar(c.kind === 'direct' ? nameOf(otherOf(c)) : (c.name || 'G'), size);
  }
  function subOf(c) {
    if (c.kind === 'all') return t('allStaffSub') + ' · ' + t('membersN', { n: teamIds().length });
    if (c.kind === 'direct') { var o = otherOf(c); return roleOf(o) || t('formerStaff'); }
    return t('membersN', { n: (c.members || []).length });
  }
  function whenText(iso) {
    var l = localOf(iso), day = l.slice(0, 10);
    if (day === D.TODAY) return O.fmt.time(l);
    if (day === d.add(D.TODAY, -1)) return t('yesterday');
    return day.slice(0, 4) === D.TODAY.slice(0, 4) ? d.fmt(day) : d.fmtY(day);
  }
  function dayText(day) { return day === D.TODAY ? t('today') : day === d.add(D.TODAY, -1) ? t('yesterday') : d.fmtY(day); }
  function sizeText(n) { return n >= 1048576 ? (Math.round(n / 104857.6) / 10) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function linkify(s) { return esc(s).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>'; }); }

  function visibleChats() {
    var q = U_STATE.q.trim().toLowerCase();
    return S.chats.filter(function (c) { return !q || title(c).toLowerCase().indexOf(q) >= 0 || (c.kind === 'group' && (c.members || []).some(function (id) { return nameOf(id).toLowerCase().indexOf(q) >= 0; })); });
  }
  function rowHTML(c) {
    var last = c.last, who = last ? (last.sender === me() ? t('you') : c.kind === 'direct' ? '' : TC.firstName(nameOf(last.sender))) : '';
    var prev = last ? (who ? '<span class="who">' + esc(who) + ': </span>' : '') + esc(TC.preview(last)) : '<span class="who">' + esc(c.kind === 'all' ? t('allStaffSub') : t('noMessages')) + '</span>';
    return '<button type="button" class="tc-row' + (c.id === U_STATE.openId ? ' on' : '') + (c.unread ? ' unread' : '') + '" data-chat="' + esc(c.id) + '">' + avatarOf(c) +
      '<span class="tc-main"><span class="tc-l1"><span class="tc-name">' + esc(title(c)) + '</span><span class="tc-time">' + (last ? esc(whenText(last.at)) : '') + '</span></span>' +
      '<span class="tc-l2"><span class="tc-prev">' + prev + '</span>' + (c.muted ? '<span class="tc-mute" title="' + esc(t('muted')) + '">' + BELL_OFF + '</span>' : '') +
      (c.unread ? '<span class="tc-badge" aria-label="' + c.unread + ' unread">' + esc(TC.badge(c.unread)) + '</span>' : '') + '</span></span></button>';
  }
  function rowsHTML() {
    if (!S.loaded && !S.error) return '<div class="tc-empty">' + esc(t('loading')) + '</div>';
    var list = visibleChats();
    return list.length ? list.map(rowHTML).join('') : '<div class="tc-empty">' + esc(t('noChats')) + '</div>';
  }
  function listHTML() {
    return '<div class="tc-lhead"><h2>' + esc(t('title')) + '</h2>' + (canWrite() ? '<button type="button" class="btn btn-primary btn-sm" data-tc="new">' + O.icon('plus') + esc(t('newChat')) + '</button>' : '') + '</div>' +
      '<label class="tc-search">' + O.icon('search') + '<input type="search" data-tc-q placeholder="' + esc(t('search')) + '" aria-label="' + esc(t('search')) + '" value="' + esc(U_STATE.q) + '"></label>' +
      (S.error ? '<div class="note warn tc-err">' + esc(S.error) + ' <button type="button" class="btn btn-ghost btn-sm" data-tc="retry">' + esc(t('retry')) + '</button></div>' : '') +
      '<div class="tc-rows" role="list">' + rowsHTML() + '</div>';
  }
  function headHTML(c) {
    return '<div class="tc-head"><button type="button" class="tc-ic tc-back" data-tc="back" aria-label="' + esc(t('back')) + '">' + O.icon('left') + '</button>' +
      '<button type="button" class="tc-who" data-tc="details">' + avatarOf(c) + '<span class="tc-who-t"><span class="tc-who-n">' + esc(title(c)) + '</span><span class="tc-who-s">' + esc(subOf(c)) + '</span></span></button>' +
      '<button type="button" class="tc-ic' + (c.muted ? ' on' : '') + '" data-tc="mute" aria-pressed="' + c.muted + '" title="' + esc(c.muted ? t('unmute') : t('mute')) + '" aria-label="' + esc(c.muted ? t('unmute') : t('mute')) + '">' + (c.muted ? BELL_OFF : O.icon('bell')) + '</button>' +
      '<button type="button" class="tc-ic" data-tc="details" title="' + esc(t('details')) + '" aria-label="' + esc(t('details')) + '">' + O.icon('staff') + '</button></div>';
  }
  function fileHTML(m) {
    var f = m.file, k = TC.fileKind(f.mime);
    if (k === 'image') return '<button type="button" class="tc-img" data-tc-img="' + esc(m.id) + '" aria-label="' + esc(t('photo')) + '"><img alt="" data-tc-src="' + esc(m.id) + '"' + (f.data ? ' src="' + esc(f.data) + '"' : '') + '></button>';
    return '<button type="button" class="tc-file" data-tc-file="' + esc(m.id) + '">' + O.icon('file') + '<span class="fn"><b>' + esc(f.name || t('file')) + '</b><span>' + esc((k === 'video' ? t('video') : t('file')) + (f.size ? ' · ' + sizeText(f.size) : '')) + '</span></span><span>' + esc(t('openFile')) + '</span></button>';
  }
  function threadHTML(c, msgs) {
    if (!msgs) return '<div class="tc-hello">' + esc(t('loading')) + '</div>';
    if (!msgs.length) return '<div class="tc-hello">' + esc(t('noMessages')) + '</div>';
    var out = [], prevDay = '', prevWho = null, prevAt = 0;
    msgs.forEach(function (m) {
      var l = localOf(m.at), day = l.slice(0, 10), mine = m.sender === me();
      if (day !== prevDay) { out.push('<div class="tc-day">' + esc(dayText(day)) + '</div>'); prevDay = day; prevWho = null; }
      var first = m.sender !== prevWho || TC.ms(m.at) - prevAt > 10 * 60000;
      prevWho = m.sender; prevAt = TC.ms(m.at);
      var who = !mine && first && c.kind !== 'direct' ? '<div class="who" style="color:' + whoColor(m.sender) + '">' + esc(nameOf(m.sender)) + '</div>' : '';
      out.push('<div class="tc-msg ' + (mine ? 'out' : 'in') + (first ? ' first' : '') + (m.pending ? ' pending' : '') + '" data-mid="' + esc(m.id) + '"><div class="tc-bub">' + who +
        (m.file ? fileHTML(m) : '') + (m.body ? '<span class="txt">' + linkify(m.body) + '</span>' : '') +
        '<span class="meta">' + esc(m.pending ? t('sending') : O.fmt.time(l)) + '</span></div></div>');
    });
    return out.join('');
  }
  var WHO_COLORS = ['#2F7D6D', '#3B5B8C', '#8A5A2B', '#6D4C9F', '#A0414E', '#3F7F3F', '#1F6A8A', '#8C3E7A'];
  function whoColor(id) { return 'color-mix(in srgb, ' + WHO_COLORS[D.hash(String(id)) % WHO_COLORS.length] + ' 80%, var(--text))'; }
  function composerHTML(c) {
    if (readOnly()) return '<div class="tc-ro">' + O.icon('lock') + esc(t('paused')) + '</div>';
    if (!O.can('team', 'edit')) return '<div class="tc-ro">' + O.icon('lock') + esc(t('viewOnly')) + '</div>';
    return '<form class="tc-compose" data-tc-form autocomplete="off"><label class="tc-ic" title="' + esc(t('attach')) + '" aria-label="' + esc(t('attach')) + '">' + O.icon('clip') +
      '<input type="file" data-tc-attach hidden accept="' + esc(TC.MIMES.join(',')) + '"></label>' +
      '<textarea rows="1" data-tc-text placeholder="' + esc(t('typeHere')) + '" aria-label="' + esc(t('typeHere')) + '" maxlength="' + TC.BODY_MAX + '">' + esc(U_STATE.drafts[c.id] || '') + '</textarea>' +
      '<button type="submit" class="tc-send" aria-label="' + esc(t('send')) + '" title="' + esc(t('send')) + '">' + O.icon('send') + '</button></form>';
  }

  /* ---------- pickers (new chat, add people) ---------- */
  function peopleRows(ids, multi, picked) {
    return ids.map(function (id) {
      var s = D.staffById(id), nm = s ? s.name : id;
      return multi ? '<label class="tc-person">' + U.avatar(nm) + '<span class="grow"><span class="nm">' + esc(nm) + '</span><span class="rl">' + esc(roleOf(id)) + '</span></span><input type="checkbox" value="' + esc(id) + '"' + (picked && picked.indexOf(id) >= 0 ? ' checked' : '') + '></label>'
        : '<button type="button" class="tc-person" data-pick="' + esc(id) + '">' + U.avatar(nm) + '<span class="grow"><span class="nm">' + esc(nm) + '</span><span class="rl">' + esc(roleOf(id)) + '</span></span></button>';
    }).join('');
  }
  function others() { return teamIds().filter(function (id) { return id !== me(); }).sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b)); }); }
  function newChatModal(go) {
    var ids = others(), mode = 'direct';
    if (!ids.length) { U.toast(t('nobody')); return; }
    var body = O.html('<div class="stack"><div data-seg>' + U.seg([['direct', t('newDirect')], ['group', t('newGroup')]], mode, 'data-mode') + '</div><div data-pane></div></div>');
    function paint() {
      O.$('[data-seg]', body).innerHTML = U.seg([['direct', t('newDirect')], ['group', t('newGroup')]], mode, 'data-mode');
      O.$('[data-pane]', body).innerHTML = mode === 'direct' ? '<div class="field"><label>' + esc(t('choosePerson')) + '</label><div class="tc-people">' + peopleRows(ids, false) + '</div></div>'
        : '<div class="field"><label for="tc-gname">' + esc(t('groupName')) + '</label><input class="input" id="tc-gname" maxlength="' + TC.NAME_MAX + '" placeholder="' + esc(t('groupNameHint')) + '"></div>' +
          '<div class="field"><label>' + esc(t('choosePeople')) + '</label><div class="tc-people">' + peopleRows(ids, true) + '</div></div>';
      var create = O.$$('.modal-foot button', body.closest('.modal') || document).filter(function (b) { return b.textContent === t('create'); })[0];
      if (create) create.hidden = mode !== 'group';
    }
    var close = function () {};
    U.modal({ title: t('newChat'), body: body, autofocus: false, onOpen: function (bk, cl) { close = cl; paint(); }, actions: [{ label: t('cancel') }, { label: t('create'), kind: 'primary', onClick: function (cl) {
      var name = TC.cleanName((O.$('#tc-gname', body) || {}).value), picked = O.$$('input[type=checkbox]:checked', body).map(function (x) { return x.value; });
      if (!name) { U.toast(t('needName'), 'bad'); return false; }
      if (!picked.length) { U.toast(t('needPeople'), 'bad'); return false; }
      if (picked.length + 1 > TC.GROUP_MAX) { U.toast(t('tooMany', { n: TC.GROUP_MAX }), 'bad'); return false; }
      TCX.open('group', name, picked).then(function (id) { cl(); U.toast(t('created')); go(id); }, function (e) { U.toast(errText(e, t('sendFailed')), 'bad'); });
      return false;
    } }] });
    body.addEventListener('click', function (e) {
      var m = e.target.closest('[data-mode]'); if (m) { mode = m.dataset.mode; paint(); return; }
      var p = e.target.closest('[data-pick]'); if (!p) return;
      p.disabled = true;
      TCX.open('direct', null, [p.dataset.pick]).then(function (id) { close(); go(id); }, function (e2) { p.disabled = false; U.toast(errText(e2, t('sendFailed')), 'bad'); });
    });
  }
  function detailsModal(c, after) {
    var body = O.html('<div class="tc-dets"></div>');
    function paint() {
      var cur = chatById(c.id) || c, ids = cur.kind === 'all' ? teamIds() : (cur.members || []).slice(), boss = cur.canManage && canWrite();
      ids.sort(function (a, b) { return (a === me() ? -1 : b === me() ? 1 : 0) || nameOf(a).localeCompare(nameOf(b)); });
      body.innerHTML = '<div class="row-flex" style="gap:12px">' + avatarOf(cur) + '<div class="grow" style="min-width:0"><div class="b">' + esc(title(cur)) + '</div><div class="small muted">' + esc(subOf(cur)) + '</div></div></div>' +
        '<div class="acts">' + (boss ? '<button type="button" class="btn btn-ghost btn-sm" data-d="rename">' + O.icon('edit') + esc(t('rename')) + '</button><button type="button" class="btn btn-ghost btn-sm" data-d="add">' + O.icon('plus') + esc(t('addPeople')) + '</button>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm" data-d="mute">' + (cur.muted ? BELL_OFF : O.icon('bell')) + esc(cur.muted ? t('unmute') : t('mute')) + '</button>' +
        (cur.kind === 'group' && canWrite() ? '<button type="button" class="btn btn-ghost btn-sm" data-d="leave" style="color:var(--bad)">' + esc(t('leave')) + '</button>' : '') + '</div>' +
        '<div class="section-title" style="margin:0">' + esc(t('members')) + ' · ' + ids.length + '</div><div class="tc-people">' + ids.map(function (id) {
          var nm = nameOf(id);
          return '<div class="tc-person">' + U.avatar(nm) + '<span class="grow"><span class="nm">' + esc(id === me() ? t('memberYou', { name: nm }) : nm) + '</span><span class="rl">' + esc(roleOf(id)) + (cur.kind === 'group' && cur.createdBy === id ? ' · ' + esc(t('maker')) : '') + '</span></span>' +
            (boss && id !== me() ? '<button type="button" class="btn btn-ghost btn-sm" data-rm="' + esc(id) + '">' + esc(t('removePerson')) + '</button>' : '') + '</div>';
        }).join('') + '</div>';
    }
    paint();
    var unsub = TCX.onChange(function () { if (document.body.contains(body)) paint(); }), close = function () {};
    U.modal({ title: t('details'), body: body, autofocus: false, onOpen: function (bk, cl) { close = cl; }, onClose: unsub, actions: [{ label: t('done'), kind: 'primary' }] });
    function fail(e) { U.toast(errText(e, t('sendFailed')), 'bad'); }
    body.addEventListener('click', function (e) {
      var cur = chatById(c.id) || c, b = e.target.closest('[data-d], [data-rm]'); if (!b) return;
      if (b.dataset.rm) { var who = b.dataset.rm; U.confirm(t('removeQ', { name: nameOf(who) }), t('removePerson'), 'danger').then(function (ok) { if (ok) TCX.manage(cur.id, { remove: [who] }).then(function () { U.toast(t('removed')); }, fail); }); return; }
      var a = b.dataset.d;
      if (a === 'mute') TCX.setMuted(cur.id, !cur.muted).then(function () { U.toast(cur.muted ? t('mutedToast') : t('unmutedToast')); paint(); }, fail);
      else if (a === 'leave') U.confirm(t('leaveQ'), t('leave'), 'danger').then(function (ok) { if (!ok) return; TCX.manage(cur.id, { remove: [me()] }).then(function () { U.toast(t('left')); close(); after('left'); }, fail); });
      else if (a === 'rename') {
        var f = O.html('<div class="field"><label for="tc-rn">' + esc(t('groupName')) + '</label><input class="input" id="tc-rn" maxlength="' + TC.NAME_MAX + '" value="' + esc(cur.name) + '"></div>');
        U.modal({ title: t('rename'), body: f, size: 'sm', actions: [{ label: t('cancel') }, { label: t('save'), kind: 'primary', onClick: function (cl) {
          var n = TC.cleanName(O.$('#tc-rn', f).value); if (!n) { U.toast(t('needName'), 'bad'); return false; }
          TCX.manage(cur.id, { name: n }).then(function () { cl(); U.toast(t('renamed')); }, fail); return false;
        } }] });
      } else if (a === 'add') {
        var ids = others().filter(function (id) { return (cur.members || []).indexOf(id) < 0; });
        if (!ids.length) { U.toast(t('nobody')); return; }
        var pk = O.html('<div class="tc-people">' + peopleRows(ids, true) + '</div>');
        U.modal({ title: t('addPeople'), body: pk, actions: [{ label: t('cancel') }, { label: t('addPeople'), kind: 'primary', onClick: function (cl) {
          var picked = O.$$('input:checked', pk).map(function (x) { return x.value; }); if (!picked.length) { U.toast(t('needPeople'), 'bad'); return false; }
          TCX.manage(cur.id, { add: picked }).then(function () { cl(); U.toast(t('added')); }, fail); return false;
        } }] });
      }
    });
  }
  TCX.onChange = function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; };

  /* ---------- render ---------- */
  O.page('team', {
    desc: t('desc'),
    noDataRerender: true,
    render: function (root, ctx) {
      check();
      var pr = ctx.params || {};
      if (ctx.fresh && pr.chatId) { U_STATE.openId = pr.chatId; U_STATE.view = 'chat'; }
      else if (ctx.fresh) U_STATE.view = isPhone() ? 'list' : U_STATE.view;
      if (!live()) loadLocal();   /* the local copy: this viewer's chats, synchronously */
      if (U_STATE.openId && S.loaded && !chatById(U_STATE.openId)) U_STATE.openId = null;
      if (!U_STATE.openId && !isPhone() && S.chats.length) U_STATE.openId = S.chats[0].id;
      root.innerHTML = '<div class="pg-team"><div class="tc' + (U_STATE.view === 'chat' && U_STATE.openId ? ' show-chat' : '') + '"><section class="tc-list" aria-label="' + esc(t('title')) + '">' + listHTML() + '</section><section class="tc-chat" aria-label="' + esc(t('title')) + '"></section></div></div>';
      var page = O.$('.pg-team', root), box = O.$('.tc', page), listEl = O.$('.tc-list', page), chatEl = O.$('.tc-chat', page), shownFor = null;
      function fit() {
        if (!document.body.contains(box)) return;
        if (!isPhone()) { box.style.height = ''; return; }
        var tb = O.$('.tabbar'), tbh = tb && getComputedStyle(tb).display !== 'none' ? tb.getBoundingClientRect().height : 0;
        box.style.height = Math.max(320, Math.round(window.innerHeight - (box.getBoundingClientRect().top + window.scrollY) - tbh)) + 'px';
      }
      fit(); window.addEventListener('resize', fit); ctx.onLeave(function () { window.removeEventListener('resize', fit); });

      function paintRows() { var r = O.$('.tc-rows', listEl); if (r) r.innerHTML = rowsHTML(); }
      function paintList() { listEl.innerHTML = listHTML(); wireSearch(); }
      function nearBottom(th) { return th.scrollHeight - th.scrollTop - th.clientHeight < 140; }
      function paintThread(force) {
        var c = chatById(U_STATE.openId), th = O.$('.tc-thread', chatEl); if (!c || !th) return;
        var stick = force || nearBottom(th), msgs = TCX.messages(c.id);
        th.innerHTML = threadHTML(c, msgs);
        loadImages(th, msgs);
        if (stick) th.scrollTop = th.scrollHeight;
      }
      function paintChat() {
        var c = chatById(U_STATE.openId);
        box.classList.toggle('show-chat', U_STATE.view === 'chat' && !!c);
        if (!c) {
          shownFor = null;
          chatEl.innerHTML = '<div class="tc-none"><span class="art">' + ICON_ALL + '</span><h3>' + esc(t('pickChat')) + '</h3><div>' + esc(t('pickChatSub')) + '</div></div>';
          return;
        }
        shownFor = c.id;
        chatEl.innerHTML = headHTML(c) + '<div class="tc-thread" role="log" aria-live="polite" aria-label="' + esc(title(c)) + '"></div>' + composerHTML(c);
        wireComposer(c);
        paintThread(true);
        var have = TCX.messages(c.id);
        if (!have || live()) TCX.loadMessages(c.id).then(function () { if (shownFor === c.id) paintThread(!have); }, function (e) { var th = O.$('.tc-thread', chatEl); if (th && shownFor === c.id && !have) th.innerHTML = '<div class="tc-hello">' + esc(errText(e)) + '</div>'; });
        if (c.unread && !document.hidden) TCX.markRead(c.id).catch(function () {});
      }
      function loadImages(th, msgs) {
        (msgs || []).forEach(function (m) {
          if (!m.file || m.file.data || TC.fileKind(m.file.mime) !== 'image' || !m.file.path) return;
          var img = O.$('img[data-tc-src="' + (window.CSS && CSS.escape ? CSS.escape(m.id) : m.id) + '"]', th); if (!img) return;
          TCX.fileUrl(m.file).then(function (u) { if (u) { img.src = u; img.onload = function () { if (nearBottom(th)) th.scrollTop = th.scrollHeight; }; } });
        });
      }
      function openChat(id) {
        U_STATE.openId = id; U_STATE.view = 'chat';
        O.$$('.tc-row', listEl).forEach(function (r) { r.classList.toggle('on', r.dataset.chat === id); });
        paintChat();
        var ta = O.$('[data-tc-text]', chatEl); if (ta && !isPhone()) ta.focus();
      }
      function wireSearch() {
        var q = O.$('[data-tc-q]', listEl); if (!q) return;
        q.oninput = function () { U_STATE.q = q.value; paintRows(); };
      }
      function wireComposer(c) {
        var form = O.$('[data-tc-form]', chatEl); if (!form) return;
        var ta = O.$('[data-tc-text]', form), file = O.$('[data-tc-attach]', form), sendBtn = O.$('.tc-send', form);
        function grow() { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight + 2) + 'px'; }
        grow();
        ta.addEventListener('input', function () { U_STATE.drafts[c.id] = ta.value; grow(); });
        ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isPhone()) { e.preventDefault(); submit(); } });
        form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
        file.addEventListener('change', function () {
          var f = file.files && file.files[0]; file.value = ''; if (!f) return;
          var text = ta.value; sendBtn.disabled = true;
          TCX.send(c.id, text, f).then(function () { if (text) { ta.value = ''; U_STATE.drafts[c.id] = ''; grow(); } }, function (e) { U.toast(errText(e, t('sendFailed')), 'bad'); }).then(function () { sendBtn.disabled = false; });
        });
        function submit() {
          var text = ta.value; if (!TC.cleanBody(text)) return;
          ta.value = ''; U_STATE.drafts[c.id] = ''; grow();
          TCX.send(c.id, text).then(function () { paintThread(true); }, function (e) { if (!ta.value) { ta.value = text; U_STATE.drafts[c.id] = text; grow(); } U.toast(errText(e, t('sendFailed')), 'bad'); });
          ta.focus();
        }
      }
      function msgOf(id) { return (TCX.messages(U_STATE.openId) || []).filter(function (m) { return m.id === id; })[0]; }

      /* clicks */
      page.addEventListener('click', function (e) {
        var row = e.target.closest('[data-chat]'); if (row) { openChat(row.dataset.chat); return; }
        var img = e.target.closest('[data-tc-img]');
        if (img) { var mi = msgOf(img.dataset.tcImg), src = O.$('img', img).src; if (mi && src) U.modal({ title: mi.file.name || t('photo'), body: '<div class="tc-lightbox"><img alt="" src="' + esc(src) + '"></div>', actions: [{ label: t('done'), kind: 'primary' }] }); return; }
        var fb = e.target.closest('[data-tc-file]');
        if (fb) {
          var mf = msgOf(fb.dataset.tcFile); if (!mf) return;
          var w = null; if (!mf.file.data) { try { w = window.open('', '_blank'); if (w) w.opener = null; } catch (x) { w = null; } }
          TCX.fileUrl(mf.file).then(function (u) {
            if (!u) { if (w) w.close(); U.toast(t('noAccess'), 'bad'); return; }
            if (mf.file.data) { var a = document.createElement('a'); a.href = u; a.download = mf.file.name || 'file'; document.body.appendChild(a); a.click(); a.remove(); }
            else if (w) w.location.href = u; else location.assign(u);
          });
          return;
        }
        var b = e.target.closest('[data-tc]'); if (!b) return;
        var act = b.dataset.tc, c = chatById(U_STATE.openId);
        if (act === 'new') newChatModal(function (id) { paintList(); openChat(id); });
        else if (act === 'retry') TCX.load(true).catch(function () {});
        else if (act === 'back') { U_STATE.view = 'list'; box.classList.remove('show-chat'); paintRows(); }
        else if (act === 'mute' && c) TCX.setMuted(c.id, !c.muted).then(function () { U.toast(c.muted ? t('mutedToast') : t('unmutedToast')); }, function (x) { U.toast(errText(x, t('sendFailed')), 'bad'); });
        else if (act === 'details' && c) detailsModal(c, function () { U_STATE.openId = null; U_STATE.view = 'list'; paintList(); paintChat(); });
      });

      /* live changes while the page is open */
      ctx.onLeave(TCX.onChange(function (w) {
        if (!document.body.contains(page)) return;
        if (w.thread && w.thread === U_STATE.openId && !w.list) { paintThread(false); return; }
        if (U_STATE.openId && S.loaded && !chatById(U_STATE.openId)) { U_STATE.openId = null; U_STATE.view = 'list'; paintList(); paintChat(); return; }
        var q = O.$('[data-tc-q]', listEl), typing = q && document.activeElement === q;
        if (typing) paintRows(); else paintList();
        var c = chatById(U_STATE.openId);
        if (c && shownFor === c.id) { var h = O.$('.tc-head', chatEl); if (h) h.outerHTML = headHTML(c); paintThread(false); }
        else paintChat();
      }));
      ctx.on('tick', function () { if (!live()) return; paintRows(); });
      function onVis() { if (!document.hidden && U_STATE.openId) { var c = chatById(U_STATE.openId); if (c && c.unread) TCX.markRead(c.id).catch(function () {}); } }
      document.addEventListener('visibilitychange', onVis); ctx.onLeave(function () { document.removeEventListener('visibilitychange', onVis); });

      wireSearch();
      paintChat();
      if (live() && (!S.loaded || ctx.fresh)) TCX.load(ctx.fresh).catch(function () {});
    }
  });
})();
