// Bun imports these with `with { type: "text" }` (the AGENT.md defaults are
// embedded as strings). Tell tsc that *.md modules resolve to a string.
declare module "*.md" {
  const content: string
  export default content
}
