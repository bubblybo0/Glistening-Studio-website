// ===========================================================================
// Glistening Studio — ticket-Worker (Cloudflare)
// ---------------------------------------------------------------------------
// Wat deze Worker doet:
//   POST /book         -> maakt een Mollie-betaling voor een workshop en stuurt
//                         de klant door naar de Mollie-betaalpagina. Weigert als
//                         de workshop al vol is (max 15).
//   POST /webhook      -> Mollie belt dit adres na een betaling. Bij "paid":
//                         tellen we de plekken op en versturen we 2 mails
//                         (bevestiging aan de klant + seintje aan Kiki).
//   GET  /availability -> geeft per workshop terug hoeveel plekken al bezet zijn
//                         (gebruikt de site om automatisch "uitverkocht" te tonen).
//   GET  /book         -> oude/gecachte boeklinks blijven werken (zonder mail).
//
// GEHEIMEN staan NIET in deze code, maar in Cloudflare (Settings → Variables):
//   env.MOLLIE_API_KEY   -> je Mollie-sleutel (bestond al)
//   env.RESEND_API_KEY   -> je Resend-sleutel (nieuw, voor de mails)
//   env.TICKETS          -> een KV-namespace (nieuw, het "geheugen" om te tellen)
//
// De 3 instellingen hieronder mag je gerust aanpassen.
// ===========================================================================

const CAPACITY = 15;                              // max. plekken per workshop
const PRICE_PER_TICKET = 55;                      // prijs per ticket in euro
const SITE = "https://glisteningstudio.com";      // je website
const FROM_EMAIL = "Glistening Studio <info@mail.glisteningstudio.com>"; // afzender mails (Resend-subdomein)
const NOTIFY_EMAIL = "info@glisteningstudio.com"; // waar jij het seintje krijgt (Fastmail, ongewijzigd)

// ---------------------------------------------------------------------------
// KORTINGSCODES
// ---------------------------------------------------------------------------
// Elke code geeft 10% korting en is 2 maanden geldig, gerekend vanaf de datum
// van de workshop (de dag waarop je 'm uitdeelt). Je hoeft dus alleen de code
// en die datum op te geven — de vervaldatum rekent de Worker zelf uit.
//
// Een nieuwe code toevoegen? Zet er een regel bij in de lijst hieronder, bijv.:
//   { code: "12OKT", from: "2026-10-12" },
// De code is de datum in HOOFDLETTERS (zoals je 'm aan de deelnemers geeft);
// hoofd-/kleine letters en spaties maken bij het invullen niet uit.
// Verlopen codes mag je gewoon in de lijst laten staan — ze werken vanzelf niet
// meer — of je haalt ze weg om het overzicht te bewaren.
const DISCOUNT_PERCENT = 10;   // korting per geldige code (%)
const DISCOUNT_MONTHS = 2;     // hoe lang een code geldig blijft na de workshopdatum
const DISCOUNT_CODES = [
  { code: "27AUG", from: "2026-08-27" },
];

// De /availability geeft alleen publieke tellingen terug (geen persoonsgegevens),
// dus die mag elke pagina van de site opvragen — ook via www.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    if (url.pathname === "/availability") {
      return handleAvailability(env);
    }
    if (url.pathname === "/bookings") {
      return handleBookings(env, url);
    }
    if (url.pathname === "/discount") {
      return handleDiscount(url);
    }
    if (url.pathname === "/request" && request.method === "POST") {
      return handleRequest(request, env);
    }
    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env, url);
    }
    if (url.pathname === "/book") {
      return handleBook(request, env, url);
    }
    return new Response("Not found", { status: 404 });
  },
};

// --- Hulpjes voor het "geheugen" (KV) --------------------------------------
// We bewaren één klein doc "counts": { "<workshop-id>": aantalBezetteN, ... }
async function readCounts(env) {
  try {
    const raw = await env.TICKETS.get("counts");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

// --- Kortingscodes ----------------------------------------------------------
// Zoekt een ingevoerde code op en controleert of die nog geldig is. Geeft
// { code, percent } terug bij een geldige code, anders null.
function findDiscount(input) {
  const code = String(input || "").trim().toUpperCase();
  if (!code) return null;
  const entry = DISCOUNT_CODES.find(function (c) {
    return String(c.code).trim().toUpperCase() === code;
  });
  if (!entry) return null;
  const from = new Date(entry.from + "T00:00:00Z");
  if (isNaN(from.getTime())) return null;
  const until = new Date(from);
  until.setUTCMonth(until.getUTCMonth() + DISCOUNT_MONTHS);
  until.setUTCHours(23, 59, 59, 999); // geldig t/m het einde van de vervaldag
  if (Date.now() > until.getTime()) return null;
  return { code: entry.code, percent: DISCOUNT_PERCENT };
}

// Berekent het te betalen bedrag (in euro, als "12.34"-string) voor een aantal
// tickets, met de eventuele korting eraf. Rekent in centen om afrondingsgedoe
// te voorkomen.
function computeAmount(qty, discount) {
  let cents = Math.round(PRICE_PER_TICKET * qty * 100);
  if (discount && discount.percent) {
    cents = Math.round((cents * (100 - discount.percent)) / 100);
  }
  return (cents / 100).toFixed(2);
}

// --- GET /discount?code=... -------------------------------------------------
// Laat de site (het boek-venster) live checken of een code klopt, zodat de
// klant het gekorte bedrag al ziet vóór de betaling. De echte korting wordt
// altijd nog eens server-side bevestigd in /book, dus dit is puur voor de tonen.
function handleDiscount(url) {
  const d = findDiscount(url.searchParams.get("code"));
  return json({ valid: !!d, percent: d ? d.percent : 0 }, 200, {
    ...CORS,
    "Cache-Control": "public, max-age=20",
  });
}

// --- GET /bookings?key=... --------------------------------------------------
// Geeft alle opgeslagen boekingen terug als JSON, zodat de CRM-sync ze elk uur
// kan ophalen. Beveiligd met een geheime sleutel (env.BOOKINGS_KEY) die je in
// Cloudflare (Settings -> Variables) zet; zonder de juiste sleutel: 401. Bewust
// GEEN CORS-headers, zodat alleen de server-to-server sync er (met sleutel) bij kan.
async function handleBookings(env, url) {
  const key = url.searchParams.get("key") || "";
  if (!env.BOOKINGS_KEY || key !== env.BOOKINGS_KEY) {
    return json({ error: "unauthorized" }, 401);
  }
  const out = [];
  let cursor;
  do {
    const list = await env.TICKETS.list({ prefix: "booking:", cursor });
    for (const k of list.keys) {
      const raw = await env.TICKETS.get(k.name);
      if (raw) { try { out.push(JSON.parse(raw)); } catch (e) {} }
    }
    cursor = list.list_complete ? null : list.cursor;
  } while (cursor);
  out.sort((a, b) => String(b.bookedAt).localeCompare(String(a.bookedAt)));
  return json({ bookings: out, count: out.length }, 200);
}

// --- GET /availability ------------------------------------------------------
async function handleAvailability(env) {
  const counts = await readCounts(env);
  return json({ capacity: CAPACITY, sold: counts }, 200, {
    ...CORS,
    "Cache-Control": "public, max-age=20",
  });
}

// --- POST /request: interesse voor een workshop op een vrije dag ------------
// De bezoeker klikt in de kalender op een lege dag en vult een kort formulier
// in. Dit is nadrukkelijk NOG GEEN boeking: we starten alleen het contact.
// We sturen Kiki een seintje en de aanvrager een korte bevestiging.
async function handleRequest(request, env) {
  let data = {};
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.indexOf("application/json") !== -1) {
      data = await request.json();
    } else {
      const form = await request.formData();
      form.forEach((v, k) => { data[k] = v; });
    }
  } catch (e) {
    return json({ ok: false, error: "bad-request" }, 400, CORS);
  }

  const name = (data.name || "").toString().trim();
  const email = (data.email || "").toString().trim();
  const message = (data.message || "").toString().trim();
  const dateText = (data.dateText || data.date || "").toString().trim();
  const lang = (data.lang || "").toString().trim().toLowerCase() === "en" ? "en" : "nl";

  if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ ok: false, error: "missing-fields" }, 400, CORS);
  }

  const when = dateText || (lang === "en" ? "a date to be discussed" : "een nader te bepalen dag");

  // 1) Seintje aan Kiki.
  const kikiHtml = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#2a2320">
      <h2 style="margin:0 0 12px">🌱 Nieuwe workshop-aanvraag</h2>
      <p>Iemand heeft interesse om op deze dag een workshop te boeken. De boeking is <strong>nog niet voltooid</strong>; het contact is hiermee net gestart.</p>
      <p style="background:#faf3e6;border-radius:10px;padding:12px 16px;margin:18px 0">
        <strong>Gewenste dag:</strong> ${escapeHtml(when)}<br>
        <strong>Naam:</strong> ${escapeHtml(name)}<br>
        <strong>E-mail:</strong> ${escapeHtml(email)}<br>
        <strong>Bericht:</strong> ${escapeHtml(message || "-")}
      </p>
      <p>Reageer gerust rechtstreeks op deze mail om contact op te nemen.</p>
    </div>`;
  await resendSend(env, {
    to: NOTIFY_EMAIL,
    subject: `🌱 Workshop-aanvraag: ${name} · ${when}`,
    html: kikiHtml,
    reply_to: email,
  });

  // 2) Korte bevestiging aan de aanvrager (duidelijk: nog geen boeking).
  const okHtml = lang === "en"
    ? `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#2a2320;max-width:560px">
        <p>Hi ${escapeHtml(name)},</p>
        <p>Thank you for your interest in a workshop on <strong>${escapeHtml(when)}</strong>! 🌸</p>
        <p>This is not a confirmed booking yet: I have received your request and will get in touch soon to see what is possible and arrange the details together.</p>
        <p>Warm regards,<br>Kiki · Glistening Studio</p>
      </div>`
    : `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#2a2320;max-width:560px">
        <p>Hoi ${escapeHtml(name)},</p>
        <p>Wat leuk dat je interesse hebt in een workshop op <strong>${escapeHtml(when)}</strong>! 🌸</p>
        <p>Dit is nog geen bevestigde boeking: ik heb je aanvraag ontvangen en neem snel contact met je op om te kijken wat er mogelijk is en de details samen door te nemen.</p>
        <p>Warme groet,<br>Kiki · Glistening Studio</p>
      </div>`;
  try {
    await resendSend(env, {
      to: email,
      subject: lang === "en" ? "🌱 Your workshop request" : "🌱 Je workshop-aanvraag",
      html: okHtml,
      reply_to: NOTIFY_EMAIL,
    });
  } catch (e) {
    // De aanvraag is al bij Kiki; een mislukte bevestiging mag de bezoeker niet stoppen.
    console.log("Bevestigingsmail-fout:", e && e.message);
  }

  return json({ ok: true }, 200, CORS);
}

// --- /book: betaling starten ------------------------------------------------
async function handleBook(request, env, url) {
  // Nieuwe manier: het formulier op de site stuurt een POST met naam/e-mail.
  // Oude manier: een gecachte link stuurt een GET met alleen ?qty & ?desc.
  let eventId, qty, desc, when, name, email, phone, diet, theme, lang, discountInput;

  if (request.method === "POST") {
    const form = await request.formData();
    eventId = (form.get("eventId") || "").toString().trim();
    qty = clampQty(form.get("qty"));
    desc = (form.get("desc") || "Glistening Studio workshop").toString();
    when = (form.get("when") || "").toString().trim();
    name = (form.get("name") || "").toString().trim();
    email = (form.get("email") || "").toString().trim();
    phone = (form.get("phone") || "").toString().trim();
    diet = (form.get("diet") || "").toString().trim();
    theme = (form.get("theme") || "Suncatcher").toString().trim();
    lang = (form.get("lang") || "").toString().trim().toLowerCase() === "en" ? "en" : "nl";
    discountInput = (form.get("discount") || "").toString();

    if (!name || !email) {
      return htmlPage("Vul je naam en e-mail in", "Ga terug en vul je naam en e-mailadres in, dan kun je verder naar de betaling.");
    }
  } else {
    // GET-fallback (oude link) — geen naam/e-mail, dus geen mail achteraf.
    qty = clampQty(url.searchParams.get("qty"));
    desc = (url.searchParams.get("desc") || "Glistening Studio workshop").toString();
    eventId = (url.searchParams.get("event") || "").toString().trim();
    when = "";
    name = email = phone = diet = "";
    theme = (url.searchParams.get("theme") || "Suncatcher").toString().trim();
    lang = (url.searchParams.get("lang") || "").toString().trim().toLowerCase() === "en" ? "en" : "nl";
    discountInput = (url.searchParams.get("discount") || "").toString();
  }

  // Kortingscode server-side valideren (nooit op de client vertrouwen voor het bedrag).
  const discount = findDiscount(discountInput);

  // Taal bepaalt de Mollie-checkout-taal en waar de klant na betaling terugkomt.
  const checkoutLocale = lang === "en" ? "en_US" : "nl_NL";
  const thanksPath = lang === "en" ? "/en/bedankt.html" : "/bedankt.html";

  // Max 15 afdwingen (op basis van reeds betaalde plekken).
  if (eventId) {
    const counts = await readCounts(env);
    const sold = counts[eventId] || 0;
    if (sold >= CAPACITY) {
      return htmlPage("Deze workshop is net vol", "Wat jammer, alle plekken voor deze datum zijn vergeven. Bekijk de agenda voor de eerstvolgende workshop.", true);
    }
    if (sold + qty > CAPACITY) {
      const left = CAPACITY - sold;
      return htmlPage("Nog maar " + left + " plek" + (left === 1 ? "" : "ken") + " vrij", "Er " + (left === 1 ? "is" : "zijn") + " nog " + left + " plek" + (left === 1 ? "" : "ken") + " voor deze workshop. Ga terug en kies een lager aantal.");
    }
  }

  const amount = computeAmount(qty, discount);
  const discountNote = discount ? ` (-${discount.percent}% code ${discount.code})` : "";

  const mollieRes = await fetch("https://api.mollie.com/v2/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MOLLIE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: { currency: "EUR", value: amount },
      description: `${desc} - ${qty} ticket${qty > 1 ? "s" : ""}${discountNote}`,
      locale: checkoutLocale,
      redirectUrl: `${SITE}${thanksPath}`,
      webhookUrl: `${url.origin}/webhook`,
      metadata: {
        eventId, qty, when, name, email, phone, diet, theme, lang,
        amount,
        discount: discount ? discount.code : "",
        discountPercent: discount ? discount.percent : 0,
      },
    }),
  });

  if (!mollieRes.ok) {
    const errText = await mollieRes.text();
    console.log("Mollie fout:", errText);
    return htmlPage("Er ging iets mis bij het starten van de betaling", "Probeer het zo nog eens, of mail info@glisteningstudio.com. Er is niets afgeschreven.");
  }

  const payment = await mollieRes.json();
  const checkoutUrl = payment._links && payment._links.checkout && payment._links.checkout.href;
  if (!checkoutUrl) {
    return htmlPage("Kon geen betaallink ophalen", "Probeer het zo nog eens, of mail info@glisteningstudio.com. Er is niets afgeschreven.");
  }

  return Response.redirect(checkoutUrl, 302);
}

// --- /webhook: Mollie meldt de uitkomst van een betaling --------------------
async function handleWebhook(request, env, url) {
  // Mollie stuurt alleen het betaal-id; we vragen de echte status zelf op bij
  // Mollie (zo kan niemand een nepbetaling faken).
  let paymentId = "";
  try {
    const form = await request.formData();
    paymentId = (form.get("id") || "").toString();
  } catch (e) {}
  if (!paymentId) return new Response("ok", { status: 200 });

  const res = await fetch(`https://api.mollie.com/v2/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${env.MOLLIE_API_KEY}` },
  });
  if (!res.ok) return new Response("ok", { status: 200 });
  const payment = await res.json();

  // Alleen bij een écht betaalde boeking iets doen.
  if (payment.status !== "paid") return new Response("ok", { status: 200 });

  // Al verwerkt? (Mollie kan de webhook meerdere keren sturen.) Dan stoppen.
  const already = await env.TICKETS.get(`processed:${paymentId}`);
  if (already) return new Response("ok", { status: 200 });

  const meta = payment.metadata || {};
  const eventId = (meta.eventId || "").toString();
  const qty = clampQty(meta.qty);

  // Meteen als verwerkt markeren (voorkomt dubbel tellen bij herhaalde webhook).
  await env.TICKETS.put(`processed:${paymentId}`, "1");

  // Plekken bijtellen.
  let newCount = null;
  if (eventId) {
    const counts = await readCounts(env);
    counts[eventId] = (counts[eventId] || 0) + qty;
    newCount = counts[eventId];
    await env.TICKETS.put("counts", JSON.stringify(counts));
  }

  // Volledige boeking opslaan (los per betaling, zodat de CRM-sync ze kan ophalen).
  try {
    const record = {
      paymentId,
      bookedAt: new Date().toISOString(),          // Boekingsdatum
      name: (meta.name || "").toString().trim(),
      email: (meta.email || "").toString().trim(),
      phone: (meta.phone || "").toString().trim(),  // Telefoonnummer (indien genoemd)
      diet: (meta.diet || "").toString().trim(),    // Dieetwensen
      workshopDate: (meta.when || "").toString().trim(), // Gekozen workshop: datum
      theme: (meta.theme || "Suncatcher").toString().trim(), // Gekozen workshop: thema
      eventId,
      qty,
      amount: (meta.amount || "").toString(),
      discount: (meta.discount || "").toString().trim(),
      discountPercent: parseInt(meta.discountPercent, 10) || 0,
    };
    await env.TICKETS.put(`booking:${paymentId}`, JSON.stringify(record));
  } catch (e) {
    console.log("Boeking opslaan-fout:", e && e.message);
  }

  // Mails versturen (mislukt er één, dan laten we de rest en Mollie met rust).
  try {
    await sendEmails(env, meta, qty, newCount);
  } catch (e) {
    console.log("Mail-fout:", e && e.message);
  }

  return new Response("ok", { status: 200 });
}

// --- Mails via Resend -------------------------------------------------------
async function sendEmails(env, meta, qty, newCount) {
  const name = (meta.name || "").toString().trim();
  const email = (meta.email || "").toString().trim();
  const phone = (meta.phone || "").toString().trim();
  const theme = (meta.theme || "Suncatcher").toString().trim();
  const when = (meta.when || "").toString().trim() || "je gekozen datum";
  const diet = (meta.diet || "").toString().trim();
  // Het echt betaalde bedrag zetten we bij het boeken in de metadata; valt dat
  // om welke reden dan ook weg, dan rekenen we terug zonder korting.
  const amount = (meta.amount || computeAmount(qty, null)).toString();
  const discountCode = (meta.discount || "").toString().trim();
  const discountPercent = parseInt(meta.discountPercent, 10) || 0;

  // 1) Bevestiging aan de klant (jouw goedgekeurde tekst).
  if (email) {
    const boeking = `${qty} plek${qty > 1 ? "ken" : ""} · ${when}`;
    const klantHtml = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#2a2320;max-width:560px">
        <p>Beste ${escapeHtml(name || "deelnemer")},</p>
        <p>Wat leuk dat je erbij bent! Je plek is gereserveerd, ik kijk er nu al naar uit. 😊</p>
        <p style="background:#faf3e6;border-radius:10px;padding:12px 16px;margin:18px 0">
          <strong>Je boeking:</strong> ${escapeHtml(boeking)}
        </p>
        <p>Tijdens de workshop maak je in een kleine, gezellige groep je eigen kristallen suncatcher. Alle materialen (kristallen, kralen en bedeltjes) liggen voor je klaar, dus je hoeft zelf niets mee te nemen. Geen ervaring nodig; er is alle ruimte om te spelen en te ontdekken. Reken op zo'n 2 tot 2,5 uur, met hapjes en drankjes erbij. En vooral heel veel creatieve gezelligheid.</p>
        <p>📌 Een paar dagen van tevoren stuur ik je de exacte locatie en de laatste praktische details.</p>
        <p>💌 Zijn je dieetwensen veranderd? Laat het gerust weten.</p>
        <p>Ik kijk er naar uit om je bij de workshop te zien! 🌸</p>
        <p>Warme groet,<br>Kiki · Glistening Studio</p>
      </div>`;
    await resendSend(env, {
      to: email,
      subject: "✨ Reservering suncatcher workshop ✨",
      html: klantHtml,
      reply_to: NOTIFY_EMAIL,
    });
  }

  // 2) Seintje aan Kiki (met naam, datum, aantal en eventuele dieetwensen).
  const kikiHtml = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#2a2320">
      <h2 style="margin:0 0 12px">🎫 Nieuwe boeking!</h2>
      <p><strong>Naam:</strong> ${escapeHtml(name || "-")}<br>
      <strong>E-mail:</strong> ${escapeHtml(email || "-")}<br>
      <strong>Telefoon:</strong> ${escapeHtml(phone || "-")}<br>
      <strong>Aantal:</strong> ${qty} plek${qty > 1 ? "ken" : ""}<br>
      <strong>Workshop:</strong> ${escapeHtml(theme)} · ${escapeHtml(when)}<br>
      <strong>Dieetwensen:</strong> ${escapeHtml(diet || "-")}<br>
      ${discountCode ? `<strong>Kortingscode:</strong> ${escapeHtml(discountCode)} (−${discountPercent}%)<br>` : ""}
      <strong>Betaald:</strong> €${amount}<br>
      ${newCount != null ? `<strong>Plekken nu bezet:</strong> ${newCount} / ${CAPACITY}` : ""}</p>
    </div>`;
  await resendSend(env, {
    to: NOTIFY_EMAIL,
    subject: `🎫 Nieuwe boeking: ${name || "onbekend"} · ${when}`,
    html: kikiHtml,
    reply_to: email || NOTIFY_EMAIL,
  });
}

async function resendSend(env, { to, subject, html, reply_to }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html, reply_to }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("Resend " + res.status + ": " + t);
  }
}

// --- Kleine helpers ---------------------------------------------------------
function clampQty(value) {
  const n = parseInt(value != null ? value : "1", 10);
  if (isNaN(n)) return 1;
  return Math.min(Math.max(n, 1), CAPACITY);
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Nette Nederlandse pagina bij een fout of "vol" (met knop terug naar de agenda).
function htmlPage(title, text, soldOut) {
  const body = `<!doctype html><html lang="nl"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} · Glistening Studio</title>
    <style>
      body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fbf7ef;color:#2a2320;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
      .card{max-width:440px;text-align:center;background:#fff;border-radius:16px;padding:32px 28px;box-shadow:0 10px 40px rgba(0,0,0,.08)}
      h1{font-size:1.4rem;margin:0 0 10px}
      p{line-height:1.6;margin:0 0 22px}
      a{display:inline-block;background:#c9862f;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600}
    </style></head><body><div class="card">
      <h1>${soldOut ? "😔 " : ""}${escapeHtml(title)}</h1>
      <p>${escapeHtml(text)}</p>
      <a href="${SITE}/workshops.html#agenda">Naar de agenda</a>
    </div></body></html>`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
