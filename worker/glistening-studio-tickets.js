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
const PRICE_PER_TICKET = 45;                      // prijs per ticket in euro
const SITE = "https://glisteningstudio.com";      // je website
const FROM_EMAIL = "Glistening Studio <info@mail.glisteningstudio.com>"; // afzender mails (Resend-subdomein)
const NOTIFY_EMAIL = "info@glisteningstudio.com"; // waar jij het seintje krijgt (Fastmail, ongewijzigd)

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

// --- GET /availability ------------------------------------------------------
async function handleAvailability(env) {
  const counts = await readCounts(env);
  return json({ capacity: CAPACITY, sold: counts }, 200, {
    ...CORS,
    "Cache-Control": "public, max-age=20",
  });
}

// --- /book: betaling starten ------------------------------------------------
async function handleBook(request, env, url) {
  // Nieuwe manier: het formulier op de site stuurt een POST met naam/e-mail.
  // Oude manier: een gecachte link stuurt een GET met alleen ?qty & ?desc.
  let eventId, qty, desc, when, name, email, diet, lang;

  if (request.method === "POST") {
    const form = await request.formData();
    eventId = (form.get("eventId") || "").toString().trim();
    qty = clampQty(form.get("qty"));
    desc = (form.get("desc") || "Glistening Studio workshop").toString();
    when = (form.get("when") || "").toString().trim();
    name = (form.get("name") || "").toString().trim();
    email = (form.get("email") || "").toString().trim();
    diet = (form.get("diet") || "").toString().trim();
    lang = (form.get("lang") || "").toString().trim().toLowerCase() === "en" ? "en" : "nl";

    if (!name || !email) {
      return htmlPage("Vul je naam en e-mail in", "Ga terug en vul je naam en e-mailadres in, dan kun je verder naar de betaling.");
    }
  } else {
    // GET-fallback (oude link) — geen naam/e-mail, dus geen mail achteraf.
    qty = clampQty(url.searchParams.get("qty"));
    desc = (url.searchParams.get("desc") || "Glistening Studio workshop").toString();
    eventId = (url.searchParams.get("event") || "").toString().trim();
    when = "";
    name = email = diet = "";
    lang = (url.searchParams.get("lang") || "").toString().trim().toLowerCase() === "en" ? "en" : "nl";
  }

  // Taal bepaalt de Mollie-checkout-taal en waar de klant na betaling terugkomt.
  const checkoutLocale = lang === "en" ? "en_US" : "nl_NL";
  const thanksPath = lang === "en" ? "/en/bedankt.html" : "/bedankt.html";

  // Max 15 afdwingen (op basis van reeds betaalde plekken).
  if (eventId) {
    const counts = await readCounts(env);
    const sold = counts[eventId] || 0;
    if (sold >= CAPACITY) {
      return htmlPage("Deze workshop is net vol", "Wat jammer — alle plekken voor deze datum zijn vergeven. Bekijk de agenda voor de eerstvolgende workshop.", true);
    }
    if (sold + qty > CAPACITY) {
      const left = CAPACITY - sold;
      return htmlPage("Nog maar " + left + " plek" + (left === 1 ? "" : "ken") + " vrij", "Er " + (left === 1 ? "is" : "zijn") + " nog " + left + " plek" + (left === 1 ? "" : "ken") + " voor deze workshop. Ga terug en kies een lager aantal.");
    }
  }

  const amount = (PRICE_PER_TICKET * qty).toFixed(2);

  const mollieRes = await fetch("https://api.mollie.com/v2/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MOLLIE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: { currency: "EUR", value: amount },
      description: `${desc} - ${qty} ticket${qty > 1 ? "s" : ""}`,
      locale: checkoutLocale,
      redirectUrl: `${SITE}${thanksPath}`,
      webhookUrl: `${url.origin}/webhook`,
      metadata: { eventId, qty, when, name, email, diet, lang },
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
  const when = (meta.when || "").toString().trim() || "je gekozen datum";
  const diet = (meta.diet || "").toString().trim();
  const amount = (PRICE_PER_TICKET * qty).toFixed(2);

  // 1) Bevestiging aan de klant (jouw goedgekeurde tekst).
  if (email) {
    const boeking = `${qty} plek${qty > 1 ? "ken" : ""} — ${when}`;
    const klantHtml = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#2a2320;max-width:560px">
        <p>Beste ${escapeHtml(name || "deelnemer")},</p>
        <p>Wat leuk dat je erbij bent! Je plek is gereserveerd, ik kijk er nu al naar uit. 😊</p>
        <p style="background:#faf3e6;border-radius:10px;padding:12px 16px;margin:18px 0">
          <strong>Je boeking:</strong> ${escapeHtml(boeking)}
        </p>
        <p>Tijdens de workshop maak je in een kleine, gezellige groep je eigen kristallen suncatcher. Alle materialen — kristallen, kralen en bedeltjes — liggen voor je klaar, dus je hoeft zelf niets mee te nemen. Geen ervaring nodig; er is alle ruimte om te spelen en te ontdekken. Reken op zo'n 2 tot 2,5 uur, met hapjes en drankjes erbij. En vooral heel veel creatieve gezelligheid.</p>
        <p>📌 Een paar dagen van tevoren stuur ik je de exacte locatie en de laatste praktische details.</p>
        <p>💌 Zijn je dieetwensen veranderd? Laat het gerust weten.</p>
        <p>Ik kijk er naar uit om je bij de workshop te zien! 🌸</p>
        <p>Warme groet,<br>Kiki — Glistening Studio</p>
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
      <p><strong>Naam:</strong> ${escapeHtml(name || "—")}<br>
      <strong>E-mail:</strong> ${escapeHtml(email || "—")}<br>
      <strong>Aantal:</strong> ${qty} plek${qty > 1 ? "ken" : ""}<br>
      <strong>Workshop:</strong> ${escapeHtml(when)}<br>
      <strong>Dieetwensen:</strong> ${escapeHtml(diet || "—")}<br>
      <strong>Betaald:</strong> €${amount}<br>
      ${newCount != null ? `<strong>Plekken nu bezet:</strong> ${newCount} / ${CAPACITY}` : ""}</p>
    </div>`;
  await resendSend(env, {
    to: NOTIFY_EMAIL,
    subject: `🎫 Nieuwe boeking: ${name || "onbekend"} — ${when}`,
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
    <title>${escapeHtml(title)} — Glistening Studio</title>
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
