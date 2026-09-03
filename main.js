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
})();

document.addEventListener("DOMContentLoaded", function () {
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  // Ticket-stepper: +/- bouwen een "Boek workshop"-link die naar de Cloudflare
  // Worker gaat, die op dat moment een Mollie-betaling maakt voor het gekozen aantal.
  var WORKER_BOOK_URL = "https://glistening-studio-tickets.noisy-surf-d8b5.workers.dev/book";
  var MAX_TICKET_QTY = 15;
  function initTicketPickers() {
    document.querySelectorAll(".ticket-picker").forEach(function (picker) {
      var minus = picker.querySelector(".qty-minus");
      var plus = picker.querySelector(".qty-plus");
      var valueEl = picker.querySelector(".qty-value");
      var bookBtn = picker.querySelector(".book-btn");
      if (!minus || !plus || !valueEl || !bookBtn) return;
      var desc = bookBtn.getAttribute("data-worker-desc") || "Glistening Studio workshop";
      var maxQty = MAX_TICKET_QTY;
      var qty = picker._qty && picker._qty <= maxQty ? picker._qty : 1;
      function update() {
        picker._qty = qty;
        valueEl.textContent = qty;
        // Hoorbare context voor schermlezers: "1 ticket" / "3 tickets".
        valueEl.setAttribute("aria-label", qty + (qty === 1 ? " ticket" : " tickets"));
        minus.disabled = qty <= 1;
        plus.disabled = qty >= maxQty;
        var ticketDesc = desc + " - " + qty + " ticket" + (qty > 1 ? "s" : "");
        bookBtn.setAttribute("href", WORKER_BOOK_URL + "?qty=" + qty + "&desc=" + encodeURIComponent(ticketDesc));
        bookBtn.textContent = qty === 1 ? "Boek workshop" : "Boek " + qty + " tickets";
      }
      minus.onclick = function () { if (qty > 1) { qty--; update(); } };
      plus.onclick = function () { if (qty < maxQty) { qty++; update(); } };
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

  // "Vertaal naar Engels"-link in de nav — opent Google Translate in een nieuw tabblad.
  var translateLink = document.getElementById("translateLink");
  if (translateLink) {
    translateLink.addEventListener("click", function (e) {
      e.preventDefault();
      var target = "https://translate.google.com/translate?sl=nl&tl=en&u=" + encodeURIComponent(window.location.href);
      window.open(target, "_blank", "noopener");
    });
  }
});
