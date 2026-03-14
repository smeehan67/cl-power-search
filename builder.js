// ============================================================
// builder.js — Boolean Query Builder Panel
// Floating panel injected on CL search pages.
// ============================================================

(function () {
  "use strict";

  const IS_SEARCH_PAGE = /\/search\//.test(location.pathname);
  if (!IS_SEARCH_PAGE) return;

  const STORAGE_KEY_STATE = "builderState";
  const STORAGE_KEY_SAVES = "savedSearches";
  const MAX_OR_TERMS = 14; // CL hard limit: 15+ OR terms returns 400

  // ──────────────────────────────────────────────────────────
  // STATE
  // ──────────────────────────────────────────────────────────

  let orTerms  = [{ text: "", phrase: false }];
  let andTerms = [{ text: "", phrase: false }];
  let notTerms = [{ text: "", phrase: false }];
  let collapsed = false;

  // ──────────────────────────────────────────────────────────
  // STORAGE
  // ──────────────────────────────────────────────────────────

  function saveState() {
    chrome.storage.local.set({
      [STORAGE_KEY_STATE]: { orTerms, andTerms, notTerms, collapsed },
    });
  }

  function loadState(cb) {
    chrome.storage.local.get(STORAGE_KEY_STATE, (data) => {
      const s = data[STORAGE_KEY_STATE];
      if (s) {
        orTerms  = s.orTerms  || orTerms;
        andTerms = s.andTerms || andTerms;
        notTerms = s.notTerms || notTerms;
        collapsed = s.collapsed || false;
      }
      cb();
    });
  }

  function saveSavedSearches() {
    chrome.storage.local.set({ [STORAGE_KEY_SAVES]: savedSearches });
  }

  function loadSavedSearches(cb) {
    chrome.storage.local.get(STORAGE_KEY_SAVES, (data) => {
      savedSearches = data[STORAGE_KEY_SAVES] || [];
      cb();
    });
  }

  // ──────────────────────────────────────────────────────────
  // CSV EXPORT / IMPORT
  // ──────────────────────────────────────────────────────────

  function csvField(val) {
    if (/[,"\n]/.test(val)) return '"' + val.replace(/"/g, '""') + '"';
    return val;
  }

  function parseCSVRow(line) {
    const fields = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (c === "," && !inQuotes) {
        fields.push(field); field = "";
      } else {
        field += c;
      }
    }
    fields.push(field);
    return fields;
  }

  function exportSearchesCSV() {
    const header = "name,section,or_terms,and_terms,not_terms";
    const rows = savedSearches.map((s) => {
      const orStr  = s.orTerms.map((t) => t.text.trim()).filter(Boolean).join("|");
      const andStr = s.andTerms ? s.andTerms.map((t) => t.text.trim()).filter(Boolean).join("|") : "";
      const notStr = s.notTerms.map((t) => t.text.trim()).filter(Boolean).join("|");
      return [csvField(s.name), csvField(s.section || ""), csvField(orStr), csvField(andStr), csvField(notStr)].join(",");
    });
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "cl-saved-searches.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function importSearchesCSV(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
    if (lines.length < 2) return 0;
    let added = 0;
    lines.slice(1).forEach((line) => {
      const cols = parseCSVRow(line);
      const [rawName, rawSection, rawOr] = cols;
      // 5-column format: name,section,or_terms,and_terms,not_terms
      // 4-column legacy: name,section,or_terms,not_terms
      const has5Cols = cols.length >= 5;
      const rawAnd = has5Cols ? cols[3] : "";
      const rawNot = has5Cols ? cols[4] : cols[3];
      const name = (rawName || "").trim();
      if (!name) return;
      const orTerms = (rawOr || "").split("|").map((t) => t.trim()).filter(Boolean)
                       .map((t) => ({ text: t, phrase: false }));
      const andTerms = (rawAnd || "").split("|").map((t) => t.trim()).filter(Boolean)
                        .map((t) => ({ text: t, phrase: t.includes(" ") }));
      const notTerms = (rawNot || "").split("|").map((t) => t.trim()).filter(Boolean)
                        .map((t) => ({ text: t, phrase: t.includes(" ") }));
      if (!orTerms.length)  orTerms.push({ text: "", phrase: false });
      if (!andTerms.length) andTerms.push({ text: "", phrase: false });
      if (!notTerms.length) notTerms.push({ text: "", phrase: false });
      const entry = { name, section: rawSection ? rawSection.trim() : null, orTerms, andTerms, notTerms };
      const idx = savedSearches.findIndex((s) => s.name === name);
      if (idx >= 0) { savedSearches[idx] = entry; } else { savedSearches.push(entry); added++; }
    });
    saveSavedSearches();
    rebuildSaveOptions();
    return added;
  }

  function openAllSavedSearches() {
    if (!savedSearches.length) return;
    const currentSection = (location.pathname.match(/\/search\/([^/]+)/) || [])[1] || "";
    savedSearches.forEach((save) => {
      const section = save.section || currentSection;
      const orParts = save.orTerms
        .filter((t) => t.text.trim())
        .map((t) => (t.phrase ? `"${t.text.trim()}"` : t.text.trim()));
      if (!orParts.length) return;
      const andParts = save.andTerms
        ? save.andTerms.filter((t) => t.text.trim()).map((t) => (t.phrase ? `"${t.text.trim()}"` : t.text.trim()))
        : [];
      const andInfix = andParts.length ? " " + andParts.join(" ") : "";
      const notParts = save.notTerms
        .filter((t) => t.text.trim())
        .map((t) => (t.phrase ? `-"${t.text.trim()}"` : `-${t.text.trim()}`));
      const notSuffix = notParts.length ? " " + notParts.join(" ") : "";
      const groups = [];
      for (let i = 0; i < orParts.length; i += MAX_OR_TERMS) {
        groups.push(orParts.slice(i, i + MAX_OR_TERMS));
      }
      groups.forEach((g) => {
        const orStr = g.length > 1 ? `(${g.join("|")})` : g[0];
        const q = `${orStr}${andInfix}${notSuffix}`.trim();
        const url = new URL(`${location.origin}/search/${section}`);
        url.searchParams.set("query", q);
        window.open(url.toString(), "_blank");
      });
    });
  }

  // ──────────────────────────────────────────────────────────
  // TEMPLATES
  // ──────────────────────────────────────────────────────────

  const TEMPLATES = [
    {
      name: "Fender Guitars",
      section: "msa",
      or: ["strat*", "tele*", "jazzmaster", "jaguar", "mustang*"],
      and: ["fender"],
      not: ["squier", "squire", "reissue", "part*"],
    },
    {
      name: "Gibson Guitars",
      section: "msa",
      or: ["les paul*", "SG", "ES-335", "flying V*", "explorer*"],
      and: ["gibson"],
      not: ["epiphone", "reissue", "part*"],
    },
    {
      name: "Musical Instruments",
      section: "msa",
      or: ["guitar*", "piano*", "keyboard*", "drum*", "violin*"],
      not: ["broken", "parts"],
    },
    {
      name: "Electronics",
      section: "ela",
      or: ["macbook*", "ipad*", "iphone*", "pixel*", "galaxy*"],
      not: ["broken", "parts only", "cracked"],
    },
    {
      name: "Bikes & Outdoor",
      section: "sga",
      or: ["bike*", "bicycle*", "kayak*", "surfboard*", "skateboard*"],
      not: [],
    },
    {
      name: "Tools & Hardware",
      section: "tla",
      or: ["drill*", "saw*", "compressor*", "generator*", "toolbox*"],
      not: ["broken", "parts"],
    },
    {
      name: "Cars & Trucks",
      section: "cta",
      or: ["sedan*", "SUV", "truck*", "pickup*", "hybrid*"],
      and: ["clean title"],
      not: ["salvage", "parts", "flood", "rebuilt"],
    },
    {
      name: "Baby & Kids",
      section: "baa",
      or: ["stroller*", "crib*", "highchair*", "playpen*", "baby gear"],
      not: ["broken", "damaged"],
    },
    {
      name: "Furniture",
      section: "fua",
      or: ["sofa", "couch", "sectional", "dresser*", "bookcase*"],
      not: ["broken", "damaged"],
    },
    {
      name: "Vintage & Antiques",
      section: "ata",
      or: ["vintage*", "antique*", "retro", "mid-century", "collectible*"],
      not: ["replica", "reproduction"],
    },
    {
      name: "⚡ Split demo — Tech (2 tabs)",
      section: "ela",
      or: [
        "macbook", "imac", "ipad", "iphone", "pixel", "galaxy", "surface",
        "thinkpad", "dell xps", "hp spectre", "lenovo", "asus", "acer",
        "chromebook", "kindle", "airpods", "beats", "bose", "sonos",
        "nvidia", "gaming pc", "ps5", "xbox", "nintendo", "switch",
      ],
      not: ["broken", "parts only"],
    },
  ];

  // ──────────────────────────────────────────────────────────
  // QUERY GENERATION
  // OR:  (term1|term2|term3)
  // NOT: -term1 -term2
  // ──────────────────────────────────────────────────────────

  function buildQuery() {
    const orParts = orTerms
      .map((t) => t.text.trim())
      .filter(Boolean)
      .map((t, i) => (orTerms[i] && orTerms[i].phrase ? `"${t}"` : t));

    const andParts = andTerms
      .map((t) => t.text.trim())
      .filter(Boolean)
      .map((t, i) => (andTerms[i] && andTerms[i].phrase ? `"${t}"` : t));

    const notParts = notTerms
      .map((t) => t.text.trim())
      .filter(Boolean)
      .map((t, i) => {
        const val = notTerms[i] && notTerms[i].phrase ? `"${t}"` : t;
        return `-${val}`;
      });

    if (!orParts.length && !andParts.length) return "";

    let query = "";
    if (orParts.length > 1) {
      query += `(${orParts.join("|")})`;
    } else if (orParts.length === 1) {
      query += orParts[0];
    }

    if (andParts.length) {
      if (query) query += " ";
      query += andParts.join(" ");
    }

    if (notParts.length) {
      if (query) query += " ";
      query += notParts.join(" ");
    }

    return query;
  }

  // ──────────────────────────────────────────────────────────
  // AUTO-SPLIT
  // CL rejects queries with more than MAX_OR_TERMS (14) OR terms.
  // Split into groups of MAX_OR_TERMS, keeping all NOT terms.
  // ──────────────────────────────────────────────────────────

  function computeSubQueries() {
    const andParts = andTerms
      .filter((t) => t.text.trim())
      .map((t) => (t.phrase ? `"${t.text.trim()}"` : t.text.trim()));
    const andInfix = andParts.length ? " " + andParts.join(" ") : "";

    const notParts = notTerms
      .filter((t) => t.text.trim())
      .map((t) => {
        const val = t.phrase ? `"${t.text.trim()}"` : t.text.trim();
        return `-${val}`;
      });
    const notSuffix = notParts.length ? " " + notParts.join(" ") : "";

    const orParts = orTerms
      .filter((t) => t.text.trim())
      .map((t) => (t.phrase ? `"${t.text.trim()}"` : t.text.trim()));

    if (!orParts.length) return [];

    // Split into groups of MAX_OR_TERMS (CL hard limit)
    const groups = [];
    for (let i = 0; i < orParts.length; i += MAX_OR_TERMS) {
      groups.push(orParts.slice(i, i + MAX_OR_TERMS));
    }

    return groups.map((g) => {
      const orStr = g.length > 1 ? `(${g.join("|")})` : g[0];
      return `${orStr}${andInfix}${notSuffix}`.trim();
    });
  }

  function autoSplitSearch() {
    const subQueries = computeSubQueries();
    if (!subQueries.length) return;

    // Navigate current tab to first sub-query, open rest in new tabs
    subQueries.forEach((q, i) => {
      const url = new URL(location.href);
      url.searchParams.set("query", q);
      if (i === 0) {
        location.href = url.toString();
      } else {
        window.open(url.toString(), "_blank");
      }
    });
  }

  // ──────────────────────────────────────────────────────────
  // UI HELPERS
  // ──────────────────────────────────────────────────────────

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, attrs);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith("data-")) node.setAttribute(k, v);
    }
    children.forEach((c) => {
      if (typeof c === "string") node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }

  // ──────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────

  let savedSearches = [];
  let templateSelect = null;
  let saveNameInput = null;

  let panel = null;
  let previewEl = null;
  let plainEnglishEl = null;
  let counterEl = null;
  let warningEl = null;
  let searchBtn = null;
  let bodyEl = null;
  let toggleEl = null;

  function renderTermRows(container, terms, onUpdate, autoPhrase = false) {
    container.innerHTML = "";

    terms.forEach((term, i) => {
      const row = el("div", { className: "cl-term-row" });

      const input = el("input", {
        type: "text",
        value: term.text,
        placeholder: i === 0 ? "e.g. house" : "another term",
      });

      let syncPhraseBtn = () => {};

      input.addEventListener("input", () => {
        terms[i].text = input.value;
        if (autoPhrase) terms[i].phrase = input.value.trim().includes(" ");
        syncPhraseBtn();
        onUpdate();
      });

      const removeBtn = el("button", { className: "cl-remove-btn", title: "Remove", tabIndex: -1 }, ["×"]);
      removeBtn.addEventListener("click", () => {
        terms.splice(i, 1);
        if (terms.length === 0) terms.push({ text: "", phrase: false });
        renderPanel();
      });

      row.appendChild(input);
      if (!autoPhrase) {
        const phraseBtn = el(
          "span",
          { className: "cl-phrase-toggle" + (term.phrase ? " active" : ""), tabIndex: -1 },
          ['"…"']
        );

        const isWildcard = () => terms[i].text.includes("*");

        function flashWildcardWarning() {
          phraseBtn.textContent = "⚠ can't quote *";
          phraseBtn.classList.add("cl-phrase-wildcard-warn");
          setTimeout(() => {
            phraseBtn.textContent = '"…"';
            phraseBtn.classList.remove("cl-phrase-wildcard-warn");
          }, 1500);
        }

        syncPhraseBtn = function () {
          const wc = isWildcard();
          phraseBtn.classList.toggle("disabled", wc);
          phraseBtn.title = wc
            ? "Wildcards can't be phrase-matched — remove * first"
            : "Exact phrase match";
          if (wc && terms[i].phrase) {
            terms[i].phrase = false;
            phraseBtn.classList.remove("active");
            flashWildcardWarning();
          }
        };

        syncPhraseBtn(); // set initial state on render

        phraseBtn.addEventListener("click", () => {
          if (isWildcard()) { flashWildcardWarning(); return; }
          terms[i].phrase = !terms[i].phrase;
          phraseBtn.classList.toggle("active", terms[i].phrase);
          onUpdate();
        });
        row.appendChild(phraseBtn);
      }
      row.appendChild(removeBtn);
      container.appendChild(row);
    });
  }

  function buildPlainEnglish() {
    const orFilled  = orTerms.filter((t) => t.text.trim());
    const andFilled = andTerms.filter((t) => t.text.trim());
    const notFilled = notTerms.filter((t) => t.text.trim());

    if (!orFilled.length && !andFilled.length) return "";

    function termLabel(t) {
      const text = t.text.trim();
      if (text.endsWith("*")) {
        return `anything starting with <b>${text.slice(0, -1)}</b>`;
      }
      if (t.phrase) {
        return `the exact phrase <b>\u201c${text}\u201d</b>`;
      }
      return `<b>${text}</b>`;
    }

    function joinList(items, conj) {
      if (items.length === 1) return items[0];
      if (items.length === 2) return `${items[0]} ${conj} ${items[1]}`;
      return items.slice(0, -1).join(", ") + `, ${conj} ` + items[items.length - 1];
    }

    let html = "Finds listings";
    if (orFilled.length) {
      html += " containing " + joinList(orFilled.map(termLabel), "or");
    }
    if (andFilled.length) {
      html += " \u2014 that also include " + joinList(andFilled.map(termLabel), "and");
    }
    if (notFilled.length) {
      html += " \u2014 but not " + joinList(notFilled.map(termLabel), "or");
    }
    return html + ".";
  }

  function updatePreview() {
    const q = buildQuery();
    previewEl.textContent = q || "(empty)";

    const pe = buildPlainEnglish();
    plainEnglishEl.innerHTML = pe;
    plainEnglishEl.classList.toggle("hidden", !pe);

    const orCount = orTerms.filter((t) => t.text.trim()).length;
    counterEl.textContent = `${orCount} / ${MAX_OR_TERMS} OR terms`;
    counterEl.className = orCount <= MAX_OR_TERMS ? "green" : "red";

    if (orCount > MAX_OR_TERMS) {
      // Over CL's term limit — show auto-split info
      const subs = computeSubQueries();
      warningEl.textContent = `\u26a1 Opens ${subs.length} tabs (CL limits to ${MAX_OR_TERMS} OR terms)`;
      warningEl.classList.add("visible");
      if (searchBtn) {
        searchBtn.textContent = `Search in ${subs.length} tabs`;
        searchBtn.disabled = !q;
      }
    } else {
      warningEl.textContent = `\u26a0 Too many OR terms \u2014 CL limits to ${MAX_OR_TERMS}`;
      warningEl.classList.remove("visible");
      if (searchBtn) {
        searchBtn.textContent = "Search Craigslist";
        searchBtn.disabled = !q;
      }
    }

    saveState();
  }

  function renderPanel() {
    if (!panel) return;

    const orContainer  = bodyEl.querySelector("#cl-or-container");
    const andContainer = bodyEl.querySelector("#cl-and-container");
    const notContainer = bodyEl.querySelector("#cl-not-container");

    renderTermRows(orContainer,  orTerms,  updatePreview, false);
    renderTermRows(andContainer, andTerms, updatePreview, true);
    renderTermRows(notContainer, notTerms, updatePreview, true);
    updatePreview();
  }

  function rebuildSaveOptions() {
    Array.from(templateSelect.querySelectorAll("[data-save]")).forEach((o) => o.remove());
    if (!savedSearches.length) return;
    const divider = el("option", { value: "" }, ["— My saves —"]);
    divider.disabled = true;
    divider.setAttribute("data-save", "divider");
    templateSelect.appendChild(divider);
    savedSearches.forEach((save, i) => {
      const opt = el("option", { value: `user:${i}` }, [save.name]);
      opt.setAttribute("data-save", String(i));
      templateSelect.appendChild(opt);
    });
  }

  function buildPanel() {
    panel = el("div", { id: "cl-builder-panel" });

    // Header
    const header = el("div", { id: "cl-builder-header" });
    const title = el("h3", {}, ["Boolean Builder"]);
    toggleEl = el("span", { id: "cl-builder-toggle" }, [collapsed ? "▼ expand" : "▲ collapse"]);
    header.appendChild(title);
    header.appendChild(toggleEl);
    header.addEventListener("click", () => {
      collapsed = !collapsed;
      toggleEl.textContent = collapsed ? "▼ expand" : "▲ collapse";
      bodyEl.classList.toggle("collapsed", collapsed);
      saveState();
    });

    // Body
    bodyEl = el("div", { id: "cl-builder-body" });
    if (collapsed) bodyEl.classList.add("collapsed");

    // Template selector
    templateSelect = el("select", { id: "cl-template-select" });
    const placeholderOpt = el("option", { value: "" }, ["— load a template / saved search —"]);
    placeholderOpt.disabled = true;
    placeholderOpt.selected = true;
    templateSelect.appendChild(placeholderOpt);
    TEMPLATES.forEach((tmpl, i) => {
      templateSelect.appendChild(el("option", { value: String(i) }, [tmpl.name]));
    });
    templateSelect.addEventListener("change", () => {
      const val = templateSelect.value;
      if (!val) return;

      let section;
      if (val.startsWith("user:")) {
        const idx = parseInt(val.slice(5), 10);
        const save = savedSearches[idx];
        orTerms  = save.orTerms.map((t) => ({ ...t }));
        andTerms = save.andTerms && save.andTerms.length
          ? save.andTerms.map((t) => ({ ...t, phrase: t.text.includes(" ") }))
          : [{ text: "", phrase: false }];
        notTerms = save.notTerms.length
          ? save.notTerms.map((t) => ({ ...t, phrase: t.text.includes(" ") }))
          : [{ text: "", phrase: false }];
        section = save.section;
        if (saveNameInput) saveNameInput.value = save.name;
      } else {
        const idx = parseInt(val, 10);
        if (isNaN(idx)) return;
        const tmpl = TEMPLATES[idx];
        orTerms  = tmpl.or.map((t) => ({ text: t, phrase: false }));
        andTerms = tmpl.and
          ? tmpl.and.map((t) => ({ text: t, phrase: t.includes(" ") }))
          : [{ text: "", phrase: false }];
        notTerms = tmpl.not.length
          ? tmpl.not.map((t) => ({ text: t, phrase: t.includes(" ") }))
          : [{ text: "", phrase: false }];
        section = tmpl.section;
      }

      if (section && location.pathname !== `/search/${section}`) {
        saveState();
        const url = new URL(location.href);
        url.pathname = `/search/${section}`;
        url.search = "";
        url.hash = "";
        location.href = url.toString();
        return;
      }

      templateSelect.value = "";
      renderPanel();
    });

    // OR section
    const orLabel = el("div", { className: "cl-builder-section-label" }, ["OR terms"]);
    const orContainer = el("div", { id: "cl-or-container" });
    const orAddBtn = el("button", { className: "cl-add-btn" }, ["+ add term"]);
    orAddBtn.addEventListener("click", () => {
      orTerms.push({ text: "", phrase: false });
      renderPanel();
    });
    const orAdd5Btn = el("button", { className: "cl-add-btn" }, ["+ 5 terms"]);
    orAdd5Btn.style.marginLeft = "12px";
    orAdd5Btn.addEventListener("click", () => {
      for (let i = 0; i < 5; i++) orTerms.push({ text: "", phrase: false });
      renderPanel();
    });

    // AND section
    const andLabel = el("div", { className: "cl-builder-section-label" }, ["AND terms"]);
    const andContainer = el("div", { id: "cl-and-container" });
    const andAddBtn = el("button", { className: "cl-add-btn" }, ["+ add term"]);
    andAddBtn.addEventListener("click", () => {
      andTerms.push({ text: "", phrase: false });
      renderPanel();
    });
    const andAdd5Btn = el("button", { className: "cl-add-btn" }, ["+ 5 terms"]);
    andAdd5Btn.style.marginLeft = "12px";
    andAdd5Btn.addEventListener("click", () => {
      for (let i = 0; i < 5; i++) andTerms.push({ text: "", phrase: false });
      renderPanel();
    });

    // NOT section
    const notLabel = el("div", { className: "cl-builder-section-label" }, ["NOT terms"]);
    const notContainer = el("div", { id: "cl-not-container" });
    const notAddBtn = el("button", { className: "cl-add-btn" }, ["+ add term"]);
    notAddBtn.addEventListener("click", () => {
      notTerms.push({ text: "", phrase: false });
      renderPanel();
    });
    const notAdd5Btn = el("button", { className: "cl-add-btn" }, ["+ 5 terms"]);
    notAdd5Btn.style.marginLeft = "12px";
    notAdd5Btn.addEventListener("click", () => {
      for (let i = 0; i < 5; i++) notTerms.push({ text: "", phrase: false });
      renderPanel();
    });

    // Query preview
    const previewLabel = el("div", { className: "cl-builder-section-label" }, ["Query preview"]);
    previewEl = el("div", { id: "cl-query-preview" });
    plainEnglishEl = el("div", { id: "cl-plain-english", className: "hidden" });
    counterEl = el("div", { id: "cl-char-counter", className: "green" });
    warningEl = el("div", { id: "cl-char-warning" }, [
      `\u26a0 Too many OR terms \u2014 CL limits to ${MAX_OR_TERMS}`,
    ]);

    // Search button
    searchBtn = el("button", { id: "cl-search-btn" }, ["Search Craigslist"]);
    searchBtn.addEventListener("click", () => {
      const q = buildQuery();
      if (!q) return;

      const orCount = orTerms.filter((t) => t.text.trim()).length;
      if (orCount > MAX_OR_TERMS) {
        autoSplitSearch();
      } else {
        // Normal navigation — update ?query= param in current CL URL
        const url = new URL(location.href);
        url.searchParams.set("query", q);
        location.href = url.toString();
      }
    });

    // Save row
    const saveRow = el("div", { className: "cl-term-row", id: "cl-save-row" });
    saveNameInput = el("input", {
      type: "text",
      id: "cl-save-name",
      placeholder: "Save as…",
    });
    const saveBtn   = el("button", { className: "cl-add-btn", id: "cl-save-btn" }, ["Save"]);
    const deleteBtn = el("button", { className: "cl-remove-btn", id: "cl-delete-btn",
                                      title: "Delete this save" }, ["Delete"]);

    saveBtn.addEventListener("click", () => {
      const name = saveNameInput.value.trim();
      if (!name) return;
      const m = location.pathname.match(/\/search\/([^/]+)/);
      const section = m ? m[1] : null;
      const entry = {
        name,
        section,
        orTerms:  orTerms.map((t) => ({ ...t })),
        andTerms: andTerms.map((t) => ({ ...t })),
        notTerms: notTerms.map((t) => ({ ...t })),
      };
      const existing = savedSearches.findIndex((s) => s.name === name);
      if (existing >= 0) {
        savedSearches[existing] = entry;
      } else {
        savedSearches.push(entry);
      }
      saveSavedSearches();
      rebuildSaveOptions();
      saveNameInput.value = "";
    });

    deleteBtn.addEventListener("click", () => {
      const name = saveNameInput.value.trim();
      if (!name) return;
      const idx = savedSearches.findIndex((s) => s.name === name);
      if (idx < 0) return;
      savedSearches.splice(idx, 1);
      saveSavedSearches();
      rebuildSaveOptions();
      saveNameInput.value = "";
    });

    saveRow.appendChild(saveNameInput);
    saveRow.appendChild(saveBtn);
    saveRow.appendChild(deleteBtn);

    // CSV export/import row
    const csvRow = el("div", { id: "cl-csv-row" });
    const exportCsvBtn = el("button", { className: "cl-add-btn", id: "cl-export-csv-btn" }, ["export csv"]);
    const importCsvLabel = el("label", { id: "cl-import-csv-label" }, ["import csv"]);
    const importCsvInput = el("input", { type: "file", id: "cl-import-csv-input", accept: ".csv" });
    const csvStatus = el("span", { id: "cl-csv-status" });

    exportCsvBtn.addEventListener("click", () => {
      if (!savedSearches.length) return;
      exportSearchesCSV();
    });

    importCsvInput.addEventListener("change", () => {
      const file = importCsvInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const added = importSearchesCSV(e.target.result);
        csvStatus.textContent = `Imported ${added} new entr${added === 1 ? "y" : "ies"}.`;
        setTimeout(() => { csvStatus.textContent = ""; }, 3000);
      };
      reader.readAsText(file);
      importCsvInput.value = "";
    });

    importCsvLabel.appendChild(importCsvInput);
    const searchAllBtn = el("button", { className: "cl-add-btn", id: "cl-search-all-btn" }, ["search all"]);
    searchAllBtn.addEventListener("click", () => {
      openAllSavedSearches();
    });

    csvRow.appendChild(exportCsvBtn);
    csvRow.appendChild(searchAllBtn);
    csvRow.appendChild(importCsvLabel);
    csvRow.appendChild(csvStatus);

    // Scrollable terms area (OR + NOT); preview/buttons pinned below
    const termsScrollEl = el("div", { id: "cl-terms-scroll" });
    termsScrollEl.appendChild(templateSelect);
    termsScrollEl.appendChild(orLabel);
    termsScrollEl.appendChild(orContainer);
    termsScrollEl.appendChild(orAddBtn);
    termsScrollEl.appendChild(orAdd5Btn);
    termsScrollEl.appendChild(andLabel);
    termsScrollEl.appendChild(andContainer);
    termsScrollEl.appendChild(andAddBtn);
    termsScrollEl.appendChild(andAdd5Btn);
    termsScrollEl.appendChild(notLabel);
    termsScrollEl.appendChild(notContainer);
    termsScrollEl.appendChild(notAddBtn);
    termsScrollEl.appendChild(notAdd5Btn);
    termsScrollEl.appendChild(saveRow);
    termsScrollEl.appendChild(csvRow);
    bodyEl.appendChild(termsScrollEl);
    // Clear button
    const clearBtn = el("button", { id: "cl-clear-btn" }, ["Clear all"]);
    clearBtn.addEventListener("click", () => {
      orTerms  = [{ text: "", phrase: false }];
      andTerms = [{ text: "", phrase: false }];
      notTerms = [{ text: "", phrase: false }];
      renderPanel();
    });

    bodyEl.appendChild(previewLabel);
    bodyEl.appendChild(previewEl);
    bodyEl.appendChild(plainEnglishEl);
    bodyEl.appendChild(counterEl);
    bodyEl.appendChild(warningEl);
    bodyEl.appendChild(searchBtn);
    bodyEl.appendChild(clearBtn);

    panel.appendChild(header);
    panel.appendChild(bodyEl);
    document.body.appendChild(panel);

    rebuildSaveOptions();
    renderPanel();
  }

  // ──────────────────────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────────────────────

  loadState(() => {
    loadSavedSearches(() => {
      buildPanel();
    });
  });
})();
