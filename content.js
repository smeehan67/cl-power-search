// ============================================================
// content.js — Craigslist Power Search
// Runs on every CL page. On search pages: hides dismissed
// listings, injects dismiss buttons, shows count badge.
// ============================================================

(function () {
  "use strict";

  const IS_SEARCH_PAGE = /\/search\//.test(location.pathname);
  const IS_DETAIL_PAGE = /\/d\//.test(location.pathname);

  // ──────────────────────────────────────────────────────────
  // FINGERPRINTING
  // SHA-256(lower(title)|price|lower(neighborhood))
  // Matches the Python tracker's algorithm.
  // ──────────────────────────────────────────────────────────

  async function sha256(str) {
    const buf = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function fingerprint(title, price, neighborhood) {
    const raw =
      title.toLowerCase() + "|" + price + "|" + neighborhood.toLowerCase();
    return sha256(raw);
  }

  // ──────────────────────────────────────────────────────────
  // STORAGE HELPERS
  // Schema: { dismissed: { [fp]: { id, title, dismissedAt } } }
  // ──────────────────────────────────────────────────────────

  function loadDismissed() {
    return new Promise((resolve) => {
      chrome.storage.local.get("dismissed", (data) => {
        resolve(data.dismissed || {});
      });
    });
  }

  function saveDismissed(dismissed) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ dismissed }, resolve);
    });
  }

  // ──────────────────────────────────────────────────────────
  // LISTING PARSING
  // Targets Craigslist's current search result markup.
  // ──────────────────────────────────────────────────────────

  function getListingNodes() {
    // Current CL markup uses <div class="cl-search-result"> cards inside
    // a <div class="results"> container. Legacy fallbacks included.
    return Array.from(
      document.querySelectorAll(
        '.cl-search-result, ol.cl-static-search-results li, div.results li.result-row'
      )
    );
  }

  function parseListingNode(card) {
    // Anchor — try current then legacy selectors
    const anchor =
      card.querySelector("a.cl-app-anchor") ||
      card.querySelector("a.posting-title") ||
      card.querySelector("a[href*='.html']");

    if (!anchor) return null;

    const href = anchor.href || "";
    const idMatch = href.match(/(\d{8,12})\.html/);
    const id = idMatch ? idMatch[1] : "";

    // Title
    const titleEl =
      anchor.querySelector(".label") ||
      anchor.querySelector(".result-title") ||
      anchor;
    const title = (titleEl.textContent || "").trim();

    // Price
    const priceEl =
      card.querySelector(".priceinfo") ||
      card.querySelector(".result-price");
    const price = priceEl ? (priceEl.textContent || "").trim() : "";

    // Neighborhood
    const metaEl =
      card.querySelector(".meta") ||
      card.querySelector(".result-hood") ||
      card.querySelector(".postingtitletext small");
    const neighborhood = metaEl ? (metaEl.textContent || "").trim() : "";

    return { id, title, price, neighborhood, anchor, card };
  }

  // ──────────────────────────────────────────────────────────
  // BADGE
  // ──────────────────────────────────────────────────────────

  let badgeEl = null;

  function upsertBadge(count) {
    if (count === 0) {
      if (badgeEl) badgeEl.remove();
      badgeEl = null;
      return;
    }

    if (!badgeEl) {
      badgeEl = document.createElement("div");
      badgeEl.id = "cl-dismiss-badge";

      // Insert before the results list
      const list =
        document.querySelector("div.results") ||
        document.querySelector("ol.cl-static-search-results");
      if (list) {
        list.parentNode.insertBefore(badgeEl, list);
      } else {
        document.body.prepend(badgeEl);
      }
    }

    badgeEl.innerHTML =
      "You've hidden <span>" + count + "</span> listing" +
      (count === 1 ? "" : "s") + " on this page.";
  }

  // ──────────────────────────────────────────────────────────
  // DISMISS BUTTON
  // ──────────────────────────────────────────────────────────

  // Document-level capture handler — fires before ANY Craigslist listener.
  // We intercept every event type that could trigger navigation or interfere.
  for (const evt of ["pointerdown", "pointerup", "mousedown", "mouseup", "click"]) {
    document.addEventListener(evt, (e) => {
      const btn = e.target.closest(".cl-dismiss-btn");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Only do the actual dismiss on click (not on mousedown/up)
      if (evt === "click") {
        const card = btn.closest(".cl-search-result") || btn.closest("li");
        if (!card) return;

        const fp = btn.dataset.fp;
        const id = btn.dataset.listingId;
        const title = btn.dataset.listingTitle;

        card.classList.add("cl-fading-out");
        setTimeout(() => card.remove(), 310);

        (async () => {
          const fresh = await loadDismissed();
          fresh[fp] = { id, title, dismissedAt: new Date().toISOString() };
          await saveDismissed(fresh);
          upsertBadge(Object.keys(fresh).length);
        })();
      }
    }, true);  // capture phase on document — fires first
  }

  // Detect CL view mode from the individual card's class
  function isGalleryView(card) {
    return card.classList.contains("cl-search-view-mode-gallery");
  }

  function addDismissButton(card, fp, id, title, dismissed) {
    if (card.querySelector(".cl-dismiss-btn")) return; // already added

    const btn = document.createElement("button");
    btn.className = "cl-dismiss-btn";
    btn.title = "Hide this listing";
    btn.textContent = "×";

    // Store data for the document-level handler
    btn.dataset.fp = fp;
    btn.dataset.listingId = id;
    btn.dataset.listingTitle = title;

    // Direct click handler — backup for views where document capture misses
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      card.classList.add("cl-fading-out");
      setTimeout(() => card.remove(), 310);

      (async () => {
        const fresh = await loadDismissed();
        fresh[fp] = { id, title, dismissedAt: new Date().toISOString() };
        await saveDismissed(fresh);
        upsertBadge(Object.keys(fresh).length);
      })();
    });

    if (isGalleryView(card)) {
      // Gallery view: absolute-position over the card image
      // Append inside .gallery-card (the visible card container)
      const galleryCard = card.querySelector(".gallery-card") || card;
      galleryCard.style.setProperty("position", "relative", "important");
      galleryCard.style.setProperty("overflow", "visible", "important");

      const s = btn.style;
      s.setProperty("position", "absolute", "important");
      s.setProperty("top", "4px", "important");
      s.setProperty("right", "4px", "important");
      s.setProperty("width", "22px", "important");
      s.setProperty("height", "22px", "important");
      s.setProperty("background", "rgba(120,120,120,0.75)", "important");
      s.setProperty("color", "#fff", "important");
      s.setProperty("border", "none", "important");
      s.setProperty("border-radius", "50%", "important");
      s.setProperty("font-size", "14px", "important");
      s.setProperty("line-height", "22px", "important");
      s.setProperty("text-align", "center", "important");
      s.setProperty("cursor", "pointer", "important");
      s.setProperty("z-index", "2147483647", "important");
      s.setProperty("padding", "0", "important");
      s.setProperty("display", "flex", "important");
      s.setProperty("align-items", "center", "important");
      s.setProperty("justify-content", "center", "important");
      s.setProperty("font-family", "sans-serif", "important");
      s.setProperty("opacity", "1", "important");
      s.setProperty("visibility", "visible", "important");
      s.setProperty("pointer-events", "auto", "important");
      s.setProperty("overflow", "visible", "important");

      galleryCard.appendChild(btn);
    } else {
      // List / thumb view: append inside the visible content container
      const contentNode = card.querySelector(".result-node") || card;

      // Use setProperty with !important to override cached CSS
      const s = btn.style;
      s.setProperty("display", "inline-flex", "important");
      s.setProperty("align-items", "center", "important");
      s.setProperty("justify-content", "center", "important");
      s.setProperty("width", "18px", "important");
      s.setProperty("height", "18px", "important");
      s.setProperty("background", "rgba(120,120,120,0.75)", "important");
      s.setProperty("color", "#fff", "important");
      s.setProperty("border", "none", "important");
      s.setProperty("border-radius", "50%", "important");
      s.setProperty("font-size", "12px", "important");
      s.setProperty("line-height", "18px", "important");
      s.setProperty("text-align", "center", "important");
      s.setProperty("cursor", "pointer", "important");
      s.setProperty("padding", "0", "important");
      s.setProperty("margin-right", "6px", "important");
      s.setProperty("vertical-align", "middle", "important");
      s.setProperty("font-family", "sans-serif", "important");
      s.setProperty("flex-shrink", "0", "important");
      s.setProperty("position", "relative", "important");
      s.setProperty("z-index", "2147483647", "important");
      s.setProperty("pointer-events", "auto", "important");
      s.setProperty("top", "auto", "important");
      s.setProperty("right", "auto", "important");

      contentNode.prepend(btn);
    }
  }

  // ──────────────────────────────────────────────────────────
  // MAIN — runs once on page load
  // ──────────────────────────────────────────────────────────

  async function run() {
    if (!IS_SEARCH_PAGE) return;

    const dismissed = await loadDismissed();
    const dismissedIds = new Set(
      Object.values(dismissed).map((v) => v.id).filter(Boolean)
    );

    const nodes = getListingNodes();
    let hiddenCount = 0;

    // Process all listings in parallel (fingerprints are async)
    await Promise.all(
      nodes.map(async (card) => {
        const parsed = parseListingNode(card);
        if (!parsed) return;

        const { id, title, price, neighborhood } = parsed;
        const fp = await fingerprint(title, price, neighborhood);

        // Hide if already dismissed by fingerprint or ID
        if (dismissed[fp] || (id && dismissedIds.has(id))) {
          card.remove();
          hiddenCount++;
          return;
        }

        // Otherwise add dismiss button
        addDismissButton(card, fp, id, title, dismissed);
      })
    );

    upsertBadge(hiddenCount);
  }

  // ──────────────────────────────────────────────────────────
  // DETAIL PAGE DISMISS
  // Runs on listing detail pages (/d/ URLs).
  // ──────────────────────────────────────────────────────────

  async function setupDetailPage() {
    // Extract listing ID from URL (e.g. /apa/d/sunnyvale-apt/7654321098.html)
    const idMatch = location.pathname.match(/(\d{8,12})\.html/);
    const id = idMatch ? idMatch[1] : "";

    // Scrape listing data — use same selectors as parseListingNode where possible
    const titleEl =
      document.querySelector("#titletextonly") ||
      document.querySelector(".postingtitletext");
    const title = titleEl
      ? (titleEl.firstChild || titleEl).textContent.trim()
      : document.title.replace(/\s*[-–]\s*craigslist\s*$/i, "").trim();

    const priceEl = document.querySelector(".price");
    const price = priceEl ? priceEl.textContent.trim() : "";

    const hoodEl = document.querySelector(".postingtitletext small");
    const neighborhood = hoodEl ? hoodEl.textContent.trim() : "";

    // Check if already dismissed
    const dismissed = await loadDismissed();
    const dismissedIds = new Set(
      Object.values(dismissed).map((v) => v.id).filter(Boolean)
    );
    const fp = await fingerprint(title, price, neighborhood);
    const alreadyDismissed = !!(dismissed[fp] || (id && dismissedIds.has(id)));

    // Create button
    const btn = document.createElement("button");
    btn.id = "cl-detail-dismiss-btn";
    if (alreadyDismissed) {
      btn.textContent = "Dismissed \u2713";
      btn.disabled = true;
      btn.classList.add("cl-detail-dismissed");
    } else {
      btn.textContent = "Dismiss this listing";
      btn.addEventListener("click", async () => {
        const fresh = await loadDismissed();
        fresh[fp] = { id, title, dismissedAt: new Date().toISOString() };
        await saveDismissed(fresh);
        btn.textContent = "Dismissed \u2713";
        btn.disabled = true;
        btn.classList.add("cl-detail-dismissed");
      });
    }

    // Insert after the posting title heading, or before the body section
    const anchor =
      document.querySelector("h2.postingtitle") ||
      document.querySelector(".postingtitletext") ||
      document.querySelector(".userbody") ||
      document.body;
    anchor.insertAdjacentElement("afterend", btn);
  }

  // Run immediately; also re-run if CL does a soft navigation
  run();

  // Observe for dynamically loaded listings and view-mode switches
  const observer = new MutationObserver(() => {
    // Debounce
    clearTimeout(observer._timer);
    observer._timer = setTimeout(run, 400);
  });

  const resultsContainer =
    document.querySelector("div.results") ||
    document.querySelector("ol.cl-static-search-results") ||
    document.body;

  // Watch childList (new listings) and subtree+attributes (view mode switches)
  observer.observe(resultsContainer, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

  if (IS_DETAIL_PAGE) setupDetailPage();

  // Also re-run on hash changes (CL uses hash for view mode: #search=2~list~0)
  window.addEventListener("hashchange", () => {
    // Remove existing buttons so they get re-created for the new view mode
    document.querySelectorAll(".cl-dismiss-btn").forEach(b => b.remove());
    clearTimeout(observer._timer);
    observer._timer = setTimeout(run, 400);
  });
})();
