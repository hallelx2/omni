import { useEffect, useRef } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { spawn, type IPty } from "tauri-pty"
import "@xterm/xterm/css/xterm.css"
import { isTauri } from "@/lib/tauri"

// A monochrome, terminal-luxe xterm theme (always dark — a terminal is a terminal).
const THEME = {
  background: "#121212",
  foreground: "#e4e4e4",
  cursor: "#e4e4e4",
  cursorAccent: "#121212",
  selectionBackground: "rgba(255,255,255,0.18)",
  black: "#1c1c1c",
  red: "#e06c75",
  green: "#98c379",
  yellow: "#e5c07b",
  blue: "#7aa2f7",
  magenta: "#c099ff",
  cyan: "#56b6c2",
  white: "#cfcfcf",
  brightBlack: "#5c5c5c",
  brightRed: "#ef7a82",
  brightGreen: "#a6e3a1",
  brightYellow: "#f0d399",
  brightBlue: "#9cc0ff",
  brightMagenta: "#d0b0ff",
  brightCyan: "#79d0db",
  brightWhite: "#ffffff",
}

function detectShell(): string {
  const ua = navigator.userAgent
  if (ua.includes("Windows")) return "powershell.exe"
  if (ua.includes("Mac")) return "/bin/zsh"
  return "/bin/bash"
}

export function TerminalView({ cwd, visible }: { id: string; cwd: string; visible: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const ptyRef = useRef<IPty | null>(null)

  useEffect(() => {
    if (!containerRef.current || !isTauri()) return
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 12.5,
      fontFamily: '"Geist Mono Variable", "Cascadia Code", Consolas, monospace',
      fontWeight: "400",
      fontWeightBold: "600",
      lineHeight: 1.35,
      letterSpacing: 0,
      theme: THEME,
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: true,
      macOptionIsMeta: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    requestAnimationFrame(() => {
      try {
        fit.fit()
      } catch {
        /* not yet sized */
      }
    })
    termRef.current = term
    fitRef.current = fit

    const pty = spawn(detectShell(), [], {
      cols: term.cols || 80,
      rows: term.rows || 24,
      cwd,
      env: { TERM: "xterm-256color", COLORTERM: "truecolor", LANG: "en_US.UTF-8" },
    })
    ptyRef.current = pty

    pty.onData((d) => term.write(d))
    pty.onExit(({ exitCode }) =>
      term.write(`\r\n\x1b[90m[process exited · code ${exitCode}]\x1b[0m\r\n`),
    )
    term.onData((d) => pty.write(d))
    term.onResize(({ cols, rows }) => pty.resize(cols, rows))

    // Ctrl+Shift+C / Ctrl+Shift+V copy-paste.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && event.ctrlKey && event.shiftKey) {
        if (event.key === "C") {
          const sel = term.getSelection()
          if (sel) navigator.clipboard?.writeText(sel)
          return false
        }
        if (event.key === "V") {
          navigator.clipboard?.readText().then((t) => pty.write(t))
          return false
        }
      }
      return true
    })

    const ro = new ResizeObserver(() => requestAnimationFrame(() => {
      try {
        fit.fit()
      } catch {
        /* hidden */
      }
    }))
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      try {
        pty.kill()
      } catch {
        /* already gone */
      }
      term.dispose()
      termRef.current = null
      fitRef.current = null
      ptyRef.current = null
    }
  }, [cwd])

  // Re-fit + focus when this tab becomes visible (hidden panels have no size).
  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        termRef.current?.focus()
      } catch {
        /* ignore */
      }
    })
  }, [visible])

  if (!isTauri()) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground">
        Terminal is available in the desktop app.
      </div>
    )
  }

  return <div ref={containerRef} className="h-full w-full px-2 pt-1" />
}
