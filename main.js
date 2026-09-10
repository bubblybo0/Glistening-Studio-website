// GlisteningStudio — small helper script (no dependencies, no build step)

// --- Gedeelde datum-helper -------------------------------------------------
// Beschikbaar voor de losse pagina-scripts (workshops.html / workshop.html).
// Rekent uit één ISO-datum ("2026-10-02T19:00:00+02:00") alle labels uit,
// zodat events.json alleen datum/tijd/stad hoeft te bevatten. Zomer-/wintertijd
// gaat automatisch goed via de tijdzone Europe/Amsterdam.
(function () {
  var TZ = "Europe/Amsterdam";
  window.glsEventLabels = function (startISO) {
    var d = new Date(startISO);
    var dutchDate = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", timeZone: TZ }).format(d);
    var englishDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: TZ }).format(d);
    var dateLabel = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", timeZone: TZ }).format(d).replace(/\.$/, "");
    var fullDate = new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).format(d);
    var fullDateEn = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TZ }).format(d);
    var time = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(d);
    var hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(d));
    var timeOfDay, timeOfDayEn;
    if (hour < 12) { timeOfDay = "ochtend"; timeOfDayEn = "morning"; }
    else if (hour < 18) { timeOfDay = "middag"; timeOfDayEn = "afternoon"; }
    else { timeOfDay = "avond"; timeOfDayEn = "evening"; }
    return { dateLabel: dateLabel, fullDate: fullDate, fullDateEn: fullDateEn, dutchDate: dutchDate, englishDate: englishDate, time: time, timeOfDay: timeOfDay, timeOfDayEn: timeOfDayEn };
  };
  // Is de workshop nog niet voorbij? (kleine marge zodat een workshop pas de
  // dag erna uit de agenda verdwijnt, niet al zodra hij begint.)
  window.glsIsUpcoming = function (startISO) {
    var start = new Date(startISO).getTime();
    return start + 12 * 60 * 60 * 1000 > Date.now();
  };

  // Adres van de Cloudflare ticket-Worker. Ook beschikbaar voor de losse
  // pagina-scripts (workshops.html / workshop.html) om beschikbaarheid op te halen.
  window.GLS_WORKER_BASE = "https://glistening-studio-tickets.noisy-surf-d8b5.workers.dev";

  // Haalt op hoeveel plekken per workshop al bezet zijn. Faalt de Worker, dan
  // geven we een leeg resultaat terug zodat de agenda gewoon blijft werken.
  window.glsFetchAvailability = function () {
    return fetch(window.GLS_WORKER_BASE + "/availability")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.sold) return { capacity: 15, sold: {} };
        return { capacity: data.capacity || 15, sold: data.sold };
      })
      .catch(function () { return { capacity: 15, sold: {} }; });
  };

  // --- Maandkalender ---------------------------------------------------------
  // Tekent een "echte" agenda: de huidige maand + de volgende maand als een
  // klassiek kalenderraster (maandag-eerst), waarin de dagen met een workshop
  // oplichten. Klikken op zo'n dag springt naar de bijbehorende kaart in de
  // agendalijst (id "agenda-<eventid>"). Werkt op zowel de NL- als de
  // /en/-pagina; taal en steden-vertaling gaan via opts.
  window.glsRenderCalendar = function (container, events, opts) {
    if (!container) return;
    opts = opts || {};
    var locale = opts.lang === "en" ? "en-US" : "nl-NL";
    var isEn = opts.lang === "en";
    var cityMap = opts.cityMap || {};
    var MONTHS_TO_SHOW = 2;

    // Datumsleutel "YYYY-MM-DD" in de tijdzone Amsterdam, zodat een workshop op
    // de juiste dag in het raster valt (ongeacht de tijdzone van de bezoeker).
    function keyTZ(dateOrISO) {
      return new Intl.DateTimeFormat("en-CA", {
        year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ
      }).format(new Date(dateOrISO));
    }

    // Workshops groeperen per dag, op tijd gesorteerd.
    var byDay = {};
    (events || []).forEach(function (ev) {
      var k = keyTZ(ev.start);
      (byDay[k] = byDay[k] || []).push(ev);
    });
    Object.keys(byDay).forEach(function (k) {
      byDay[k].sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
    });

    var now = new Date();
    var todayKey = keyTZ(now);
    var weekdays = isEn
      ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      : ["ma", "di", "wo", "do", "vr", "za", "zo"];

    function pad(n) { return n < 10 ? "0" + n : "" + n; }

    var html = '<div class="gls-cal-months">';
    for (var m = 0; m < MONTHS_TO_SHOW; m++) {
      var d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      var year = d.getFullYear();
      var month = d.getMonth(); // 0-gebaseerd
      var monthName = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(d);
      var firstWd = (new Date(year, month, 1).getDay() + 6) % 7; // maandag = 0
      var daysInMonth = new Date(year, month + 1, 0).getDate();

      html += '<div class="gls-cal-month">';
      html += '<div class="gls-cal-title">' + monthName + '</div>';
      html += '<div class="gls-cal-grid" role="grid">';
      weekdays.forEach(function (w) {
        html += '<div class="gls-cal-wd" role="columnheader">' + w + '</div>';
      });
      for (var i = 0; i < firstWd; i++) html += '<div class="gls-cal-cell is-empty" aria-hidden="true"></div>';

      for (var day = 1; day <= daysInMonth; day++) {
        var key = year + "-" + pad(month + 1) + "-" + pad(day);
        var cls = "gls-cal-cell";
        if (key === todayKey) cls += " is-today";
        // Alleen komende workshops tonen; afgelopen dagen blijven een gewone dag.
        var upcoming = (byDay[key] || []).filter(function (ev) { return window.glsIsUpcoming(ev.start); });
        if (!upcoming.length) {
          // Vrije dag vanaf vandaag: aanklikbaar om zelf een workshop aan te vragen.
          if (key >= todayKey) {
            var freeDayName = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(new Date(key + "T12:00:00"));
            var reqLabel = isEn
              ? ("Request a workshop on " + freeDayName)
              : ("Vraag een workshop aan op " + freeDayName);
            html += '<button type="button" class="' + cls + ' can-request" data-request-date="' + key +
              '" data-request-text="' + freeDayName + '" title="' + reqLabel + '" aria-label="' + reqLabel + '">' +
              day + '</button>';
          } else {
            html += '<div class="' + cls + '" role="gridcell">' + day + '</div>';
          }
          continue;
        }
        // Leesbare omschrijving voor tooltip + schermlezer.
        var descParts = upcoming.map(function (ev) {
          var L = window.glsEventLabels(ev.start);
          var city = cityMap[ev.city] || ev.city;
          return isEn
            ? ("workshop " + city + " at " + L.time)
            : ("workshop " + city + " om " + L.time);
        });
        var dayName = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(new Date(key + "T12:00:00"));
        var label = dayName + ": " + descParts.join(", ");
        var badge = upcoming.length > 1 ? '<span class="gls-cal-badge">' + upcoming.length + '</span>' : "";
        html += '<a class="' + cls + ' has-workshop" role="gridcell" href="#agenda-' +
          encodeURIComponent(upcoming[0].id) + '" title="' + label + '" aria-label="' + label + '">' +
          day + badge + '</a>';
      }
      html += '</div></div>';
    }
    html += '</div>'; // .gls-cal-months

    // Legenda onder de maanden.
    var legend = isEn
      ? '<span><span class="sw sw-workshop"></span>workshop day (click to book)</span>' +
        '<span><span class="sw sw-open"></span>free day (click to request your own)</span>'
      : '<span><span class="sw sw-workshop"></span>workshopdag (klik om je plek te reserveren)</span>' +
        '<span><span class="sw sw-open"></span>vrije dag (klik om er zelf één aan te vragen)</span>';
    html += '<div class="gls-cal-legend">' + legend + '</div>';

    container.innerHTML = html;
  };
})();

document.addEventListener("DOMContentLoaded", function () {
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // --- Taal (nl standaard; en op de /en/-pagina's via <html lang="en">) -----
  // De losse pagina-teksten staan gewoon in de HTML; dit is alleen voor de
  // strings die main.js zelf opbouwt (boek-venster + ticket-stepper).
  var LANG = document.documentElement.getAttribute("lang") === "en" ? "en" : "nl";
  var STR = {
    nl: {
      dialogTitle: "Je plek reserveren",
      close: "Sluiten",
      name: "Je naam",
      email: "Je e-mailadres",
      phone: "Telefoonnummer",
      diet: "Dieetwensen of allergie&euml;n?",
      optional: "(optioneel)",
      privacy: "We gebruiken je gegevens alleen voor deze boeking.",
      cancel: "Annuleren",
      toPayment: "Naar betaling &rarr;",
      working: "Bezig…",
      discount: "Kortingscode",
      discountApply: "Toepassen",
      discountChecking: "Bezig met controleren…",
      discountApplied: function (p) { return "✓ " + p + "% korting toegepast"; },
      discountInvalid: "Deze kortingscode is niet (meer) geldig.",
      spot: "plek", spots: "plekken",
      bookWorkshop: "Boek workshop",
      bookMany: function (q) { return "Boek " + q + " tickets"; },
      ticketAria: function (q) { return q + (q === 1 ? " ticket" : " tickets"); },
      defaultDesc: "Glistening Studio workshop"
    },
    en: {
      dialogTitle: "Reserve your spot",
      close: "Close",
      name: "Your name",
      email: "Your email address",
      phone: "Phone number",
      diet: "Dietary needs or allergies?",
      optional: "(optional)",
      privacy: "We only use your details for this booking.",
      cancel: "Cancel",
      toPayment: "To payment &rarr;",
      working: "Working…",
      discount: "Discount code",
      discountApply: "Apply",
      discountChecking: "Checking…",
      discountApplied: function (p) { return "✓ " + p + "% discount applied"; },
      discountInvalid: "This discount code is not (or no longer) valid.",
      spot: "spot", spots: "spots",
      bookWorkshop: "Book workshop",
      bookMany: function (q) { return "Book " + q + " tickets"; },
      ticketAria: function (q) { return q + (q === 1 ? " ticket" : " tickets"); },
      defaultDesc: "Glistening Studio workshop"
    }
  }[LANG];

  // --- Menu (met focusbeheer voor toegankelijkheid) ------------------------
  var menuToggle = document.getElementById("menuToggle");
  var navClose = document.getElementById("navClose");
  var overlay = document.getElementById("navOverlay");
  // Delen van de pagina die we voor hulptechnologie afschermen als het menu open is.
  var pageRegions = [
    document.querySelector("nav.site-nav"),
    document.getElementById("main"),
    document.querySelector("footer.site")
  ].filter(Boolean);

  function openNav() {
    overlay.classList.add("open");
    document.body.classList.add("nav-open");
    menuToggle.setAttribute("aria-expanded", "true");
    pageRegions.forEach(function (el) { el.setAttribute("aria-hidden", "true"); });
    var first = overlay.querySelector("a[href], button");
    if (first) first.focus();
  }
  function closeNav() {
    overlay.classList.remove("open");
    document.body.classList.remove("nav-open");
    menuToggle.setAttribute("aria-expanded", "false");
    pageRegions.forEach(function (el) { el.removeAttribute("aria-hidden"); });
    if (menuToggle) menuToggle.focus();
  }
  if (menuToggle && overlay) {
    menuToggle.addEventListener("click", openNav);
    if (navClose) navClose.addEventListener("click", closeNav);
    overlay.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", closeNav); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.classList.contains("open")) closeNav();
    });
    // Houd de focus binnen het open menu (focus-trap).
    overlay.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      var focusables = overlay.querySelectorAll("a[href], button");
      if (!focusables.length) return;
      var firstEl = focusables[0], lastEl = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    });
  }

  // --- Zachte licht-glow die naar de cursor drijft (alleen muis, geen touch) ---
  var canHover = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (canHover && !reduceMotion) {
    var glow = document.createElement("div");
    glow.id = "lightCursor";
    document.body.appendChild(glow);
    var glowX = 0, glowY = 0, targetX = 0, targetY = 0, glowStarted = false;
    document.addEventListener("mousemove", function (e) {
      targetX = e.clientX;
      targetY = e.clientY;
      if (!glowStarted) {
        glowX = targetX; glowY = targetY;
        glowStarted = true;
        glow.classList.add("is-active");
      }
    });
    document.addEventListener("mouseleave", function () { glow.classList.remove("is-active"); });
    document.addEventListener("mouseenter", function () { if (glowStarted) glow.classList.add("is-active"); });
    (function tick() {
      glowX += (targetX - glowX) * 0.12;
      glowY += (targetY - glowY) * 0.12;
      glow.style.transform = "translate3d(" + glowX + "px," + glowY + "px,0)";
      requestAnimationFrame(tick);
    })();
  }

  // --- Video's: rekening houden met "verminder beweging" + alleen laden/spelen
  //     wanneer ze in beeld zijn (scheelt data en batterij, vooral op mobiel). --
  var videos = document.querySelectorAll("video[autoplay]");
  if (reduceMotion) {
    // Bezoeker wil geen beweging: alle video's stilzetten op hun posterframe en
    // niet opnieuw starten. Zo respecteren we dat voor ÁLLE video's, niet alleen de hero.
    videos.forEach(function (v) {
      v.removeAttribute("autoplay");
      try { v.pause(); } catch (e) {}
    });
  } else {
    videos.forEach(function (v) {
      // Hero-/achtergrondvideo bovenaan blijft direct laden; de rest pas als het nodig is.
      var isHero = v.closest(".hero-video-section") || v.classList.contains("page-ambient-bg");
      if (!isHero) v.preload = "none";
    });
    if ("IntersectionObserver" in window) {
      var vObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var v = entry.target;
          if (entry.isIntersecting) {
            if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
          } else if (!v.paused) {
            try { v.pause(); } catch (e) {}
          }
        });
      }, { threshold: 0.1 });
      videos.forEach(function (v) { vObserver.observe(v); });
    } else {
      // Oude browser zonder IntersectionObserver: gewoon proberen te spelen.
      videos.forEach(function (v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); });
    }
  }

  // Fade + lift elk .reveal-element in beeld de eerste keer dat het zichtbaar wordt
  var revealEls = document.querySelectorAll(".reveal");
  if (revealEls.length) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      revealEls.forEach(function (el) { el.classList.add("is-visible"); });
    } else {
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.18, rootMargin: "0px 0px -60px 0px" }
      );
      revealEls.forEach(function (el) { observer.observe(el); });

      // Vangnet: IntersectionObserver kan in zeldzame gevallen een element missen.
      var revealFallback = function () {
        revealEls.forEach(function (el) {
          if (el.classList.contains("is-visible")) return;
          var r = el.getBoundingClientRect();
          if (r.top < window.innerHeight && r.bottom > 0) {
            el.classList.add("is-visible");
            observer.unobserve(el);
          }
        });
      };
      window.addEventListener("scroll", revealFallback, { passive: true });
      window.addEventListener("resize", revealFallback);
      window.addEventListener("load", revealFallback);
      setTimeout(revealFallback, 1500);
      // Laatste redmiddel: laat inhoud nooit permanent onzichtbaar.
      setTimeout(function () {
        revealEls.forEach(function (el) { el.classList.add("is-visible"); });
      }, 6000);
    }
  }

  // Ticket-stepper + boeken. De +/- kiezen het aantal; "Boek" opent een klein
  // venster waarin de klant naam + e-mail (+ evt. dieetwensen) invult. Dat
  // formulier POST't naar de Cloudflare Worker, die de Mollie-betaling start.
  var WORKER_BOOK_URL = window.GLS_WORKER_BASE + "/book";
  var MAX_TICKET_QTY = 15;

  // Bouwt (eenmalig) het boek-venster en geeft de invelden terug.
  var bookDialog = null;
  function ensureBookDialog() {
    if (bookDialog) return bookDialog;
    var d = document.createElement("dialog");
    d.className = "book-dialog";
    d.innerHTML =
      '<form class="book-form" method="post" action="' + WORKER_BOOK_URL + '" novalidate>' +
        '<button type="button" class="book-dialog-close" aria-label="' + STR.close + '">&times;</button>' +
        '<h2>' + STR.dialogTitle + '</h2>' +
        '<p class="book-summary" data-summary></p>' +
        '<input type="hidden" name="eventId" data-eventid>' +
        '<input type="hidden" name="qty" data-qty>' +
        '<input type="hidden" name="desc" data-desc>' +
        '<input type="hidden" name="when" data-when>' +
        '<input type="hidden" name="theme" value="Suncatcher" data-theme>' +
        '<input type="hidden" name="lang" value="' + LANG + '">' +
        '<input type="hidden" name="locale" value="' + (LANG === "en" ? "en_US" : "nl_NL") + '">' +
        '<label class="book-field">' + STR.name +
          '<input type="text" name="name" autocomplete="name" required>' +
        '</label>' +
        '<label class="book-field">' + STR.email +
          '<input type="email" name="email" autocomplete="email" required>' +
        '</label>' +
        '<label class="book-field">' + STR.phone + ' <span class="book-opt">' + STR.optional + '</span>' +
          '<input type="tel" name="phone" autocomplete="tel" inputmode="tel">' +
        '</label>' +
        '<label class="book-field">' + STR.diet + ' <span class="book-opt">' + STR.optional + '</span>' +
          '<textarea name="diet" rows="2"></textarea>' +
        '</label>' +
        '<label class="book-field">' + STR.discount + ' <span class="book-opt">' + STR.optional + '</span>' +
          '<span class="book-discount-row">' +
            '<input type="text" name="discount" autocomplete="off" autocapitalize="characters" spellcheck="false" data-discount>' +
            '<button type="button" class="btn btn-ghost book-discount-apply" data-discount-apply>' + STR.discountApply + '</button>' +
          '</span>' +
          '<span class="book-discount-msg" data-discount-msg aria-live="polite"></span>' +
        '</label>' +
        '<p class="book-privacy">' + STR.privacy + '</p>' +
        '<div class="book-actions">' +
          '<button type="button" class="btn btn-ghost" data-cancel>' + STR.cancel + '</button>' +
          '<button type="submit" class="btn btn-primary" data-submit>' + STR.toPayment + '</button>' +
        '</div>' +
      '</form>';
    document.body.appendChild(d);
    var form = d.querySelector("form");

    // --- Prijsweergave (met eventuele korting) ---
    function formatEuro(n) { return n.toFixed(2).replace(".", ","); }
    function renderSummary() {
      var q = d._qty || 1;
      var base = 55 * q;
      var pct = d._discountPercent || 0;
      var total = (base * (100 - pct)) / 100;
      var parts = "<strong>" + q + " " + (q === 1 ? STR.spot : STR.spots) + "</strong>" +
        (d._when ? " &middot; " + d._when : "") + " &middot; ";
      if (pct > 0) {
        parts += '<span class="book-old-price">&euro;' + formatEuro(base) + '</span> ' +
          '<strong>&euro;' + formatEuro(total) + '</strong> ' +
          '<span class="book-save">&minus;' + pct + '%</span>';
      } else {
        parts += "&euro;" + formatEuro(total);
      }
      d.querySelector("[data-summary]").innerHTML = parts;
    }
    d._renderSummary = renderSummary;

    // --- Kortingscode live controleren bij de Worker ---
    var discountInput = d.querySelector("[data-discount]");
    var discountMsg = d.querySelector("[data-discount-msg]");
    var applyBtn = d.querySelector("[data-discount-apply]");
    function setDiscountMsg(text, state) {
      discountMsg.textContent = text;
      discountMsg.className = "book-discount-msg" + (state ? " is-" + state : "");
    }
    function applyDiscount() {
      var code = (discountInput.value || "").trim();
      if (!code) { d._discountPercent = 0; setDiscountMsg("", ""); renderSummary(); return; }
      applyBtn.disabled = true;
      setDiscountMsg(STR.discountChecking, "");
      fetch(window.GLS_WORKER_BASE + "/discount?code=" + encodeURIComponent(code))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (data && data.valid) {
            d._discountPercent = data.percent || 0;
            setDiscountMsg(STR.discountApplied(d._discountPercent), "ok");
          } else {
            d._discountPercent = 0;
            setDiscountMsg(STR.discountInvalid, "bad");
          }
          renderSummary();
        })
        .catch(function () {
          d._discountPercent = 0;
          setDiscountMsg(STR.discountInvalid, "bad");
          renderSummary();
        })
        .finally(function () { applyBtn.disabled = false; });
    }
    applyBtn.addEventListener("click", applyDiscount);
    discountInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); applyDiscount(); }
    });
    // Past de klant de code nog aan? Dan de eerder toegepaste korting weer loslaten
    // tot 'Toepassen' opnieuw is bevestigd (zodat de getoonde prijs nooit liegt).
    discountInput.addEventListener("input", function () {
      if (d._discountPercent) { d._discountPercent = 0; setDiscountMsg("", ""); renderSummary(); }
    });

    function close() { if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); }
    d.querySelector(".book-dialog-close").addEventListener("click", close);
    d.querySelector("[data-cancel]").addEventListener("click", close);
    // Klik op de donkere achtergrond (buiten de kaart) sluit ook.
    d.addEventListener("click", function (e) { if (e.target === d) close(); });
    // Bij verzenden: knop uitschakelen zodat er niet dubbel geboekt wordt.
    form.addEventListener("submit", function () {
      var btn = d.querySelector("[data-submit]");
      btn.disabled = true;
      btn.textContent = STR.working;
    });
    bookDialog = d;
    return d;
  }

  function openBookDialog(opts) {
    var d = ensureBookDialog();
    d.querySelector("[data-eventid]").value = opts.eventId || "";
    d.querySelector("[data-qty]").value = opts.qty;
    d.querySelector("[data-desc]").value = opts.desc;
    d.querySelector("[data-when]").value = opts.when || "";
    var themeField = d.querySelector("[data-theme]");
    if (themeField) themeField.value = opts.theme || "Suncatcher";
    // Korting-state en -veld resetten per keer dat het venster opent.
    d._qty = opts.qty;
    d._when = opts.when || "";
    d._discountPercent = 0;
    var discountField = d.querySelector("[data-discount]");
    if (discountField) discountField.value = "";
    var discountMsgEl = d.querySelector("[data-discount-msg]");
    if (discountMsgEl) { discountMsgEl.textContent = ""; discountMsgEl.className = "book-discount-msg"; }
    d._renderSummary();
    // Verzendknop weer activeren (voor het geval een vorige poging afbrak).
    var btn = d.querySelector("[data-submit]");
    btn.disabled = false;
    btn.innerHTML = STR.toPayment;
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
    var nameInput = d.querySelector('input[name="name"]');
    if (nameInput) nameInput.focus();
  }

  function initTicketPickers() {
    document.querySelectorAll(".ticket-picker").forEach(function (picker) {
      var minus = picker.querySelector(".qty-minus");
      var plus = picker.querySelector(".qty-plus");
      var valueEl = picker.querySelector(".qty-value");
      var bookBtn = picker.querySelector(".book-btn");
      if (!minus || !plus || !valueEl || !bookBtn) return;
      var desc = bookBtn.getAttribute("data-worker-desc") || STR.defaultDesc;
      var when = bookBtn.getAttribute("data-when") || "";
      var eventId = bookBtn.getAttribute("data-event-id") || "";
      var maxQty = parseInt(bookBtn.getAttribute("data-max-qty"), 10);
      if (isNaN(maxQty) || maxQty < 1) maxQty = MAX_TICKET_QTY;
      var qty = picker._qty && picker._qty <= maxQty ? picker._qty : 1;
      function update() {
        picker._qty = qty;
        valueEl.textContent = qty;
        // Hoorbare context voor schermlezers: "1 ticket" / "3 tickets".
        valueEl.setAttribute("aria-label", STR.ticketAria(qty));
        minus.disabled = qty <= 1;
        plus.disabled = qty >= maxQty;
        bookBtn.textContent = qty === 1 ? STR.bookWorkshop : STR.bookMany(qty);
      }
      minus.onclick = function () { if (qty > 1) { qty--; update(); } };
      plus.onclick = function () { if (qty < maxQty) { qty++; update(); } };
      bookBtn.onclick = function (e) {
        e.preventDefault();
        var ticketDesc = desc + " - " + qty + " ticket" + (qty > 1 ? "s" : "");
        openBookDialog({ eventId: eventId, qty: qty, desc: ticketDesc, when: when });
      };
      update();
    });
  }
  initTicketPickers();
  document.addEventListener("eventDataReady", initTicketPickers);

  // --- Workshop aanvragen op een vrije kalenderdag -------------------------
  // Klik je in de kalender op een vrije (niet-gekleurde) dag, dan open je een
  // klein venster om interesse door te geven. Dat stuurt een seintje naar Kiki
  // via de Worker (POST /request). Het is nadrukkelijk nog geen boeking.
  var RSTR = {
    nl: {
      title: "Een workshop aanvragen",
      lead: function (d) { return "Je geeft interesse door voor een workshop op <strong>" + d + "</strong>."; },
      name: "Je naam",
      email: "Je e-mailadres",
      message: "Waar denk je aan?",
      messageHint: "Bijvoorbeeld: met hoeveel mensen, welke gelegenheid, of een vraag.",
      optional: "(optioneel)",
      note: "Let op: dit is nog geen boeking. Je stuurt me een aanvraag en daarna neem ik contact met je op om samen de details te bekijken.",
      cancel: "Annuleren",
      submit: "Aanvraag versturen",
      working: "Versturen…",
      okTitle: "Gelukt, je aanvraag is onderweg! 🌸",
      okBody: "Ik neem snel contact met je op om samen te kijken wat er mogelijk is. Dit is nog geen bevestigde boeking, dat regelen we samen.",
      close: "Sluiten",
      error: "Het versturen lukte even niet. Probeer het zo nog eens, of mail info@glisteningstudio.com."
    },
    en: {
      title: "Request a workshop",
      lead: function (d) { return "You are letting me know you are interested in a workshop on <strong>" + d + "</strong>."; },
      name: "Your name",
      email: "Your email address",
      message: "What do you have in mind?",
      messageHint: "For example: how many people, the occasion, or a question.",
      optional: "(optional)",
      note: "Please note: this is not a booking yet. You are sending me a request, and I will get in touch to go through the details together.",
      cancel: "Cancel",
      submit: "Send request",
      working: "Sending…",
      okTitle: "Done, your request is on its way! 🌸",
      okBody: "I will get in touch soon to see what is possible. This is not a confirmed booking yet, we will arrange that together.",
      close: "Close",
      error: "Sending did not work just now. Please try again, or email info@glisteningstudio.com."
    }
  }[LANG];

  var requestDialog = null;
  function ensureRequestDialog() {
    if (requestDialog) return requestDialog;
    var d = document.createElement("dialog");
    d.className = "book-dialog request-dialog";
    d.innerHTML =
      '<form class="book-form request-form" novalidate>' +
        '<button type="button" class="book-dialog-close" aria-label="' + RSTR.close + '">&times;</button>' +
        '<h2>' + RSTR.title + '</h2>' +
        '<p class="book-summary" data-req-lead></p>' +
        '<label class="book-field">' + RSTR.name +
          '<input type="text" name="name" autocomplete="name" required>' +
        '</label>' +
        '<label class="book-field">' + RSTR.email +
          '<input type="email" name="email" autocomplete="email" required>' +
        '</label>' +
        '<label class="book-field">' + RSTR.message + ' <span class="book-opt">' + RSTR.optional + '</span>' +
          '<textarea name="message" rows="3" placeholder="' + RSTR.messageHint + '"></textarea>' +
        '</label>' +
        '<p class="book-privacy request-note">' + RSTR.note + '</p>' +
        '<p class="request-error" data-req-error aria-live="polite" hidden></p>' +
        '<div class="book-actions">' +
          '<button type="button" class="btn btn-ghost" data-req-cancel>' + RSTR.cancel + '</button>' +
          '<button type="submit" class="btn btn-primary" data-req-submit>' + RSTR.submit + '</button>' +
        '</div>' +
      '</form>' +
      '<div class="book-form request-done" hidden>' +
        '<button type="button" class="book-dialog-close" aria-label="' + RSTR.close + '">&times;</button>' +
        '<h2>' + RSTR.okTitle + '</h2>' +
        '<p class="request-done-body">' + RSTR.okBody + '</p>' +
        '<div class="book-actions">' +
          '<button type="button" class="btn btn-primary" data-req-close>' + RSTR.close + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(d);

    var form = d.querySelector(".request-form");
    var doneEl = d.querySelector(".request-done");
    var errEl = d.querySelector("[data-req-error]");
    var submitBtn = d.querySelector("[data-req-submit]");

    function close() { if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); }
    d.querySelectorAll(".book-dialog-close").forEach(function (b) { b.addEventListener("click", close); });
    d.querySelector("[data-req-cancel]").addEventListener("click", close);
    d.querySelector("[data-req-close]").addEventListener("click", close);
    d.addEventListener("click", function (e) { if (e.target === d) close(); });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = form.querySelector('input[name="name"]').value.trim();
      var email = form.querySelector('input[name="email"]').value.trim();
      var message = form.querySelector('textarea[name="message"]').value.trim();
      if (!name || !email) { form.reportValidity && form.reportValidity(); return; }
      errEl.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = RSTR.working;
      fetch(window.GLS_WORKER_BASE + "/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: d._reqDate || "",
          dateText: d._reqText || d._reqDate || "",
          name: name, email: email, message: message, lang: LANG
        })
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data || !data.ok) throw new Error("request failed");
          form.hidden = true;
          doneEl.hidden = false;
          var closeBtn = d.querySelector("[data-req-close]");
          if (closeBtn) closeBtn.focus();
        })
        .catch(function () {
          errEl.textContent = RSTR.error;
          errEl.hidden = false;
          submitBtn.disabled = false;
          submitBtn.textContent = RSTR.submit;
        });
    });

    requestDialog = d;
    return d;
  }

  function openRequestDialog(dateKey, dateText) {
    var d = ensureRequestDialog();
    d._reqDate = dateKey || "";
    d._reqText = dateText || dateKey || "";
    var form = d.querySelector(".request-form");
    var doneEl = d.querySelector(".request-done");
    form.hidden = false;
    doneEl.hidden = true;
    form.reset();
    d.querySelector("[data-req-lead]").innerHTML = RSTR.lead(d._reqText);
    var errEl = d.querySelector("[data-req-error]");
    errEl.hidden = true; errEl.textContent = "";
    var submitBtn = d.querySelector("[data-req-submit]");
    submitBtn.disabled = false;
    submitBtn.textContent = RSTR.submit;
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
    var nameInput = form.querySelector('input[name="name"]');
    if (nameInput) nameInput.focus();
  }

  // Klik op een vrije kalenderdag (werkt ook na opnieuw tekenen van de kalender).
  document.addEventListener("click", function (e) {
    var cell = e.target.closest ? e.target.closest("[data-request-date]") : null;
    if (!cell) return;
    e.preventDefault();
    openRequestDialog(cell.getAttribute("data-request-date"), cell.getAttribute("data-request-text"));
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && requestDialog && requestDialog.open) {
      if (typeof requestDialog.close === "function") requestDialog.close();
      else requestDialog.removeAttribute("open");
    }
  });

  // Slow-motion voor specifieke sfeer-achtergrondvideo's (niet bij verminderde beweging)
  if (!reduceMotion) {
    ["workshopSectionVideo"].forEach(function (id) {
      var v = document.getElementById(id);
      if (v) v.playbackRate = 0.5;
    });
  }

  // Taalknop: op de workshop-detailpagina nemen we de ?event-parameter mee naar
  // de andere taalversie, zodat die hetzelfde evenement toont. De link werkt ook
  // zonder JS (de href in de HTML wijst al naar de juiste tegenhanger).
  if (window.location.search) {
    document.querySelectorAll("a.lang-link[data-keep-query]").forEach(function (a) {
      var href = a.getAttribute("href");
      if (href && href.indexOf("?") === -1) a.setAttribute("href", href + window.location.search);
    });
  }
});
