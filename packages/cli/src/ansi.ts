/** Tiny ANSI helper. No deps. Detects color support via env. */

const NO_COLOR = process.env.NO_COLOR !== undefined
const enabled = process.stdout.isTTY && !NO_COLOR

function wrap(open: number, close = 0): (s: string) => string {
  if (!enabled) return (s) => s
  return (s) => `\x1b[${open}m${s}\x1b[${close}m`
}

export const ansi = {
  reset: enabled ? "\x1b[0m" : "",
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  underline: wrap(4, 24),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
  bgRed: wrap(41, 49),
  bgGreen: wrap(42, 49),
}

/** Move cursor up `n` lines and clear from there to end of screen. */
export function clearLastLines(n: number): void {
  if (!enabled || n <= 0) return
  process.stdout.write(`\x1b[${n}A\x1b[0J`)
}
