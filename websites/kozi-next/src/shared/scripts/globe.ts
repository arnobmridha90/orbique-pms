// The globe on staykozi.com: the Earth lit as it is right now. Land is a field of dots, warm on the
// day side, dim on the night side and amber where the sun is rising or setting. Kozi's cities glow
// on it. Drag to turn it; it turns slowly by itself unless motion is reduced.
import mask from '@shared/data/land-mask.json';
import { subsolar } from '@shared/lib/sun';

const D = Math.PI / 180;
type Spot = { lat: number; lon: number; el: HTMLElement };

// light on a point of land: night blue, then amber at the terminator, then the paper of the day side
const NIGHT = [104, 116, 168, 0.42], AMBER = [240, 184, 96, 1], DAY = [246, 239, 228, 0.94];
const BANDS = 24, LO = -0.2, HI = 0.18; // s = cos(angle to the sun); twilight spans LO..HI
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const rgba = (c: number[]) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${c[3].toFixed(3)})`;
const PALETTE = Array.from({ length: BANDS + 2 }, (_, b) => {
  if (b === 0) return rgba(NIGHT);
  if (b === BANDS + 1) return rgba(DAY);
  const s = LO + ((b - 0.5) / BANDS) * (HI - LO);
  return rgba(s < 0 ? mix(NIGHT, AMBER, (s - LO) / -LO) : mix(AMBER, DAY, s / HI));
});

// light on the sea, by s from -1 to 1: near black at night, a warm band where the sun is rising
// or setting, a deep blue by day and a soft warm glint where the sun is overhead
const SEA = (() => {
  const lut = new Uint8ClampedArray(512 * 3);
  const NIGHT_SEA = [8, 11, 25], DAY_EDGE = [30, 43, 86], DAY_TOP = [50, 72, 132], DUSK = [112, 70, 56], GLINT = [84, 62, 30];
  for (let i = 0; i < 512; i++) {
    const s = (i / 511) * 2 - 1;
    const t = Math.max(0, Math.min(1, (s + 0.08) / 0.3)), e = t * t * (3 - 2 * t);
    let c = s < 0.22 ? mix(NIGHT_SEA, DAY_EDGE, e) : mix(DAY_EDGE, DAY_TOP, (s - 0.22) / 0.78);
    c = mix(c, DUSK, 0.5 * Math.exp(-(((s - 0.01) / 0.075) ** 2)));
    const g = Math.max(0, s) ** 22 * 0.7;
    lut.set([c[0] + GLINT[0] * g, c[1] + GLINT[1] * g, c[2] + GLINT[2] * g], i * 3);
  }
  return lut;
})();

export function init(root: HTMLElement) {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-globe-canvas]')!;
  const ctx = canvas.getContext('2d')!;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // land points from the mask: the same grid the mask was built on
  const bin = atob(mask.data);
  const pts: number[] = [];
  const rows = mask.counts.length;
  for (let i = 0, k = 0; i < rows; i++) {
    const lat = (90 - ((i + 0.5) * 180) / rows) * D, n = mask.counts[i];
    for (let j = 0; j < n; j++, k++) if (bin.charCodeAt(k >> 3) & (1 << (k & 7))) pts.push(lat, (-180 + ((j + 0.5) * 360) / n) * D);
  }
  const N = pts.length / 2;
  const sLat = new Float32Array(N), cLat = new Float32Array(N), sLon = new Float32Array(N), cLon = new Float32Array(N);
  for (let p = 0; p < N; p++) { sLat[p] = Math.sin(pts[2 * p]); cLat[p] = Math.cos(pts[2 * p]); sLon[p] = Math.sin(pts[2 * p + 1]); cLon[p] = Math.cos(pts[2 * p + 1]); }

  // which band of light each point is in, sorted so each band is drawn as one path
  let sun: [number, number] = [0, 0];
  const order = new Uint16Array(N), starts = new Uint32Array(BANDS + 3);
  function light() {
    sun = subsolar();
    const sd = Math.sin(sun[1] * D), cd = Math.cos(sun[1] * D), sl = Math.sin(sun[0] * D), cl = Math.cos(sun[0] * D);
    const band = new Uint8Array(N);
    starts.fill(0);
    for (let p = 0; p < N; p++) {
      const s = sLat[p] * sd + cLat[p] * cd * (cLon[p] * cl + sLon[p] * sl);
      band[p] = s <= LO ? 0 : s >= HI ? BANDS + 1 : 1 + Math.min(BANDS - 1, Math.floor(((s - LO) / (HI - LO)) * BANDS));
      starts[band[p] + 1]++;
    }
    for (let b = 1; b < starts.length; b++) starts[b] += starts[b - 1];
    const at = starts.slice();
    for (let p = 0; p < N; p++) order[at[band[p]]++] = p;
  }
  light();
  setInterval(light, 60_000);

  const spots: Spot[] = [...root.querySelectorAll<HTMLElement>('[data-spot]')].map((el) => ({ lat: +el.dataset.lat!, lon: +el.dataset.lon!, el }));
  // each city's label shows the time there
  const clocks = spots.map(({ el }) => ({ out: el.querySelector<HTMLElement>('[data-spot-time]'), fmt: new Intl.DateTimeFormat('en-MY', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: el.dataset.tz }) }));
  const tick = () => clocks.forEach((c) => { if (c.out) c.out.textContent = c.fmt.format(new Date()).replace(/\s/g, ' ').toLowerCase(); });
  tick();
  setTimeout(() => { tick(); setInterval(tick, 60_000); }, 60_000 - (Date.now() % 60_000) + 50);

  // view: the longitude and latitude at the middle of the globe
  const home = spots[0] ?? { lat: 3, lon: 101 };
  let lon0 = home.lon + 30, lat0 = 14;
  let W = 0, H = 0, R = 0, cx = 0, cy = 0, dpr = 1;

  // the sea and the air are shaded a pixel at a time on two small canvases, then drawn scaled up:
  // the sea covers the disc of the Earth, the air a wider square around it
  const SS = innerWidth < 700 ? 150 : 210, AS = 120, AR = 1.14;
  const sea = document.createElement('canvas'), air = document.createElement('canvas');
  sea.width = sea.height = SS; air.width = air.height = AS;
  const seaX = sea.getContext('2d')!, airX = air.getContext('2d')!;
  const seaImg = seaX.createImageData(SS, SS), airImg = airX.createImageData(AS, AS);
  // each sea pixel's direction from the middle of the Earth; outside the disc, the nearest edge
  const nX = new Float32Array(SS * SS), nY = new Float32Array(SS * SS), nZ = new Float32Array(SS * SS), rim = new Float32Array(SS * SS);
  for (let j = 0, k = 0; j < SS; j++) for (let i = 0; i < SS; i++, k++) {
    let x = ((i + 0.5) / SS) * 2 - 1, y = 1 - ((j + 0.5) / SS) * 2;
    const d = Math.hypot(x, y);
    if (d > 1) { x /= d; y /= d; }
    nX[k] = x; nY[k] = y; nZ[k] = Math.sqrt(Math.max(0, 1 - x * x - y * y)); rim[k] = (1 - nZ[k]) ** 3;
  }
  // each air pixel: its direction round the edge, and how thick the air is there
  const aU = new Float32Array(AS * AS), aV = new Float32Array(AS * AS), aF = new Float32Array(AS * AS);
  for (let j = 0, k = 0; j < AS; j++) for (let i = 0; i < AS; i++, k++) {
    const x = (((i + 0.5) / AS) * 2 - 1) * AR, y = (1 - ((j + 0.5) / AS) * 2) * AR, d = Math.hypot(x, y) || 1;
    aU[k] = x / d; aV[k] = y / d; aF[k] = d <= 1 ? 1 : Math.exp(-(d - 1) / 0.055) * Math.max(0, 1 - ((d - 1) / 0.13) ** 2); // gone before the canvas edge
  }
  function shade(sx: number, sy: number, sz: number) {
    const p = seaImg.data;
    for (let k = 0, o = 0; k < nX.length; k++, o += 4) {
      const l = nX[k] * sx + nY[k] * sy + nZ[k] * sz, li = ((l + 1) * 255.5) | 0;
      // the air at the edge catches the light: a thin bright rim on the day side
      const a = rim[k] * Math.max(0, Math.min(1, (l + 0.3) / 0.6)) * 0.55;
      p[o] = SEA[li * 3] + 80 * a; p[o + 1] = SEA[li * 3 + 1] + 110 * a; p[o + 2] = SEA[li * 3 + 2] + 180 * a; p[o + 3] = 255;
    }
    seaX.putImageData(seaImg, 0, 0);
    // round the Earth the air glows faintly everywhere and brightly on the side towards the sun;
    // with the sun behind the Earth it lights up as a ring
    const q = airImg.data, back = Math.max(0, -sz) ** 3 * 0.7;
    for (let k = 0, o = 0; k < aU.length; k++, o += 4) {
      const lit = Math.max(0, Math.min(1, (aU[k] * sx + aV[k] * sy + 0.25) / 0.6));
      q[o] = 132; q[o + 1] = 160; q[o + 2] = 255; q[o + 3] = 255 * aF[k] * Math.min(0.75, 0.13 + 0.5 * lit + back);
    }
    airX.putImageData(airImg, 0, 0);
  }
  function size() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    R = Math.min(W, H) * 0.44; cx = W / 2; cy = H / 2;
    draw(performance.now());
  }

  function draw(t: number) {
    const s0 = Math.sin(lat0 * D), c0 = Math.cos(lat0 * D), sl0 = Math.sin(lon0 * D), cl0 = Math.cos(lon0 * D);
    // a point on the sphere, as seen from the front: x, y on screen and z towards us
    const view = (sLa: number, cLa: number, sLo: number, cLo: number) => {
      const sd = sLo * cl0 - cLo * sl0, cdl = cLo * cl0 + sLo * sl0;
      return [cLa * sd, c0 * sLa - s0 * cLa * cdl, s0 * sLa + c0 * cLa * cdl];
    };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // the air, then the sea, both lit from wherever the sun is
    const sv = view(Math.sin(sun[1] * D), Math.cos(sun[1] * D), Math.sin(sun[0] * D), Math.cos(sun[0] * D));
    shade(sv[0], sv[1], sv[2]);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(air, cx - R * AR, cy - R * AR, R * AR * 2, R * AR * 2);
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(sea, cx - R, cy - R, R * 2, R * 2);

    // the land, one path per band of light; dots shrink towards the edge
    const r0 = Math.max(0.9, R * 0.0058);
    for (let b = 0; b < BANDS + 2; b++) {
      if (starts[b] === starts[b + 1]) continue;
      ctx.beginPath();
      for (let i = starts[b]; i < starts[b + 1]; i++) {
        const p = order[i];
        const v = view(sLat[p], cLat[p], sLon[p], cLon[p]);
        if (v[2] <= 0.02) continue;
        const x = cx + R * v[0], y = cy - R * v[1], r = r0 * (0.5 + 0.5 * v[2]);
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = PALETTE[b]; ctx.fill();
    }

    // a darker edge gives the sphere its depth
    const edge = ctx.createRadialGradient(cx, cy, R * 0.78, cx, cy, R);
    edge.addColorStop(0, 'rgba(6,8,18,0)'); edge.addColorStop(1, 'rgba(6,8,18,0.32)');
    ctx.fillStyle = edge; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();

    // our cities: a glow, a dot and a slow ring, with the label following
    for (const c of spots) {
      const v = view(Math.sin(c.lat * D), Math.cos(c.lat * D), Math.sin(c.lon * D), Math.cos(c.lon * D));
      const x = cx + R * v[0], y = cy - R * v[1];
      const vis = Math.max(0, Math.min(1, (v[2] - 0.06) / 0.2));
      c.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      c.el.style.opacity = vis.toFixed(3);
      c.el.style.visibility = vis > 0 ? 'visible' : 'hidden';
      if (vis <= 0) continue;
      const halo = ctx.createRadialGradient(x, y, 0, x, y, 22);
      halo.addColorStop(0, `rgba(240,184,96,${(0.55 * vis).toFixed(3)})`); halo.addColorStop(1, 'rgba(240,184,96,0)');
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.fill();
      if (!reduce) {
        const k = (t % 2600) / 2600;
        ctx.strokeStyle = `rgba(240,184,96,${((1 - k) * 0.8 * vis).toFixed(3)})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 5 + k * 16, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = `rgba(255,214,140,${vis.toFixed(3)})`; ctx.beginPath(); ctx.arc(x, y, 3.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  // motion: a slow turn, a drag with a little momentum, and flying to a city when asked
  let spin = reduce ? 0 : 1, vx = 0, vy = 0, dragging = false, idleSince = 0, raf = 0, running = false;
  let fly: { from: [number, number]; to: [number, number]; t0: number } | null = null;
  // degrees a second. The land drifts to the right, the way the Earth turns, slowly while our
  // first city faces you and faster while it is round the back.
  const facing = () => Math.sin(lat0 * D) * Math.sin(home.lat * D) + Math.cos(lat0 * D) * Math.cos(home.lat * D) * Math.cos((home.lon - lon0) * D);
  const speed = () => { const f = Math.max(0, Math.min(1, (facing() + 0.2) / 0.8)); return 6 - 4.6 * f * f * (3 - 2 * f); };
  let last = performance.now();
  function frame(t: number) {
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (fly) {
      const k = Math.min(1, (t - fly.t0) / 1400), e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      lon0 = fly.from[0] + (fly.to[0] - fly.from[0]) * e; lat0 = fly.from[1] + (fly.to[1] - fly.from[1]) * e;
      if (k >= 1) { fly = null; idleSince = t + 2500; }
    } else if (!dragging) {
      lon0 += vx * dt; lat0 = Math.max(-40, Math.min(50, lat0 + vy * dt));
      vx *= 0.92; vy *= 0.92;
      if (!reduce && t > idleSince) spin = Math.min(1, spin + dt * 0.6);
      lon0 -= speed() * spin * dt;
    }
    draw(t);
    raf = running ? requestAnimationFrame(frame) : 0;
  }
  const start = () => { if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { running = false; cancelAnimationFrame(raf); raf = 0; };

  let px = 0, py = 0, pt = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; fly = null; spin = 0; vx = vy = 0; px = e.clientX; py = e.clientY; pt = e.timeStamp;
    canvas.setPointerCapture(e.pointerId); root.classList.add('is-dragging');
    if (reduce) start();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const k = 90 / R, dx = e.clientX - px, dy = e.clientY - py, dt = Math.max(1, e.timeStamp - pt) / 1000;
    lon0 -= dx * k; lat0 = Math.max(-40, Math.min(50, lat0 + dy * k));
    vx = (-dx * k) / dt; vy = (dy * k) / dt;
    px = e.clientX; py = e.clientY; pt = e.timeStamp;
    if (reduce) draw(performance.now());
  });
  const up = () => {
    if (!dragging) return;
    dragging = false; idleSince = performance.now() + 1800; root.classList.remove('is-dragging');
    if (reduce) { vx = vy = 0; stop(); }
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);

  // the country list flies the globe to its city
  root.querySelectorAll<HTMLElement>('[data-fly]').forEach((el) => {
    const go = () => {
      const [lon, lat] = el.dataset.fly!.split(',').map(Number);
      let to = lon - 18; // the city a little right of the middle
      while (to - lon0 > 180) to -= 360;
      while (lon0 - to > 180) to += 360;
      if (reduce) { lon0 = to; lat0 = Math.max(-40, Math.min(50, lat + 10)); draw(performance.now()); return; }
      fly = { from: [lon0, lat0], to: [to, Math.max(-40, Math.min(50, lat + 10))], t0: performance.now() }; spin = 0;
    };
    el.addEventListener('pointerenter', go); el.addEventListener('focus', go);
  });

  new ResizeObserver(size).observe(canvas);
  if (!reduce) {
    new IntersectionObserver(([e]) => (e.isIntersecting && !document.hidden ? start() : stop())).observe(canvas);
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  }
  size();
  root.classList.add('is-ready');
}
