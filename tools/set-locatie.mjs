// set-locatie.mjs — zet in één keer de locatie van alle losse workshops.
//
// Draaien vanuit de projectmap:
//   node tools/set-locatie.mjs "<venue>" "<straat>" ["<plaats>"]
//
// Voorbeeld:
//   node tools/set-locatie.mjs "Atelier de Kust" "Goudenregenstraat 34E" "Den Haag"
//
// De plaats is optioneel; laat je 'm weg, dan blijft de huidige plaats staan.
// Het script past events.json aan (de bron) en draait daarna automatisch
// build-seo.mjs, zodat de zichtbare locatie én de SEO-schema's meteen kloppen.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const [venue, street, city] = process.argv.slice(2);

if (!venue || !street) {
  console.error('Gebruik: node tools/set-locatie.mjs "<venue>" "<straat>" ["<plaats>"]');
  console.error('Voorbeeld: node tools/set-locatie.mjs "Atelier de Kust" "Goudenregenstraat 34E" "Den Haag"');
  process.exit(1);
}

// JSON netjes escapen (aanhalingstekens en backslashes) voor in de tekst.
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const file = join(root, "events.json");
let text = readFileSync(file, "utf8");

// We vervangen op tekstniveau zodat de compacte opmaak (één workshop per regel)
// behouden blijft.
text = text.replace(/"venue":\s*"(?:[^"\\]|\\.)*"/g, `"venue": "${esc(venue)}"`);
text = text.replace(/"street":\s*"(?:[^"\\]|\\.)*"/g, `"street": "${esc(street)}"`);
if (city) {
  text = text.replace(/"city":\s*"(?:[^"\\]|\\.)*"/g, `"city": "${esc(city)}"`);
}

// Controleer dat het geldige JSON blijft voordat we wegschrijven.
const count = JSON.parse(text).length;
writeFileSync(file, text);

console.log(`Locatie bijgewerkt voor ${count} workshop(s):`);
console.log(`  ${venue}, ${street}${city ? ", " + city : ""}`);
console.log("SEO-data opnieuw genereren...");

// build-seo.mjs draait zichzelf bij het importeren.
await import("./build-seo.mjs");
