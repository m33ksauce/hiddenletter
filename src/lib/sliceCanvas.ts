import type { MultiPolygon } from 'polygon-clipping'
import { densityPlan } from './difficulty'
import {
  dist2,
  ringsArea,
  ringsCentroid,
  ringsNearlyTouch,
  sampleQuadRing,
} from './geometry'
import { buildLetterQuads, partitionRings } from './letterQuadMesh'
import { splitCellByLetter, unionRings } from './letterShape'
import { buildQuadGrid } from './quadGrid'
import { mulberry32 } from './rng'
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

function quadBox(corners: Point[]) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const point of corners) {
    x0 = Math.min(x0, point[0])
    y0 = Math.min(y0, point[1])
    x1 = Math.max(x1, point[0])
    y1 = Math.max(y1, point[1])
  }
  return { x0, y0, x1, y1 }
}

function buildExteriorPieces(
  outline: MultiPolygon,
  size: number,
  density: number,
  seed: number,
  targetCount: number,
): Fragment[] {
  const plan = densityPlan(density, size)
  const rng = mulberry32(seed)
  const quads = buildQuadGrid(size, targetCount, rng)
  const partitionTarget = Math.max(
    plan.targetArea,
    (size * size) / Math.max(4, targetCount * 0.95),
  )
  const fragments: Fragment[] = []

  for (const quad of quads) {
    const cell = sampleQuadRing(quad.corners, quad.bulges, 6)
    const { outside } = splitCellByLetter(cell, outline)
    const box = quadBox(quad.corners)

    for (const rings of outside) {
      const parts = partitionRings(rings, box, partitionTarget, size, rng)
      for (const part of parts) {
        const fragment = toFragment(part.rings, false)
        if (fragment) fragments.push(fragment)
      }
    }
  }

  return fragments
}

export function sliceCanvas(
  outline: MultiPolygon,
  size: number,
  density: number,
  seed: number,
): SlicePiece[] {
  const plan = densityPlan(density, size)

  const solutionFragments: Fragment[] = buildLetterQuads(outline, size, density, seed).map((quad) => ({
    rings: quad.rings,
    isSolution: true,
    area: quad.area,
    centroid: ringsCentroid(quad.rings),
  }))

  const decoyTarget = Math.max(4, plan.siteCount - solutionFragments.length)
  const exteriorFragments = mergeFragments(
    buildExteriorPieces(outline, size, density, seed, decoyTarget),
    plan.mergeBelow * 0.35,
  )
  return [...solutionFragments, ...exteriorFragments]
}

export function sliceSolutionOnly(
  outline: MultiPolygon,
  size: number,
  density: number,
  seed: number,
): SlicePiece[] {
  return buildLetterQuads(outline, size, density, seed).map((quad) => ({
    rings: quad.rings,
    isSolution: true,
    area: quad.area,
    centroid: ringsCentroid(quad.rings),
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
