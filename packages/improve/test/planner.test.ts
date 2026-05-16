import { describe, expect, test } from "bun:test"
import { MockAdapter } from "../../adapters/src/mock.ts"
import { Planner, parsePlan, renderPlan } from "../src/planner.ts"

describe("parsePlan", () => {
  test("parses a numbered list", () => {
    const raw = `1. Read the file
2. Find the function
3. Make the edit
4. Run the tests`
    const p = parsePlan("refactor", raw, 8)
    expect(p.steps.length).toBe(4)
    expect(p.steps[0]!.action).toContain("Read the file")
    expect(p.steps[2]!.index).toBe(3)
  })

  test("extracts tool hint from '(uses X)'", () => {
    const raw = `1. List files (uses glob)\n2. Search code (uses grep)\n3. Apply patch (uses edit)`
    const p = parsePlan("hunt", raw, 8)
    expect(p.steps[0]!.tool).toBe("glob")
    expect(p.steps[1]!.tool).toBe("grep")
    expect(p.steps[2]!.tool).toBe("edit")
  })

  test("respects maxSteps", () => {
    const raw = "1. a\n2. b\n3. c\n4. d\n5. e"
    const p = parsePlan("x", raw, 3)
    expect(p.steps.length).toBe(3)
  })

  test("ignores non-step lines", () => {
    const raw = `Here's the plan:\n1. Step one\nSome thought\n2. Step two\nDone.`
    const p = parsePlan("x", raw, 8)
    expect(p.steps.map((s) => s.action)).toEqual(["Step one", "Step two"])
  })

  test("falls back to single step when no numbered list", () => {
    const p = parsePlan("simple", "just do it", 8)
    expect(p.steps.length).toBe(1)
    expect(p.steps[0]!.action).toBe("just do it")
  })
})

describe("Planner", () => {
  test("invokes the model and returns parsed plan", async () => {
    const model = new MockAdapter({
      script: [
        {
          kind: "text",
          text: "1. First action (uses bash)\n2. Second action\n3. Final step",
        },
      ],
    })
    const planner = new Planner(model)
    const plan = await planner.plan("do something", [
      { name: "bash", description: "shell", permission: "ask" },
    ])
    expect(plan.steps.length).toBe(3)
    expect(plan.steps[0]!.tool).toBe("bash")
    expect(plan.raw).toContain("First action")
  })

  test("handles model error by throwing", async () => {
    const model = new MockAdapter({
      script: [{ kind: "error", message: "model down" }],
    })
    const planner = new Planner(model)
    await expect(planner.plan("x")).rejects.toThrow(/model down/)
  })

  test("renderPlan produces a prompt-ready string", () => {
    const plan = parsePlan("task", "1. Alpha\n2. Beta", 8)
    const rendered = renderPlan(plan)
    expect(rendered).toContain("Plan for: task")
    expect(rendered).toContain("1. Alpha")
    expect(rendered).toContain("2. Beta")
  })

  test("onStructuredFallback fires once when generateObject errors", async () => {
    const model = new MockAdapter({
      script: [
        { kind: "text", text: "1. step A\n2. step B" },
        { kind: "text", text: "1. step C" },
      ],
    })
    const warnings: unknown[] = []
    const planner = new Planner(model, {
      useStructuredOutput: true,
      // A "languageModel" object that always throws when generateObject calls
      // it — simulates a provider that doesn't support structured output.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      languageModel: { specificationVersion: "v2" } as any,
      onStructuredFallback: (e) => warnings.push(e),
    })
    await planner.plan("first")
    await planner.plan("second")
    expect(warnings.length).toBe(1) // warned ONCE despite two fallbacks
  })
})
