/**
 * Theme tokens — adopting opencode's theme schema verbatim so we can
 * cross-import community theme files later. Default theme below is a
 * tuned-for-Omni variant of opencode's dark palette.
 */

export interface Theme {
  // Background ramp — root to elevated surfaces
  readonly background: string
  readonly backgroundPanel: string    // cards: user msg, sidebar, dialog body, block tool
  readonly backgroundElement: string  // input fields, hover state, file pills
  readonly backgroundMenu: string     // popups (slash, autocomplete)

  // Borders — only really used for SplitBorder; we never draw boxes
  readonly border: string
  readonly borderSubtle: string
  readonly borderActive: string

  // Foreground ramp
  readonly text: string
  readonly textMuted: string

  // Brand + signals
  readonly primary: string            // brand accent — selected-row slab, brand mark, links
  readonly secondary: string
  readonly accent: string             // markdown headings, dialog category titles
  readonly success: string
  readonly warning: string
  readonly error: string
  readonly info: string

  // Selected-row foreground; resolves at runtime via selectedFg().
  readonly selectedListItemText?: string

  // Markdown-specific
  readonly markdownText: string
  readonly markdownHeading: string
  readonly markdownCode: string
  readonly markdownLink: string
  readonly markdownEmphasis: string
  readonly markdownStrong: string
  readonly markdownBlockquote: string
  readonly markdownBullet: string

  // Diff
  readonly diffAdded: string
  readonly diffRemoved: string
  readonly diffAddedBg: string
  readonly diffRemovedBg: string
  readonly diffHighlightAdded: string
  readonly diffHighlightRemoved: string
  readonly diffContext: string
  readonly diffLineNumber: string
}

/**
 * Default Omni theme — opencode's dark step palette with a slightly
 * cooler primary (a cyan-ish teal that reads as "agent" rather than
 * the warm-orange opencode uses for its brand).
 *
 * Background ramp matches opencode 1:1 so layouts feel familiar to
 * anyone coming from opencode.
 */
export const omniDark: Theme = {
  background:        "#0a0a0a",
  backgroundPanel:   "#141414",
  backgroundElement: "#1e1e1e",
  backgroundMenu:    "#1a1a1a",

  border:        "#484848",
  borderSubtle:  "#3c3c3c",
  borderActive:  "#606060",

  text:      "#eeeeee",
  textMuted: "#808080",

  primary:   "#7dd3fc",   // sky-blue accent — "agent" feel
  secondary: "#5c9cf5",
  accent:    "#a78bfa",
  success:   "#7fd88f",
  warning:   "#f5a742",
  error:     "#e06c75",
  info:      "#56b6c2",

  markdownText:       "#eeeeee",
  markdownHeading:    "#a78bfa",
  markdownCode:       "#7fd88f",
  markdownLink:       "#7dd3fc",
  markdownEmphasis:   "#e5c07b",
  markdownStrong:     "#7dd3fc",
  markdownBlockquote: "#808080",
  markdownBullet:     "#7dd3fc",

  diffAdded:           "#4fd6be",
  diffRemoved:         "#c53b53",
  diffAddedBg:         "#20303b",
  diffRemovedBg:       "#37222c",
  diffHighlightAdded:  "#b8db87",
  diffHighlightRemoved:"#e26a75",
  diffContext:         "#828bb8",
  diffLineNumber:      "#8f8f8f",
}

/**
 * Light variant — for terminals on light backgrounds. The primary
 * inverts to blue, accent goes warm orange.
 */
export const omniLight: Theme = {
  ...omniDark,
  background:        "#fafafa",
  backgroundPanel:   "#f0f0f0",
  backgroundElement: "#e5e5e5",
  backgroundMenu:    "#ededed",
  border:            "#c4c4c4",
  borderSubtle:      "#d4d4d4",
  borderActive:      "#9e9e9e",
  text:              "#1a1a1a",
  textMuted:         "#6b6b6b",
  primary:           "#3b7dd8",
  accent:            "#d97706",
}

// Active theme — for now a single export; later we'll expose a context.
export const theme: Theme = omniDark

/**
 * SplitBorder — opencode's signature chrome. Use as
 *   <box border={SplitBorder.sides} customBorderChars={SplitBorder.chars}>
 * Renders only a left-edge vertical bar with no horizontal sides.
 */
export const SplitBorder = {
  sides: ["left"] as const,
  chars: {
    topLeft:     " ",
    topRight:    " ",
    bottomLeft:  " ",
    bottomRight: " ",
    horizontal:  " ",
    vertical:    "┃",
    topT:        " ",
    bottomT:     " ",
    leftT:       " ",
    rightT:      " ",
    cross:       " ",
  } as const,
} as const

/**
 * SplitBorder for the prompt — the only place that uses the "fang"
 * connector at the bottom-left, so users see a thin tick under the
 * input that hints the input is anchored to the next section above.
 */
export const PromptBorder = {
  sides: ["left"] as const,
  chars: {
    ...SplitBorder.chars,
    bottomLeft: "╹",
  } as const,
} as const

/**
 * Choose a readable foreground on top of a theme.primary slab.
 * opencode computes this via luminance. We approximate by picking
 * background (very dark or very light depending on theme) when the
 * primary is bright enough, otherwise white.
 */
export function selectedFg(bg: string): string {
  // Quick luminance heuristic: if avg of RGB > 0.55, use dark fg, else white.
  const r = parseInt(bg.slice(1, 3), 16)
  const g = parseInt(bg.slice(3, 5), 16)
  const b = parseInt(bg.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.55 ? "#0a0a0a" : "#eeeeee"
}
