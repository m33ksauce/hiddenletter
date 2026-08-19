export function requireDebugTools(scriptName) {
  const enabled = process.env.VITE_DEBUG_TOOLS === 'true' || process.env.DEBUG_TOOLS === 'true'
  if (!enabled) {
    console.error(`${scriptName} is disabled. Set VITE_DEBUG_TOOLS=true to run debug scripts.`)
    process.exit(1)
  }
}

export const UPPERCASE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
export const LOWERCASE_LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')
export const ALL_LETTERS = [...UPPERCASE_LETTERS, ...LOWERCASE_LETTERS]
