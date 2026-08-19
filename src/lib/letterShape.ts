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

function markReachableBackground(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const reachable = new Uint8Array(width * height)
  const stack: number[] = []

  const tryPush = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const index = y * width + x
    if (pixels[index] === 1 || reachable[index] === 1) return
    reachable[index] = 1
    stack.push(index)
  }

  for (let x = 0; x < width; x++) {
    tryPush(x, 0)
    tryPush(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    tryPush(0, y)
    tryPush(width - 1, y)
  }

  while (stack.length > 0) {
    const index = stack.pop()
    if (index === undefined) break
    const x = index % width
    const y = (index / width) | 0
    tryPush(x + 1, y)
    tryPush(x - 1, y)
    tryPush(x, y + 1)
    tryPush(x, y - 1)
  }

  return reachable
}

function sealPinholes(pixels: Uint8Array, width: number, height: number): void {
  const dilated = new Uint8Array(pixels)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      if (pixels[i] === 1) continue
      if (
        pixels[i - 1] === 1 ||
        pixels[i + 1] === 1 ||
        pixels[i - width] === 1 ||
        pixels[i + width] === 1
      ) {
        dilated[i] = 1
      }
    }
  }
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      pixels[i] =
        dilated[i] === 1 &&
        dilated[i - 1] === 1 &&
        dilated[i + 1] === 1 &&
        dilated[i - width] === 1 &&
        dilated[i + width] === 1
          ? 1
          : 0
    }
  }
}

function buildHoleGrid(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const ink = new Uint8Array(pixels)
  sealPinholes(ink, width, height)
  const exterior = markReachableBackground(ink, width, height)
  const holeGrid = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    if (ink[i] === 0 && exterior[i] === 0) holeGrid[i] = 1
  }
  return holeGrid
}

/** Break narrow waist bridges (e.g. B, 8) so each counter becomes its own hole. */
function splitHoleBridges(holeGrid: Uint8Array, width: number, height: number): void {
  const rows: Array<{ y: number; minX: number; maxX: number; width: number }> = []
  for (let y = 0; y < height; y++) {
    let minX = width
    let maxX = -1
    for (let x = 0; x < width; x++) {
      if (!holeGrid[y * width + x]) continue
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
    }
    if (maxX >= minX) rows.push({ y, minX, maxX, width: maxX - minX + 1 })
  }
  if (rows.length < 5) return

  const maxWidth = Math.max(...rows.map((r) => r.width))
  const minWidth = Math.min(...rows.map((r) => r.width))
  if (minWidth >= maxWidth * 0.5) return

  const waistRows = rows.filter((r) => r.width <= minWidth * 1.2 + 6)
  for (const row of waistRows) {
    for (let x = row.minX; x <= row.maxX; x++) {
      holeGrid[row.y * width + x] = 0
    }
  }
}

function traceHoleComponents(
  pixels: Uint8Array,
  width: number,
  height: number,
  _outerRing: Point[],
): Point[][] {
  const minPixels = 800
  const holeGrid = buildHoleGrid(pixels, width, height)
  splitHoleBridges(holeGrid, width, height)

  const visited = new Uint8Array(width * height)
  const holes: Point[][] = []

  const isHole = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    return holeGrid[y * width + x] === 1
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x
      if (visited[start] || !isHole(x, y)) continue

      const component = new Uint8Array(width * height)
      let size = 0
      const queue: Point[] = [[x, y]]
      visited[start] = 1
      component[start] = 1
      size++

      while (queue.length > 0) {
        const [cx, cy] = queue.pop()!
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Point[]) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const ni = ny * width + nx
          if (visited[ni] || !isHole(nx, ny)) continue
          visited[ni] = 1
          component[ni] = 1
          size++
          queue.push([nx, ny])
        }
      }

      if (size < minPixels) continue

      const values = Array.from(component, (value) => (value ? 1 : 0))
      const traced = contours().size([width, height]).thresholds([0.5]).contour(values, 0.5)
      for (const polygon of traced.coordinates) {
        for (const ring of polygon) {
          const cleaned = uniqueRing(ring as Point[])
          if (cleaned.length < 4) continue
          const simplified = simplifyRing(cleaned, 1.1)
          if (uniqueRing(simplified).length >= 4) {
            holes.push(withWinding(simplified, false))
          }
        }
      }
    }
  }

  return holes
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

  const nested = nestRings(rings)
  return nested.map((polygon) => {
    const outerRing = uniqueRing(polygon[0] as Point[])
    if (outerRing.length < 4) return polygon
    const holes = traceHoleComponents(pixels, width, height, outerRing)
    return [polygon[0]!, ...holes.map((hole) => toPairRing(hole))]
  })
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
