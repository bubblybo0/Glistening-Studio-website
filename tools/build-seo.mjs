// build-seo.mjs — werkt de SEO-data bij vanuit events.json (één bron van waarheid).
//
// Draaien vanuit de projectmap:  node tools/build-seo.mjs
//
// Doet twee dingen, automatisch en consistent:
//   1. Zet de Event structured data (JSON-LD) in workshops.html — alleen komende
//      workshops, met endDate, juiste beschikbaarheid, nette locatie en één vaste
//      organisator-URL. Geen losse Mollie-links meer.
//   2. Genereert sitemap.xml met alleen de echte, indexeerbare pagina's (geen
//      ?event=-URL's, geen changefreq/priority).
//
// Voer dit uit telkens nadat je events.json hebt aangepast.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildSiteNav } from "./build-nav.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://glisteningstudio.com";
const TZ = "Europe/Amsterdam";
const DURATION_HOURS = 2.5;

const events = JSON.parse(readFileSync(join(root, "events.json"), "utf8"));

// Alleen komende workshops (met kleine marge), op datum gesorteerd.
const upcoming = events
  .filter((ev) => new Date(ev.start).getTime() + 12 * 3600e3 > Date.now())
  .sort((a, b) => new Date(a.start) - new Date(b.start));

function dutchDate(startISO) {
  return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", timeZone: TZ }).format(new Date(startISO));
}

function englishDate(startISO) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: TZ }).format(new Date(startISO));
}

// Voegt uren toe en houdt dezelfde UTC-offset als de begintijd aan.
function endDate(startISO) {
  const m = startISO.match(/([+-]\d{2}:\d{2})$/);
  const offset = m ? m[1] : "+00:00";
  const sign = offset[0] === "-" ? -1 : 1;
  const offMin = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const ms = Date.parse(startISO) + DURATION_HOURS * 3600e3;
  return new Date(ms + offMin * 60000).toISOString().slice(0, 19) + offset;
}

// --- 1. JSON-LD voor workshops.html (NL) én en/workshops.html (EN) ---------
// Eén bron (events.json) → beide talen blijven automatisch gelijk.
function buildJsonLd({ pagePath, formatDate, cityLabel, venueFallback }) {
  return upcoming.map((ev) => {
    const city = cityLabel(ev.city);
    return {
      "@context": "https://schema.org",
      "@type": "Event",
      name: `Suncatcher workshop ${city} · ${formatDate(ev.start)}`,
      startDate: ev.start,
      endDate: endDate(ev.start),
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      eventStatus: "https://schema.org/EventScheduled",
      location: {
        "@type": "Place",
        name: ev.venue || venueFallback(city),
        address: {
          "@type": "PostalAddress",
          ...(ev.street ? { streetAddress: ev.street } : {}),
          addressLocality: city,
          addressCountry: "NL"
        }
      },
      organizer: { "@type": "Organization", name: "Glistening Studio", url: `${SITE}/` },
      image: `${SITE}/suncatchers-tuin.jpg`,
      url: `${SITE}${pagePath}#agenda`,
      offers: {
        "@type": "Offer",
        price: String(ev.price != null ? ev.price : 55) + ".00",
        priceCurrency: "EUR",
        availability: ev.status && ev.status !== "available"
          ? "https://schema.org/SoldOut"
          : "https://schema.org/InStock",
        url: `${SITE}${pagePath}#agenda`
      }
    };
  });
}

function writeJsonLd(relPath, jsonld) {
  const ldBlock = JSON.stringify(jsonld, null, 2);
  const filePath = join(root, relPath);
  let html = readFileSync(filePath, "utf8");
  html = html.replace(
    /(<script type="application\/ld\+json">)[\s\S]*?(<\/script>)/,
    `$1\n${ldBlock}\n$2`
  );
  writeFileSync(filePath, html);
}

writeJsonLd("workshops.html", buildJsonLd({
  pagePath: "/workshops.html",
  formatDate: dutchDate,
  cityLabel: (c) => c,
  venueFallback: (c) => `Sfeervol atelier in ${c}`
}));

writeJsonLd("en/workshops.html", buildJsonLd({
  pagePath: "/en/workshops.html",
  formatDate: englishDate,
  cityLabel: (c) => (c === "Den Haag" ? "The Hague" : c),
  venueFallback: (c) => `Cozy studio in ${c}`
}));

// --- 2. sitemap.xml --------------------------------------------------------
const pages = ["/", "/workshops.html", "/privegroepen.html", "/zakelijke-groepen.html", "/over-ons.html", "/contact.html"];
const today = new Date().toISOString().slice(0, 10);
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  pages.map((p) => `  <url>\n    <loc>${SITE}${p}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`).join("\n") +
  `\n</urlset>\n`;
writeFileSync(join(root, "sitemap.xml"), sitemap);

console.log(`SEO bijgewerkt: ${upcoming.length} komende workshop(s) in JSON-LD, ${pages.length} pagina's in sitemap.`);

// --- 3. navigatie/menu/taalknop op elke pagina bijwerken -------------------
buildSiteNav();
