// optimize-images.mjs — verkleint en comprimeert te grote foto's in de projectmap.
//
// Draaien vanuit de projectmap:  node tools/optimize-images.mjs
// (eenmalig eerst de tool installeren:  npm install )
//
// Wat het doet, veilig en herhaalbaar:
//   - Loopt door alle .jpg/.jpeg in de projectmap (niet in en/, tools, .git, node_modules —
//     en/ gebruikt dezelfde foto's uit de hoofdmap).
//   - Pakt alleen foto's die echt te groot zijn: breder dan 1300px OF zwaarder dan 320 KB.
//   - Schaalt naar maximaal 1200px (langste zijde), comprimeert naar kwaliteit 80 (mozjpeg),
//     en respecteert de EXIF-oriëntatie zodat niets gedraaid raakt.
//   - Overschrijft alleen als het resultaat écht kleiner is. Al geoptimaliseerde foto's
//     worden overgeslagen, dus je kunt dit zo vaak draaien als je wilt.
//
// Handig na het toevoegen van nieuwe foto's: eerst dit script, dan pas committen.

import sharp from "sharp";
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_SIDE = 1200;      // langste zijde na verkleinen
const QUALITY = 80;         // JPEG-kwaliteit
const MIN_WIDTH = 1300;     // breder dan dit -> verkleinen
const MIN_BYTES = 320 * 1024; // zwaarder dan dit -> opnieuw comprimeren

const files = readdirSync(root).filter((n) => /\.jpe?g$/i.test(n));

let touched = 0;
let savedBytes = 0;

for (const name of files) {
  const path = join(root, name);
  const before = statSync(path).size;
  const input = readFileSync(path);
  const meta = await sharp(input).metadata();
  const tooWide = (meta.width || 0) > MIN_WIDTH || (meta.height || 0) > MIN_WIDTH;
  const tooHeavy = before > MIN_BYTES;
  if (!tooWide && !tooHeavy) continue;

  const out = await sharp(input)
    .rotate() // respecteer EXIF-oriëntatie
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toBuffer();

  if (out.length < before) {
    writeFileSync(path, out);
    touched++;
    savedBytes += before - out.length;
    console.log(`  ${name}: ${(before / 1024).toFixed(0)}KB -> ${(out.length / 1024).toFixed(0)}KB`);
  }
}

if (touched) {
  console.log(`\n✓ ${touched} foto('s) geoptimaliseerd, samen ${(savedBytes / 1024 / 1024).toFixed(2)} MB lichter.`);
} else {
  console.log("✓ Alle foto's zijn al klein genoeg, niets te doen.");
}
