import { DEFAULT_COLOR, isPaletteColor } from './colors'
import { clampDensity, DEFAULT_DENSITY } from './difficulty'
import { ringsLabelPlacement } from './geometry'
import type { GameState, PuzzleCell } from './types'
import { GAME_STATE_VERSION } from './types'

/** Bump when puzzle geometry rules change (invalidates localStorage). */

const STORAGE_KEY = 'hiddenletter:v4'

function withLabelAnchor(cell: PuzzleCell): PuzzleCell {
  const placement = ringsLabelPlacement(cell.rings, cell.labelSize, cell.bulges)
  return { ...cell, labelAnchor: placement.anchor, labelSize: placement.size }
}

export function loadState(): GameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as GameState
    if (data.version !== GAME_STATE_VERSION) return null
    if (!data.puzzle?.letter || !/^[A-Za-z]$/.test(data.puzzle.letter)) return null
    if (!Array.isArray(data.puzzle.cells) || data.puzzle.cells.length === 0) {
      return null
    }
    if (
      !data.puzzle.cells.every(
        (cell) =>
          Array.isArray(cell.rings) &&
          cell.rings.length > 0 &&
          Array.isArray(cell.rings[0]) &&
          (cell.rings[0]?.length ?? 0) >= 3,
      )
    ) {
      return null
    }

    const density = clampDensity(data.density ?? data.puzzle.density ?? DEFAULT_DENSITY)

    return {
      version: GAME_STATE_VERSION,
      puzzle: {
        ...data.puzzle,
        density: clampDensity(data.puzzle.density ?? density),
        cells: data.puzzle.cells.map(withLabelAnchor),
      },
      fills: data.fills,
      selectedColor:
        data.selectedColor === 'eraser' || isPaletteColor(data.selectedColor)
          ? data.selectedColor
          : DEFAULT_COLOR,
      density,
    }
  } catch {
    return null
  }
}

export function saveState(state: GameState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Private mode or quota — the game still works for this session.
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
