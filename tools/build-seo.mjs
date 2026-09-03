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

// Voegt uren toe en houdt dezelfde UTC-offset als de begintijd aan.
function endDate(startISO) {
  const m = startISO.match(/([+-]\d{2}:\d{2})$/);
  const offset = m ? m[1] : "+00:00";
  const sign = offset[0] === "-" ? -1 : 1;
  const offMin = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const ms = Date.parse(startISO) + DURATION_HOURS * 3600e3;
  return new Date(ms + offMin * 60000).toISOString().slice(0, 19) + offset;
}

// --- 1. JSON-LD voor workshops.html ---------------------------------------
const jsonld = upcoming.map((ev) => ({
  "@context": "https://schema.org",
  "@type": "Event",
  name: `Suncatcher workshop ${ev.city} — ${dutchDate(ev.start)}`,
  startDate: ev.start,
  endDate: endDate(ev.start),
  eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
  eventStatus: "https://schema.org/EventScheduled",
  location: {
    "@type": "Place",
    name: `Sfeervol atelier in ${ev.city}`,
    address: { "@type": "PostalAddress", addressLocality: ev.city, addressCountry: "NL" }
  },
  organizer: { "@type": "Organization", name: "Glistening Studio", url: `${SITE}/` },
  image: `${SITE}/suncatchers-tuin.jpg`,
  url: `${SITE}/workshops.html#agenda`,
  offers: {
    "@type": "Offer",
    price: String(ev.price != null ? ev.price : 45) + ".00",
    priceCurrency: "EUR",
    availability: ev.status && ev.status !== "available"
      ? "https://schema.org/SoldOut"
      : "https://schema.org/InStock",
    url: `${SITE}/workshops.html#agenda`
  }
}));

const ldBlock = JSON.stringify(jsonld, null, 2);
const workshopsPath = join(root, "workshops.html");
let html = readFileSync(workshopsPath, "utf8");
html = html.replace(
  /(<script type="application\/ld\+json">)[\s\S]*?(<\/script>)/,
  `$1\n${ldBlock}\n$2`
);
writeFileSync(workshopsPath, html);

// --- 2. sitemap.xml --------------------------------------------------------
const pages = ["/", "/workshops.html", "/over-ons.html", "/contact.html"];
const today = new Date().toISOString().slice(0, 10);
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  pages.map((p) => `  <url>\n    <loc>${SITE}${p}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`).join("\n") +
  `\n</urlset>\n`;
writeFileSync(join(root, "sitemap.xml"), sitemap);

console.log(`SEO bijgewerkt: ${upcoming.length} komende workshop(s) in JSON-LD, ${pages.length} pagina's in sitemap.`);
