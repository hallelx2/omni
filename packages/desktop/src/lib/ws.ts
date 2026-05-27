/** Single multiplexed WebSocket to the desktop server, with auto-reconnect. */
import type { ClientMessage, ServerMessage } from "./protocol"
import { getServerInfo } from "./tauri"

export type ConnStatus = "connecting" | "open" | "closed"

type MsgHandler = (msg: ServerMessage) => void
type StatusHandler = (status: ConnStatus) => void

export class OmniSocket {
  private ws: WebSocket | null = null
  private status: ConnStatus = "closed"
  private readonly msgHandlers = new Set<MsgHandler>()
  private readonly statusHandlers = new Set<StatusHandler>()
  private backoff = 400
  private stopped = false
  private queue: ClientMessage[] = []

  async connect(): Promise<void> {
    this.stopped = false
    const { wsUrl, token } = await getServerInfo()
    const url = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl
    this.open(url)
  }

  private open(url: string): void {
    this.setStatus("connecting")
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onopen = () => {
      this.backoff = 400
      this.setStatus("open")
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m))
    }
    ws.onmessage = (e) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage
      } catch {
        return
      }
      for (const h of this.msgHandlers) h(msg)
    }
    ws.onclose = () => {
      this.setStatus("closed")
      if (!this.stopped) {
        this.backoff = Math.min(this.backoff * 1.6, 6000)
        setTimeout(() => this.open(url), this.backoff)
      }
    }
    ws.onerror = () => ws.close()
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.status === "open") {
      this.ws.send(JSON.stringify(msg))
    } else {
      this.queue.push(msg)
    }
  }

  close(): void {
    this.stopped = true
    this.ws?.close()
  }

  onMessage(h: MsgHandler): () => void {
    this.msgHandlers.add(h)
    return () => this.msgHandlers.delete(h)
  }

  onStatus(h: StatusHandler): () => void {
    this.statusHandlers.add(h)
    h(this.status)
    return () => this.statusHandlers.delete(h)
  }

  getStatus(): ConnStatus {
    return this.status
  }

  private setStatus(s: ConnStatus): void {
    if (s === this.status) return
    this.status = s
    for (const h of this.statusHandlers) h(s)
  }
}

export const socket = new OmniSocket()
