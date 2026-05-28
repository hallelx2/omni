import { useApp } from "@/store/app"
import { SessionSidebar } from "./session-sidebar"

/**
 * Holds the inline session panel. Collapsed (toggle from the panel header) hides
 * it entirely — sessions are then reached by hovering a project in the rail,
 * which flies its session list out (see ProjectRail / ProjectFlyout).
 */
export function SidebarDock() {
  const collapsed = useApp((s) => s.sessionPanelCollapsed)
  if (collapsed) return null
  return <SessionSidebar />
}
