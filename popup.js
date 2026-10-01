// Popup: a tmux-style picker. Open it (toolbar click or Alt+W), then
// press 1-8 (or click a swatch) to recolor the current page; 0 resets.
(function () {
  const { SCHEMES, STYLE_ID, buildCss } = window.COLORED_BG;

  let tab = null;
  let sessionKey = null;

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

  async function getActiveTab() {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return t;
  }

  async function apply(idx) {
    const scheme = SCHEMES[idx];
    const css = buildCss(scheme);

    // Instant apply to the active tab (covers tabs loaded before install).
    if (!tab) {
      setStatus("No active tab.", true);
    } else if (/^(chrome|edge|about|chrome-extension|devtools):/.test(tab.url || "")) {
      setStatus("Can't recolor this page (browser/internal URL).", true);
    } else {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: setPageStyle,
          args: [css, STYLE_ID],
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

    // Persist per-tab (tmux-pane style) so it survives reloads but stays local
    // to this tab and dies with it. session storage is in-memory; tab ids are
    // stable across reloads/discards. content.js re-applies on load.
    if (sessionKey) {
      await chrome.storage.session.set({ [sessionKey]: idx === 0 ? null : idx });
    }

    markActive(idx);
    window.close();
  }

  function setStatus(msg, isError) {
    const el = document.getElementById("status");
    el.textContent = msg || "";
    el.classList.toggle("error", !!isError);
  }

  function markActive(idx) {
    document.querySelectorAll(".swatch").forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.idx) === Number(idx));
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
      el.addEventListener("click", () => apply(i));
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

  document.addEventListener("keydown", (e) => {
    resetIdle();
    const action = TAB_ACTIONS[e.key];
    if (action) {
      e.preventDefault();
      const sent = chrome.runtime.sendMessage(action);
      if (action.dismiss) sent.finally(() => window.close());
      return;
    }
    if (Object.prototype.hasOwnProperty.call(SCHEMES, e.key)) {
      e.preventDefault();
      apply(Number(e.key));
    }
  });

  (async function init() {
    buildGrid();
    resetIdle();
    tab = await getActiveTab();
    if (tab) {
      sessionKey = "scheme-tab:" + tab.id;
      const data = await chrome.storage.session.get(sessionKey);
      markActive(data[sessionKey] ?? 0);
    }
  })();
})();
