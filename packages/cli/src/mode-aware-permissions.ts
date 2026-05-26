import type { PermissionDecision, PermissionGate, Tool, ToolCall } from "@omni/core"
import type { RunMode } from "./mode.ts"

/**
 * Permission gate that short-circuits to "allow" when the run mode is "auto"
 * — the unattended autonomous posture: tools with `permission: "ask"` skip the
 * prompt entirely. Tools that declare `permission: "deny"` still deny, and the
 * safety guards layered above (destructive-bash deny, optional workspace
 * confinement) still apply regardless of mode. In any non-auto mode this gate
 * delegates straight to the inner gate (interactive ask, allow-all, …).
 */
export class ModeAwarePermissions implements PermissionGate {
  constructor(
    private readonly inner: PermissionGate,
    private readonly getMode: () => RunMode,
  ) {}
  async check(tool: Tool, call: ToolCall): Promise<PermissionDecision> {
    if (tool.permission === "deny") return "deny"
    if (this.getMode() === "auto") return "allow"
    return this.inner.check(tool, call)
  }
}
