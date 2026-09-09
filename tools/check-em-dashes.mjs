#!/usr/bin/env node
/*
 * check-em-dashes.mjs — waarschuwt zodra er een em-dash (—) in de zichtbare
 * tekst van de site sluipt. Die tekens komen vooral uit AI-gegenereerde tekst
 * en horen niet op de site; vervang ze door een komma, dubbelpunt, haakjes of
 * een middot (·).
 *
 * Gebruik:
 *   node tools/check-em-dashes.mjs            → scant alle .html-bestanden
 *   node tools/check-em-dashes.mjs a.html ... → scant alleen die bestanden
 *
 * Sluit af met code 1 als er em-dashes gevonden zijn (zodat een git-hook of CI
 * de commit kan tegenhouden), anders met code 0.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const EM_DASH = "—"; // —
const SKIP_DIRS = new Set([".git", "node_modules", "tools"]);

function findHtml(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...findHtml(full));
    else if (name.endsWith(".html")) out.push(full);
  }
  return out;
}

// Bestandslijst: uit argumenten, of anders alle .html in de repo.
const args = process.argv.slice(2).filter((a) => a.endsWith(".html"));
const files = args.length ? args : findHtml(ROOT);

let hits = 0;
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // bestand bestaat niet (meer) — overslaan
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes(EM_DASH)) {
      const rel = relative(ROOT, file) || file;
      console.log(`  ${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
      hits++;
    }
  });
}

if (hits) {
  console.error(`\n✗ ${hits} em-dash(es) (—) gevonden in de zichtbare tekst.`);
  console.error(`  Vervang ze door een komma, dubbelpunt, haakjes of · (middot).\n`);
  process.exit(1);
}
console.log("✓ Geen em-dashes gevonden in de .html-bestanden.");
