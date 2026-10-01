// Tab-walking, tmux-style. The picker popup acts like a tmux prefix. Some
// commands are *repeatable* (tmux's `bind -r`): press Alt+W once, then tap ( / )
// to move to the previous/next tab without re-pressing the prefix. Others are
// one-shot: they run and the popup closes.
//
// Chrome closes the action popup whenever the active tab changes, so we can't
// just act from the popup and stay open. Instead the popup forwards each command
// here; we perform it, and *for repeatable commands only* re-open the popup on
// the resulting active tab, so the user lands back in the picker ready to tap again.
const COMMANDS = {
  "walk-tab": (msg) => walkTab(msg.dir),
  "close-tab": closeTab,
  "new-tab": newTab,
  "reload-extension": reloadExtension,
  "toggle-keep-awake": toggleKeepAwake,
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  // Colors are stored per-tab (tmux-pane style). A content script can't read its
  // own tab id, but we get it for free as sender.tab.id — so content.js asks us
  // for its tab's scheme on load. Returns the index (or null) asynchronously, so
  // keep the channel open by returning true.
  if (msg.type === "get-scheme") {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) {
      sendResponse(null);
      return;
    }
    const key = "scheme-tab:" + tabId;
    chrome.storage.session.get(key, (data) => sendResponse(data[key] ?? null));
    return true;
  }

  const run = COMMANDS[msg.type];
  if (!run) return;
  // Perform the action first, then re-open the picker only if the command opted
  // into repeating. The popup tags each message with `repeat` (see popup.js).
  Promise.resolve(run(msg)).then(() => {
    if (msg.repeat) reopenPicker();
  });
});

// Drop a tab's stored color when the tab closes, so session storage doesn't
// accumulate dead entries during a long browser session.
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove("scheme-tab:" + tabId);
});

// Re-open the picker on the freshly activated tab, so a repeatable command can
// be tapped again. Needs Chrome 127+ and a focused window; if it's unavailable
// the action still happened, the popup just won't re-open and the user re-presses
// Alt+W.
async function reopenPicker() {
  try {
    await chrome.action.openPopup();
  } catch (e) {
    // No-op: the tab action already succeeded.
  }
}

async function walkTab(dir) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  if (tabs.length < 2) return;

  // Wrap around at the ends, like tmux next-window / previous-window.
  const i = tabs.findIndex((t) => t.active);
  const next = tabs[(i + dir + tabs.length) % tabs.length];
  await chrome.tabs.update(next.id, { active: true });
}

// & — close the active tab, tmux kill-window style. One-shot: Chrome activates a
// neighbour automatically and the popup closes with the tab change. Closing the
// last tab closes the window (the truer kill-pane analog).
async function closeTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active) return;
  await chrome.tabs.remove(active.id);
}

// c — open a fresh tab (becomes active), tmux new-window style. One-shot.
async function newTab() {
  await chrome.tabs.create({}); // active: true is the default
}

// r — restart the extension (picks up edited code when unpacked), tmux
// source-file style. One-shot. This tears down the service worker mid-call, so
// nothing after it runs. It also can't update content scripts already injected
// in open tabs — those stay on the old code (and go inert) until each tab is
// reloaded. We deliberately don't reload tabs here; the user reloads any that
// misbehave.
function reloadExtension() {
  chrome.runtime.reload();
}

// z — toggle keep-awake, so the OS doesn't dim, sleep, or lock the screen while
// idle. One-shot. chrome.power (not the Screen Wake Lock API, which needs a
// visible document) holds the request for the extension's lifetime rather than
// the service worker's, but an extension reload or browser restart drops it —
// so the flag lives in local storage and is re-applied whenever the worker
// starts (below). The toolbar badge shows when it's on.
async function toggleKeepAwake() {
  const { keepAwake } = await chrome.storage.local.get("keepAwake");
  await chrome.storage.local.set({ keepAwake: !keepAwake });
  applyKeepAwake(!keepAwake);
}

function applyKeepAwake(on) {
  if (on) chrome.power.requestKeepAwake("display");
  else chrome.power.releaseKeepAwake();
  chrome.action.setBadgeText({ text: on ? "Z" : "" });
}

// Requesting again when already awake is harmless, so this can run on every
// worker start without checking the current state.
chrome.storage.local.get("keepAwake").then(({ keepAwake }) => applyKeepAwake(!!keepAwake));
