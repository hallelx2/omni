// Allow importing `.md` files as text (used for shipped default agents).
// Loaded at runtime via `import x from "./f.md" with { type: "text" }`.
declare module "*.md" {
  const content: string
  export default content
}
