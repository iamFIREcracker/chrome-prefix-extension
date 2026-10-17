// Re-apply this tab's saved banner color on every page load, so the chosen
// color survives reloads (matching tmux, where a session keeps its color until
// you close it). The color is keyed by tab id, not origin, so it stays local to
// this tab and is independent of the host. Runs at document_start in the top
// frame only: the banners frame the whole page, not each iframe.
(function () {
  const { SCHEMES, STYLE_ID, buildCss } = self.PREFIX_BANNER;

  function setStyle(css) {
    let el = document.getElementById(STYLE_ID);
    if (!css) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = css;
  }

  function applyScheme(idx) {
    const scheme = idx == null ? null : SCHEMES[idx];
    setStyle(buildCss(scheme));
  }

  // A content script can't read its own tab id, so the background worker resolves
  // it (via sender.tab.id) and returns this tab's stored scheme. The popup applies
  // colors instantly to the active tab itself, so we only need this on (re)load.
  chrome.runtime.sendMessage({ type: "get-scheme" }, (idx) => {
    if (chrome.runtime.lastError) return; // worker asleep / no response
    if (idx == null) return;
    applyScheme(idx);
  });
})();
