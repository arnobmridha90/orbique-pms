/* Alert tunes (Arnob: "options for at least 10 tunes for each notification type ... choose them from one of the
   sections"). Shared by the app (O.tones: O.alertSound plays them, Automations > Booking alerts picks them) and the
   server (api/_lib/alerts.js: the phone notification's sound and Android channel).

   TUNES: every tune any alert type can use. file is the sound's name in public/sounds/, Android res/raw/ and the iPhone
   app (scripts/alert-sound.py makes them; keep notes in step with it, they are played by the browser when the file
   cannot be loaded). TYPES: the alert types and their default tune. A choice is {type: tune id}; pick() fills the
   defaults and drops anything unknown.

   Android channels keep their sound for good, so each (type, tune) pair has its own channel: the default tune keeps the
   type's first channel (alerts_loud, alerts_change, team_tone, alerts_message, alerts_task); any other tune uses channelId(type, tune). */
'use strict';

var BELL = [[1, 1, 0.42], [2, 0.38, 0.2], [3, 0.16, 0.1]];
var SHORT = [[1, 1, 0.22], [2, 0.3, 0.1]];
var WOOD = [[1, 1, 0.16], [4, 0.3, 0.03]];
var BLOOP = [[1, 1, 0.12], [2, 0.12, 0.06]];
var PLUCK = [[1, 1, 0.3], [2, 0.45, 0.12], [3, 0.2, 0.06]];
var BEEP = [[1, 1, 0.06], [3, 0.15, 0.03]];
var GLASS = [[1, 1, 0.6], [2.76, 0.3, 0.25]];
var PAD = [[1, 1, 0.55], [2, 0.2, 0.3]];

/* id -> {name, file, notes: [[start s, Hz, loudness, partials, glide to Hz]]} */
var TUNES = {
  chime: { name: 'Chime', file: 'orbique_alert', notes: [[0, 783.99, 0.8, BELL], [0.14, 1046.5, 0.9, BELL], [0.28, 1318.51, 1, BELL]] },
  falling: { name: 'Falling bells', file: 'orbique_change', notes: [[0, 1318.51, 1, BELL], [0.2, 987.77, 0.95, BELL]] },
  dingding: { name: 'Ding ding', file: 'orbique_message', notes: [[0, 1567.98, 0.9, SHORT], [0.16, 1567.98, 1, SHORT]] },
  bloop: { name: 'Bloop', file: 'orbique_team', notes: [[0, 520, 1, BLOOP, 880]] },
  marimba: { name: 'Marimba', file: 'orbique_task', notes: [[0, 440, 0.9, WOOD], [0.15, 659.25, 1, WOOD]] },
  sparkle: { name: 'Sparkle', file: 'orbique_sparkle', notes: [[0, 2093, 0.8, SHORT], [0.07, 1760, 0.8, SHORT], [0.14, 1567.98, 0.85, SHORT], [0.21, 1318.51, 1, SHORT]] },
  doorbell: { name: 'Doorbell', file: 'orbique_doorbell', notes: [[0, 659.25, 1, BELL], [0.42, 523.25, 1, BELL]] },
  harp: { name: 'Harp', file: 'orbique_harp', notes: [[0, 523.25, 0.7, PLUCK], [0.06, 659.25, 0.75, PLUCK], [0.12, 783.99, 0.8, PLUCK], [0.18, 1046.5, 0.9, PLUCK], [0.24, 1318.51, 1, PLUCK]] },
  beeps: { name: 'Three beeps', file: 'orbique_beep', notes: [[0, 1760, 1, BEEP], [0.18, 1760, 1, BEEP], [0.36, 1760, 1, BEEP]] },
  glass: { name: 'Glass', file: 'orbique_glass', notes: [[0, 1174.66, 1, GLASS], [0.25, 1567.98, 0.9, GLASS]] },
  pad: { name: 'Soft chord', file: 'orbique_pad', notes: [[0, 523.25, 0.8, PAD], [0, 783.99, 0.6, PAD], [0.3, 659.25, 0.8, PAD]] },
  urgent: { name: 'Urgent', file: 'orbique_urgent', notes: [[0, 880, 1, SHORT], [0.15, 1318.51, 1, SHORT], [0.3, 880, 1, SHORT], [0.45, 1318.51, 1, SHORT]] }
};
var ORDER = Object.keys(TUNES);

/* type -> {name, tune: the default, channel: the type's first Android channel (message and task: from the bell's phone
   notifications, api/_lib/notify-push.js)} */
var TYPES = {
  booking: { name: 'New booking', tune: 'chime', channel: 'alerts_loud' },
  change: { name: 'Cancellation or new dates', tune: 'falling', channel: 'alerts_change' },
  message: { name: 'Guest message', tune: 'dingding', channel: 'alerts_message' },
  team: { name: 'Team chat', tune: 'bloop', channel: 'team_tone' },
  task: { name: 'New task for you', tune: 'marimba', channel: 'alerts_task' }
};
var TYPE_ORDER = Object.keys(TYPES);

/* {type: tune} with every type, defaults filled in and unknown values dropped */
function pick(choice) {
  var c = choice && typeof choice === 'object' ? choice : {}, out = {};
  TYPE_ORDER.forEach(function (t) { out[t] = typeof c[t] === 'string' && TUNES[c[t]] ? c[t] : TYPES[t].tune; });
  return out;
}
/* the tune for one type under a choice */
function tuneFor(type, choice) { return TYPES[type] ? pick(choice)[type] : 'chime'; }
/* the Android channel for a type with this tune: the type's first channel for its default tune */
function channelId(type, tune) {
  var t = TYPES[type]; if (!t) return 'alerts_loud';
  if (!TUNES[tune] || tune === t.tune) return t.channel || 'alerts_loud';
  return 'tone_' + type + '_' + tune;
}
/* the sound file name (no extension) for a type under a choice */
function fileFor(type, choice) { return TUNES[tuneFor(type, choice)].file; }
/* only the choices that differ from the defaults, for saving */
function changes(choice) {
  var p = pick(choice), out = {};
  TYPE_ORDER.forEach(function (t) { if (p[t] !== TYPES[t].tune) out[t] = p[t]; });
  return out;
}

module.exports = { TUNES: TUNES, ORDER: ORDER, TYPES: TYPES, TYPE_ORDER: TYPE_ORDER, pick: pick, tuneFor: tuneFor, channelId: channelId, fileFor: fileFor, changes: changes };
