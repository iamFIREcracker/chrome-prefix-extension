// Banner colors mapped from the user's tmux color table + Alacritty palette.
// tmux recolors only the status line (top) and the border line under the
// active pane (bottom), never the pane itself; the page gets the same two bars.
//
//   bind -Ttablecolor 0 set-option -u status-style      (reset)
//   bind -Ttablecolor 1 set-option status-style "bg=color1"
//   bind -Ttablecolor 2 set-option status-style "bg=color10"
//   bind -Ttablecolor 3 set-option status-style "bg=color11"
//   bind -Ttablecolor 4 set-option status-style "bg=color4"
//   bind -Ttablecolor 5 set-option status-style "bg=color5"
//   bind -Ttablecolor 6 set-option status-style "bg=color6"
//   bind -Ttablecolor 7 set-option status-style "bg=color15"
//   bind -Ttablecolor 8 set-option status-style "bg=color0"
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
  // `fg` is only the label color of the popup swatch; the page is untouched.
  const SCHEMES = {
    0: null, // no banner
    1: { name: "red", bg: "#ab0000", fg: "#f4f4f4" },
    2: { name: "green", bg: "#3ad63a", fg: "#020202" },
    3: { name: "yellow", bg: "#a7964d", fg: "#020202" },
    4: { name: "blue", bg: "#3344dd", fg: "#f4f4f4" },
    5: { name: "magenta", bg: "#8a148a", fg: "#f4f4f4" },
    6: { name: "cyan", bg: "#008a8a", fg: "#f4f4f4" },
    7: { name: "light", bg: "#f4f4f4", fg: "#020202" },
    8: { name: "dark", bg: "#020202", fg: "#f4f4f4" },
  };

  const STYLE_ID = "__prefix_banner_style__";
  const BANNER_HEIGHT = "10px";

  // Build the CSS for the two banners: fixed bars drawn over the top and bottom
  // edges of the viewport, as the root element's ::before and ::after. They take
  // no layout space and let clicks through, so the page itself is untouched.
  function buildCss(scheme) {
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

  // Storage key for a host's saved color in chrome.storage.local, or null for
  // pages without a host (file://, data:), which are never saved. `host` is
  // hostname plus any non-default port, so localhost:3000 and localhost:8080
  // keep separate colors.
  function hostKey(host) {
    return host ? "scheme-host:" + host : null;
  }

  const api = { SCHEMES, STYLE_ID, buildCss, hostKey };
  if (typeof self !== "undefined") self.PREFIX_BANNER = api;
  if (typeof window !== "undefined") window.PREFIX_BANNER = api;
})();
