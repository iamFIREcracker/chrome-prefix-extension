// Colors mapped from the user's tmux color table + Alacritty palette. Like
// tmux, there are two layers, each with its own key in color mode:
//
// - 1-8 color the banners: the status line (top) and the border line under
//   the active pane (bottom), leaving the page untouched. Like a tmux
//   session's color, it belongs to the host and persists.
//
//     bind -Ttablecolor 0 set-option -u status-style      (reset)
//     bind -Ttablecolor 1 set-option status-style "bg=color1"
//     ...
//
// - Alt+1-8 recolor the page itself, like coloring the pane: one background
//   showing through everywhere, one foreground color for all text. Alt+0
//   restores the page's own colors. Like a tmux pane's color, it belongs to
//   the tab and dies with it.
//
//   key  bg       fg
//   1    color1   color15    red       / bright white
//   2    color10  color0     br-green  / black
//   3    color11  color0     br-yellow / black
//   4    color4   color15    blue      / bright white
//   5    color5   color15    magenta   / bright white
//   6    color6   color15    cyan      / bright white
//   7    color15  color0     light     / black
//   8    color0   color15    dark      / bright white
//
// Palette (256-color names -> hex):
//   color0  black         #020202
//   color1  red           #ab0000
//   color4  blue          #3344dd
//   color5  magenta       #8a148a
//   color6  cyan          #008a8a
//   color10 bright green  #3ad63a
//   color11 bright yellow #a7964d
//   color15 bright white  #f4f4f4
(function () {
  // The banners use only `bg`; the page uses both, and `fg` also labels the
  // popup swatch.
  const SCHEMES = {
    0: null, // no color
    1: { name: "red", bg: "#ab0000", fg: "#f4f4f4" },
    2: { name: "green", bg: "#3ad63a", fg: "#020202" },
    3: { name: "yellow", bg: "#a7964d", fg: "#020202" },
    4: { name: "blue", bg: "#3344dd", fg: "#f4f4f4" },
    5: { name: "magenta", bg: "#8a148a", fg: "#f4f4f4" },
    6: { name: "cyan", bg: "#008a8a", fg: "#f4f4f4" },
    7: { name: "light", bg: "#f4f4f4", fg: "#020202" },
    8: { name: "dark", bg: "#020202", fg: "#f4f4f4" },
  };

  const BANNER_HEIGHT = "10px";

  // Build the CSS for the two banners: fixed bars drawn over the top and bottom
  // edges of the viewport, as the root element's ::before and ::after. They take
  // no layout space and let clicks through, so the page itself is untouched.
  function buildBannerCss(scheme) {
    if (!scheme) return "";
    return [
      `html::before,`,
      `html::after {`,
      `  content: "" !important;`,
      `  display: block !important;`,
      `  position: fixed !important;`,
      `  left: 0 !important;`,
      `  right: 0 !important;`,
      `  height: ${BANNER_HEIGHT} !important;`,
      `  background: ${scheme.bg} !important;`,
      `  z-index: 2147483647 !important;`,
      `  pointer-events: none !important;`,
      `}`,
      `html::before { top: 0 !important; bottom: auto !important; }`,
      `html::after { bottom: 0 !important; top: auto !important; }`,
    ].join("\n");
  }

  // Escape hatch for the page recolor:
  //   data-colored-bg="off" disables theming for this element and its subtree.
  //   data-colored-bg="on" re-enables theming for this element and its subtree.
  //
  // Example:
  //   <body data-colored-bg="off">
  //     <div class="container" data-colored-bg="on">
  const OFF_SELECTOR = `[data-colored-bg="off"]`;
  const ON_SELECTOR = `[data-colored-bg="on"]`;

  const unthemeableElementClauses =
    `:not(html):not(body):not(img):not(video):not(picture):not(canvas):not(iframe):not(svg)`;

  // Build the CSS that paints the page like a terminal pane: one background
  // showing through everywhere, one foreground color for all text. It leaves
  // html::before and html::after alone, so the banners still show on top.
  function buildPageCss(scheme) {
    if (!scheme) return "";
    const { bg, fg } = scheme;
    const baseElementSelector = `*${unthemeableElementClauses}`;

    // Normal page theming: active under body, except inside an "off" subtree.
    const bodyElementSelector =
      `${baseElementSelector}:not(${OFF_SELECTOR}):not(${OFF_SELECTOR} *)`;

    // Explicit re-enable: active under an "on" subtree, even if an ancestor is "off".
    const onElementSelector = `${ON_SELECTOR} ${baseElementSelector}`;

    return [
      `body:not(${OFF_SELECTOR}),`,
      `${ON_SELECTOR} {`,
      `  min-height: 100% !important;`,
      `  background: ${bg} !important;`,
      `  color: ${fg} !important;`,
      `}`,
      // Let the page-level background show through every element (terminal-style).
      `body:not(${OFF_SELECTOR}) ${bodyElementSelector},`,
      `body:not(${OFF_SELECTOR}) ${bodyElementSelector}::before,`,
      `body:not(${OFF_SELECTOR}) ${bodyElementSelector}::after,`,
      `${onElementSelector},`,
      `${onElementSelector}::before,`,
      `${onElementSelector}::after {`,
      `  background: transparent !important;`,
      `}`,
      // Force a single foreground color, including links.
      `body:not(${OFF_SELECTOR}) ${bodyElementSelector},`,
      `${ON_SELECTOR},`,
      `${onElementSelector} {`,
      `  color: ${fg} !important;`,
      `}`,
      // Keep form controls readable against the new background.
      `body:not(${OFF_SELECTOR}) ${bodyElementSelector}:is(input, textarea, select, button),`,
      `${ON_SELECTOR}:is(input, textarea, select, button),`,
      `${onElementSelector}:is(input, textarea, select, button) {`,
      `  background-color: rgba(127, 127, 127, 0.2) !important;`,
      `  border-color: ${fg} !important;`,
      `}`,
    ].join("\n");
  }

  // The two color layers, each with its own <style> element, so either can be
  // set or cleared without touching the other. The banners frame the whole
  // window and are drawn in the top frame only; the page recolor reaches into
  // every frame.
  const LAYERS = {
    banner: {
      styleId: "__prefix_banner_style__",
      allFrames: false,
      buildCss: buildBannerCss,
    },
    page: {
      styleId: "__prefix_page_style__",
      allFrames: true,
      buildCss: buildPageCss,
    },
  };

  // Storage key for a host's banner color in chrome.storage.local, or null for
  // pages without a host (file://, data:), which are never saved. `host` is
  // hostname plus any non-default port, so localhost:3000 and localhost:8080
  // keep separate colors.
  function hostKey(host) {
    return host ? "scheme-host:" + host : null;
  }

  // Storage key for a tab's page color in chrome.storage.session: in memory
  // only, gone with the tab (background.js drops it) or the browser.
  function tabKey(tabId) {
    return "page-scheme-tab:" + tabId;
  }

  const api = { SCHEMES, LAYERS, hostKey, tabKey };
  if (typeof self !== "undefined") self.PREFIX_SCHEMES = api;
  if (typeof window !== "undefined") window.PREFIX_SCHEMES = api;
})();
