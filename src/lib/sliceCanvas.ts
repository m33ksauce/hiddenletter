import type { MultiPolygon } from 'polygon-clipping'
import { buildCurveVoronoiMesh } from './curveVoronoiMesh'
import { densityPlan } from './difficulty'
import {
  cellLabelFits,
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

function mergeIntoNearest(items: Fragment[], tiny: Fragment): boolean {
  let neighborIndex = -1
  let bestDistance = Infinity
  for (let i = 0; i < items.length; i++) {
    const other = items[i]
    if (!other || other === tiny || other.isSolution !== tiny.isSolution) continue
    const distance = dist2(tiny.centroid, other.centroid)
    if (distance < bestDistance) {
      bestDistance = distance
      neighborIndex = i
    }
  }
  if (neighborIndex < 0) return false
  const neighbor = items[neighborIndex]
  if (!neighbor) return false
  const united = unionRings(tiny.rings, neighbor.rings)
  if (!united) return false
  const merged = toFragment(united, tiny.isSolution)
  if (!merged) return false
  const tinyIndex = items.indexOf(tiny)
  const high = Math.max(tinyIndex, neighborIndex)
  const low = Math.min(tinyIndex, neighborIndex)
  items.splice(high, 1)
  items.splice(low, 1)
  items.push(merged)
  return true
}

/** Fold clipping slivers and edge specks into a neighbor so every tile can show a label. */
function mergeUnlabelable(fragments: Fragment[], labelSize: number): Fragment[] {
  const items = fragments.filter((fragment) => fragment.area >= 8)
  const skipped = new Set<Fragment>()

  for (let pass = 0; pass < items.length + 8; pass++) {
    let badIndex = -1
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item || skipped.has(item)) continue
      if (cellLabelFits(item.rings, labelSize, item.bulges)) continue
      if (badIndex < 0 || item.area < (items[badIndex]?.area ?? Infinity)) {
        badIndex = i
      }
    }
    if (badIndex < 0) break

    const tiny = items[badIndex]
    if (!tiny) break

    const candidates: Array<{ index: number; distance: number }> = []
    for (let i = 0; i < items.length; i++) {
      if (i === badIndex) continue
      const other = items[i]
      if (!other || other.isSolution !== tiny.isSolution) continue
      if (!ringsNearlyTouch(tiny.rings, other.rings, 6)) continue
      candidates.push({ index: i, distance: dist2(tiny.centroid, other.centroid) })
    }
    candidates.sort((a, b) => a.distance - b.distance)

    let merged = false
    for (const candidate of candidates) {
      const neighbor = items[candidate.index]
      if (!neighbor) continue
      const united = unionRings(tiny.rings, neighbor.rings)
      if (!united) continue
      const next = toFragment(united, tiny.isSolution)
      if (!next) continue
      const high = Math.max(badIndex, candidate.index)
      const low = Math.min(badIndex, candidate.index)
      items.splice(high, 1)
      items.splice(low, 1)
      items.push(next)
      merged = true
      break
    }

    if (merged) continue

    if (mergeIntoNearest(items, tiny)) continue

    skipped.add(tiny)
  }

  return items.filter((item) => cellLabelFits(item.rings, labelSize, item.bulges))
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

  const solution = mergeUnlabelable(
    pieces.filter((piece) => piece.isSolution),
    plan.labelSize,
  )
  const decoys = mergeUnlabelable(
    mergeFragments(
      pieces.filter((piece) => !piece.isSolution),
      plan.mergeBelow * 0.35,
    ),
    plan.labelSize,
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
