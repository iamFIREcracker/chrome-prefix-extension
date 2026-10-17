# Prefix

> tmux-style browser bindings

A small Chrome (Manifest V3) extension that gives the browser **tmux-style
keybindings** behind a tmux-like prefix (**Alt+W**). Press the prefix, then a
key to trigger a binding. Three binding families ship today:

| Prefix    | Then…       | Family                              |
|-----------|-------------|-------------------------------------|
| **Alt+W** | **Alt+C**, **1**–**8** | color the banners at the top and bottom of the page, like a tmux session (**0** removes them) |
| **Alt+W** | **)** / **(** | move to the next / previous tab     |
| **Alt+W** | **&** / **c** | close the current tab / open a new one |
| **Alt+W** | **r**         | reload the extension                |
| **Alt+W** | **z**         | keep the screen awake (toggle)      |

The color family mirrors these tmux bindings, which color the status line at
the top and the border line under the active pane, never the pane itself:

```
# Colored sessions
bind M-c switch-client -Ttablecolor
bind -Ttablecolor 0 set-option -u status-style
bind -Ttablecolor 1 set-option status-style "bg=color1"
bind -Ttablecolor 2 set-option status-style "bg=color10"
bind -Ttablecolor 3 set-option status-style "bg=color11"
bind -Ttablecolor 4 set-option status-style "bg=color4"
bind -Ttablecolor 5 set-option status-style "bg=color5"
bind -Ttablecolor 6 set-option status-style "bg=color6"
bind -Ttablecolor 7 set-option status-style "bg=color15"
bind -Ttablecolor 8 set-option status-style "bg=color0"
```

## Usage

1. Open the picker — click the toolbar icon, or press **Alt+W**
   (the tmux-style "prefix").
2. Then press a key:
   - **Alt+C** to enter color mode, then **1**–**8** (or click a swatch) to
     color the banners; **0** removes them.
   - **)** / **(** to move to the next / previous tab.
   - **&** / **c** to close the current tab / open a new one.
   - **r** to reload the extension.
   - **z** to toggle keeping the screen awake.

### Color the banners

Press **Alt+C** after the prefix to enter color mode, then a digit. The digits
live in their own key table, like tmux's `switch-client -T`, so they do
nothing in the prefix alone. Clicking a swatch works in either mode.

The color goes to two thin bars fixed to the top and bottom edges of the
window, the counterparts of the tmux status line and the bottom border line.
The page itself keeps its own colors, so the banners never clash with it.
They take no layout space and let clicks through.

| Key | Banner color    |
|-----|-----------------|
| 0   | none (removes the banners) |
| 1   | red             |
| 2   | green           |
| 3   | yellow          |
| 4   | blue            |
| 5   | magenta         |
| 6   | cyan            |
| 7   | light (white)   |
| 8   | dark (black)    |

The choice is saved **per host**: every tab on that host shows the same color,
including tabs opened later, and it survives reloads and browser restarts until
you pick **0** there. Hosts are matched exactly, port included, so
`mail.example.com` and `docs.example.com` keep separate colors, and so do
`localhost:3000` and `localhost:8080`. Default ports are left out, so
`https://example.com:443` is the same host as `https://example.com`. It's keyed
by host in `chrome.storage.local`; `content.js` re-applies it on load and
repaints the other open tabs on the host when it changes. Pages without a host
(`file://`) are colored only until they reload.

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
truer `kill-pane` analog), and **c** lands on the new-tab page, where the banners
can't be drawn but management keys still work.

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
> the popup still draws the banners instantly on them, but reload them once for
> persistence to kick in. The extension cannot touch restricted pages
> (`chrome://`, the Web Store, etc.).

## Files

- `manifest.json` — MV3 manifest, command, content script.
- `schemes.js` — color palette + banner CSS builder (shared by popup &
  content).
- `content.js` — re-applies the host's saved banner color on page load and
  when it changes.
- `popup.js` / `popup.html` / `popup.css` — the picker UI: Alt+C, then 1–8;
  0 resets.
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

Expected output — eight passing tests:

```
✔ service worker registers and openPopup() is available
✔ end-to-end: ) in the popup advances to the next tab (wraps last->first)
✔ end-to-end: ( in the popup goes to the previous tab
✔ end-to-end: & in the popup closes the active tab and a neighbour takes over
✔ end-to-end: c in the popup opens a new active tab
✔ end-to-end: Alt+C then a digit in the popup draws the banners on the active tab
✔ end-to-end: z in the popup toggles keep-awake, badge, and closes the popup
✔ walkTab() covers the full wrap-around matrix on a clean 3-tab strip
```

> Note: extensions only load in *headless* Chromium through Playwright's
> `channel: "chromium"` build, which is what `npm run test:setup` downloads.
> A regular `npm install` alone is not enough to run the suite headless.

## Customizing colors

Edit the `SCHEMES` map in `schemes.js`. Each entry is `{ name, bg, fg }`
with hex colors: `bg` colors the banners, `fg` only the swatch label in the
picker; index `0` is `null` (no banners). `BANNER_HEIGHT` sets the thickness
of the bars.
