// voeg-workshops.mjs — voeg in één keer nieuwe workshops toe aan de agenda.
//
// Draaien vanuit de projectmap:
//   node tools/voeg-workshops.mjs "<datum tijd>" "<datum tijd>" ...
//
// Voorbeelden:
//   node tools/voeg-workshops.mjs "1 nov 13:00" "5 nov 19:00" "12 nov 19:00"
//   node tools/voeg-workshops.mjs "2026-12-03 19:00"
//
// Datum mag als "1 nov", "1 november" of "2026-11-01". Laat je het jaar weg,
// dan pakt het script vanzelf het eerstvolgende jaar waarin die datum nog komt.
// Tijd als "13:00", "19:00" of kortweg "13" / "19". Wintertijd/zomertijd (+01:00
// of +02:00) wordt automatisch goed gezet voor Nederland.
//
// De locatie is standaard dezelfde als die van de laatste workshop in de agenda
// (nu Atelier de Kust in Den Haag). Wil je dat voor alles aanpassen, draai daarna
// gewoon set-locatie.mjs. Het script past events.json aan (de bron) en draait
// daarna automatisch build-seo.mjs, zodat de agenda én de SEO-schema's kloppen.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Gebruik: node tools/voeg-workshops.mjs "<datum tijd>" ["<datum tijd>" ...]');
  console.error('Voorbeeld: node tools/voeg-workshops.mjs "1 nov 13:00" "5 nov 19:00"');
  process.exit(1);
}

const MAANDEN = {
  jan: 1, januari: 1,
  feb: 2, februari: 2,
  mrt: 3, maart: 3,
  apr: 4, april: 4,
  mei: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  aug: 8, augustus: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

// Nederlandse tijdzone-offset (+01:00 of +02:00) voor een wandklok-moment.
function nlOffset(y, mo, d, h, mi) {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const tzName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Amsterdam",
    timeZoneName: "longOffset",
  })
    .formatToParts(guess)
    .find((p) => p.type === "timeZoneName").value; // bv. "GMT+01:00"
  const m = tzName.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : "+01:00";
}

const p2 = (n) => String(n).padStart(2, "0");

function parseInvoer(raw) {
  const tekst = raw.trim().toLowerCase();
  const stukken = tekst.split(/\s+/);
  if (stukken.length < 2) {
    throw new Error(`kon "${raw}" niet lezen — verwacht een datum én een tijd`);
  }

  const tijd = stukken.pop();
  const tm = tijd.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!tm) throw new Error(`"${tijd}" is geen geldige tijd (gebruik bv. 13:00 of 19)`);
  const uur = Number(tm[1]);
  const minuut = tm[2] ? Number(tm[2]) : 0;
  if (uur > 23 || minuut > 59) throw new Error(`"${tijd}" is geen geldige tijd`);

  const datum = stukken.join(" ");
  let jaar, maand, dag;

  const iso = datum.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    [, jaar, maand, dag] = iso.map(Number);
  } else {
    const dm = datum.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/);
    if (!dm) throw new Error(`"${datum}" is geen geldige datum (gebruik bv. "1 nov" of "2026-11-01")`);
    dag = Number(dm[1]);
    maand = MAANDEN[dm[2]];
    if (!maand) throw new Error(`"${dm[2]}" is geen maand die ik ken`);
    jaar = dm[3] ? Number(dm[3]) : null;
  }

  // Zonder jaar: pak het eerstvolgende jaar waarin deze datum nog komt.
  if (jaar == null) {
    const nu = new Date();
    jaar = nu.getFullYear();
    const kandidaat = new Date(jaar, maand - 1, dag, uur, minuut);
    if (kandidaat < nu) jaar += 1;
  }

  // Controleer dat de datum echt bestaat (bv. geen 31 november).
  const check = new Date(jaar, maand - 1, dag);
  if (check.getMonth() !== maand - 1 || check.getDate() !== dag) {
    throw new Error(`${dag}-${maand}-${jaar} bestaat niet`);
  }

  const offset = nlOffset(jaar, maand, dag, uur, minuut);
  const id = `${jaar}-${p2(maand)}-${p2(dag)}-${p2(uur)}${p2(minuut)}`;
  const start = `${jaar}-${p2(maand)}-${p2(dag)}T${p2(uur)}:${p2(minuut)}:00${offset}`;
  return { id, start };
}

const file = join(root, "events.json");
const events = JSON.parse(readFileSync(file, "utf8"));
const bestaandeIds = new Set(events.map((e) => e.id));

// Locatie overnemen van de laatste workshop in de agenda (val anders terug op
// de standaardlocatie in Den Haag).
const laatste = events[events.length - 1] || {};
const sjabloon = {
  city: laatste.city || "Den Haag",
  venue: laatste.venue || "Atelier de Kust",
  street: laatste.street || "Goudenregenstraat 34E",
  price: laatste.price || 55,
};

const toegevoegd = [];
const overgeslagen = [];

for (const raw of args) {
  let parsed;
  try {
    parsed = parseInvoer(raw);
  } catch (err) {
    console.error(`Overslaan: ${err.message}`);
    process.exit(1);
  }
  if (bestaandeIds.has(parsed.id)) {
    overgeslagen.push(parsed.id);
    continue;
  }
  bestaandeIds.add(parsed.id);
  events.push({
    id: parsed.id,
    start: parsed.start,
    city: sjabloon.city,
    venue: sjabloon.venue,
    street: sjabloon.street,
    price: sjabloon.price,
    status: "available",
  });
  toegevoegd.push(parsed);
}

// Chronologisch sorteren op starttijd.
events.sort((a, b) => a.start.localeCompare(b.start));

// Terugschrijven in de compacte opmaak (één workshop per regel).
const regel = (e) => {
  const velden = [`"id": ${JSON.stringify(e.id)}`, `"start": ${JSON.stringify(e.start)}`, `"city": ${JSON.stringify(e.city)}`];
  if (e.venue != null) velden.push(`"venue": ${JSON.stringify(e.venue)}`);
  if (e.street != null) velden.push(`"street": ${JSON.stringify(e.street)}`);
  velden.push(`"price": ${JSON.stringify(e.price)}`, `"status": ${JSON.stringify(e.status)}`);
  return `  { ${velden.join(", ")} }`;
};
const uit = "[\n" + events.map(regel).join(",\n") + "\n]\n";

// Controleer dat het geldige JSON blijft voordat we wegschrijven.
JSON.parse(uit);
writeFileSync(file, uit);

if (toegevoegd.length) {
  console.log(`${toegevoegd.length} workshop(s) toegevoegd:`);
  for (const t of toegevoegd) console.log(`  ${t.start}`);
}
if (overgeslagen.length) {
  console.log(`${overgeslagen.length} stond(en) al in de agenda, overgeslagen: ${overgeslagen.join(", ")}`);
}
if (!toegevoegd.length) {
  console.log("Niets toegevoegd.");
  process.exit(0);
}

console.log("SEO-data opnieuw genereren...");

// build-seo.mjs draait zichzelf bij het importeren.
await import("./build-seo.mjs");
