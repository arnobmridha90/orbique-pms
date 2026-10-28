// Makes the bundled photos the pages show: public/photos/<key>-<W>.jpg for W in 640, 1280 and 2400, from
// src/assets/photos (run before every build of the sites; files that are already up to date are skipped).
// It also writes src/shared/data/photos.json, the list of bundled photos with their sizes, which the content
// loader, /content.json and Orbique's "Live website" panel read. Commit that file when it changes.
//
// The widths follow the content contract (see src/shared/lib/content.ts). A width is made when the photo is at
// least that wide. A photo that sits well between two widths also gets the next width up at its own size, never
// enlarged (a 1080 px photo gets 640 and a "1280" file 1080 px wide), so a big screen still gets every pixel.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src/assets/photos');
const OUT = join(root, 'public/photos');
const LIST = join(root, 'src/shared/data/photos.json');
const WIDTHS = [640, 1280, 2400];

const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.jpg') ? [join(dir, e.name)] : []);

function widthsFor(w) {
  const exact = WIDTHS.filter((x) => x <= w);
  if (!exact.length) return [640]; // smaller than the smallest width: one file at its own size
  const next = WIDTHS.find((x) => x > w);
  return next && w > exact[exact.length - 1] * 1.15 ? [...exact, next] : exact;
}

const list = {};
let made = 0;
for (const file of files(SRC).sort()) {
  const key = relative(SRC, file).replace(/\\/g, '/').replace(/\.jpg$/, '');
  const meta = await sharp(file).metadata();
  const turned = (meta.orientation ?? 1) >= 5; // EXIF says the photo is on its side
  const sw = turned ? meta.height : meta.width, sh = turned ? meta.width : meta.height;
  const widths = widthsFor(sw);
  const top = Math.min(widths[widths.length - 1], sw);
  list[key] = { w: top, h: Math.round((sh * top) / sw), widths };
  const changed = statSync(file).mtimeMs;
  for (const W of widths) {
    const out = join(OUT, `${key}-${W}.jpg`);
    if (existsSync(out) && statSync(out).mtimeMs >= changed) continue;
    mkdirSync(dirname(out), { recursive: true });
    await sharp(file).rotate().resize({ width: Math.min(W, sw), withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true, progressive: true }).toFile(out);
    made++;
  }
}

// one photo a line, so a change reads well in a diff
const json = `{\n${Object.entries(list).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`;
if (!existsSync(LIST) || readFileSync(LIST, 'utf8') !== json) writeFileSync(LIST, json);
console.log(`site-photos: ${Object.keys(list).length} photos, ${made} files made`);
