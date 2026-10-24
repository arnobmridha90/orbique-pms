// Writes src/shared/data/land-mask.json: an even grid of points over the globe, one bit per point
// saying whether it is on land (Natural Earth 1:110m, via world-atlas). The globe on staykozi.com
// draws these points. It takes a few seconds, so it runs by hand: node scripts/land-mask.mjs
import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import { readFileSync, writeFileSync } from 'node:fs';

const STEP = 1.4; // degrees between points
const world = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/land-110m.json', import.meta.url)));
const land = feature(world, world.objects.land);
const rows = Math.round(180 / STEP);
const counts = [];
const bits = [];
for (let i = 0; i < rows; i++) {
  const lat = 90 - ((i + 0.5) * 180) / rows;
  // fewer points towards the poles, so they sit evenly on the sphere
  const n = Math.max(1, Math.round((360 / STEP) * Math.cos((lat * Math.PI) / 180)));
  counts.push(n);
  for (let j = 0; j < n; j++) bits.push(geoContains(land, [-180 + ((j + 0.5) * 360) / n, lat]));
}
const bytes = new Uint8Array(Math.ceil(bits.length / 8));
bits.forEach((b, k) => { if (b) bytes[k >> 3] |= 1 << (k & 7); });
const out = { source: 'Natural Earth 1:110m land, via world-atlas 2.0.2', step: STEP, counts, data: Buffer.from(bytes).toString('base64') };
writeFileSync(new URL('../src/shared/data/land-mask.json', import.meta.url), JSON.stringify(out));
console.log(`${bits.length} points, ${bits.filter(Boolean).length} on land`);
