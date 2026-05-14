import { z } from "zod"
import TurndownService from "turndown"
import type { Tool, ToolContext } from "@omni/core"

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  hr: "---",
})
turndown.remove(["script", "style", "noscript", "iframe", "svg", "nav", "footer", "header", "aside"])

const WebFetchArgs = z.object({
  url: z.string().url().describe("HTTPS URL to fetch."),
  format: z
    .enum(["text", "markdown", "html"])
    .optional()
    .describe(
      "'markdown' (default) converts HTML to markdown preserving headings/lists/links. 'text' strips all formatting. 'html' returns raw body.",
    ),
  max_bytes: z
    .number()
    .int()
    .positive()
    .max(2_000_000)
    .optional()
    .describe("Max bytes to read from the response. Default 500000."),
})

export interface WebFetchResult {
  readonly url: string
  readonly finalUrl: string
  readonly status: number
  readonly contentType: string
  readonly truncated: boolean
  readonly bytes: number
  readonly content: string
}

const DEFAULT_MAX_BYTES = 500_000

/**
 * Fetch a web page and return plain text (or raw HTML). HTTPS only.
 * Drops <script>, <style>, <nav>, <footer>; normalizes whitespace.
 * For complex SPAs the result will be minimal — the model should ask for HTML
 * mode when it needs the structure.
 */
export const webFetch: Tool<z.infer<typeof WebFetchArgs>, WebFetchResult> = {
  name: "web_fetch",
  description:
    "Fetch an HTTPS URL and return its content. 'markdown' (default) converts HTML to markdown; 'text' strips formatting; 'html' returns raw body. Large responses are truncated.",
  permission: "ask",
  schema: WebFetchArgs,
  async execute(args, ctx: ToolContext): Promise<WebFetchResult> {
    if (!args.url.startsWith("https://") && !args.url.startsWith("http://")) {
      throw new Error("only http/https URLs are allowed")
    }
    const maxBytes = args.max_bytes ?? DEFAULT_MAX_BYTES
    const format = args.format ?? "markdown"

    const res = await fetch(args.url, {
      signal: ctx.signal,
      redirect: "follow",
      headers: { "User-Agent": "omni/0.1 (+https://example.com)" },
    })
    const contentType = res.headers.get("content-type") ?? ""
    const buf = await readWithLimit(res, maxBytes)

    const raw = new TextDecoder("utf-8", { fatal: false }).decode(buf.body)
    const content =
      format === "html" ? raw : format === "markdown" ? htmlToMarkdown(raw) : extractText(raw)

    return {
      url: args.url,
      finalUrl: res.url,
      status: res.status,
      contentType,
      truncated: buf.truncated,
      bytes: buf.body.byteLength,
      content,
    }
  },
}

async function readWithLimit(
  res: Response,
  maxBytes: number,
): Promise<{ body: Uint8Array; truncated: boolean }> {
  const reader = res.body?.getReader()
  if (!reader) return { body: new Uint8Array(), truncated: false }
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value) continue
    if (total + value.byteLength > maxBytes) {
      const room = Math.max(0, maxBytes - total)
      if (room > 0) chunks.push(value.subarray(0, room))
      total += room
      truncated = true
      try {
        await reader.cancel()
      } catch {
        // ignore
      }
      break
    }
    chunks.push(value)
    total += value.byteLength
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    body.set(c, offset)
    offset += c.byteLength
  }
  return { body, truncated }
}

const HTML_DROP =
  /<(script|style|noscript|svg|iframe|nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1>/gi
const HTML_TAGS = /<[^>]+>/g
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
}

function extractText(html: string): string {
  let s = html.replace(HTML_DROP, " ")
  s = s.replace(HTML_TAGS, " ")
  s = s.replace(/&[#a-zA-Z0-9]+;/g, (m) => HTML_ENTITIES[m] ?? m)
  s = s.replace(/\s+/g, " ").trim()
  return s
}

function htmlToMarkdown(html: string): string {
  try {
    return turndown.turndown(html).replace(/\n{3,}/g, "\n\n").trim()
  } catch {
    return extractText(html)
  }
}
