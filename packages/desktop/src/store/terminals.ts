import { create } from "zustand"

export interface TermTab {
  id: string
  title: string
  cwd: string
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || "terminal"
}

interface TerminalStore {
  open: boolean
  tabs: TermTab[]
  activeId: string | null

  setOpen: (o: boolean) => void
  toggle: (cwd?: string) => void
  newTab: (cwd: string) => void
  closeTab: (id: string) => void
  setActive: (id: string) => void
}

export const useTerminals = create<TerminalStore>((set, get) => ({
  open: false,
  tabs: [],
  activeId: null,

  setOpen: (open) => set({ open }),

  toggle: (cwd) => {
    const { open, tabs } = get()
    if (open) {
      set({ open: false })
    } else {
      set({ open: true })
      if (tabs.length === 0 && cwd) get().newTab(cwd)
    }
  },

  newTab: (cwd) => {
    const id = crypto.randomUUID()
    const tab: TermTab = { id, title: baseName(cwd), cwd }
    set((s) => ({ tabs: [...s.tabs, tab], activeId: id, open: true }))
  },

  closeTab: (id) => {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id)
      let activeId = s.activeId
      if (activeId === id) activeId = tabs[tabs.length - 1]?.id ?? null
      return { tabs, activeId, open: tabs.length > 0 ? s.open : false }
    })
  },

  setActive: (id) => set({ activeId: id }),
}))
