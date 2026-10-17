// Re-apply the banner color saved for this page's host on every page load, so
// the chosen color survives reloads, new tabs, and browser restarts: a host
// keeps its color the way a tmux session does, and every tab on that host
// shares it. Runs at document_start in the top frame only: the banners frame
// the whole page, not each iframe.
(function () {
  const { SCHEMES, STYLE_ID, buildCss, hostKey } = self.PREFIX_BANNER;

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

  // Pages without a host (file://, data:) have nothing to key on; the
  // popup still colors them, but only until they reload.
  const key = hostKey(location.host);
  if (!key) return;

  chrome.storage.local.get(key, (data) => {
    if (chrome.runtime.lastError) return; // extension reloaded under us
    applyScheme(data[key]);
  });

  // A color picked in one tab repaints every other open tab on the same host.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && key in changes) applyScheme(changes[key].newValue);
  });
})();
