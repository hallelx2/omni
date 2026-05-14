/**
 * Browser client for @omni/server's WebSocket protocol. Renders events
 * into the page. Same event shape as the CLI render.
 */

declare global {
  interface Window {
    OMNI_WS_URL?: string
    OMNI_TOKEN?: string
  }
}

const wsUrl =
  window.OMNI_WS_URL ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`

const logEl = document.getElementById("log")!
const formEl = document.getElementById("form") as HTMLFormElement
const inputEl = document.getElementById("input") as HTMLInputElement
const sendEl = document.getElementById("send") as HTMLButtonElement
const statusEl = document.getElementById("status")!

let ws: WebSocket | null = null
let running = false

connect()

function connect() {
  ws = new WebSocket(wsUrl)
  ws.onopen = () => {
    statusEl.textContent = "connected"
    statusEl.className = "green"
  }
  ws.onclose = () => {
    statusEl.textContent = "disconnected"
    statusEl.className = "error"
    setTimeout(connect, 1_000)
  }
  ws.onerror = () => {
    statusEl.textContent = "error"
    statusEl.className = "error"
  }
  ws.onmessage = (e) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ev: any = JSON.parse(e.data as string)
      renderEvent(ev)
      if (ev.type === "engine.done" || ev.type === "engine.error") {
        running = false
        sendEl.disabled = false
      }
    } catch {
      // ignore
    }
  }
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault()
  const text = inputEl.value.trim()
  if (!text || running || !ws || ws.readyState !== WebSocket.OPEN) return
  appendLine(`> ${text}`, "user")
  ws.send(JSON.stringify({ type: "run", input: text }))
  running = true
  sendEl.disabled = true
  inputEl.value = ""
})

function appendLine(text: string, klass = "") {
  const div = document.createElement("div")
  div.className = klass
  div.textContent = text
  logEl.appendChild(div)
  window.scrollTo({ top: document.body.scrollHeight })
}

function appendInline(text: string, klass = "") {
  const span = document.createElement("span")
  span.className = klass
  span.textContent = text
  logEl.appendChild(span)
  window.scrollTo({ top: document.body.scrollHeight })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderEvent(ev: any) {
  switch (ev.type) {
    case "server.hello":
      appendLine(`session ${ev.sessionId}`, "dim")
      break
    case "engine.iteration":
      appendLine(`[iter ${ev.iteration}]`, "dim")
      break
    case "model.start":
      appendInline("assistant: ", "assistant")
      break
    case "model.thinking_delta":
      appendInline(ev.text, "dim")
      break
    case "model.delta":
      appendInline(ev.text, "assistant")
      break
    case "model.tool_call_done":
      appendLine(`  → ${ev.call.name}(${JSON.stringify(ev.call.args)})`, "tool")
      break
    case "tool.result":
      appendLine(
        `  ✓ ${typeof ev.result === "string" ? ev.result.slice(0, 200) : JSON.stringify(ev.result).slice(0, 200)} (${ev.durationMs}ms)`,
        "tool",
      )
      break
    case "tool.error":
      appendLine(`  ✗ ${ev.call.name}: ${ev.error.message} [${ev.error.category}]`, "error")
      break
    case "engine.usage":
      appendLine(`  [tokens: ${ev.total.totalTokens}]`, "dim")
      break
    case "engine.done":
      appendLine(`done (${ev.reason}, ${ev.durationMs}ms)`, "green")
      break
    case "engine.error":
      appendLine(`error: ${ev.error.message}`, "error")
      break
    case "permission.request": {
      const allow = window.confirm(
        `Allow ${ev.tool.name}(${JSON.stringify(ev.call.args)})?`,
      )
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "permission.response",
            requestId: ev.requestId,
            decision: allow ? "allow" : "deny",
          }),
        )
      }
      appendLine(
        `  ${allow ? "✓" : "✗"} permission ${allow ? "granted" : "denied"} for ${ev.tool.name}`,
        allow ? "tool" : "error",
      )
      break
    }
    case "server.error":
      appendLine(`server error: ${ev.message}`, "error")
      break
  }
}
