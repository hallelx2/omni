// @omni/improve embeds AGENT.md defaults via `import … with { type: "text" }`.
// The cli typecheck follows that import but doesn't load improve's ambient
// declarations, so it needs its own copy: *.md modules resolve to a string.
declare module "*.md" {
  const content: string
  export default content
}
