/* English strings the code builds at run time, which scripts/i18n-extract.mjs cannot see as one literal: month and day
   names (app/data.js), numbers as {n} ("{n} overdue"), and sentences with a name or a date in them ({x}). Every string
   here needs a translation in app/i18n/{bn,ms,zh}.js. Not loaded by the app (scripts/build.mjs leaves it out). */
O.I18N_SRC = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
  'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',
  '{n}m ago', '{n}h ago', '{n}d ago', 'yesterday', 'today', 'tomorrow',
  'Good morning', 'Good afternoon', 'Good evening', 'morning', 'afternoon', 'evening',
  /* the parts of a greeting (api/_lib/shared/greeting.cjs BUILTINS, which also holds guest wording and is not scanned) */
  'Guest first name', 'Guest full name', 'Building', 'Unit number', 'Door code', 'Check-in date', 'Check-in time', 'Check-out date',
  'Check-out time', 'Nights', 'Guests', 'Wi-Fi name', 'Wi-Fi password', 'Parking', 'Guest app link', 'Inserts {x}',
  /* short words the code joins to a value ("Airbnb" + " fee", "▲ 3.2" + " pts", "Sort by" + " platform") */
  'and', 'fee', 'noon', 'hidden', 'platform', 'status', 'Last', 'since', 'oldest', 'incl. tax', 'autopay', 'optional', '{n} pts', 'due {x}',
  'Source', 'distance', 'rating', 'avg price', 'months', 'runs', 'statements', 'arriving {x}', 'workspace',
  /* words and labels the code passes to O.tr or O.tpl as a value ("Pace: (ahead)", "in progress 2/5") */
  'done', 'not started', 'unassigned', 'previous', 'before that', 'no change', 'level', 'day', 'week', 'month', 'this unit',
  'house rules', 'ID check', 'nobody yet', 'a team member', 'the owner', 'other', 'A unit',
  /* attribute values inside a code-like literal ('data-act="x" title="…"'), which the scan reads as code */
  'Download the stock list', '4 to 8 digits', 'No limit', 'For example: Arrival', 'or drop it here. The colours update straight away.',
  '"Direct" booking badge',
  /* examples in fields that hold a number or a code */
  'e.g. 21-1', 'e.g. 1', 'e.g. 2', 'e.g. 4', 'e.g. stay@example.com',
  /* O.fmt.dur: "1h 45m" */
  '{h}h {m}m', '{h}h', '{m}m',
  /* fmt.plural in the read-aloud brief */
  '{n} other guest',
  /* the booking channel of the operator's own bookings (a label, unlike the booking sites' names) */
  'Direct',
  "Size not noted",
  "add your own items and sizes in Settings.",
  "Add the items you keep in Settings first.",
  "Size",
  "All sizes",
  "pick from the list",
  "staff type the size",
  "pick or type",
  "No sizes listed",
  "Items and sizes",
  "{n} items. Add your own, set the sizes staff choose from, edit or remove any item.",
  "No sizes",
  "Pick or type",
  "Pick only",
  "Type only",
  "Sizes",
  "Add a size, for example 500ml or 1L",
  "Quick add:",
  "Stock is one figure for this item.",
  "Staff pick one of these sizes when they record stock. Stock is kept for each size.",
  "Staff type the size when they record stock (the sizes below are suggested). Stock is kept for each size.",
  "Staff pick a size from the list, or choose Other and type one. Stock is kept for each size.",
  "Remove {x}",
  "No sizes yet.",
  "Add at least one size, or let staff type the size.",
  "Remove {x} from your items? It has no stock records, so nothing else changes.",
  "{x} removed",
  "Reorder levels are set for each item above.",
  "Size of {x}",
  "Size…",
  "Other…",
  "Type the size",
  "Another size",
  "Choose the size",
  "Add it in Settings.",
  "Add them in Settings.",
  "Choose or type the size of {x}."
];
