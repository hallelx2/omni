import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { webFetch } from "../src/web_fetch.ts"

let server: { stop: () => void; port: number }

beforeAll(() => {
  const s = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === "/html") {
        return new Response(
          `<html><head><title>t</title><style>.x{color:red}</style></head><body>` +
            `<nav>NAV</nav><script>bad()</script>` +
            `<main><h1>Title</h1><p>Hello &amp; world.</p></main>` +
            `<footer>FOOT</footer></body></html>`,
          { headers: { "Content-Type": "text/html" } },
        )
      }
      if (url.pathname === "/big") {
        const big = "x".repeat(10_000)
        return new Response(big, { headers: { "Content-Type": "text/plain" } })
      }
      if (url.pathname === "/redirect") {
        return new Response(null, { status: 302, headers: { Location: "/html" } })
      }
      return new Response("not found", { status: 404 })
    },
  })
  server = { stop: () => s.stop(), port: s.port }
})

afterAll(() => server.stop())

function ctx() {
  return { cwd: process.cwd(), signal: new AbortController().signal }
}

describe("web_fetch", () => {
  test("extracts plain text from HTML, dropping scripts/styles/nav/footer", async () => {
    const r = await webFetch.execute({ url: `http://localhost:${server.port}/html` }, ctx())
    expect(r.status).toBe(200)
    expect(r.content).toContain("Title")
    expect(r.content).toContain("Hello & world.")
    expect(r.content).not.toContain("NAV")
    expect(r.content).not.toContain("FOOT")
    expect(r.content).not.toContain("bad()")
    expect(r.content).not.toContain(".x{")
  })

  test("html mode returns raw body", async () => {
    const r = await webFetch.execute(
      { url: `http://localhost:${server.port}/html`, format: "html" },
      ctx(),
    )
    expect(r.content).toContain("<html>")
    expect(r.content).toContain("<script>")
  })

  test("truncates oversized responses", async () => {
    const r = await webFetch.execute(
      { url: `http://localhost:${server.port}/big`, max_bytes: 500, format: "html" },
      ctx(),
    )
    expect(r.truncated).toBe(true)
    expect(r.bytes).toBeLessThanOrEqual(500)
  })

  test("follows redirects", async () => {
    const r = await webFetch.execute(
      { url: `http://localhost:${server.port}/redirect` },
      ctx(),
    )
    expect(r.status).toBe(200)
    expect(r.content).toContain("Title")
  })
})
