import type { Verifier, VerifyContext, VerifierResult } from "@omni/core"
import type { ApplyPatchResult } from "../apply_patch.ts"

/**
 * The cheapest, most obvious verifier: confirm `apply_patch` actually
 * applied. If `result.failed` contains any entries OR `result.applied` is
 * empty, the patch did not land cleanly and the model should be informed.
 *
 * This catches the classic weak-model failure mode where the agent writes
 * a diff against context lines that don't exist in the file, the patch
 * fails, and without a verifier the model reports "done" anyway.
 */
export class PatchAppliesVerifier implements Verifier {
  readonly name = "patch-applies"
  readonly appliesTo = ["apply_patch"] as const
  readonly cost = "cheap" as const

  async verify(ctx: VerifyContext): Promise<VerifierResult> {
    const r = ctx.result as ApplyPatchResult | undefined
    if (!r || typeof r !== "object" || !Array.isArray(r.applied) || !Array.isArray(r.failed)) {
      // Tool's result shape doesn't match — skip rather than fail. A future
      // tool change shouldn't trip a verifier here.
      return {
        verifier: this.name,
        status: "skip",
        reason: "result shape does not look like ApplyPatchResult",
      }
    }
    if (r.failed.length > 0) {
      const lines = r.failed.map((f) => `  - ${f.path}: ${f.reason}`).join("\n")
      return {
        verifier: this.name,
        status: "fail",
        reason: `${r.failed.length} file patch(es) failed to apply`,
        feedback: `The following file patches did not apply cleanly:\n${lines}\n\nRe-read the file and produce a diff whose context lines match the current contents.`,
        details: { failed: r.failed, applied: r.applied.length },
      }
    }
    if (r.applied.length === 0) {
      return {
        verifier: this.name,
        status: "fail",
        reason: "no file patches applied",
        feedback:
          "apply_patch returned an empty `applied` list. Check the diff is well-formed (has --- / +++ headers and at least one @@ hunk).",
      }
    }
    return { verifier: this.name, status: "pass" }
  }
}
