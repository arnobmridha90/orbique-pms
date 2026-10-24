// The Kuala Lumpur skyline, drawn at build time as one SVG: five depth layers of buildings,
// the landmarks (Petronas Twin Towers, KL Tower, Merdeka 118, The Exchange 106) and Vortex KLCC,
// with windows that the live sky switches on at dusk. Stylised, not a survey drawing.

export const VB = { w: 2400, h: 900 };
const G = VB.h; // ground line

function rng(seed: number) { // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const f1 = (n: number) => Math.round(n * 10) / 10;
const poly = (pts: [number, number][]) => 'M' + pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L') + 'Z';
// a symmetric outline from [halfWidth, heightFromGround] pairs listed bottom to top
function sym(cx: number, prof: [number, number][]) {
  const left = prof.map(([w, y]) => [cx - w, G - y] as [number, number]);
  const right = [...prof].reverse().map(([w, y]) => [cx + w, G - y] as [number, number]);
  return poly([...left, ...right]);
}

export type Landmark = { id: string; name: string; x: number; top: number };

function petronas(cx: number, h: number) {
  const st = (a: number, b: number, w: number): [number, number][] => [[w, a * h], [w, b * h]];
  return sym(cx, [
    ...st(0, 0.56, 46), ...st(0.56, 0.63, 41), ...st(0.63, 0.69, 35), ...st(0.69, 0.735, 28), ...st(0.735, 0.775, 20),
    ...st(0.775, 0.8, 13), [5, 0.8 * h], [5, 0.82 * h], [8, 0.826 * h], [8, 0.842 * h], [4, 0.848 * h], [1, h],
  ]);
}
function klTower(cx: number, h: number) {
  return sym(cx, [[64, 0], [56, 0.02 * h], [26, 0.06 * h], [14, 0.07 * h], [9, 0.62 * h], [24, 0.652 * h], [38, 0.672 * h], [42, 0.692 * h],
    [42, 0.706 * h], [34, 0.718 * h], [22, 0.732 * h], [10, 0.745 * h], [5, 0.75 * h], [3.5, 0.86 * h], [6, 0.863 * h], [6, 0.872 * h], [2.2, 0.875 * h], [1, h]]);
}
function merdeka(cx: number, h: number) {
  const prof: [number, number][] = [];
  const steps = 13;
  for (let i = 0; i <= steps; i++) { // faceted body: the diamond panels make the edge step in and out
    const f = (i / steps) * 0.74;
    const w = 64 - 30 * Math.pow(f / 0.74, 1.6) + (i % 2 ? -3 : 2);
    prof.push([w, f * h]);
  }
  prof.push([24, 0.77 * h], [12, 0.79 * h], [6, 0.8 * h], [1, h]);
  return sym(cx, prof);
}
function exchange(cx: number, h: number) {
  return poly([[cx - 44, G], [cx - 38, G - 0.88 * h], [cx - 32, G - 0.9 * h], [cx + 30, G - 0.955 * h], [cx + 30, G - 0.96 * h],
    [cx + 24, G - 0.962 * h], [cx + 23, G - h], [cx + 21, G - h], [cx + 20, G - 0.962 * h], [cx + 36, G - 0.955 * h], [cx + 38, G - 0.88 * h], [cx + 44, G]]);
}
function vortex(cx: number, h: number) {
  // the slim, balconied tower: the left edge leans in a little, the right edge bows out,
  // and the crown slopes down to the right like a sail, with a mast at its high corner
  const T = G - h;
  return `M${cx - 48} ${G}L${cx - 44} ${T + 0.05 * h}L${cx - 43} ${T - 26}L${cx - 41} ${T - 26}L${cx - 40} ${T + 0.01 * h}` +
    `Q${cx - 30} ${T - 0.004 * h} ${cx - 6} ${T + 0.012 * h}Q${cx + 34} ${T + 0.03 * h} ${cx + 50} ${T + 0.085 * h}` +
    `Q${cx + 66} ${G - 0.55 * h} ${cx + 52} ${G - 0.12 * h}L${cx + 52} ${G}Z`;
}

// the lights each landmark wears after dark, so the skyline still reads at night
function nightLights(): string {
  const r = (x: number, y: number, w: number, hh: number, c: string, o = 1) => `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(hh)}" fill="${c}" opacity="${o}"/>`;
  const kt = 520, kh = 520, mx = 1930, mh = 710, ex = 1660, eh = 600;
  return r(kt - 39, G - 0.7 * kh, 78, 7, '#ffd9a0', 0.95) + r(kt - 22, G - 0.735 * kh, 44, 3, '#ffe6bf', 0.8) + r(kt - 1.3, G - 0.985 * kh, 2.6, 0.23 * kh, '#eef2ff', 0.85) +
    r(mx - 1.4, G - 0.995 * mh, 2.8, 0.2 * mh, '#eef2ff', 0.95) + r(mx - 0.9, G - 0.74 * mh, 1.8, 0.64 * mh, '#c9d4ff', 0.45) + r(mx - 20, G - 0.775 * mh, 40, 3, '#dfe7ff', 0.7) +
    `<path d="M${ex - 34} ${G - 0.9 * eh}L${ex + 30} ${G - 0.957 * eh}L${ex + 30} ${G - 0.947 * eh}L${ex - 34} ${G - 0.89 * eh}Z" fill="#e3ecff" opacity=".9"/>` + r(ex + 21, G - eh, 2, 0.04 * eh, '#eef2ff', 0.8);
}

type B = { x: number; w: number; h: number; top?: 'flat' | 'step' | 'mast' | 'crown' | 'slant' };
function generic(b: B) {
  const { x, w, h } = b, t = b.top ?? 'flat';
  if (t === 'step') return poly([[x, G], [x, G - h * 0.86], [x + w * 0.15, G - h * 0.86], [x + w * 0.15, G - h], [x + w * 0.85, G - h], [x + w * 0.85, G - h * 0.86], [x + w, G - h * 0.86], [x + w, G]]);
  if (t === 'mast') return poly([[x, G], [x, G - h], [x + w * 0.46, G - h], [x + w * 0.47, G - h - 46], [x + w * 0.53, G - h - 46], [x + w * 0.54, G - h], [x + w, G - h], [x + w, G]]);
  if (t === 'crown') return poly([[x, G], [x, G - h], [x + w * 0.2, G - h - 14], [x + w * 0.5, G - h - 26], [x + w * 0.8, G - h - 14], [x + w, G - h], [x + w, G]]);
  if (t === 'slant') return poly([[x, G], [x, G - h], [x + w, G - h - w * 0.35], [x + w, G]]);
  return poly([[x, G], [x, G - h], [x + w, G - h], [x + w, G]]);
}

export function buildSkyline(seed = 7, opts: { label?: boolean; id?: string } = {}) {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const tops: B['top'][] = ['flat', 'flat', 'step', 'mast', 'crown', 'slant'];
  const layers: string[][] = [[], [], [], [], []];
  const wins: { x: number; y: number; w: number; h: number; g: number; l: number }[] = [];
  const addWindows = (l: number, x: number, w: number, h: number, density: number, size = 1) => {
    const cw = 13 * size, ch = 16 * size;
    for (let yy = G - 18; yy > G - h + 14; yy -= ch) for (let xx = x + 7; xx < x + w - 8; xx += cw)
      if (r() < density) wins.push({ x: xx, y: yy, w: 4.2 * size, h: 6.4 * size, g: Math.floor(r() * 6), l });
  };

  // far city mass
  for (let x = -20; x < VB.w + 20;) { const w = 36 + r() * 80, h = 70 + r() * 150; layers[0].push(generic({ x, w, h, top: pick(tops) })); x += w + r() * 6; }
  // far towers
  for (let x = 0; x < VB.w;) { const w = 46 + r() * 70, h = 150 + r() * 230; if (r() < 0.75) { layers[1].push(generic({ x, w, h, top: pick(tops) })); addWindows(1, x, w, h, 0.18, 0.8); } x += w + 20 + r() * 60; }

  const L: Landmark[] = [
    { id: 'kl-tower', name: 'KL Tower', x: 520, top: 520 },
    { id: 'petronas', name: 'Petronas Twin Towers', x: 1231, top: 640 },
    { id: 'exchange', name: 'The Exchange 106', x: 1660, top: 600 },
    { id: 'merdeka', name: 'Merdeka 118', x: 1930, top: 710 },
  ];
  // mid layer: landmarks plus mid-rise towers that keep clear of them
  const marks = { 'kl-tower': klTower(520, 520), exchange: exchange(1660, 600), merdeka: merdeka(1930, 710), petronas: petronas(1150, 640) + petronas(1312, 640) };
  const clear = (x: number, w: number, near: number[]) => near.every((c) => x + w < c - 70 || x > c + 70);
  for (let x = 0; x < VB.w;) {
    const w = 60 + r() * 80, h = 190 + r() * 210;
    if (clear(x, w, [520, 1150, 1312, 1660, 1930]) && r() < 0.8) { layers[2].push(generic({ x, w, h, top: pick(tops) })); addWindows(2, x, w, h, 0.26, 0.9); }
    x += w + 30 + r() * 90;
  }
  // near layer: the twin towers and a few towers either side
  const pA = 1150, pB = 1312, ph = 640;
  const by = G - 0.37 * ph, legY = G - 0.27 * ph;
  layers[3].push(poly([[pA + 40, by], [pB - 40, by], [pB - 40, by + 13], [pA + 40, by + 13]]));
  const legs = `M${pA + 44} ${legY}L${(pA + pB) / 2} ${by + 13}L${pB - 44} ${legY}`;
  for (const [x, w, h] of [[30, 120, 260], [300, 96, 330], [1470, 110, 300], [2080, 130, 360], [2260, 120, 250]] as [number, number, number][]) {
    layers[3].push(generic({ x, w, h, top: pick(['flat', 'step', 'crown']) })); addWindows(3, x, w, h, 0.32);
  }
  // foreground: Vortex KLCC and low buildings along the bottom
  const vx = 860, vh = 470;
  const vd = vortex(vx, vh);
  addWindows(4, vx - 42, 92, vh - 30, 0.36);
  for (let x = -10; x < VB.w;) { const w = 70 + r() * 140, h = 40 + r() * 110; if (Math.abs(x + w / 2 - vx) > 120) layers[4].push(generic({ x, w, h })); x += w + r() * 30; }

  // Petronas glows silver at night; the glow is a soft ellipse, not a filter, so it is cheap to fade
  const glow = `<ellipse cx="${(pA + pB) / 2}" cy="${G - ph * 0.5}" rx="300" ry="${ph * 0.62}" fill="url(#${opts.id ?? 'sk'}-pg)" class="sk-pglow"/>`;
  const petLight = `<path class="sk-plit" d="${petronas(pA, ph)}${petronas(pB, ph)}" fill="url(#${opts.id ?? 'sk'}-pl)"/>`;

  // windows sit with their own layer, so nearer buildings hide them; each group of windows that
  // lights up together is one path, which keeps the page's element count down
  const winsOf = (l: number) => [0, 1, 2, 3, 4, 5].map((g) => {
    const rs = wins.filter((w) => w.l === l && w.g === g);
    return rs.length ? `<path class="sk-w sk-w${g}" d="${rs.map((w) => `M${f1(w.x)} ${f1(w.y)}h${f1(w.w)}v${f1(w.h)}h-${f1(w.w)}z`).join('')}"/>` : '';
  }).join('');
  // aviation beacons: each layer's lights fade in after dark and blink on their own beat
  const beaconsOf = (pts: number[][], from: number) => '<g class="sk-beacons">' + pts
    .map(([x, y], i) => `<circle class="sk-beacon" style="animation-delay:${((from + i) * 0.37).toFixed(2)}s" cx="${x}" cy="${y + 4}" r="3.4"/>`).join('') + '</g>';
  // our window on Vortex: level 43 of 56, on the bowed face
  const kx = vx + 18, ky = G - vh * (43 / 56) - 4;
  const kozi = `<g class="sk-kozi"><circle class="sk-kring" cx="${kx + 3}" cy="${ky + 4}" r="9"/><rect x="${kx}" y="${ky}" width="7" height="9" rx="1"/></g>` +
    (opts.label ? `<g class="sk-klabel" transform="translate(${kx + 22} ${ky - 26})"><line x1="-12" y1="28" x2="0" y2="10"/><text x="6" y="6">Kozi @ Vortex KLCC</text></g>` : '');

  const id = opts.id ?? 'sk';
  // facade texture: floor slabs and mullions by day (fades at night), balcony bands on Vortex
  const fac = `<pattern id="${id}-fac" width="13" height="16" patternUnits="userSpaceOnUse"><rect width="13" height="1.5" fill="#fff" fill-opacity=".1"/><rect width="1.1" height="16" fill="#fff" fill-opacity=".06"/></pattern>` +
    `<pattern id="${id}-bal" width="20" height="8.4" patternUnits="userSpaceOnUse"><rect width="20" height="2.3" fill="#fff" fill-opacity=".16"/></pattern>`;
  const defs = `<defs>${fac}<radialGradient id="${id}-pg"><stop offset="0" stop-color="#dfe7ff" stop-opacity=".55"/><stop offset=".45" stop-color="#b9c6ff" stop-opacity=".18"/><stop offset="1" stop-color="#b9c6ff" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${id}-ml" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#5d6aa8" stop-opacity="0"/><stop offset=".6" stop-color="#8f9ce0" stop-opacity=".35"/><stop offset="1" stop-color="#dfe6ff" stop-opacity=".7"/></linearGradient>` +
    `<linearGradient id="${id}-pl" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#8a93b8"/><stop offset=".55" stop-color="#d8dcf0"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>`;

  // One SVG per depth layer, stacked, so each can move on its own composited layer (parallax)
  const facOf = (d: string) => `<path class="sk-fac" d="${d}" fill="url(#${id}-fac)"/>`;
  const inner = (i: number) => {
    let out = (i === 0 ? defs : '') + (i === 3 ? glow : '') + `<path class="sk-l sk-l${i}" d="${layers[i].join('')}"/>`;
    if (i === 2) out += ['kl-tower', 'exchange', 'merdeka'].map((k) => `<path class="sk-l sk-l2 sk-mark" data-mark="${k}" d="${marks[k as keyof typeof marks]}"/>`).join('');
    if (i === 3) out += `<path class="sk-l sk-l3 sk-mark" data-mark="petronas" d="${marks.petronas}"/><path class="sk-legs" d="${legs}"/>` + petLight;
    if (i >= 2) out += facOf(layers[i].join('') + (i === 2 ? marks['kl-tower'] + marks.exchange + marks.merdeka : i === 3 ? marks.petronas : ''));
    if (i === 2) out += `<path class="sk-mlit" d="${marks.merdeka}${marks.exchange}" fill="url(#${id}-ml)"/><g class="sk-nlit">${nightLights()}</g>`;
    if (i === 4) out += `<path class="sk-vortex" d="${vd}"/><path class="sk-fac sk-bal" d="${vd}" fill="url(#${id}-bal)"/>` +
      `<path class="sk-vrim" d="M${vx + 50} ${G - vh + 0.085 * vh}Q${vx + 66} ${G - 0.55 * vh} ${vx + 52} ${G - 0.12 * vh}"/>`;
    out += winsOf(i);
    if (i === 2) out += beaconsOf([[520, G - 520], [1683, G - 600], [1930, G - 710]], 2);
    if (i === 3) out += beaconsOf([[pA, G - ph], [pB, G - ph]], 0);
    if (i === 4) out += kozi;
    return out;
  };
  const layerSvgs = [0, 1, 2, 3, 4].map((i) =>
    `<svg class="skyline sk-layer sk-layer${i}" viewBox="0 0 ${VB.w} ${VB.h}" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">${inner(i)}</svg>`);
  const svg = layerSvgs.join('');
  return { svg, layers: layerSvgs, landmarks: L, kozi: { x: kx, y: ky } };
}
