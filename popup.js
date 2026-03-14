// ============================================================
// popup.js — Toolbar popup logic
// ============================================================

(function () {
  "use strict";

  const countEl = document.getElementById("dismissed-count");
  const sinceDateEl = document.getElementById("since-date");
  const noDataEl = document.getElementById("no-data");
  const rowCount = document.getElementById("row-count");
  const rowSince = document.getElementById("row-since");
  const clearBtn = document.getElementById("clear-btn");
  const confirmRow = document.getElementById("confirm-row");
  const confirmYes = document.getElementById("confirm-yes");
  const confirmNo = document.getElementById("confirm-no");
  const exportBtn = document.getElementById("export-btn");
  const importInput = document.getElementById("import-input");
  const importStatus = document.getElementById("import-status");

  // ──────────────────────────────────────────────────────────
  // LOAD AND DISPLAY STATS
  // ──────────────────────────────────────────────────────────

  function formatDate(isoString) {
    if (!isoString) return "—";
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function renderStats(dismissed) {
    const entries = Object.values(dismissed);
    const count = entries.length;

    if (count === 0) {
      noDataEl.style.display = "";
      rowCount.style.display = "none";
      rowSince.style.display = "none";
      return;
    }

    // Earliest dismissedAt
    const earliest = entries
      .map((e) => e.dismissedAt)
      .filter(Boolean)
      .sort()[0];

    noDataEl.style.display = "none";
    rowCount.style.display = "";
    rowSince.style.display = "";
    countEl.textContent = count;
    sinceDateEl.textContent = formatDate(earliest);
  }

  chrome.storage.local.get("dismissed", (data) => {
    renderStats(data.dismissed || {});
  });

  // ──────────────────────────────────────────────────────────
  // CLEAR ALL
  // ──────────────────────────────────────────────────────────

  clearBtn.addEventListener("click", () => {
    confirmRow.classList.add("visible");
  });

  confirmNo.addEventListener("click", () => {
    confirmRow.classList.remove("visible");
  });

  confirmYes.addEventListener("click", () => {
    chrome.storage.local.set({ dismissed: {} }, () => {
      confirmRow.classList.remove("visible");
      renderStats({});
    });
  });

  // ──────────────────────────────────────────────────────────
  // EXPORT
  // ──────────────────────────────────────────────────────────

  exportBtn.addEventListener("click", () => {
    chrome.storage.local.get("dismissed", (data) => {
      const json = JSON.stringify(data.dismissed || {}, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cl-dismissed.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  // ──────────────────────────────────────────────────────────
  // IMPORT
  // ──────────────────────────────────────────────────────────

  importInput.addEventListener("change", () => {
    const file = importInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      let incoming;
      try {
        incoming = JSON.parse(e.target.result);
      } catch {
        importStatus.style.color = "#c22";
        importStatus.textContent = "Invalid JSON file.";
        return;
      }
      chrome.storage.local.get("dismissed", (data) => {
        const merged = Object.assign({}, data.dismissed || {}, incoming);
        chrome.storage.local.set({ dismissed: merged }, () => {
          const added = Object.keys(incoming).length;
          importStatus.style.color = "#4a4";
          importStatus.textContent = `Imported ${added} entr${added === 1 ? "y" : "ies"}.`;
          renderStats(merged);
        });
      });
    };
    reader.readAsText(file);
    importInput.value = "";
  });
})();
