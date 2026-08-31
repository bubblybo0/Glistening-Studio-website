// GlisteningStudio — small helper script (no dependencies, no build step)
document.addEventListener("DOMContentLoaded", function () {
  var menuToggle = document.getElementById("menuToggle");
  var navClose = document.getElementById("navClose");
  var overlay = document.getElementById("navOverlay");
  function openNav() {
    overlay.classList.add("open");
    document.body.classList.add("nav-open");
    menuToggle.setAttribute("aria-expanded", "true");
  }
  function closeNav() {
    overlay.classList.remove("open");
    document.body.classList.remove("nav-open");
    menuToggle.setAttribute("aria-expanded", "false");
  }
  if (menuToggle && overlay) {
    menuToggle.addEventListener("click", openNav);
    if (navClose) navClose.addEventListener("click", closeNav);
    overlay.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", closeNav); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav();
    });
  }

  // Respect reduced-motion: freeze the hero video on its poster frame instead of autoplaying
  var heroVideo = document.querySelector(".hero-video-section video");
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (heroVideo && reduceMotion) {
    heroVideo.removeAttribute("autoplay");
    heroVideo.pause();
  }

  // Soft light glow that drifts toward the cursor — desktop/mouse only, off for touch
  // devices and for anyone who prefers reduced motion.
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

  // Make sure every ambient/story video actually starts looping, even if the
  // browser's autoplay policy silently blocked the autoplay attribute (in which
  // case it would otherwise just sit frozen on its poster image forever).
  var allVideos = document.querySelectorAll("video[autoplay]");
  function tryPlayAll() {
    allVideos.forEach(function (v) {
      if (v.paused) {
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
      }
    });
  }
  tryPlayAll();
  window.addEventListener("load", tryPlayAll);
  ["click", "touchstart", "scroll"].forEach(function (evt) {
    document.addEventListener(evt, tryPlayAll, { once: true, passive: true });
  });

  // Fade + lift each .reveal element into place the first time it scrolls into view
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

      // Safety net: IntersectionObserver can miss an element in rare cases
      // (e.g. a video changing the row's height right as it scrolls into
      // view). Without this, a missed element would stay invisible forever.
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
      // Last resort: never leave content permanently invisible.
      setTimeout(function () {
        revealEls.forEach(function (el) { el.classList.add("is-visible"); });
      }, 6000);
    }
  }

  // Ticket quantity stepper: +/- buttons swap the "Boek workshop" link
  // between pre-made fixed-amount Mollie links (1 ticket, 2 tickets, ...),
  // so the customer never has to type in their own amount. initTicketPickers
  // is re-run whenever event data finishes loading async (see workshop.html),
  // since data-links may start empty on pages that fetch events.json.
  function initTicketPickers() {
    document.querySelectorAll(".ticket-picker").forEach(function (picker) {
      var minus = picker.querySelector(".qty-minus");
      var plus = picker.querySelector(".qty-plus");
      var valueEl = picker.querySelector(".qty-value");
      var bookBtn = picker.querySelector(".book-btn");
      var stepper = picker.querySelector(".qty-stepper");
      if (!minus || !plus || !valueEl || !bookBtn) return;
      var links = {};
      try { links = JSON.parse(bookBtn.getAttribute("data-links") || "{}"); } catch (e) {}
      var maxQty = Object.keys(links).length || 1;
      if (stepper) stepper.style.display = maxQty > 1 ? "" : "none";
      var qty = picker._qty && picker._qty <= maxQty ? picker._qty : 1;
      function update() {
        picker._qty = qty;
        valueEl.textContent = qty;
        minus.disabled = qty <= 1;
        plus.disabled = qty >= maxQty;
        var url = links[String(qty)];
        if (url) bookBtn.setAttribute("href", url);
        bookBtn.textContent = qty === 1 ? "Boek workshop" : "Boek " + qty + " tickets";
      }
      minus.onclick = function () { if (qty > 1) { qty--; update(); } };
      plus.onclick = function () { if (qty < maxQty) { qty++; update(); } };
      update();
    });
  }
  initTicketPickers();
  document.addEventListener("eventDataReady", initTicketPickers);

  // Slow-motion playback for specific ambient background videos
  var slowMotionIds = ["workshopSectionVideo"];
  slowMotionIds.forEach(function (id) {
    var v = document.getElementById(id);
    if (v) v.playbackRate = 0.5;
  });

  // "Vertaal naar Engels" link in the nav — opens a Google Translate view of
  // the current page in a new tab. Plain text link, no flag icons.
  var translateLink = document.getElementById("translateLink");
  if (translateLink) {
    translateLink.addEventListener("click", function (e) {
      e.preventDefault();
      var target = "https://translate.google.com/translate?sl=nl&tl=en&u=" + encodeURIComponent(window.location.href);
      window.open(target, "_blank", "noopener");
    });
  }
});
