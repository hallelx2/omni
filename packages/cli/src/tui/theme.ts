import { SyntaxStyle, RGBA, rgbToHex } from "@opentui/core"

/**
 * Theme tokens — RGBA-based, matching opencode's theme model 1:1 so the
 * components below render with opencode's exact visual language (alpha
 * fades via {@link fadeColor}, transparency-gated chrome via `.a` checks,
 * `selectedForeground` contrast on selected slabs).
 *
 * Values are stored as {@link RGBA} (not hex strings) because opentui is
 * RGBA-native and opencode's idioms (`fadeColor`, `theme.x.a !== 0`)
 * require it. Use {@link rgba} to author from hex.
 */

/** Author a token from a hex string. */
const rgba = (hex: string): RGBA => RGBA.fromHex(hex)

export interface Theme {
  // Background ramp — root to elevated surfaces
  readonly background: RGBA
  readonly backgroundPanel: RGBA    // cards: user msg, sidebar, dialog body, block tool
  readonly backgroundElement: RGBA  // input fields, hover state, file pills
  readonly backgroundMenu: RGBA     // popups (slash, autocomplete)

  // Borders
  readonly border: RGBA
  readonly borderSubtle: RGBA
  readonly borderActive: RGBA

  // Foreground ramp
  readonly text: RGBA
  readonly textMuted: RGBA

  // Brand + signals
  readonly primary: RGBA            // brand accent — selected-row slab, brand mark, links
  readonly secondary: RGBA
  readonly accent: RGBA             // markdown headings, dialog category titles
  readonly success: RGBA
  readonly warning: RGBA
  readonly error: RGBA
  readonly info: RGBA

  // Selected-row foreground; resolved at runtime via selectedFg().
  readonly selectedListItemText?: RGBA

  // Markdown-specific
  readonly markdownText: RGBA
  readonly markdownHeading: RGBA
  readonly markdownCode: RGBA
  readonly markdownLink: RGBA
  readonly markdownEmphasis: RGBA
  readonly markdownStrong: RGBA
  readonly markdownBlockquote: RGBA
  readonly markdownBullet: RGBA

  // Diff
  readonly diffAdded: RGBA
  readonly diffRemoved: RGBA
  readonly diffAddedBg: RGBA
  readonly diffRemovedBg: RGBA
  readonly diffHighlightAdded: RGBA
  readonly diffHighlightRemoved: RGBA
  readonly diffContext: RGBA
  readonly diffLineNumber: RGBA
}

/**
 * Default Omni theme — opencode's dark step palette with a slightly
 * cooler primary (a cyan-ish teal that reads as "agent" rather than the
 * warm-orange opencode uses for its brand). The background ramp matches
 * opencode 1:1 so layouts feel familiar. Backgrounds are opaque (a=255),
 * which keeps the prompt's `▀` undershadow visible.
 */
export const omniDark: Theme = {
  // Refined cool palette — a tokyonight-derived deep blue-black with a
  // cohesive blue / violet / teal accent family and muted blue-grays.
  background:        rgba("#131620"),
  backgroundPanel:   rgba("#1a1d2a"),
  backgroundElement: rgba("#232739"),
  backgroundMenu:    rgba("#1a1d2a"),

  border:        rgba("#3b4261"),
  borderSubtle:  rgba("#2a2e42"),
  borderActive:  rgba("#545c7e"),

  text:      rgba("#c8d3f5"),
  textMuted: rgba("#828bb8"),

  primary:   rgba("#82aaff"),   // blue — brand / "agent"
  secondary: rgba("#c099ff"),   // violet
  accent:    rgba("#c099ff"),   // violet
  success:   rgba("#c3e88d"),
  warning:   rgba("#ffc777"),
  error:     rgba("#ff757f"),
  info:      rgba("#86e1fc"),   // cyan

  markdownText:       rgba("#c8d3f5"),
  markdownHeading:    rgba("#82aaff"),
  markdownCode:       rgba("#c3e88d"),
  markdownLink:       rgba("#86e1fc"),
  markdownEmphasis:   rgba("#ffc777"),
  markdownStrong:     rgba("#f2f5ff"),   // brighter than body text so **bold** reads
  markdownBlockquote: rgba("#828bb8"),
  markdownBullet:     rgba("#82aaff"),

  diffAdded:           rgba("#c3e88d"),
  diffRemoved:         rgba("#ff757f"),
  diffAddedBg:         rgba("#1f2a20"),
  diffRemovedBg:       rgba("#2b1f27"),
  diffHighlightAdded:  rgba("#d7f59d"),
  diffHighlightRemoved:rgba("#ff8b94"),
  diffContext:         rgba("#828bb8"),
  diffLineNumber:      rgba("#565f89"),
}

/**
 * Light variant — for terminals on light backgrounds. The primary
 * inverts to blue, accent goes warm orange.
 */
export const omniLight: Theme = {
  ...omniDark,
  background:        rgba("#fafafa"),
  backgroundPanel:   rgba("#f0f0f0"),
  backgroundElement: rgba("#e5e5e5"),
  backgroundMenu:    rgba("#ededed"),
  border:            rgba("#c4c4c4"),
  borderSubtle:      rgba("#d4d4d4"),
  borderActive:      rgba("#9e9e9e"),
  text:              rgba("#1a1a1a"),
  textMuted:         rgba("#6b6b6b"),
  primary:           rgba("#3b7dd8"),
  accent:            rgba("#d97706"),
}

// Active theme — for now a single export; later we'll expose a context.
export const theme: Theme = omniDark

/**
 * Readable column width for the transcript and prompt. On wide terminals,
 * full-width prose (150+ cols) is hard to read; capping to a column keeps
 * line length comfortable. Left-aligned; the empty space sits to the right.
 */
export const CONTENT_WIDTH = 100

/**
 * Border character sets — ported verbatim from opencode's
 * `component/border.tsx`. `EmptyBorder` draws nothing but a space for the
 * horizontal edge; `SplitBorder` adds the signature `┃` vertical bar.
 *
 * opencode's idiom is to borrow `SplitBorder.customBorderChars` and set
 * the `border` sides explicitly per component, e.g.
 *   <box border={["left"]} customBorderChars={SplitBorder.customBorderChars} ...>
 */
export const EmptyBorder = {
  topLeft:     "",
  bottomLeft:  "",
  vertical:    "",
  topRight:    "",
  bottomRight: "",
  horizontal:  " ",
  bottomT:     "",
  topT:        "",
  cross:       "",
  leftT:       "",
  rightT:      "",
} as const

export const SplitBorder = {
  border: ["left", "right"] as ("left" | "right" | "top" | "bottom")[],
  customBorderChars: {
    ...EmptyBorder,
    vertical: "┃",
  },
} as const

/**
 * Border char set for the prompt's bottom-left "fang" (╹) — the input
 * box's left bar terminates in a fang, opencode-style.
 */
export const PromptFangChars = {
  ...SplitBorder.customBorderChars,
  bottomLeft: "╹",
} as const

/** Border chars for the prompt's height-1 undershadow extension. */
export const EmptyBorderChars = {
  ...EmptyBorder,
  vertical: "╹",
} as const

/**
 * Fade a color's alpha by a factor in [0,1] — opencode's `fadeColor`,
 * used for the prompt meta-strip fade-in animation.
 */
export function fadeColor(color: RGBA, alpha: number): RGBA {
  return RGBA.fromValues(color.r, color.g, color.b, color.a * alpha)
}

/**
 * Lazily-built SyntaxStyle for the markdown / code renderers. opentui's
 * <markdown> requires one; it colours headings, code, links, etc. Built
 * from the active theme's markdown tokens (converted back to hex for the
 * FFI style table). Created on first use (after the renderer's FFI is
 * initialised) and cached.
 */
let _syntax: SyntaxStyle | undefined
export function syntaxStyle(): SyntaxStyle {
  if (_syntax) return _syntax
  const hex = (c: RGBA) => rgbToHex(c)
  // Scope names match what opentui's markdown highlighter emits (verified
  // against the parser): markup.strong/italic/strikethrough/raw/link/quote/
  // list/heading. `markup` is a base fallback for any unmapped markup.* scope.
  try {
    const s = SyntaxStyle.fromStyles({
      default:               { fg: hex(theme.markdownText) },
      markup:                { fg: hex(theme.markdownText) },
      // Heading hierarchy: cyan (h1) → blue (h2) → violet (h3+) so section
      // levels read at a glance instead of one flat colour.
      "markup.heading":      { fg: hex(theme.primary), bold: true },
      "markup.heading.1":    { fg: hex(theme.info), bold: true },
      "markup.heading.2":    { fg: hex(theme.primary), bold: true },
      "markup.heading.3":    { fg: hex(theme.accent), bold: true },
      "markup.heading.4":    { fg: hex(theme.accent), bold: true },
      "markup.heading.5":    { fg: hex(theme.secondary), bold: true },
      "markup.heading.6":    { fg: hex(theme.secondary), bold: true },
      "markup.bold":         { fg: hex(theme.markdownStrong), bold: true },
      "markup.strong":       { fg: hex(theme.markdownStrong), bold: true },
      "markup.italic":       { fg: hex(theme.markdownEmphasis), italic: true },
      "markup.strikethrough": { fg: hex(theme.textMuted) },
      "markup.raw":          { fg: hex(theme.markdownCode) },
      "markup.raw.block":    { fg: hex(theme.markdownCode) },
      "markup.raw.inline":   { fg: hex(theme.markdownCode) },
      "markup.quote":        { fg: hex(theme.markdownBlockquote), italic: true },
      "markup.list":         { fg: hex(theme.markdownBullet) },
      // Links: keep colour AND underline on every link scope (the label scope
      // is more specific and was previously dropping the underline).
      "markup.link":         { fg: hex(theme.markdownLink), underline: true },
      "markup.link.label":   { fg: hex(theme.markdownLink), underline: true },
      "markup.link.url":     { fg: hex(theme.markdownLink), underline: true },
      comment:               { fg: hex(theme.textMuted), italic: true },
      keyword:               { fg: hex(theme.accent) },
      string:                { fg: hex(theme.success) },
      number:                { fg: hex(theme.warning) },
      function:              { fg: hex(theme.markdownLink) },
      type:                  { fg: hex(theme.info) },
      variable:              { fg: hex(theme.markdownText) },
      punctuation:           { fg: hex(theme.textMuted) },
    })
    _syntax = s
    return s
  } catch {
    // FFI not ready yet — return a transient plain style WITHOUT caching, so
    // the next call (once the renderer is up) builds the real style table.
    return SyntaxStyle.create()
  }
}

/**
 * Choose a readable foreground on top of a colored slab (e.g. the
 * selected-row `theme.primary` background) — opencode's
 * `selectedForeground`, computed by luminance. RGBA channels are 0..1.
 */
export function selectedFg(bg: RGBA): RGBA {
  if (theme.selectedListItemText) return theme.selectedListItemText
  const luminance = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b
  return luminance > 0.55 ? theme.background : theme.text
}
