// Popup: a tmux-style picker. Open it (toolbar click or Alt+W), press Alt+C to
// enter color mode, then press 1-8 (or click a swatch) to color the banners at
// the top and bottom of the current page, or Alt+1-8 (or Alt+click a swatch)
// to recolor the page itself; 0 / Alt+0 remove them.
(function () {
  const { SCHEMES, LAYERS, hostKey, tabKey } = window.PREFIX_SCHEMES;

  let tab = null;

  // Injected into the page world to add/update/remove the <style> element.
  function setPageStyle(css, id) {
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

  function hostOf(url) {
    try {
      return new URL(url).host;
    } catch (e) {
      return "";
    }
  }

  // Where a layer's color is saved for the active tab, or null when it can't
  // be. The banners belong to the host and persist in local storage; the page
  // color belongs to the tab and lives in session storage until the tab closes.
  function storageOf(layer) {
    if (!tab) return null;
    const key = layer === "banner" ? hostKey(hostOf(tab.url)) : tabKey(tab.id);
    if (!key) return null;
    const area = layer === "banner" ? chrome.storage.local : chrome.storage.session;
    return { area, key };
  }

  async function getActiveTab() {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return t;
  }

  // `layer` is "banner" or "page" (see LAYERS in schemes.js).
  async function apply(layer, idx) {
    const { styleId, allFrames, buildCss } = LAYERS[layer];
    const css = buildCss(SCHEMES[idx]);

    // Instant apply to the active tab (covers tabs loaded before install).
    if (!tab) {
      setStatus("No active tab.", true);
    } else if (/^(chrome|edge|about|chrome-extension|devtools):/.test(tab.url || "")) {
      setStatus("Can't color this page (browser/internal URL).", true);
    } else {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames },
          func: setPageStyle,
          args: [css, styleId],
        });
        setStatus("");
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        if (/file/i.test(tab.url || "")) {
          setStatus(
            "Blocked. For file:// pages, enable “Allow access to file URLs” " +
              "on chrome://extensions, then reload the page.",
            true
          );
        } else {
          setStatus("Couldn't apply: " + msg, true);
        }
        return;
      }
    }

    // Persist so the color survives reloads; content.js re-applies it on load.
    // A banner color also repaints the other open tabs on the same host.
    const storage = storageOf(layer);
    if (storage) {
      if (idx === 0) await storage.area.remove(storage.key);
      else await storage.area.set({ [storage.key]: idx });
    }

    markActive(layer, idx);
    window.close();
  }

  function setStatus(msg, isError) {
    const el = document.getElementById("status");
    el.textContent = msg || "";
    el.classList.toggle("error", !!isError);
  }

  // Each layer has its own marker: an outline for the banners, an inner ring
  // for the page.
  function markActive(layer, idx) {
    document.querySelectorAll(".swatch").forEach((el) => {
      el.classList.toggle("active-" + layer, Number(el.dataset.idx) === Number(idx));
    });
  }

  function buildGrid() {
    const grid = document.getElementById("grid");
    Object.keys(SCHEMES).forEach((key) => {
      const i = Number(key);
      const scheme = SCHEMES[i];
      if (!scheme) return;
      const el = document.createElement("div");
      el.className = "swatch";
      el.dataset.idx = i;
      el.style.background = scheme.bg;
      el.style.color = scheme.fg;
      el.innerHTML =
        `<span class="num">${i}</span>` +
        `<span class="label">${scheme.name}</span>`;
      el.addEventListener("click", (e) => apply(e.altKey ? "page" : "banner", i));
      grid.appendChild(el);
    });
  }

  // Keys that delegate to the background worker. Each sends a { type, repeat, ...args }
  // message; the worker performs the action, then — only when `repeat` is set —
  // re-opens this popup on the resulting active tab. Repeatable commands are tmux's
  // `bind -r`: tap the same key again without re-pressing Alt+W. One-shot commands
  // run once and let the popup close.
  // Don't window.close() for these — the tab change owns the lifecycle either way.
  // The exception is a one-shot that leaves the tab alone (`dismiss`): nothing
  // else would close the popup, so we close it once the worker has the message.
  const TAB_ACTIONS = {
    "(": { type: "walk-tab", dir: -1, repeat: true },
    ")": { type: "walk-tab", dir: 1, repeat: true },
    "&": { type: "close-tab" },
    "c": { type: "new-tab" },
    "r": { type: "reload-extension" },
    "z": { type: "toggle-keep-awake", dismiss: true },
  };

  // Auto-dismiss: the picker is a transient tmux-style prefix, not a window meant
  // to linger. If you don't act, it closes itself. Every keystroke resets the
  // countdown, so repeatable commands tapped in quick succession keep it alive —
  // only an idle pause lets it disappear.
  const IDLE_MS = 1500;
  let idleTimer = null;
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => window.close(), IDLE_MS);
  }

  // Color mode: a second key table, like tmux's `switch-client -T`. Alt+C
  // enters it from the prefix; only there do the digits pick a scheme, which
  // leaves the bare digits free in the prefix table. A digit colors the
  // banners; Alt+digit recolors the page.
  let colorMode = false;
  function enterColorMode() {
    colorMode = true;
    document.body.classList.add("color-mode");
  }

  // Match Alt+C by physical key as well as by character: on macOS, Option+C
  // reports e.key as "ç".
  function isColorModeKey(e) {
    return e.altKey && (e.code === "KeyC" || e.key.toLowerCase() === "c");
  }

  // The digit of a color-mode key, or null. Alt+digit is matched by physical
  // key only: on macOS, Option+1 reports e.key as "¡".
  function colorDigit(e) {
    const m = e.altKey ? /^Digit(\d)$/.exec(e.code) : /^\d$/.exec(e.key);
    if (!m) return null;
    const idx = Number(e.altKey ? m[1] : m[0]);
    return Object.prototype.hasOwnProperty.call(SCHEMES, idx) ? idx : null;
  }

  document.addEventListener("keydown", (e) => {
    resetIdle();
    if (colorMode) {
      const idx = colorDigit(e);
      if (idx != null) {
        e.preventDefault();
        apply(e.altKey ? "page" : "banner", idx);
      }
      return;
    }
    // Checked before TAB_ACTIONS so Alt+C never falls through to `c` (new tab).
    if (isColorModeKey(e)) {
      e.preventDefault();
      enterColorMode();
      return;
    }
    const action = TAB_ACTIONS[e.key];
    if (action) {
      e.preventDefault();
      const sent = chrome.runtime.sendMessage(action);
      if (action.dismiss) sent.finally(() => window.close());
    }
  });

  // On Windows, Chrome focuses its ⋮ menu when Alt is released with no other
  // key seen since Alt went down. The popup forwards the key events it leaves
  // unhandled to the browser window, so after an Alt chord handled above (the
  // C of Alt+C) the browser sees a lone Alt press and release, focuses the
  // menu, and the popup loses the keyboard. Handling the release here keeps
  // it from reaching the browser.
  document.addEventListener("keyup", (e) => {
    if (e.key === "Alt") e.preventDefault();
  });

  (async function init() {
    buildGrid();
    resetIdle();
    tab = await getActiveTab();
    for (const layer of Object.keys(LAYERS)) {
      const storage = storageOf(layer);
      const data = storage ? await storage.area.get(storage.key) : {};
      markActive(layer, storage ? data[storage.key] ?? 0 : 0);
    }
  })();
})();
