export const UPPERCASE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
export const LOWERCASE_LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')
export const ALL_LETTERS = [...UPPERCASE_LETTERS, ...LOWERCASE_LETTERS] as const

export type LetterCase = 'upper' | 'lower'

export function letterCase(letter: string): LetterCase {
  return /[A-Z]/.test(letter) ? 'upper' : 'lower'
}

export function letterOutlinePath(letter: string): string {
  const bucket = letterCase(letter)
  return `/letters/${bucket}/${letter}.json`
}

/** Keep labels in the same case as the chosen letter. */
export function withLetterCase(source: string, letter: string): string {
  return /[A-Z]/.test(letter) ? source.toUpperCase() : source.toLowerCase()
}
