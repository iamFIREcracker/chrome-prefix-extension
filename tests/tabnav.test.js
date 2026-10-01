// Regression tests for tmux-style tab navigation (the ( / ) bindings).
//
// These load the *real* unpacked extension into Chromium and exercise the
// actual shipping chain — popup.js keydown -> chrome.runtime.sendMessage ->
// background.js -> chrome.tabs.update — plus the wrap-around index math in
// background.js's walkTab().
//
// Requires a Chromium that supports extensions in headless mode, which needs
// Playwright's `channel: 'chromium'`. Install it once with `npm run test:setup`.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const EXT = path.resolve(__dirname, "..");

let ctx, sw, extId, profileDir, popup;
let pages = {}; // query-string -> Page, e.g. { a, b, c }

// Snapshot the tab strip from the service worker's point of view.
const tabsInfo = () =>
  sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return tabs.map((t) => ({ id: t.id, url: t.url, active: t.active }));
  });

const activeUrl = async () => (await tabsInfo()).find((t) => t.active)?.url;

async function waitFor(fn, { timeout = 5000, interval = 50 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, interval));
  }
}

before(async () => {
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbg-prof-"));
  ctx = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    channel: "chromium", // new headless mode — required for extensions to load
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });

  sw =
    ctx.serviceWorkers()[0] ||
    (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
  extId = new URL(sw.url()).host;

  // Three content tabs, in a known left-to-right order: a, b, c.
  const first = ctx.pages()[0] || (await ctx.newPage());
  await first.goto("https://example.com/?a");
  pages.a = first;
  for (const q of ["b", "c"]) {
    const p = await ctx.newPage();
    await p.goto("https://example.com/?" + q);
    pages[q] = p;
  }

  // The popup, loaded as a normal page so we can dispatch real keypresses into
  // it. It sits to the right of the content tabs (last in the strip).
  popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
});

after(async () => {
  await ctx?.close();
  if (profileDir) fs.rmSync(profileDir, { recursive: true, force: true });
});

test("service worker registers and openPopup() is available", async () => {
  assert.equal(typeof extId, "string");
  assert.ok(extId.length > 0, "extension id should be present");

  const hasOpenPopup = await sw.evaluate(
    () =>
      typeof chrome?.action?.openPopup === "function"
  );
  assert.ok(
    hasOpenPopup,
    "chrome.action.openPopup must exist (needs Chrome 127+) for the popup to re-open after each hop"
  );
});

test("end-to-end: ) in the popup advances to the next tab (wraps last->first)", async () => {
  // Focus the popup so it receives the keypress; it's the last tab, so 'next'
  // must wrap around to the first tab.
  await popup.bringToFront();
  const before = await tabsInfo();
  const startActive = before.find((t) => t.active).id;
  const firstId = before[0].id;

  await popup.keyboard.press(")");
  await waitFor(async () => (await tabsInfo()).find((t) => t.active).id !== startActive);

  const after = await tabsInfo();
  assert.equal(
    after.find((t) => t.active).id,
    firstId,
    "next-from-last should wrap to the first tab"
  );
});

test("end-to-end: ( in the popup goes to the previous tab", async () => {
  await popup.bringToFront();
  const before = await tabsInfo();
  const startActive = before.find((t) => t.active).id;
  const prevId = before[before.length - 2].id; // popup is last; prev is the one before it

  await popup.keyboard.press("(");
  await waitFor(async () => (await tabsInfo()).find((t) => t.active).id !== startActive);

  const after = await tabsInfo();
  assert.equal(
    after.find((t) => t.active).id,
    prevId,
    "previous-from-last should land on the tab immediately to the left"
  );
});

test("end-to-end: & in the popup closes the active tab and a neighbour takes over", async () => {
  // Use a throwaway tab so we don't disturb the a/b/c/popup strip the later
  // wrap-around test relies on. It opens active; close it via the popup's &.
  const victim = await ctx.newPage();
  await victim.goto("https://example.com/?victim");
  await waitFor(async () => (await activeUrl())?.endsWith("?victim"));

  const before = await tabsInfo();
  const victimId = before.find((t) => t.active).id;

  // Dispatch & into the popup page *without* focusing it, so the victim stays
  // the active tab — this drives the real popup.js -> background.js ->
  // chrome.tabs.remove chain (close-tab acts on the active tab).
  await popup.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "&" }))
  );

  await waitFor(async () => !(await tabsInfo()).some((t) => t.id === victimId));

  const after = await tabsInfo();
  assert.ok(
    !after.some((t) => t.id === victimId),
    "the active tab should have been removed"
  );
  assert.ok(
    after.some((t) => t.active),
    "a neighbouring tab should become active after the close"
  );
});

test("end-to-end: c in the popup opens a new active tab", async () => {
  await popup.bringToFront();
  const before = await tabsInfo();

  await popup.keyboard.press("c");
  await waitFor(async () => (await tabsInfo()).length === before.length + 1);

  const after = await tabsInfo();
  const created = after.find((t) => !before.some((b) => b.id === t.id));
  assert.ok(created, "a new tab should have been created");
  assert.ok(created.active, "the new tab should be the active tab");

  // Clean up so the strip is back to [a, b, c, popup] for the wrap-around test.
  await sw.evaluate((id) => chrome.tabs.remove(id), created.id);
  await waitFor(async () => (await tabsInfo()).length === before.length);
});

test("end-to-end: z in the popup toggles keep-awake, badge, and closes the popup", async () => {
  // A throwaway popup page: z dismisses the picker itself (no tab change does
  // it), and the shared popup must stay open for the walkTab test below.
  const picker = await ctx.newPage();
  await picker.goto(`chrome-extension://${extId}/popup.html`);
  const keepAwake = () =>
    sw.evaluate(async () => (await chrome.storage.local.get("keepAwake")).keepAwake);
  const badge = () => sw.evaluate(() => chrome.action.getBadgeText({}));

  await picker.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "z" }))
  );
  await waitFor(async () => (await keepAwake()) === true);
  await waitFor(() => picker.isClosed());
  assert.equal(await badge(), "Z", "the badge should show keep-awake is on");

  // Toggle back off so the profile is left as we found it.
  await sw.evaluate(() => toggleKeepAwake());
  assert.equal(await keepAwake(), false);
  assert.equal(await badge(), "", "the badge should clear when keep-awake is off");
});

test("walkTab() covers the full wrap-around matrix on a clean 3-tab strip", async () => {
  // Drop the popup tab so the strip is exactly [a, b, c] and the math is easy
  // to reason about. walkTab is called directly with a known active tab.
  await popup.close();
  await waitFor(async () => (await tabsInfo()).length === 3);

  const setActive = async (q) => {
    await pages[q].bringToFront();
    await waitFor(async () => (await activeUrl())?.endsWith("?" + q));
  };
  const walk = (dir) => sw.evaluate((d) => walkTab(d), dir);

  // forward through the middle
  await setActive("a");
  await walk(1);
  assert.ok((await activeUrl()).endsWith("?b"), "a +1 -> b");

  // forward wrap: last -> first
  await setActive("c");
  await walk(1);
  assert.ok((await activeUrl()).endsWith("?a"), "c +1 -> a (wrap)");

  // backward through the middle
  await setActive("c");
  await walk(-1);
  assert.ok((await activeUrl()).endsWith("?b"), "c -1 -> b");

  // backward wrap: first -> last
  await setActive("a");
  await walk(-1);
  assert.ok((await activeUrl()).endsWith("?c"), "a -1 -> c (wrap)");
});
