# AGENTS.md — Glistening Studio

Context voor AI-agents (Codex, Claude, e.a.) die aan deze repo werken. Lees dit eerst.

## Wat is dit
Statische website van **Glistening Studio** (glisteningstudio.com): workshops waarin
deelnemers hun eigen kristallen suncatcher maken, gevestigd in **Den Haag**. Nederlandstalig.
Eenmanszaak (Kiki), die zelf nog aan het leren is op technisch vlak — leg keuzes simpel uit.

## Techniek
- **Puur statisch**: losse HTML-pagina's + één `style.css` + één `main.js`. **Geen build-stap,
  geen framework, geen dependencies, geen package.json.** Gewoon bestanden bewerken.
- `main.js` = vanilla JS (menu, video-autoplay, scroll-reveals, ticket-stepper). Geen libraries.
- Data van workshops staat in `events.json`; sommige pagina's laden dit async.
- Hosting: GitHub Pages via het `CNAME`-bestand (mogelijk migratie naar Cloudflare Pages).
  Elke push naar `main` gaat live.

## Pagina's
`index.html` (home), `workshops.html` (agenda + tickets), `workshop.html` (detail),
`evenement.html`, `over-ons.html`, `contact.html`, `bedankt.html` (na betaling), `404.html`.

## Tickets / betalingen
- Boekknoppen sturen naar een **Cloudflare Worker** (`glistening-studio-tickets`) die
  per klik dynamisch een **Mollie**-betaling aanmaakt (€45/ticket, max 8).
- Zie `WORKER_BOOK_URL` en `MAX_TICKET_QTY` in `main.js`.

## Harde regels
- **Nooit** betaal-/API-/Mollie-sleutels of tokens in de repo zetten. Die horen alleen in
  Cloudflare thuis. De repo is **publiek** — behandel alles hierin als openbaar.
- Behoud de bestaande stijl: rustig, licht, warm; sfeervolle foto's/video's. De site staat
  bewust vast op **light mode** (`data-theme="light"` + `color-scheme: light`) — niet weghalen.
- Houd het simpel: geen build-tools of frameworks toevoegen zonder goede reden.

## Conventies
- Behoud toegankelijkheid: `alt`-teksten, `aria-*`, `prefers-reduced-motion`, skip-link.
- Nederlandse teksten, `lang="nl"`. Semantische HTML.
- Kleine, gerichte wijzigingen; commit-berichten kort en duidelijk.
