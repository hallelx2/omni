# Authoring a tool

A tool is a callable side-effect the model can invoke during a run. Each tool
declares its name, description, argument schema, and permission posture, and
implements `execute(args, ctx)`.

## Minimum example

```ts
import { z } from "zod"
import type { Tool, ToolContext } from "@omni/core"

const ShoutArgs = z.object({
  text: z.string().min(1).describe("Text to convert to upper case."),
})

export const shout: Tool<z.infer<typeof ShoutArgs>, { result: string }> = {
  name: "shout",
  description: "Return the input in upper case.",
  permission: "auto",
  schema: ShoutArgs,
  async execute(args, ctx: ToolContext) {
    return { result: args.text.toUpperCase() }
  },
}
```

Register with the engine:

```ts
new Engine({ model, tools: [shout, bash, readFile] })
```

## The `Tool` contract

```ts
interface Tool<TArgs, TResult> {
  readonly name: string                 // model-facing identifier
  readonly description: string          // model-facing prose
  readonly permission: "auto" | "ask" | "deny"
  readonly schema: z.ZodType<TArgs>     // validated before execute()
  execute(args: TArgs, ctx: ToolContext): Promise<TResult>
}
```

### `name`
Lowercase, snake_case, no spaces. The model emits this string when proposing
a tool call. Must be unique within the registered set.

### `description`
A single sentence the model reads to decide whether to call the tool. Be
concrete: "Read a text file" beats "Read things". Include args summary and
result shape when it's not obvious from the schema.

### `permission`
- `auto` — engine always allows. Use for side-effect-free reads (`glob`,
  `read_file`, `grep`).
- `ask` — engine consults the configured `PermissionGate`. Use for anything
  that writes, executes, or hits the network.
- `deny` — engine always rejects. Useful for keeping a tool registered (so
  the model knows it exists) but not callable in this session.

### `schema`
A Zod schema describing the args object. The engine validates raw model
output against this before calling `execute`. Use `.describe(...)` on each
field — the description is included in the JSON Schema the model sees, and
helps small models pass the right args.

```ts
z.object({
  path: z.string().min(1).describe("Path relative to cwd."),
  encoding: z.enum(["utf8", "base64"]).optional().describe("Default utf8."),
})
```

Prefer specific types over `z.any()`. If a tool accepts arbitrary JSON, use
`z.record(z.unknown())` so the schema still rejects non-objects.

### `execute(args, ctx)`
Async. Args are already validated when this runs.

```ts
interface ToolContext {
  readonly cwd: string                      // working directory
  readonly signal: AbortSignal              // honor for cancellable I/O
  readonly env?: Readonly<Record<string, string>>
  readonly onProgress?: (message: string) => void  // optional progress callback
}
```

**Always honor `ctx.signal`.** Pass it to `fetch`, listen with
`addEventListener("abort", ...)` for long operations, and propagate to any
subprocesses (`Bun.spawn({ signal: ctx.signal })`). Without this, aborts
don't actually stop the work.

**Throw on failure.** The engine catches and emits `tool.error` with the
classified error. Throw `Error` (or a subclass); the engine's
`classifyError` adds category + retryable flags.

**Return values get JSON-stringified** when appended to conversation
history. Keep them small and structured. Prefer objects with named fields
over giant strings — the model parses structured output more reliably.

## Result size matters

Tool results over 64KB are clipped to head + tail with an elision marker
before being appended to history. For potentially-large output, truncate
yourself (the `clip` util in `@omni/tools/util/clip` does this with
configurable budgets) and return a shape that includes a `truncated` flag.

```ts
return {
  text: clipped.text,
  truncated: clipped.truncated,
  totalBytes: raw.length,
}
```

## Path safety

For tools that touch the filesystem, use `resolveUnderCwd` from
`@omni/tools/util/path`:

```ts
import { resolveUnderCwd } from "@omni/tools/util/path"

const abs = resolveUnderCwd(args.path, ctx.cwd) // throws on `..` escape
```

Pass `{ allowEscape: true }` for read-only tools where the
`PermissionGate` is the real boundary.

## Progress events

Long-running tools can emit progress messages that surface as
`tool.progress` engine events. The engine interleaves them with the eventual
`tool.result` via an `AsyncQueue`, so order is preserved.

```ts
async execute(args, ctx) {
  ctx.onProgress?.("connecting...")
  const conn = await connect()
  ctx.onProgress?.("authenticating...")
  await auth(conn)
  return doWork(conn)
}
```

## Testing a tool

Unit-test the tool directly. The engine integration is already tested in
`@omni/core` — you just need to test that your tool does the right thing
given args + context.

```ts
import { describe, expect, test } from "bun:test"
import { shout } from "./shout.ts"

const ctx = { cwd: process.cwd(), signal: new AbortController().signal }

test("uppercases input", async () => {
  expect(await shout.execute({ text: "hi" }, ctx)).toEqual({ result: "HI" })
})

test("rejects empty input via schema", () => {
  // The engine validates first; in tools tests, validate directly:
  expect(shout.schema.safeParse({ text: "" }).success).toBe(false)
})
```

## Anti-patterns

- **Don't write to disk silently.** Use `permission: "ask"`.
- **Don't swallow `ctx.signal`.** Aborts won't work; users will hate it.
- **Don't return raw `Buffer`/`ArrayBuffer`.** The conversation history is
  text. Encode to string with a documented codec.
- **Don't hide errors as success.** Return `{ ok: false, error: "..." }`
  vs throwing is fine, but be explicit. Don't return an empty success.
- **Don't depend on global state.** Use `ctx.cwd`, `ctx.env`. Tools may run
  in parallel; globals will collide.
