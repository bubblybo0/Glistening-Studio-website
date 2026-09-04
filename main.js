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
    var time = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(d);
    var hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(d));
    var timeOfDay, timeOfDayEn;
    if (hour < 12) { timeOfDay = "ochtend"; timeOfDayEn = "morning"; }
    else if (hour < 18) { timeOfDay = "middag"; timeOfDayEn = "afternoon"; }
    else { timeOfDay = "avond"; timeOfDayEn = "evening"; }
    return { dateLabel: dateLabel, dutchDate: dutchDate, englishDate: englishDate, time: time, timeOfDay: timeOfDay, timeOfDayEn: timeOfDayEn };
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
      diet: "Dieetwensen of allergie&euml;n?",
      optional: "(optioneel)",
      privacy: "We gebruiken je gegevens alleen voor deze boeking.",
      cancel: "Annuleren",
      toPayment: "Naar betaling &rarr;",
      working: "Bezig…",
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
      diet: "Dietary needs or allergies?",
      optional: "(optional)",
      privacy: "We only use your details for this booking.",
      cancel: "Cancel",
      toPayment: "To payment &rarr;",
      working: "Working…",
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
        '<input type="hidden" name="lang" value="' + LANG + '">' +
        '<input type="hidden" name="locale" value="' + (LANG === "en" ? "en_US" : "nl_NL") + '">' +
        '<label class="book-field">' + STR.name +
          '<input type="text" name="name" autocomplete="name" required>' +
        '</label>' +
        '<label class="book-field">' + STR.email +
          '<input type="email" name="email" autocomplete="email" required>' +
        '</label>' +
        '<label class="book-field">' + STR.diet + ' <span class="book-opt">' + STR.optional + '</span>' +
          '<textarea name="diet" rows="2"></textarea>' +
        '</label>' +
        '<p class="book-privacy">' + STR.privacy + '</p>' +
        '<div class="book-actions">' +
          '<button type="button" class="btn btn-ghost" data-cancel>' + STR.cancel + '</button>' +
          '<button type="submit" class="btn btn-primary" data-submit>' + STR.toPayment + '</button>' +
        '</div>' +
      '</form>';
    document.body.appendChild(d);
    var form = d.querySelector("form");
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
    var total = (45 * opts.qty).toFixed(2).replace(".", ",");
    d.querySelector("[data-summary]").innerHTML =
      "<strong>" + opts.qty + " " + (opts.qty === 1 ? STR.spot : STR.spots) + "</strong>" +
      (opts.when ? " &middot; " + opts.when : "") +
      " &middot; &euro;" + total;
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
