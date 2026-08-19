export type Point = [number, number]

/** Bump when saved puzzle geometry rules change (invalidates localStorage). */
export const GAME_STATE_VERSION = 5 as const

export type PuzzleCell = {
  id: string
  rings: Point[][]
  bulges?: number[]
  centroid: Point
  labelAnchor: Point
  label: string
  isSolution: boolean
  labelSize: number
}

export type Puzzle = {
  letter: string
  width: number
  height: number
  density: number
  cells: PuzzleCell[]
}

export type GameState = {
  version: typeof GAME_STATE_VERSION
  puzzle: Puzzle
  fills: Record<string, string>
  selectedColor: string
  density: number
}
