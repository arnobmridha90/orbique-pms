// The 3D Kuala Lumpur behind the Malaysia site: the real city from open map data (buildings, roads, rail, rivers,
// parks and trees from Overture Maps: OpenStreetMap, Google Open Buildings, Microsoft), with the Petronas Twin Towers,
// KL Tower, Merdeka 118, Exchange 106 and Vortex (our floors lit) modelled from their real footprints and heights.
// The modules and the data live in public/city/v3 (three.js r128 as the global THREE, then window.KLC.*). They are
// fetched only after the page has painted and gone idle, and only where they can run well: never with reduced
// motion, Save-Data, no WebGL or a weak device (those keep the still image). The canvas is persisted across page
// changes (Astro's ClientRouter), so the city is built once per visit and each page just flies the camera.
// Units: 1 = 10 m, x east, z south, origin = Vortex Tower.
import { gsap } from 'gsap';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
declare global { interface Window { THREE: Any; KLC: Any } }

const BASE = '/city/v3/';
const SCRIPTS = ['three-r128.min.js', 'klc-data.js', 'ground.js', 'city.js', 'landmarks.js', 'sky.js', 'post.js'];

export type Rig = { px: number; py: number; pz: number; tx: number; ty: number; tz: number; orbit: number };
export type Pins = 'on' | 'off' | 'views';
export type PageCity = { cam: string; pins: Pins; hi: number[] | null; touch: boolean };

// positions from the map
const L = {
  vortex: { x: 0, z: 0, h: 23.5 },
  petronas: { x: 49.4, z: -35.8, h: 45.2 },
  kltower: { x: -39.5, z: 20.7, h: 42.1, base: 0 },
  merdeka: { x: -73.7, z: 145.1, h: 67.9 },
  exchange106: { x: 126.5, z: 142.9, h: 45.4 },
};
// the content's view ids, as the city names its landmarks
const MARK: Record<string, 'petronas' | 'kltower' | 'merdeka'> = { petronas: 'petronas', 'kl-tower': 'kltower', merdeka: 'merdeka' };
const VIEW_OF: Record<string, string> = { petronas: 'petronas', kltower: 'kl-tower', merdeka: 'merdeka' };
let levelY = (lv: number) => 0.1 + (lv / 58) * (L.vortex.h - 1.5);

// camera presets (the approved design's)
const P: Record<string, Rig> = {
  intro: { px: 520, py: 420, pz: 640, tx: 0, ty: 0, tz: 0, orbit: 0.02 },
  hero: { px: 125, py: 26, pz: 30, tx: 40, ty: 20, tz: -40, orbit: 0.018 },
  vortex: { px: 34, py: 30, pz: 40, tx: 0, ty: 13, tz: 0, orbit: 0.06 },
  aerial: { px: -160, py: 230, pz: 160, tx: 0, ty: 0, tz: 0, orbit: 0.02 },
  'aerial-low': { px: 120, py: 70, pz: -150, tx: 0, ty: 16, tz: 0, orbit: 0.015 },
  guides: { px: -240, py: 140, pz: -120, tx: 10, ty: 10, tz: 10, orbit: 0.012 },
  gallery: { px: 150, py: 120, pz: 40, tx: 45, ty: 6, tz: -30, orbit: 0.03 },
};
const DAY_WIDE: Rig = { px: 15, py: 36, pz: 25, tx: 32, ty: 22, tz: -46, orbit: 0 }; // Petronas sits right of the day card
const DAY_TALL: Rig = { px: 20, py: 42, pz: 8, tx: 49, ty: 24, tz: -36, orbit: 0 };
/** Stand inside the tower at that level and look at a landmark. */
function lookFrom(lv: number, mark: 'petronas' | 'kltower' | 'merdeka'): Rig {
  const T = L[mark], y = levelY(lv) + 0.4, dx = T.x - L.vortex.x, dz = T.z - L.vortex.z, d = Math.hypot(dx, dz);
  const ty = mark === 'kltower' ? (L.kltower.base || 0) + 31 : T.h * 0.62;
  return { px: L.vortex.x + (dx / d) * 2.2, py: y, pz: L.vortex.z + (dz / d) * 2.2, tx: T.x, ty, tz: T.z, orbit: 0 };
}
const LOOK_LEVEL = { petronas: 43, kltower: 47, merdeka: 47 };
const floorShot = (lv: number): Rig => ({ px: 22, py: levelY(lv) + 7, pz: 26, tx: 0, ty: levelY(lv), tz: 0, orbit: 0.07 });

/** A camera preset by name: one of P, 'day', 'look-<view>' or 'floor-<level>'. */
export function preset(name: string): Rig | null {
  if (P[name]) return P[name];
  if (name === 'day') return innerWidth < 640 ? DAY_TALL : DAY_WIDE;
  const look = /^look-(.+)$/.exec(name);
  if (look && MARK[look[1]]) return lookFrom(LOOK_LEVEL[MARK[look[1]]], MARK[look[1]]);
  const floor = /^floor-(\d{1,2})$/.exec(name);
  if (floor) return floorShot(Math.min(58, Number(floor[1])));
  return null;
}

// ------------------------------------------------------------------ can this device show it?
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const small = () => innerWidth < 640;
export function supported() {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (reduced() || nav.connection?.saveData) return false;
  if ((nav.deviceMemory && nav.deviceMemory < 2) || (nav.hardwareConcurrency && nav.hardwareConcurrency < 3)) return false;
  if (Math.min(screen.width, screen.height) < 330) return false;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}

// ------------------------------------------------------------------ state
const rig: Rig = { ...P.intro };
let orbitA = 0;
let THREE: Any, renderer: Any, scene: Any, camera: Any, uniforms: Any, FOG: Any, FOG_N: Any, FOG_D: Any, FOG_K: Any;
let post: Any = null, beacon: Any = null, vortexRing: Any[] = [];
const parts: Any[] = [], pickables: Any[] = [];
let ok = false, running = false, visible = !document.hidden;
let hi: number[] | null = null;
let page: PageCity = { cam: 'hero', pins: 'on', hi: null, touch: false };
let canvas: HTMLCanvasElement, stage: HTMLElement;
let readyResolve: (v: boolean) => void;
export const ready = new Promise<boolean>((r) => (readyResolve = r));
export const isOn = () => ok;

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const script = (src: string) => new Promise<void>((ok_, no) => {
  const s = document.createElement('script');
  s.src = BASE + src; s.async = false; s.onload = () => ok_(); s.onerror = () => no(new Error('could not load ' + src));
  document.head.append(s);
});
const frame = () => new Promise((r) => setTimeout(r, 0));

/** Fetch and build the city, then switch its lights on. `after` holds the build back (the intro plays first). */
let started: Promise<boolean> | null = null;
export function start(after: Promise<unknown> = Promise.resolve()) {
  return (started ??= (async () => {
    stage = document.querySelector<HTMLElement>('[data-stage]')!;
    canvas = stage?.querySelector<HTMLCanvasElement>('canvas') as HTMLCanvasElement;
    if (!canvas || !supported()) { readyResolve(false); return false; }
    try {
      const data = Promise.all([fetch(BASE + 'city.json').then((r) => r.json()), fetch(BASE + 'city.bin').then((r) => r.arrayBuffer())]);
      await Promise.all(SCRIPTS.map(script));
      const [man, bin] = await data;
      await after;
      await build(window.KLC.decode(bin, man));
    } catch (e) {
      console.warn('[city] staying with the still image:', (e as Error).message);
      readyResolve(false);
      return false;
    }
    ok = true;
    reveal();
    readyResolve(true);
    return true;
  })());
}

async function build(data: Any) {
  THREE = window.THREE;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, small() ? 1.5 : 1.75));
  scene = new THREE.Scene();
  FOG = new THREE.Color(0x1a1426);
  FOG_N = new THREE.Color(0x1a1426); FOG_D = new THREE.Color(0xc4cfdc); FOG_K = new THREE.Color(0xb07a6a);
  scene.background = new THREE.Color(0x05070d);
  camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 5000);
  uniforms = { uOn: { value: 0 }, uTime: { value: 0 }, uFog: { value: FOG }, uFogD: { value: 0.0024 }, uDay: { value: 0 }, uDusk: { value: 0 } };
  const group = new THREE.Group(); scene.add(group);
  const KLC = window.KLC;
  const ctx = { THREE, renderer, scene, camera, group, uniforms, data, small: small(), rng, L, pickables, heightAt: () => 0 };
  // one module at a time, letting the page breathe in between
  for (const m of ['ground', 'city', 'landmarks', 'sky']) {
    await frame();
    try {
      const r = KLC[m].build(ctx) || {};
      parts.push(r);
      if (m === 'landmarks') { levelY = r.vortex.levelY; vortexRing = r.vortex.rings; beacon = r.vortex.beacon; }
    } catch (e) { console.warn('[city] part failed:', m, e); }
  }
  L.kltower.base = (ctx.heightAt as (x: number, z: number) => number)(L.kltower.x, L.kltower.z) || 0;
  try { post = KLC.post.create(ctx); } catch { post = null; }
  canvas.addEventListener('webglcontextlost', () => { ok = false; stage.classList.remove('on'); });
  addEventListener('resize', resize);
  resize();
  input();
}

function resize() {
  if (!renderer) return;
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = innerWidth < innerHeight ? 58 : 42;
  camera.updateProjectionMatrix();
  post?.resize?.(innerWidth, innerHeight);
}

/** The lights come on and the camera flies in from high above to this page's view. */
function reveal() {
  stage.classList.add('on');
  loop();
  gsap.to(uniforms.uOn, { value: 1.1, duration: 3.2, ease: 'power1.inOut' });
  apply(3.6);
}

// ------------------------------------------------------------------ camera
let curTween: gsap.core.Tween | null = null;
function bake() { // move the orbit offset into the rig so a new flight starts from what is on screen
  const c = Math.cos(orbitA * rig.orbit), s = Math.sin(orbitA * rig.orbit); orbitA = 0;
  const dx = rig.px - rig.tx, dz = rig.pz - rig.tz;
  rig.px = rig.tx + dx * c - dz * s; rig.pz = rig.tz + dx * s + dz * c;
}
/** Fly to a preset (by name) or a rig. */
export function fly(to: string | Rig, dur = 2.4) {
  const p = typeof to === 'string' ? preset(to) : to;
  if (!p) return;
  if (!ok) { Object.assign(rig, p); return; }
  bake();
  curTween?.kill();
  curTween = gsap.to(rig, { ...p, duration: dur, ease: 'power3.inOut' });
}

/** The sky: 0 night .. 1 day, with a warm dusk tint. */
export function sky(day: number, dusk: number, dur = 1.6) {
  if (!uniforms) return;
  gsap.to(uniforms.uDay, { value: day, duration: dur, ease: 'power2.inOut', overwrite: 'auto' });
  gsap.to(uniforms.uDusk, { value: dusk, duration: dur, ease: 'power2.inOut', overwrite: 'auto' });
}

/** Light up our floors at these levels on the tower (null: all of them gently pulsing). */
export function highlight(levels: number[] | null) { hi = levels && levels.length ? levels : null; }

/** A new page: its camera, its pins and whether the city takes drags. */
export function setPage(p: PageCity) {
  page = p;
  document.documentElement.classList.toggle('no-city', p.cam === 'none');
  document.documentElement.toggleAttribute('data-city-touch', p.touch);
  yawT = 0; pitchT = 0;
  if (ok) apply(2.6);
}
function apply(dur: number) {
  highlight(page.hi);
  pins(page.pins);
  sky(0, 0, 1);
  if (page.cam !== 'none') fly(page.cam, dur);
}

// ------------------------------------------------------------------ drag to look around, tap a landmark
let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
let yaw = 0, pitch = 0, yawT = 0, pitchT = 0, mx = 0, my = 0;
function input() {
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: yawT, pitch: pitchT }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    yawT = drag.yaw + (e.clientX - drag.x) * 0.006;
    pitchT = Math.max(-0.5, Math.min(0.5, drag.pitch + (e.clientY - drag.y) * 0.004));
  });
  canvas.addEventListener('pointerup', (e) => { if (!drag) return; const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6; drag = null; if (!moved) pick(e); });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });
}
function pick(e: PointerEvent) {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const hit = ray.intersectObjects(pickables, false)[0];
  if (!hit) return;
  const id = hit.object.userData.pick as string;
  document.dispatchEvent(new CustomEvent('kozi:pick', { detail: { id: id === 'vortex' ? 'vortex' : VIEW_OF[id] ?? id } }));
}

// ------------------------------------------------------------------ pins: labels on landmarks
type Pin = { el: HTMLElement; at: () => [number, number, number] };
let pinList: Pin[] = [];
let avoid: HTMLElement[] = [];
function pins(mode: Pins) {
  const box = stage.querySelector<HTMLElement>('[data-pins]')!;
  box.classList.toggle('off', mode === 'off');
  box.classList.toggle('views', mode === 'views');
  if (!pinList.length) {
    const at: Record<string, () => [number, number, number]> = {
      vortex: () => [L.vortex.x, L.vortex.h + 2, L.vortex.z],
      petronas: () => [L.petronas.x, L.petronas.h + 1.5, L.petronas.z],
      'kl-tower': () => [L.kltower.x, (L.kltower.base || 0) + 44, L.kltower.z],
      merdeka: () => [L.merdeka.x, 71, L.merdeka.z],
    };
    pinList = [...box.querySelectorAll<HTMLElement>('[data-pin]')].filter((el) => at[el.dataset.pin!]).map((el) => ({ el, at: at[el.dataset.pin!] }));
  }
  // labels never sit on the words they would cover (the home page's headline and buttons, say)
  avoid = [...document.querySelectorAll<HTMLElement>('[data-pin-avoid] > *')];
}
/** Mark one landmark's pin (the view finder's current view). */
export function pinOn(id: string | null) { pinList.forEach((p) => p.el.classList.toggle('on', p.el.dataset.pin === id)); }

let tmp: Any = null;
function placePins() {
  if (page.pins === 'off') return;
  tmp ??= new THREE.Vector3();
  const rects = scrollY < innerHeight ? avoid.map((e) => e.getBoundingClientRect()) : [];
  for (const p of pinList) {
    const [x0, y0, z0] = p.at();
    tmp.set(x0, y0, z0).project(camera);
    const x = ((tmp.x + 1) / 2) * innerWidth, y = ((1 - tmp.y) / 2) * innerHeight;
    const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1 && !rects.some((r) => x + 120 > r.left && x - 120 < r.right && y > r.top && y - 70 < r.bottom);
    p.el.hidden = !vis;
    if (vis) p.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
  }
}

// ------------------------------------------------------------------ the render loop
let last = performance.now(), time = 0, odd = false;
document.addEventListener('visibilitychange', () => { visible = !document.hidden; if (visible && ok) { last = performance.now(); loop(); } });
function loop() {
  if (running || !ok || !visible) return;
  running = true;
  requestAnimationFrame(tick);
}
function tick() {
  running = false;
  if (!ok || !visible) return;
  requestAnimationFrame(tick); running = true;
  // behind a dimmed page, or with the city hidden, half the frames are plenty
  const root = document.documentElement;
  if (root.classList.contains('no-city')) return;
  if (root.classList.contains('dim') && (odd = !odd)) return;
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
  uniforms.uTime.value = time;
  orbitA += dt;
  yaw += (yawT - yaw) * 0.08; pitch += (pitchT - pitch) * 0.08;
  const turn = orbitA * rig.orbit + yaw * (rig.orbit ? 1 : 0), c = Math.cos(turn), s = Math.sin(turn);
  const dx = rig.px - rig.tx, dz = rig.pz - rig.tz;
  camera.position.set(rig.tx + dx * c - dz * s, rig.py, rig.tz + dx * s + dz * c);
  let tx = rig.tx, ty = rig.ty, tz = rig.tz;
  if (!rig.orbit) { // standing still: dragging turns the head instead
    const fx = rig.tx - rig.px, fz = rig.tz - rig.pz, cy = Math.cos(yaw), sy = Math.sin(yaw);
    tx = rig.px + fx * cy - fz * sy; tz = rig.pz + fx * sy + fz * cy; ty = rig.ty + pitch * 40;
  }
  camera.lookAt(tx + mx * (rig.orbit ? 6 : 1.5), ty - my * (rig.orbit ? 4 : 1), tz);
  const dl = uniforms.uDay.value, dk = uniforms.uDusk.value;
  FOG.copy(FOG_N).lerp(FOG_D, dl).lerp(FOG_K, dk * 0.6);
  for (const p of parts) p.update?.(uniforms.uTime.value, dt);
  if (beacon) beacon.material.opacity = 0.75 + 0.25 * Math.sin(time * 2.4);
  for (const r of vortexRing) r.material.opacity = hi === null ? 0.5 + 0.2 * Math.sin(time * 2 + r.userData.lv) : hi.includes(r.userData.lv) ? 1 : 0.12;
  if (post) post.render(); else renderer.render(scene, camera);
  placePins();
}
