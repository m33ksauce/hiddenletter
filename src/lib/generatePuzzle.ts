import { clampDensity, DEFAULT_DENSITY, densityPlan } from './difficulty'
import { ringsLabelPlacement } from './geometry'
import { loadBaseLetterShape } from './letterMask'
import { UPPERCASE_LETTERS, withLetterCase } from './letters'
import { mulberry32, pickOne, randomSeed, type Rng } from './rng'
import { sliceCanvas, sliceSeedForLetter } from './sliceCanvas'
import type { Puzzle, PuzzleCell } from './types'

const ALPHA = UPPERCASE_LETTERS

function decoyLetter(letter: string, rng: Rng): string {
  const skip = letter.toUpperCase()
  const choices = ALPHA.filter((item) => item !== skip)
  return withLetterCase(pickOne(choices, rng), letter)
}

function labelCells(letter: string, seed: number, width: number, density: number, cells: PuzzleCell[]): PuzzleCell[] {
  const plan = densityPlan(density, width)
  const rngLabels = mulberry32(seed ^ 0x9e3779b9)
  return cells.map((cell) => {
    const placement = ringsLabelPlacement(cell.rings, plan.labelSize, cell.bulges)
    return {
      ...cell,
      label: cell.isSolution ? letter : decoyLetter(letter, rngLabels),
      labelAnchor: placement.anchor,
      labelSize: placement.size,
    }
  })
}

export async function generatePuzzle(letter: string, density = DEFAULT_DENSITY): Promise<Puzzle> {
  if (!/^[A-Za-z]$/.test(letter)) {
    throw new Error('Only a single letter A–Z is allowed')
  }

  const level = clampDensity(density)
  const base = await loadBaseLetterShape(letter)
  const plan = densityPlan(level, base.width)
  const gridSeed = sliceSeedForLetter(letter)

  for (let attempt = 0; attempt < 8; attempt++) {
    const seed = attempt === 0 ? gridSeed : randomSeed()
    const pieces = sliceCanvas(base.outline, base.width, level, seed)
    const cells: PuzzleCell[] = pieces.map((piece, index) => ({
      id: `c${index}`,
      rings: piece.rings,
      bulges: piece.bulges,
      centroid: piece.centroid,
      labelAnchor: piece.centroid,
      label: '',
      isSolution: piece.isSolution,
      labelSize: plan.labelSize,
    }))

    const labeled = labelCells(letter, seed, base.width, level, cells)
    const solutionCount = labeled.filter((cell) => cell.isSolution).length
    if (labeled.length >= plan.minCells && solutionCount >= plan.minSolution) {
      return {
        letter,
        width: base.width,
        height: base.height,
        density: level,
        cells: labeled,
      }
    }
  }

  throw new Error('Could not build a puzzle. Please try again.')
}

export { sliceSolutionOnly, sliceSeedForLetter } from './sliceCanvas'
