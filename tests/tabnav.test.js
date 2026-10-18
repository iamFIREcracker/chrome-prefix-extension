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
const http = require("node:http");

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

test("end-to-end: Alt+C then a digit in the popup colors every tab on the host and survives a reload", async () => {
  // A throwaway popup page: applying a scheme closes the picker. The picker
  // captures the active tab when it loads, so bring tab a to the front first,
  // then reload the picker in the background to bind it to tab a.
  const picker = await ctx.newPage();
  await picker.goto(`chrome-extension://${extId}/popup.html`);
  await pages.a.bringToFront();
  await waitFor(async () => (await activeUrl())?.endsWith("?a"));
  await picker.reload();

  const key = "scheme-host:example.com";
  const stored = () =>
    sw.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);
  const press = (init) =>
    picker.evaluate(
      (i) => document.dispatchEvent(new KeyboardEvent("keydown", i)),
      init
    );

  // A bare digit in the prefix table does nothing.
  await press({ key: "1" });
  assert.equal(await stored(), undefined, "a digit without Alt+C must not draw the banners");
  assert.ok(!picker.isClosed(), "the picker should stay open");

  // Alt+C enters color mode (macOS reports Option+C as "ç"), then 1 applies.
  await press({ key: "ç", code: "KeyC", altKey: true });
  await press({ key: "1", code: "Digit1" });
  await waitFor(async () => (await stored()) === 1);
  await waitFor(() => picker.isClosed());

  // Both banners take color 1 (red, #ab0000); the page background is untouched.
  const RED = "rgb(171, 0, 0)";
  const banner = (page, pseudo) =>
    page.evaluate(
      (p) => getComputedStyle(document.documentElement, p).backgroundColor,
      pseudo
    );
  assert.equal(await banner(pages.a, "::before"), RED, "top banner");
  assert.equal(await banner(pages.a, "::after"), RED, "bottom banner");
  assert.notEqual(
    await pages.a.evaluate(() => getComputedStyle(document.body).backgroundColor),
    RED,
    "the page background must keep its own color"
  );

  // Tab b is on the same host, so it repaints without a reload.
  await waitFor(async () => (await banner(pages.b, "::before")) === RED);

  // The color is stored per host, so a reload brings it back.
  await pages.a.reload();
  await waitFor(async () => (await banner(pages.a, "::before")) === RED);

  // Clearing the stored scheme removes the banners from every tab on the host
  // and leaves the profile as we found it.
  await sw.evaluate((k) => chrome.storage.local.remove(k), key);
  await waitFor(async () => (await banner(pages.b, "::before")) !== RED);
});

test("end-to-end: Alt+C then Alt+digit in the popup recolors this tab's page beside the banners", async () => {
  const picker = await ctx.newPage();
  await picker.goto(`chrome-extension://${extId}/popup.html`);
  await pages.a.bringToFront();
  await waitFor(async () => (await activeUrl())?.endsWith("?a"));
  await picker.reload();

  const tabA = (await tabsInfo()).find((t) => t.active).id;
  const bannerKey = "scheme-host:example.com";
  const pageKey = "page-scheme-tab:" + tabA;
  const local = (k) =>
    sw.evaluate(async (k) => (await chrome.storage.local.get(k))[k], k);
  const session = (k) =>
    sw.evaluate(async (k) => (await chrome.storage.session.get(k))[k], k);
  const press = (init) =>
    picker.evaluate(
      (i) => document.dispatchEvent(new KeyboardEvent("keydown", i)),
      init
    );
  const RED = "rgb(171, 0, 0)";
  const GREEN = "rgb(58, 214, 58)";
  const bodyBg = (page) =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const banner = (page) =>
    page.evaluate(
      () => getComputedStyle(document.documentElement, "::before").backgroundColor
    );

  try {
    // Banners red first, so we can check the page layer leaves them alone.
    await sw.evaluate((k) => chrome.storage.local.set({ [k]: 1 }), bannerKey);
    await waitFor(async () => (await banner(pages.a)) === RED);

    // Alt+C, then Alt+2 (macOS reports Option+2 as "™") recolors the page green.
    await press({ key: "ç", code: "KeyC", altKey: true });
    await press({ key: "™", code: "Digit2", altKey: true });
    await waitFor(async () => (await session(pageKey)) === 2);
    await waitFor(() => picker.isClosed());

    assert.equal(await bodyBg(pages.a), GREEN, "the page takes color 2");
    assert.equal(await banner(pages.a), RED, "the banners keep their own color");
    assert.equal(await local(bannerKey), 1, "the banner color is not overwritten");

    // The page color belongs to the tab: tab b, on the same host, keeps its
    // own background, and tab a keeps green across a reload.
    assert.notEqual(await bodyBg(pages.b), GREEN, "another tab on the host is not recolored");
    await pages.a.reload();
    await waitFor(async () => (await bodyBg(pages.a)) === GREEN);
    assert.equal(await banner(pages.a), RED);
  } finally {
    await sw.evaluate((k) => chrome.storage.local.remove(k), bannerKey);
    await sw.evaluate((k) => chrome.storage.session.remove(k), pageKey);
    await pages.a.reload();
  }
});

test("the page color reaches every frame and is dropped when its tab closes", async () => {
  // The top page on one port embeds a frame served from another port.
  const listen = (body) =>
    new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end(body);
      });
      server.listen(0, "127.0.0.1", () => resolve(server));
    });
  const inner = await listen("<!doctype html><title>inner</title><p>inner</p>");
  const innerHost = "127.0.0.1:" + inner.address().port;
  const outer = await listen(
    `<!doctype html><title>outer</title><iframe src="http://${innerHost}/"></iframe>`
  );
  const outerUrl = "http://127.0.0.1:" + outer.address().port + "/";
  const page = await ctx.newPage();

  try {
    await page.goto(outerUrl);
    const tabId = (await tabsInfo()).find((t) => t.url === outerUrl).id;
    const key = "page-scheme-tab:" + tabId;
    await sw.evaluate((k) => chrome.storage.session.set({ [k]: 2 }), key);
    await page.reload();

    const frame = await waitFor(() =>
      page.frames().find((f) => f.url().includes(innerHost))
    );
    await waitFor(async () =>
      (await frame.evaluate(() => getComputedStyle(document.body).backgroundColor)) ===
      "rgb(58, 214, 58)"
    );

    await page.close();
    await waitFor(async () =>
      (await sw.evaluate(async (k) => (await chrome.storage.session.get(k))[k], key)) ===
      undefined
    );
  } finally {
    if (!page.isClosed()) await page.close();
    inner.close();
    outer.close();
  }
});

test("colors are kept per port: two local servers on one host stay separate", async () => {
  // Two HTTP servers on 127.0.0.1, each on its own free port.
  const listen = () =>
    new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end("<!doctype html><title>port</title><p>port</p>");
      });
      server.listen(0, "127.0.0.1", () => resolve(server));
    });
  const servers = [await listen(), await listen()];
  const hosts = servers.map((s) => "127.0.0.1:" + s.address().port);
  const [first, second] = await Promise.all(hosts.map(() => ctx.newPage()));

  try {
    // Color only the first port, then load both: only the first gets banners.
    await sw.evaluate(
      (k) => chrome.storage.local.set({ [k]: 1 }),
      "scheme-host:" + hosts[0]
    );
    await first.goto("http://" + hosts[0] + "/");
    await second.goto("http://" + hosts[1] + "/");

    const banner = (page) =>
      page.evaluate(
        () => getComputedStyle(document.documentElement, "::before").backgroundColor
      );
    await waitFor(async () => (await banner(first)) === "rgb(171, 0, 0)");
    assert.notEqual(
      await banner(second),
      "rgb(171, 0, 0)",
      "another port on the same host must keep its own color"
    );
  } finally {
    await sw.evaluate(
      (k) => chrome.storage.local.remove(k),
      "scheme-host:" + hosts[0]
    );
    await first.close();
    await second.close();
    servers.forEach((s) => s.close());
  }
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
