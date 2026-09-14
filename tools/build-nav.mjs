// build-nav.mjs — genereert de navigatiebalk + het uitklapmenu op elke pagina
// vanuit één bron van waarheid (de PAGES-tabel hieronder).
//
// Draaien vanuit de projectmap:  node tools/build-nav.mjs
//
// Waarom: de header (met o.a. de taalknop) stond op drie plekken per pagina en
// op 18 pagina's tegelijk. Wil je iets aan het menu of de taalknop wijzigen,
// pas dan dit script aan en draai het één keer — alle pagina's blijven gelijk.
//
// Wat het doet: vervangt in elke pagina het <nav class="site-nav">…</nav>-blok
// en het <div class="nav-overlay" id="navOverlay">…</div>-blok door de
// gegenereerde versie. De rest van de pagina blijft ongemoeid.
//
// Een nieuwe pagina toevoegen? Zet één regel in PAGES: het pad + de taal + de
// link naar de andere taalversie (alt). Meer is niet nodig.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- Bron van waarheid: elke pagina, de taal en de link naar de andere taal ---
const PAGES = {
  // Nederlandse pagina's -> link naar de Engelse versie
  "index.html":             { lang: "nl", alt: "en/index.html" },
  "workshops.html":         { lang: "nl", alt: "en/workshops.html" },
  "over-ons.html":          { lang: "nl", alt: "en/about.html" },
  "contact.html":           { lang: "nl", alt: "en/contact.html" },
  "privegroepen.html":      { lang: "nl", alt: "en/private-groups.html" },
  "zakelijke-groepen.html": { lang: "nl", alt: "en/corporate-groups.html" },
  "workshop.html":          { lang: "nl", alt: "en/workshop.html", keepQuery: true },
  "bedankt.html":           { lang: "nl", alt: "en/bedankt.html" },
  "evenement.html":         { lang: "nl", alt: "en/evenement.html" },
  // Engelse pagina's (map en/) -> link terug naar de Nederlandse versie
  "en/index.html":            { lang: "en", alt: "../index.html" },
  "en/workshops.html":        { lang: "en", alt: "../workshops.html" },
  "en/about.html":            { lang: "en", alt: "../over-ons.html" },
  "en/contact.html":          { lang: "en", alt: "../contact.html" },
  "en/private-groups.html":   { lang: "en", alt: "../privegroepen.html" },
  "en/corporate-groups.html": { lang: "en", alt: "../zakelijke-groepen.html" },
  "en/workshop.html":         { lang: "en", alt: "../workshop.html", keepQuery: true },
  "en/bedankt.html":          { lang: "en", alt: "../bedankt.html" },
  "en/evenement.html":        { lang: "en", alt: "../evenement.html" },
};

// --- Teksten en paden per taal (alles wat per taal verschilt staat hier) ------
const STR = {
  nl: {
    about: "over-ons.html", aboutLabel: "Over mij", cta: "Bekijk workshops",
    altLabel: "English", altLang: "en",   // de taalknop wijst naar Engels
    closeAria: "Menu sluiten", asset: "",  // overlay-video staat in de hoofdmap
  },
  en: {
    about: "about.html", aboutLabel: "About", cta: "View workshops",
    altLabel: "Nederlands", altLang: "nl", // de taalknop wijst naar Nederlands
    closeAria: "Close menu", asset: "../", // overlay-video staat een map hoger
  },
};

// Bouwt één taalknop (<a class="lang-link ...">). extra = extra CSS-classes.
function langLink(cfg, s, extra = "") {
  const cls = extra ? `lang-link ${extra}` : "lang-link";
  const kq = cfg.keepQuery ? " data-keep-query" : "";
  return `<a class="${cls}" href="${cfg.alt}" hreflang="${s.altLang}" lang="${s.altLang}"${kq}>${s.altLabel}</a>`;
}

// De navigatiebalk: taalknop linksboven (mobiel), links in het midden, menu rechts.
function buildNav(cfg, s) {
  return `<nav class="site-nav">
  ${langLink(cfg, s, "lang-link-mobile")}
  <div class="site-nav-links">
    <a href="index.html">Home</a>
    <a href="workshops.html">Workshops</a>
    <a href="${s.about}">${s.aboutLabel}</a>
    <a href="contact.html">Contact</a>
    <a class="cta" href="workshops.html">${s.cta}</a>
    ${langLink(cfg, s)}
  </div>
  <button class="menu-btn" id="menuToggle" aria-haspopup="true" aria-expanded="false" aria-controls="navOverlay">
    <span class="bars"><span></span><span></span><span></span></span>
    Menu
  </button>
</nav>`;
}

// Het volledige-scherm uitklapmenu.
function buildOverlay(cfg, s) {
  return `<div class="nav-overlay" id="navOverlay">
  <video class="nav-overlay-bg" autoplay muted loop playsinline poster="${s.asset}hero-poster.jpg" aria-hidden="true">
    <source src="${s.asset}hero.mp4" type="video/mp4">
  </video>
  <button class="close-btn" id="navClose" aria-label="${s.closeAria}">&times;</button>
  <a href="index.html">Home</a>
  <a href="workshops.html">Workshops</a>
  <a href="${s.about}">${s.aboutLabel}</a>
  <a href="contact.html">Contact</a>
  <a class="cta" href="workshops.html">${s.cta}</a>
  ${langLink(cfg, s)}
</div>`;
}

// Genereert de nav op alle pagina's. Wordt los aangeroepen (node tools/build-nav.mjs)
// en ook vanuit build-seo.mjs, zodat één commando alles bijwerkt.
export function buildSiteNav() {
  let changed = 0;
  for (const [rel, cfg] of Object.entries(PAGES)) {
    const s = STR[cfg.lang];
    const file = join(root, rel);
    const original = readFileSync(file, "utf8");

    let html = original;
    const nav = buildNav(cfg, s);
    const overlay = buildOverlay(cfg, s);

    const navRe = /<nav class="site-nav">[\s\S]*?<\/nav>/;
    const overlayRe = /<div class="nav-overlay" id="navOverlay">[\s\S]*?<\/div>/;
    if (!navRe.test(html)) throw new Error(`Geen <nav class="site-nav"> gevonden in ${rel}`);
    if (!overlayRe.test(html)) throw new Error(`Geen nav-overlay gevonden in ${rel}`);

    html = html.replace(navRe, nav).replace(overlayRe, overlay);

    if (html !== original) {
      writeFileSync(file, html);
      changed++;
      console.log(`bijgewerkt: ${rel}`);
    }
  }

  console.log(changed === 0
    ? `Navigatie is al up-to-date (${Object.keys(PAGES).length} pagina's gecontroleerd).`
    : `Navigatie bijgewerkt op ${changed} van ${Object.keys(PAGES).length} pagina's.`);
  return changed;
}

// Alleen uitvoeren als dit bestand direct wordt gedraaid (niet bij importeren).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildSiteNav();
}
