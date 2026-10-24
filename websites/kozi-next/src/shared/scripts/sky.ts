// Paints a sky state onto the page: skyline colours, which windows are lit, the glow on the
// Twin Towers, and the text colour that reads best on that sky.
import { css, type SkyState } from '@shared/lib/sun';

// the six window groups switch on one after another as the light goes; a few stay dimmer
const LEVEL = [1, 0.92, 0.8, 0.95, 0.7, 0.86];

export function skyVars(s: SkyState): Record<string, string> {
  const v: Record<string, string> = {};
  s.sk.forEach((c, i) => (v[`--sk${i}`] = c));
  v['--zen'] = css(s.zen); v['--hor'] = css(s.hor); v['--glow'] = css(s.glow);
  v['--dark'] = s.dark.toFixed(3); v['--lit'] = s.lit.toFixed(3);
  for (let g = 0; g < 6; g++) v[`--w${g}`] = (Math.min(1, Math.max(0, s.lit * 7 - g)) * LEVEL[g]).toFixed(3);
  return v;
}

export function applySky(el: HTMLElement, s: SkyState) {
  const v = skyVars(s);
  for (const k in v) el.style.setProperty(k, v[k]);
  el.dataset.ink = s.ink;
  return v;
}

/** Remember the live sky for this tab so the next page paints it before any script runs. */
export function cacheSky(v: Record<string, string>, ink: string) {
  try { sessionStorage.setItem('kozi-sky', JSON.stringify({ t: Date.now(), v, ink })); } catch { /* private mode */ }
}

const PHASES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
export function moonName(phase: number) { return PHASES[Math.round(phase * 8) % 8]; }
