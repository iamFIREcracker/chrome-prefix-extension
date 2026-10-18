// Re-apply this page's saved colors on every page load. Two layers, like tmux:
//
// - The banners belong to the host: saved in chrome.storage.local, they
//   survive reloads, new tabs, and browser restarts, and every tab on the host
//   shares them, the way a tmux session keeps its color. Drawn in the top
//   frame only, since they frame the whole window.
// - The page color belongs to the tab: saved in chrome.storage.session under
//   the tab id, it survives reloads and navigation in that tab and dies with
//   it, the way a tmux pane keeps its color. Applied in every frame.
//
// Runs at document_start in every frame.
(function () {
  const { SCHEMES, LAYERS, hostKey } = self.PREFIX_SCHEMES;

  function setStyle(id, css) {
    let el = document.getElementById(id);
    if (!css) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = css;
  }

  function applyScheme(layer, idx) {
    const scheme = idx == null ? null : SCHEMES[idx];
    setStyle(LAYERS[layer].styleId, LAYERS[layer].buildCss(scheme));
  }

  // A content script can't read its own tab id, so the background worker
  // resolves it (via sender.tab.id) and returns this tab's page color. The
  // popup applies it instantly to the active tab itself, so we only need this
  // on (re)load.
  chrome.runtime.sendMessage({ type: "get-page-scheme" }, (idx) => {
    if (chrome.runtime.lastError) return; // worker asleep / extension reloaded
    if (idx != null) applyScheme("page", idx);
  });

  if (window !== window.top) return;

  // Pages without a host (file://, data:) have nothing to key on; the
  // popup still draws their banners, but only until they reload.
  const key = hostKey(location.host);
  if (!key) return;

  chrome.storage.local.get(key, (data) => {
    if (chrome.runtime.lastError) return; // extension reloaded under us
    applyScheme("banner", data[key]);
  });

  // A banner color picked in one tab repaints every other open tab on the
  // same host.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && key in changes) {
      applyScheme("banner", changes[key].newValue);
    }
  });
})();
