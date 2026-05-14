import readline from "node:readline"
import { ansi } from "./ansi.ts"

/**
 * Ask a yes/no question. Default is "yes" if user just presses Enter.
 * Returns `false` if stdin is closed (non-TTY contexts).
 */
export function confirm(question: string, defaultYes = true): Promise<boolean> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(defaultYes)
      return
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const prompt = `${ansi.yellow(question)} ${ansi.dim(defaultYes ? "[Y/n]" : "[y/N]")} `
    rl.question(prompt, (answer) => {
      rl.close()
      const trimmed = answer.trim().toLowerCase()
      if (!trimmed) {
        resolve(defaultYes)
        return
      }
      resolve(trimmed === "y" || trimmed === "yes")
    })
  })
}

/** Read a single line of input from the user. */
export function readLine(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(promptText, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}
