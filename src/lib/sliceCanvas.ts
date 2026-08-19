import type { MultiPolygon } from 'polygon-clipping'
import { buildCurveVoronoiMesh } from './curveVoronoiMesh'
import { densityPlan } from './difficulty'
import {
  dist2,
  ringsArea,
  ringsCentroid,
  ringsNearlyTouch,
} from './geometry'
import { unionRings } from './letterShape'
import type { Point } from './types'

export type SlicePiece = {
  rings: Point[][]
  bulges?: number[]
  isSolution: boolean
  area: number
  centroid: Point
}

type Fragment = SlicePiece

function toFragment(
  rings: Point[][],
  isSolution: boolean,
  bulges?: number[],
): Fragment | null {
  const area = ringsArea(rings)
  if (area < 8) return null
  return {
    rings,
    bulges,
    isSolution,
    area,
    centroid: ringsCentroid(rings),
  }
}

function mergeFragments(fragments: Fragment[], minKeep: number): Fragment[] {
  const items = fragments.filter((fragment) => fragment.area >= 8)
  const skipped = new Set<Fragment>()

  for (let pass = 0; pass < items.length + 8; pass++) {
    let tinyIndex = -1
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item || skipped.has(item) || item.area >= minKeep) continue
      if (tinyIndex < 0 || item.area < (items[tinyIndex]?.area ?? Infinity)) {
        tinyIndex = i
      }
    }
    if (tinyIndex < 0) break

    const tiny = items[tinyIndex]
    if (!tiny) break

    const candidates: Array<{ index: number; distance: number }> = []
    for (let i = 0; i < items.length; i++) {
      if (i === tinyIndex) continue
      const other = items[i]
      if (!other || other.isSolution !== tiny.isSolution) continue
      if (!ringsNearlyTouch(tiny.rings, other.rings, 4)) continue
      candidates.push({ index: i, distance: dist2(tiny.centroid, other.centroid) })
    }
    candidates.sort((a, b) => a.distance - b.distance)

    let merged: Fragment | null = null
    let neighborIndex = -1
    for (const candidate of candidates) {
      const neighbor = items[candidate.index]
      if (!neighbor) continue
      const united = unionRings(tiny.rings, neighbor.rings)
      if (!united) continue
      const next = toFragment(united, tiny.isSolution)
      if (!next) continue
      merged = next
      neighborIndex = candidate.index
      break
    }

    if (!merged || neighborIndex < 0) {
      skipped.add(tiny)
      continue
    }

    const high = Math.max(tinyIndex, neighborIndex)
    const low = Math.min(tinyIndex, neighborIndex)
    items.splice(high, 1)
    items.splice(low, 1)
    items.push(merged)
  }

  return items
}

export function sliceCanvas(
  outline: MultiPolygon,
  size: number,
  density: number,
  seed: number,
): SlicePiece[] {
  const plan = densityPlan(density, size)
  const pieces = buildCurveVoronoiMesh(outline, size, density, seed).map((piece) => ({
    rings: piece.rings,
    isSolution: piece.isSolution,
    area: piece.area,
    centroid: piece.centroid,
  }))

  const solution = pieces.filter((piece) => piece.isSolution)
  const decoys = mergeFragments(
    pieces.filter((piece) => !piece.isSolution),
    plan.mergeBelow * 0.35,
  )
  return [...solution, ...decoys]
}

export function sliceSolutionOnly(
  outline: MultiPolygon,
  size: number,
  density: number,
  seed: number,
): SlicePiece[] {
  return buildCurveVoronoiMesh(outline, size, density, seed)
    .filter((piece) => piece.isSolution)
    .map((piece) => ({
      rings: piece.rings,
      isSolution: true,
      area: piece.area,
      centroid: piece.centroid,
    }))
}

/** Fixed seed per letter so the grid is stable while density changes piece count. */
export function sliceSeedForLetter(letter: string): number {
  let hash = 0
  for (let i = 0; i < letter.length; i++) {
    hash = (hash * 31 + letter.charCodeAt(i)) >>> 0
  }
  return hash || 1
}
