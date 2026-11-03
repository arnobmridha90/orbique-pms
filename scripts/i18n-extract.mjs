#!/usr/bin/env node
/* Finds the English UI text in the app and checks that every language has it (app/i18n/).
 *
 *   node scripts/i18n-extract.mjs            -> report: how many strings, what is missing in each language (exit 0)
 *   node scripts/i18n-extract.mjs --check    -> the CI guard: exit 1 when a UI string has no translation in bn, ms or zh,
 *                                               when a translation lost a {placeholder}, or when a catalog is malformed
 *   node scripts/i18n-extract.mjs --missing out.json   -> write the untranslated strings to out.json (for translators)
 *
 * What counts as UI text: string literals in app/core.js, app/data.js (labels only), app/pages/*.js, app/server/*.js,
 * the shell and the shared api/_lib/shared/*.cjs modules that read as English words for a person (a capital letter and a
 * word, or several words). HTML inside a literal is split into its text and its placeholder / title / aria-label / alt
 * values. A literal is covered when it is a catalog key, or a piece of one ("Due in " is covered by "Due in {n} days"),
 * or is listed in app/i18n/ignore.js (not UI text: code, data, brand names).
 *
 * The catalogs: app/i18n/en.js lists every English source string (O.I18N_SRC), and app/i18n/{bn,ms,zh}.js map each
 * one to its translation (O.I18N.bn = {...}). Placeholders: {n} is a number, any other {name} is text the app fills in.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const LANGS = ['bn', 'ms', 'zh'];

/* the files whose literals are scanned (places-data.js is a list of real places; guestapp.js is the guest's own app,
   which keeps its own wording; the native bridge has no screens) */
const SKIP = new Set(['app/pages/places-data.js', 'app/data.js']);
export function sourceFiles() {
  const out = [];
  const add = (d, ext) => { const p = path.join(ROOT, d); if (!fs.existsSync(p)) return; for (const f of fs.readdirSync(p).sort()) if (f.endsWith(ext)) out.push(path.join(d, f)); };
  out.push('app/core.js');
  add('app/pages', '.js'); add('app/server', '.js');
  out.push('api/_lib/shared/teamchat.cjs', 'api/_lib/shared/taskwho.cjs', 'api/_lib/shared/unitreq.cjs', 'api/_lib/shared/beds.cjs', 'api/_lib/shared/unitdue.cjs', 'api/_lib/shared/rateplan.cjs');
  return out.filter((f) => !SKIP.has(f) && fs.existsSync(path.join(ROOT, f)));
}

/* code between  i18n:off  and  i18n:on  comments is left out (blanked, so line numbers stay right) */
export const withoutOff = (code) => code.replace(/\/\*\s*i18n:off[\s\S]*?(?:\/\*\s*i18n:on\s*\*\/|$)/g, (m) => m.replace(/[^\n]/g, ' '));

/* ---------------- a small JavaScript lexer: string literals and template pieces ---------------- */
export function literals(src) {
  const out = []; let i = 0; const n = src.length; let prevSig = ''; /* last significant char, for regex detection */
  const kwBefore = /(?:return|typeof|case|in|of|delete|void|throw|new|else|do)$/;
  function readString(q) { let s = ''; i++; while (i < n && src[i] !== q) { if (src[i] === '\\') { s += esc(); continue; } if (src[i] === '\n') break; s += src[i++]; } i++; return s; }
  function esc() {
    i++; const c = src[i++];
    if (c === 'n') return '\n'; if (c === 't') return '\t'; if (c === 'r') return '';
    if (c === 'u') { if (src[i] === '{') { const e = src.indexOf('}', i); const h = src.slice(i + 1, e); i = e + 1; return String.fromCodePoint(parseInt(h, 16)); } const h = src.slice(i, i + 4); i += 4; return String.fromCharCode(parseInt(h, 16)); }
    if (c === 'x') { const h = src.slice(i, i + 2); i += 2; return String.fromCharCode(parseInt(h, 16)); }
    if (c === '\n') return '';
    return c;
  }
  function readTemplate() { /* returns the literal pieces of a template; ${...} becomes {x} */
    i++; let s = '';
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { s += esc(); continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; let depth = 1; while (i < n && depth) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; else if (src[i] === "'" || src[i] === '"') { const q = src[i]; readString(q); continue; } else if (src[i] === '`') { readTemplate(); continue; } if (depth) i++; } i++; s += '{x}'; continue; }
      s += src[i++];
    }
    i++; return s;
  }
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'" || c === '"') { const at = i, line = src.slice(0, i).split('\n').length; out.push({ s: readString(c), line, at, end: i }); prevSig = 'a'; continue; }
    if (c === '`') { const at = i, line = src.slice(0, i).split('\n').length; out.push({ s: readTemplate(), line, at, end: i }); prevSig = 'a'; continue; }
    if (c === '/') {
      const before = src.slice(Math.max(0, i - 12), i).trimEnd();
      if (!prevSig || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prevSig) || kwBefore.test(before)) { /* a regex literal */
        i++; let cls = false; while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; else if (src[i] === '/' && !cls) break; else if (src[i] === '\n') break; i++; }
        i++; while (/[a-z]/.test(src[i] || '')) i++; prevSig = 'a'; continue;
      }
    }
    if (!/\s/.test(c)) prevSig = /[\w$)\]]/.test(c) ? (prevSig = 'a') : c;
    if (/[\w$]/.test(c)) { let j = i; while (j < n && /[\w$]/.test(src[j])) j++; const w = src.slice(i, j); i = j; prevSig = kwBefore.test(w) ? '(' : 'a'; continue; }
    i++;
  }
  return out;
}

/* sentences joined at run time: 'No single ' + t.name + ' unit is free.' -> "No single {x} unit is free." (the app matches
   {x} to any text, so the whole sentence is translated in one go, with the name kept as it is) */
function simpleExpr(e) {
  if (!e || /['"`;{}\n]/.test(e)) return false;
  let depth = 0;
  for (let k = 0; k < e.length; k++) {
    const ch = e[k];
    if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') { if (--depth < 0) return false; }
    else if (!depth && /[?:,]/.test(ch)) return false;
    else if (!depth && (e.startsWith('||', k) || e.startsWith('&&', k) || (ch === '=' && e[k + 1] !== '=' && e[k - 1] !== '=' && e[k - 1] !== '!'))) return false;
  }
  return depth === 0;
}
const plainLit = (x) => !/[<>]|=["']/.test(x.s) && !/\{x\}/.test(x.s);
/* the text a literal with markup leaves open at its end ('<b>Due ' -> 'Due ', 'title="Booked (' -> 'Booked (') or at its
   start ('</b> is created.' -> ' is created.', ' on or off" data-x=' -> ' on or off'); null when it has none */
function tailOf(s) {
  if (/\{x\}/.test(s)) return null;
  const at = s.match(/\b(?:placeholder|title|aria-label|alt|data-tip)\s*=\s*"([^"<>]*)$/);
  if (at) return decode(at[1]);
  if (!/[<>]/.test(s)) return null;
  const rest = s.slice(s.lastIndexOf('>') + 1);
  return /[<"=]/.test(rest) ? null : decode(rest);
}
function headOf(s) {
  if (/\{x\}/.test(s)) return null;
  const at = s.match(/^([^<>"=]*)"\s*(?:[a-z-]+=|>|\/>|$)/);
  if (at) return decode(at[1]);
  if (!/</.test(s)) return null;
  const rest = s.slice(0, s.indexOf('<'));
  return /[>"=]/.test(rest) ? null : decode(rest);
}
export function chains(code, lits) {
  const out = [];
  for (let a = 0; a < lits.length; a++) {
    const plain = plainLit(lits[a]);
    const start = plain ? lits[a].s : tailOf(lits[a].s);
    if (start == null) continue;
    const inAttr = !plain && /=\s*"[^"<>]*$/.test(lits[a].s);
    const parts = [start]; let b = a, closed = false;
    while (b + 1 < lits.length) {
      const gap = code.slice(lits[b].end, lits[b + 1].at).match(/^\s*\+\s*([\s\S]*?)\s*\+\s*$/);
      if (!gap || !simpleExpr(gap[1])) break;
      if (inAttr && /"/.test(lits[b + 1].s)) { parts.push(decode(lits[b + 1].s.slice(0, lits[b + 1].s.indexOf('"')))); b++; closed = true; break; } /* the attribute value ends here */
      if (plainLit(lits[b + 1])) { parts.push(lits[b + 1].s); b++; continue; }
      const h = headOf(lits[b + 1].s);
      if (h != null) { parts.push(h); b++; closed = true; }
      break;
    }
    if (!plain && parts.length < 2) continue;
    const pre = plain && /[\w$\])]\s*\+\s*$/.test(code.slice(Math.max(0, lits[a].at - 60), lits[a].at)) && !/[+\-*/%]=\s*[\s\S]*$/.test(code.slice(Math.max(0, lits[a].at - 3), lits[a].at)) && !/\+\s*$/.test(code.slice(lits[a].at - 1, lits[a].at)) ? /(?:^|[^'"`\w$])([\w$.]+(?:\([^()'"`]*\))?)\s*\+\s*$/.exec(code.slice(Math.max(0, lits[a].at - 60), lits[a].at)) : null;
    const post = !closed && /^\s*\+\s*[\w$(]/.test(code.slice(lits[b].end, lits[b].end + 40)) && !/^\s*\+\s*[\w$.()]+\s*\+\s*['"`]/.test(code.slice(lits[b].end, lits[b].end + 80));
    if (parts.length < 2 && !pre && !post) continue;
    if (closed) b--; /* the literal that closed the chain can open the next one */
    let k = (pre ? '{x}' : '') + parts.join('{x}') + (post ? '{x}' : '');
    k = k.replace(/^\s*\{x\}\s*$/, '');
    k = k.replace(/\s+/g, ' ').trim();
    if (k.replace(/\{x\}/g, '').replace(/[^A-Za-z]/g, '').length < 6 || !/[A-Za-z]{2,} [A-Za-z]{2,}|[A-Za-z]{3,}.*\{x\}.*[A-Za-z]{3,}/.test(k.replace(/\{x\}/g, ' {x} '))) continue;
    if (/^\{x\}[\s\S]*\{x\}$/.test(k) && parts.length === 1 && parts[0].trim().split(/\s+/).length < 2) continue;
    if (!isUI(k.replace(/\{x\}/g, 'X'))) continue;
    out.push({ k, line: lits[a].line });
    a = b;
  }
  return out;
}

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&middot;': '·', '&times;': '×', '&rarr;': '→', '&larr;': '←', '&hellip;': '…', '&mdash;': '—', '&ndash;': '–', '&rsquo;': '’', '&lsquo;': '‘', '&bull;': '•' };
export const decode = (s) => s.replace(/&[a-z#0-9]+;/gi, (m) => ENT[m] || m);
const ATTRS = /\b(?:placeholder|title|aria-label|alt|data-tip|data-empty|data-label)\s*=\s*(["'])(.*?)\1/g;

/* split one literal into the UI pieces it carries */
export function pieces(lit) {
  const s = lit;
  const parts = [];
  if (/[{;]\s*[a-z-]+\s*:\s*[^;]+;/.test(s) && /[{}]/.test(s)) return parts; /* a stylesheet (O.css) */
  /* an attribute value cut by concatenation: '... title="' + x  or  'placeholder="Search ' + ... */
  const open = s.match(/\b(?:placeholder|title|aria-label|alt)\s*=\s*"([^"]*)$/);
  if (open) parts.push(decode(open[1]));
  if (/<\/?[a-z][^>]*>|^[^<]*>|<[a-z][^>]*$/i.test(s)) {
    for (const m of s.matchAll(ATTRS)) parts.push(decode(m[2]));
    /* attribute values cut by concatenation: title="' + x + '" -> the text before or after */
    const t = s.replace(/<[^>]*>/g, '\u0000').replace(/^[^<>]*>/, '\u0000').replace(/<[a-z][^>]*$/i, '\u0000');
    for (const x of t.split('\u0000')) parts.push(decode(x));
    const head = s.match(/^([^<>"]*)"\s*(?:[a-z-]+=|>|\/>)/); /* '...text" class=...' (end of an attribute value) */
    if (head) parts.push(decode(head[1]));
  } else { const head = s.match(/^([^<>"]*)"\s*(?:[a-z-]+=|>|\/>)/); parts.push(head ? decode(head[1]) : s); }
  return parts.map((p) => p.replace(/\s+/g, ' ')).filter((p) => !/[a-z-]+=["']|^\s*["']|["']\s*$/.test(p) || /^"[^"=]+"$/.test(p.trim())).map(clean).filter((p) => isUI(p) || joined(p));
}
/* the words of a piece, without the punctuation that joins it to the text around it: ", arrives " -> "arrives" */
export function clean(p) { return p.replace(/^[\s,;·•—–|+-]+(?=[A-Za-z(])/, '').replace(/(?<=[A-Za-z0-9.)?!…%])[\s,;·•—–|(+-]+$/, '').trim(); }
/* a lower-case word on its own is an id or a class, unless the literal joined it to other text: ' due ', ', arrives ' */
function joined(p) { return false; }
export function pieceWords(lit) {
  /* lower-case words that a literal joins into a sentence: ' due ', ', arrives ', ' nights' (but not ' active', 'btn ') */
  const out = [];
  if (/<|>|=/.test(lit)) return out;
  const m = lit.match(/^(\s+|[\s,;·(—–]*[,;·(—–][\s]*)([a-z][a-z' ]*[a-z])(\s+|[\s,;.:·)—–]+)$/);
  if (m && (/[,;·(—–]/.test(m[1] + m[3]) || (/^\s+$/.test(m[1]) && /^\s+$/.test(m[3])))) out.push(m[2]);
  return out;
}

const CODEY = /^(?:[a-z]+[A-Z]\w*|[a-z0-9]+(?:[-_.:/][a-z0-9]+)+|[A-Z_0-9]+|https?:.*|www\..*|mailto:.*|tel:.*|data:.*|#.*|\..*|\[.*|.*[{};].*;.*|[\w-]+\s*:\s*[^ ].*;?|.*\$\{.*|M[\d .,-]+.*|.*\.(?:js|css|png|jpe?g|svg|webp|json|html|pdf|csv|wav|mp3)(?:\?.*)?)$/;
export function isUI(p) {
  if (!p || p.length < 2) return false;
  if (!/[A-Za-z]{2,}/.test(p)) return false;
  if (/^--?[a-z]/.test(p) && !/ /.test(p)) return false; /* CSS variables, flags */
  if (/^&|^[\w-]+:$|\d+px\b|^[\w-]+\(|^input:|:not\(/.test(p)) return false; /* entities, "key:", CSS, selectors */
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(p) || /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.test(p)) return false; /* emails, domains */
  if (/^(?:[A-Z]{1,5}-?\d+[\w-]*|\d+[\w-]*)$/.test(p)) return false; /* codes: OM-1, DEMO-1101 */
  if (CODEY.test(p) && !/ /.test(p)) return false;
  if (/^[a-z][\w-]*$/.test(p)) return false; /* one lower-case word: an id, a class or a key */
  if (/^(?:[a-z][\w-]*\s+)+[a-z][\w-]*$/.test(p) && /-/.test(p)) return false; /* "btn btn-sm": classes */
  if (/^[\w-]+(?:\s+[\w-]+)*\s*\{/.test(p) || /[{;]\s*[a-z-]+\s*:/.test(p)) return false; /* CSS */
  if (/^[.#]?[a-z][\w-]*(?:[ >,.#:[][\w\-=".'\]()# >,.:*]*)$/.test(p) && /[.#[>]/.test(p.replace(/\.$/, '')) && !/^[a-z]+(?: [a-z]+){2,}[.]?$/.test(p)) return false; /* selectors (not a sentence such as "is created when you save.") */
  if (/^\w+\(.*\)$/.test(p) || /=>|function\s*\(|\breturn\b.*;/.test(p)) return false; /* code */
  if (/^(?:select|insert|update|delete|create|alter)\s/i.test(p) && /\b(?:from|into|table|set|where)\b/i.test(p)) return false; /* SQL */
  if (/^[A-Z]{2,5}$/.test(p)) return false; /* codes: MYR, AM, ID */
  if (/^[\d\s:+\-./,%]+[A-Za-z]{1,3}$/.test(p)) return false; /* "10am", "3pm" */
  return true;
}

/* ---------------- the catalogs ---------------- */
export function loadCatalogs() {
  const ctx = { window: {}, console };
  ctx.window.O = {}; ctx.O = ctx.window.O; vm.createContext(ctx);
  const dir = path.join(ROOT, 'app/i18n');
  for (const f of ['en.js', 'ignore.js', ...LANGS.map((l) => l + '.js')]) { const p = path.join(dir, f); if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: p }); }
  const O = ctx.window.O;
  return { src: O.I18N_SRC || [], ignore: O.I18N_IGNORE || [], tr: O.I18N || {} };
}

/* every English string that needs a translation: the UI pieces in the code, plus app/i18n/en.js (strings the code builds
   at run time, such as "{n} nights" from O.fmt.plural or "Due in {n} days"), minus app/i18n/ignore.js */
export function required() {
  const { src, ignore, tr } = loadCatalogs();
  const ign = new Set(ignore);
  const found = new Map();
  for (const f of sourceFiles()) {
    const code = withoutOff(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const lits = literals(code);
    for (const { s, line } of lits) for (const p of pieces(s).concat(pieceWords(s))) if (!found.has(p)) found.set(p, f + ':' + line);
    for (const { k, line } of chains(code, lits)) if (!found.has(k)) found.set(k, f + ':' + line + ' (joined)');
    /* a word a literal adds after a value: x + ' notice', n + ' pts' (not a class: cls + ' active') */
    for (const x of lits) { const m = x.s.match(/^\s+([a-z][a-z']*(?: [a-z][a-z']*){0,3})$/); if (m && /[\w$)\]]\s*\+\s*$/.test(code.slice(Math.max(0, x.at - 40), x.at)) && !/class(?:Name)?\s*[=:+]|cls|\bc\s*\+|className/.test(code.slice(Math.max(0, x.at - 80), x.at)) && !/^\s*[+]\s*['"`]?\s*['"]?\s*>/.test(code.slice(x.end, x.end + 6)) && !/^\s*\+\s*'"/.test(code.slice(x.end, x.end + 8)) && !found.has(m[1])) found.set(m[1], f + ':' + x.line + ' (word)'); }
    /* O.fmt.plural(n, 'night') -> "{n} night" */
    for (const m of code.matchAll(/plural\([^,()]+(?:\([^()]*\))?[^,()]*,\s*'([^']+)'/g)) { const k = '{n} ' + m[1]; if (!found.has(k)) found.set(k, f + ' (plural)'); }
  }
  const shell = fs.readFileSync(path.join(ROOT, 'app/shell.html'), 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
  for (const p of pieces(shell)) if (!found.has(p)) found.set(p, 'app/shell.html');
  for (const k of src) if (!found.has(k)) found.set(k, 'app/i18n/en.js');
  for (const k of ign) found.delete(k);
  return { keys: found, ignore: ign, tr, src };
}

function main() {
  const { keys, ignore, tr } = required();
  const problems = [], warnings = [];
  const ph = (s) => (s.match(/\{[a-z0-9_]+\}/gi) || []).sort().join(',');
  const missing = {};
  for (const l of LANGS) {
    const t = tr[l] || {};
    missing[l] = [...keys.keys()].filter((k) => typeof t[k] !== 'string' || !t[k].trim());
    for (const k of Object.keys(t)) if (typeof t[k] === 'string' && ph(t[k]) !== ph(k)) problems.push(l + ': the translation of "' + k + '" has placeholders ' + (ph(t[k]) || 'none') + ', expected ' + (ph(k) || 'none'));
    const extra = Object.keys(t).filter((k) => !keys.has(k) && !ignore.has(k));
    if (extra.length) warnings.push(l + ': ' + extra.length + ' translations of strings the app no longer has (safe to delete), e.g. ' + JSON.stringify(extra[0]));
  }
  console.log('UI strings: ' + keys.size + ' (not UI text, in app/i18n/ignore.js: ' + ignore.size + ')');
  for (const l of LANGS) console.log('  ' + l + ': ' + (keys.size - missing[l].length) + ' translated, ' + missing[l].length + ' missing');
  const show = args.includes('--all') ? 1e9 : 40;
  for (const l of LANGS) if (missing[l].length) { console.log('\n' + l + ' has no translation for ' + missing[l].length + ' strings (add them to app/i18n/' + l + '.js, or to app/i18n/ignore.js if they are not UI text):'); for (const k of missing[l].slice(0, show)) console.log('  ' + JSON.stringify(k) + '  (' + keys.get(k) + ')'); }
  for (const w of warnings) console.log('note: ' + w);
  for (const p of problems) console.log('PROBLEM ' + p);
  const mi = args.indexOf('--missing');
  if (mi >= 0) fs.writeFileSync(args[mi + 1], JSON.stringify(Object.fromEntries(LANGS.map((l) => [l, missing[l].map((k) => ({ s: k, at: keys.get(k) }))])), null, 1));
  if (args.includes('--check') && (LANGS.some((l) => missing[l].length) || problems.length)) { console.log('\ni18n check failed'); process.exit(1); }
  if (args.includes('--check')) console.log('i18n check passed');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
