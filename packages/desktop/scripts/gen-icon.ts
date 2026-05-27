#!/usr/bin/env bun
/**
 * Generate a 1024×1024 brand source PNG (indigo→violet gradient with a minimal
 * ring mark) without any image deps, then `tauri icon` rasterizes the rest.
 */
import { deflateSync } from "node:zlib"
import { resolve } from "node:path"

const SIZE = 1024
const channels = 4

function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t)
}

const raw = new Uint8Array(SIZE * (1 + SIZE * channels))
const cx = SIZE / 2
const cy = SIZE / 2
const ringR = SIZE * 0.3
const ringW = SIZE * 0.075

for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (1 + SIZE * channels)
  raw[rowStart] = 0 // filter: none
  for (let x = 0; x < SIZE; x++) {
    const t = (x + y) / (2 * SIZE)
    let r = lerp(99, 168, t)
    let g = lerp(91, 85, t)
    let b = lerp(246, 247, t)
    // soft ring highlight (the "O" in Omni)
    const d = Math.hypot(x - cx, y - cy)
    const ring = Math.max(0, 1 - Math.abs(d - ringR) / ringW)
    if (ring > 0) {
      const k = ring * 0.85
      r = lerp(r, 255, k)
      g = lerp(g, 255, k)
      b = lerp(b, 255, k)
    }
    const p = rowStart + 1 + x * channels
    raw[p] = r
    raw[p + 1] = g
    raw[p + 2] = b
    raw[p + 3] = 255
  }
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((a, b) => a + b.length, 0)
  const out = new Uint8Array(len)
  let o = 0
  for (const a of arrs) {
    out.set(a, o)
    o += a.length
  }
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = concat(new TextEncoder().encode(type), data)
  const crc = Bun.hash.crc32(body) >>> 0
  return concat(u32(data.length), body, u32(crc))
}

const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ihdr = concat(u32(SIZE), u32(SIZE), new Uint8Array([8, 6, 0, 0, 0]))
const idat = new Uint8Array(deflateSync(raw))
const png = concat(sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array()))

const out = resolve(import.meta.dir, "..", "src-tauri", "icon-source.png")
await Bun.write(out, png)
console.log(`wrote ${out} (${(png.length / 1024).toFixed(0)} KB)`)
