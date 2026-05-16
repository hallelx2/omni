/**
 * Built-in verifiers (CRITIC pattern). Each pairs with one or more tools
 * and checks the tool's output via an *external* signal — never an LLM
 * grading itself.
 *
 * Verifiers are intentionally separate from tools so you can ship the
 * same tool with different verifiers in different contexts (e.g. a code
 * agent ships TypecheckVerifier + TestVerifier; a prose agent doesn't).
 */
export { PatchAppliesVerifier } from "./patch_applies.ts"
export { FileParsesVerifier } from "./file_parses.ts"
export {
  TypecheckVerifier,
  runShellVerifier,
  type TypecheckVerifierOptions,
} from "./typecheck.ts"
export { TestVerifier, type TestVerifierOptions } from "./test.ts"
