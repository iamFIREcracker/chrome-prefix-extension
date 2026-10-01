# Prefix

> tmux-style browser bindings

A small Chrome (Manifest V3) extension that gives the browser **tmux-style
keybindings** behind a tmux-like prefix (**Alt+W**). Press the prefix, then a
key to trigger a binding. Three binding families ship today:

| Prefix    | Then…       | Family                              |
|-----------|-------------|-------------------------------------|
| **Alt+W** | **1**–**8** | recolor the page like a tmux pane (**0** resets) |
| **Alt+W** | **)** / **(** | move to the next / previous tab     |
| **Alt+W** | **&** / **c** | close the current tab / open a new one |
| **Alt+W** | **r**         | reload the extension                |
| **Alt+W** | **z**         | keep the screen awake (toggle)      |

The page-theming family is inspired by these tmux bindings:

```
# Colored panes
bind 0 select-pane -P "default"
bind 1 select-pane -P "bg=color1,fg=color15"
bind 2 select-pane -P "bg=color10,fg=color0"
bind 3 select-pane -P "bg=color11,fg=color0"
bind 4 select-pane -P "bg=color4,fg=color15"
bind 5 select-pane -P "bg=color5,fg=color15"
bind 6 select-pane -P "bg=color6,fg=color15"
bind 7 select-pane -P "bg=color15,fg=color0"
bind 8 select-pane -P "bg=color0,fg=color15"
```

## Usage

1. Open the picker — click the toolbar icon, or press **Alt+W**
   (the tmux-style "prefix").
2. Then press a key:
   - **1**–**8** (or click a swatch) to apply a color; **0** resets.
   - **)** / **(** to move to the next / previous tab.
   - **&** / **c** to close the current tab / open a new one.
   - **r** to reload the extension.
   - **z** to toggle keeping the screen awake.

### Recolor the page

| Key | Colors                 |
|-----|------------------------|
| 0   | default (reset)        |
| 1   | red bg / white fg      |
| 2   | green bg / black fg    |
| 3   | yellow bg / black fg   |
| 4   | blue bg / white fg     |
| 5   | magenta bg / white fg  |
| 6   | cyan bg / white fg     |
| 7   | light: white bg / black fg |
| 8   | dark: black bg / white fg  |

The choice is saved **per-tab**, tmux-pane style: it sticks as long as the tab
is open (surviving reloads and navigation), stays local to that one tab, and is
forgotten when the tab closes or the browser restarts. It's keyed by tab id in
`chrome.storage.session`; `content.js` re-applies it on load by asking the
background worker for its own tab's scheme.

### Move between tabs

| Key | Action            |
|-----|-------------------|
| )   | next tab          |
| (   | previous tab      |

Navigation wraps around at the ends, like tmux's `next-window` /
`previous-window`. These are **repeatable** commands (tmux's `bind -r`): after
each hop the picker re-opens on the new tab, so you can keep tapping **)** / **(**
to walk across tabs without re-pressing **Alt+W** (handled by `background.js`).

### Manage tabs

| Key | Action  |
|-----|---------|
| c   | new tab |
| &   | close tab |

Like `kill-pane` / `new-window` in tmux. Unlike **)** / **(**, these are
**one-shot** (not repeatable): they run once and the picker closes — re-press
**Alt+W** for the next command. Closing the **last** tab closes the window (the
truer `kill-pane` analog), and **c** lands on the new-tab page, which theming
can't touch but management keys still work on.

### Reload the extension

| Key | Action           |
|-----|------------------|
| r   | reload extension |

Like `source-file` in tmux: restarts the extension via
`chrome.runtime.reload()`, picking up edited code when loaded unpacked.
**One-shot.** It restarts the service worker and popup immediately, but it
**can't** swap the content script already running in tabs you have open — those
keep the old code (and go inert) until reloaded. We keep this binding dead
simple and don't auto-reload tabs; just reload any tab that misbehaves.

**After pulling an update, press `r`.** Chrome reads `popup.html` / `popup.js`
from disk each time the picker opens, so popup changes (like a new cheatsheet
entry) show up right away and can make the update look loaded. Changes to
`manifest.json` (such as a new permission) and `background.js` only take effect
after a reload. Until then a new binding can appear in the cheatsheet but fail:
for example, **z** before a reload fails with `chrome.power` undefined.

### Keep the screen awake

| Key | Action                         |
|-----|--------------------------------|
| z   | keep the screen awake (toggle) |

Stops the OS from dimming, sleeping, or locking the screen while you're idle,
like `caffeinate -d`. **One-shot** toggle; the toolbar badge shows **Z** while
it's on. It uses `chrome.power.requestKeepAwake("display")` rather than the
web's Screen Wake Lock API, which only holds while a page is visible and so
can't stay on in the background. The setting is kept in `chrome.storage.local`
and re-applied when the extension reloads or the browser restarts. It only
blocks *idle* locking: locking by hand, closing the lid, or an enforced IT
policy still lock the screen.

## Install (unpacked)

1. Visit `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this directory.
4. (Optional) Set/confirm the shortcut at `chrome://extensions/shortcuts`.

> Note: tabs already open before installing won't have the content script;
> the popup still applies colors instantly to them, but reload them once for
> persistence to kick in. The extension cannot touch restricted pages
> (`chrome://`, the Web Store, etc.).

## Files

- `manifest.json` — MV3 manifest, command, content script.
- `schemes.js` — color palette + CSS builder (shared by popup & content).
- `content.js` — re-applies the saved scheme on page load.
- `popup.js` / `popup.html` / `popup.css` — the 1–8 picker UI; 0 resets.
- `background.js` — service worker for tab navigation + management, the
  extension reload, and keep-awake (`( ) & c r z`).

## Tests

Regression tests for the tab-navigation bindings live in `tests/`. They load
the real unpacked extension into headless Chromium (via Playwright) and drive
the actual `popup.js → background.js → chrome.tabs` chain, plus the wrap-around
math in `walkTab()`.

**Requirements:** Node 18+ and `npm`.

```sh
npm install         # one-time: install dev dependencies (Playwright)
npm run test:setup  # one-time: download the extension-capable Chromium build
npm test            # run the suite
```

Expected output — seven passing tests:

```
✔ service worker registers and openPopup() is available
✔ end-to-end: ) in the popup advances to the next tab (wraps last->first)
✔ end-to-end: ( in the popup goes to the previous tab
✔ end-to-end: & in the popup closes the active tab and a neighbour takes over
✔ end-to-end: c in the popup opens a new active tab
✔ end-to-end: z in the popup toggles keep-awake, badge, and closes the popup
✔ walkTab() covers the full wrap-around matrix on a clean 3-tab strip
```

> Note: extensions only load in *headless* Chromium through Playwright's
> `channel: "chromium"` build, which is what `npm run test:setup` downloads.
> A regular `npm install` alone is not enough to run the suite headless.

## Customizing colors

Edit the `SCHEMES` map in `schemes.js`. Each entry is `{ name, bg, fg }`
with hex colors; index `0` is `null` (reset).

## Escape hatch (for sites you control)

The themer flattens almost everything to one background + one foreground.
On a site whose HTML you own, you can control theming with:

- `data-colored-bg="off"` — disables theming for this element and its subtree
- `data-colored-bg="on"` — re-enables theming for this element and its subtree

Example:

```html
<body data-colored-bg="off">
  <div class="container" data-colored-bg="on">
    <!-- this container will be themed even though body is off -->
  </div>
</body>
```

This lets you keep the page body in its original colors while theming specific
sections, or vice versa.
