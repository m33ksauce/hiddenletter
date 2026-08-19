import { contours } from 'd3-contour'
import polygonClipping from 'polygon-clipping'
import type { MultiPolygon, Polygon } from 'polygon-clipping'
import {
  closeRing,
  pointInPolygon,
  polygonArea,
  uniqueRing,
  withWinding,
} from './geometry'
import type { Point } from './types'

function perpendicularDistance(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return Math.hypot(point[0] - start[0], point[1] - start[1])
  return Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / length
}

function simplifyRing(ring: Point[], epsilon: number): Point[] {
  const open = uniqueRing(ring)
  if (open.length < 8) return closeRing(open)

  const first = open[0]
  const last = open[open.length - 1]
  if (!first || !last) return closeRing(open)

  let maxDist = 0
  let maxIndex = 0
  for (let i = 1; i < open.length - 1; i++) {
    const point = open[i]
    if (!point) continue
    const dist = perpendicularDistance(point, first, last)
    if (dist > maxDist) {
      maxDist = dist
      maxIndex = i
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyRing(open.slice(0, maxIndex + 1), epsilon)
    const right = simplifyRing(open.slice(maxIndex), epsilon)
    return closeRing([...uniqueRing(left), ...uniqueRing(right).slice(1)])
  }

  return closeRing([first, last])
}

function toPairRing(ring: Point[]): Array<[number, number]> {
  return closeRing(ring).map((point) => [point[0], point[1]])
}

function ringContainsRing(outer: Point[], inner: Point[]): boolean {
  const sample = uniqueRing(inner)[0]
  return Boolean(sample && pointInPolygon(sample, outer))
}

function nestRings(rings: Point[][]): MultiPolygon {
  const items = rings
    .map((ring) => ({ ring, area: polygonArea(ring) }))
    .filter((item) => item.area >= 10)
    .sort((a, b) => b.area - a.area)

  const parent = items.map(() => -1)
  for (let i = 0; i < items.length; i++) {
    const current = items[i]
    if (!current) continue
    for (let j = i - 1; j >= 0; j--) {
      const candidate = items[j]
      if (!candidate) continue
      if (ringContainsRing(candidate.ring, current.ring)) {
        parent[i] = j
        break
      }
    }
  }

  const depth = items.map((_, index) => {
    let count = 0
    let cursor = parent[index] ?? -1
    while (cursor !== -1 && count < 8) {
      count += 1
      cursor = parent[cursor] ?? -1
    }
    return count
  })

  const polygons: MultiPolygon = []
  for (let i = 0; i < items.length; i++) {
    if ((depth[i] ?? 0) % 2 !== 0) continue
    const outer = items[i]
    if (!outer) continue
    const holes: Polygon = []
    for (let j = i + 1; j < items.length; j++) {
      if (parent[j] !== i || (depth[j] ?? 0) % 2 === 0) continue
      const hole = items[j]
      if (!hole) continue
      const simplified = simplifyRing(hole.ring, 1.1)
      if (uniqueRing(simplified).length >= 4) {
        holes.push(toPairRing(withWinding(simplified, false)))
      }
    }
    const simplifiedOuter = simplifyRing(outer.ring, 1.6)
    if (uniqueRing(simplifiedOuter).length < 4) continue
    polygons.push([toPairRing(withWinding(simplifiedOuter, true)), ...holes])
  }

  return polygons
}

export function traceLetter(pixels: Uint8Array, width: number, height: number): MultiPolygon {
  const values = Array.from(pixels, (value) => value)
  const traced = contours().size([width, height]).smooth(true).contour(values, 0.5)
  const rings: Point[][] = []

  for (const polygon of traced.coordinates) {
    for (const ring of polygon) {
      const cleaned = uniqueRing(ring as Point[])
      if (cleaned.length >= 3) rings.push(cleaned)
    }
  }

  return nestRings(rings)
}

function asPolygons(result: MultiPolygon): Point[][][] {
  return result
    .map((polygon) =>
      polygon
        .map((ring) => uniqueRing(ring as Point[]))
        .filter((ring) => ring.length >= 3),
    )
    .filter((polygon) => (polygon[0]?.length ?? 0) >= 3)
}

export function splitCellByLetter(
  cell: Point[],
  letter: MultiPolygon,
): { inside: Point[][][]; outside: Point[][][] } {
  const subject: Polygon = [toPairRing(cell)]
  if (!letter.length) {
    return { inside: [], outside: [uniqueRing(cell)].filter((ring) => ring.length >= 3).map((ring) => [ring]) }
  }

  try {
    return {
      inside: asPolygons(polygonClipping.intersection(subject, letter)),
      outside: asPolygons(polygonClipping.difference(subject, letter)),
    }
  } catch {
    return { inside: [], outside: [uniqueRing(cell)].map((ring) => [ring]) }
  }
}

export function unionRings(a: Point[][], b: Point[][]): Point[][] | null {
  try {
    const result = polygonClipping.union(
      a.map((ring) => toPairRing(ring)),
      b.map((ring) => toPairRing(ring)),
    )
    const polygons = asPolygons(result)
    const first = polygons[0]
    if (polygons.length === 1 && first) return first
    return null
  } catch {
    return null
  }
}
