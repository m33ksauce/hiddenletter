import type { Point } from './types'

export function dist2(a: Point, b: Point): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

function ringBounds(ring: Point[]): [number, number, number, number] | null {
  const first = ring[0]
  if (!first) return null
  let minX = first[0]
  let minY = first[1]
  let maxX = first[0]
  let maxY = first[1]
  for (let i = 1; i < ring.length; i++) {
    const point = ring[i]
    if (!point) continue
    minX = Math.min(minX, point[0])
    minY = Math.min(minY, point[1])
    maxX = Math.max(maxX, point[0])
    maxY = Math.max(maxY, point[1])
  }
  return [minX, minY, maxX, maxY]
}

export function ringsNearlyTouch(a: Point[][], b: Point[][], slack = 4): boolean {
  const ringA = a[0]
  const ringB = b[0]
  if (!ringA || !ringB) return false
  const boxA = ringBounds(ringA)
  const boxB = ringBounds(ringB)
  if (!boxA || !boxB) return false
  if (boxA[2] + slack < boxB[0] || boxB[2] + slack < boxA[0]) return false
  if (boxA[3] + slack < boxB[1] || boxB[3] + slack < boxA[1]) return false

  const limit = slack * slack
  for (const pointA of ringA) {
    for (const pointB of ringB) {
      if (dist2(pointA, pointB) <= limit) return true
    }
  }
  return false
}

export function signedArea(polygon: Point[]): number {
  let area = 0
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const current = polygon[i]
    const previous = polygon[j]
    if (!current || !previous) continue
    area += previous[0] * current[1] - current[0] * previous[1]
  }
  return area / 2
}

export function ringsArea(rings: Point[][]): number {
  const outer = rings[0]
  if (!outer) return 0
  let area = polygonArea(outer)
  for (let i = 1; i < rings.length; i++) {
    const hole = rings[i]
    if (hole) area -= polygonArea(hole)
  }
  return Math.max(0, area)
}

export function polygonCentroid(polygon: Point[]): Point {
  let x = 0
  let y = 0
  let areaTwice = 0

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const current = polygon[i]
    const previous = polygon[j]
    if (!current || !previous) continue
    const cross = previous[0] * current[1] - current[0] * previous[1]
    areaTwice += cross
    x += (previous[0] + current[0]) * cross
    y += (previous[1] + current[1]) * cross
  }

  if (Math.abs(areaTwice) < 1e-6) {
    let sx = 0
    let sy = 0
    for (const point of polygon) {
      sx += point[0]
      sy += point[1]
    }
    const n = Math.max(polygon.length, 1)
    return [sx / n, sy / n]
  }

  return [x / (3 * areaTwice), y / (3 * areaTwice)]
}

export function polygonArea(polygon: Point[]): number {
  return Math.abs(signedArea(polygon))
}

export function withWinding(polygon: Point[], positive: boolean): Point[] {
  const open = uniqueRing(polygon)
  const area = signedArea(open)
  if (area === 0) return closeRing(open)
  if (area > 0 === positive) return closeRing(open)
  return closeRing([...open].reverse())
}

export function uniqueRing(polygon: Point[]): Point[] {
  if (polygon.length < 2) return polygon
  const first = polygon[0]
  const last = polygon[polygon.length - 1]
  if (!first || !last) return polygon
  if (first[0] === last[0] && first[1] === last[1]) {
    return polygon.slice(0, -1)
  }
  return polygon
}

export function closeRing(polygon: Point[]): Point[] {
  const unique = uniqueRing(polygon)
  const first = unique[0]
  if (!first || unique.length < 3) return unique
  return [...unique, [first[0], first[1]]]
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const current = polygon[i]
    const previous = polygon[j]
    if (!current || !previous) continue
    const [xi, yi] = current
    const [xj, yj] = previous
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function pointInRings(point: Point, rings: Point[][]): boolean {
  const outer = rings[0]
  if (!outer || !pointInPolygon(point, outer)) return false
  for (let i = 1; i < rings.length; i++) {
    const hole = rings[i]
    if (hole && pointInPolygon(point, hole)) return false
  }
  return true
}

/** Point inside the letter solid (outer boundary minus holes). */
export function pointInLetterSolid(point: Point, letterRings: Point[][]): boolean {
  return pointInRings(point, letterRings)
}

export function ringsCentroid(rings: Point[][]): Point {
  const outer = rings[0]
  if (!outer) return [0, 0]
  const guess = polygonCentroid(outer)
  if (pointInRings(guess, rings)) return guess

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of outer) {
    minX = Math.min(minX, point[0])
    minY = Math.min(minY, point[1])
    maxX = Math.max(maxX, point[0])
    maxY = Math.max(maxY, point[1])
  }

  const steps = 8
  for (let row = 1; row < steps; row++) {
    for (let col = 1; col < steps; col++) {
      const candidate: Point = [
        minX + ((maxX - minX) * col) / steps,
        minY + ((maxY - minY) * row) / steps,
      ]
      if (pointInRings(candidate, rings)) return candidate
    }
  }

  return guess
}

function pointToSegmentDist(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2))
  const q: Point = [a[0] + dx * t, a[1] + dy * t]
  return Math.hypot(point[0] - q[0], point[1] - q[1])
}

function ringsBoundary(rings: Point[][], bulges?: number[]): Point[][] {
  const boundary: Point[][] = []
  const outer = rings[0]
  if (outer) {
    const corners = uniqueRing(outer)
    if (bulges && corners.length === 4 && bulges.length === 4) {
      boundary.push(sampleQuadRing(corners, bulges, 10))
    } else {
      boundary.push(corners)
    }
  }
  for (let i = 1; i < rings.length; i++) {
    const hole = rings[i]
    if (hole) boundary.push(uniqueRing(hole))
  }
  return boundary
}

function minDistToBoundary(point: Point, boundary: Point[][]): number {
  let min = Infinity
  for (const ring of boundary) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      if (!a || !b) continue
      min = Math.min(min, pointToSegmentDist(point, a, b))
    }
  }
  return min
}

function bestInteriorPoint(rings: Point[][], boundary: Point[][]): Point {
  const outer = rings[0]
  if (!outer) return [0, 0]

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of outer) {
    minX = Math.min(minX, point[0])
    minY = Math.min(minY, point[1])
    maxX = Math.max(maxX, point[0])
    maxY = Math.max(maxY, point[1])
  }

  let best = ringsCentroid(rings)
  let bestDist = minDistToBoundary(best, boundary)

  const search = (steps: number, cx: number, cy: number, halfW: number, halfH: number) => {
    for (let row = 0; row <= steps; row++) {
      for (let col = 0; col <= steps; col++) {
        const candidate: Point = [cx - halfW + ((2 * halfW * col) / steps), cy - halfH + ((2 * halfH * row) / steps)]
        if (!pointInRings(candidate, rings)) continue
        const dist = minDistToBoundary(candidate, boundary)
        if (dist > bestDist) {
          bestDist = dist
          best = candidate
        }
      }
    }
  }

  search(14, (minX + maxX) / 2, (minY + maxY) / 2, (maxX - minX) / 2, (maxY - minY) / 2)
  const refine = Math.min(maxX - minX, maxY - minY) / 14
  search(10, best[0], best[1], refine, refine)
  return best
}

/** Place a single-character label fully inside the piece, away from cut edges. */
export function ringsLabelPlacement(
  rings: Point[][],
  labelSize: number,
  bulges?: number[],
): { anchor: Point; size: number } {
  const boundary = ringsBoundary(rings, bulges)
  const anchor = bestInteriorPoint(rings, boundary)
  const inset = minDistToBoundary(anchor, boundary)
  const strokePad = 8
  const size = Math.min(labelSize, Math.max(0, (inset - strokePad) * 2))
  return { anchor, size }
}

export function quadArea(corners: Point[]): number {
  if (corners.length < 3) return 0
  let area = 0
  for (let i = 0; i < corners.length; i++) {
    const current = corners[i]
    const next = corners[(i + 1) % corners.length]
    if (!current || !next) continue
    area += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(area / 2)
}

export function quadCentroid(corners: Point[]): Point {
  let x = 0
  let y = 0
  for (const point of corners) {
    x += point[0]
    y += point[1]
  }
  const n = Math.max(corners.length, 1)
  return [x / n, y / n]
}

function quadEdgeControl(a: Point, b: Point, bulge: number): Point {
  const mx = (a[0] + b[0]) / 2
  const my = (a[1] + b[1]) / 2
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  return [mx + (-dy / len) * len * bulge, my + (dx / len) * len * bulge]
}

function quadBezierPoint(a: Point, control: Point, b: Point, t: number): Point {
  const u = 1 - t
  return [
    u * u * a[0] + 2 * u * t * control[0] + t * t * b[0],
    u * u * a[1] + 2 * u * t * control[1] + t * t * b[1],
  ]
}

export function sampleQuadRing(corners: Point[], bulges: number[], segments = 5): Point[] {
  const ring: Point[] = []
  const n = corners.length
  if (n < 3) return corners

  for (let i = 0; i < n; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % n]
    if (!a || !b) continue
    const bulge = bulges[i] ?? 0
    if (Math.abs(bulge) < 0.012) {
      if (ring.length === 0 || dist2(ring[ring.length - 1]!, a) > 1) ring.push(a)
      continue
    }
    const control = quadEdgeControl(a, b, bulge)
    for (let step = 0; step < segments; step++) {
      const point = quadBezierPoint(a, control, b, step / segments)
      if (ring.length === 0 || dist2(ring[ring.length - 1]!, point) > 0.5) ring.push(point)
    }
  }

  return closeRing(uniqueRing(ring))
}

export function quadToPath(corners: Point[], bulges: number[]): string {
  const n = corners.length
  if (n < 3) return polygonToPath(corners)

  let path = ''
  for (let i = 0; i < n; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % n]
    if (!a || !b) continue
    if (i === 0) path += `M${a[0].toFixed(2)} ${a[1].toFixed(2)}`

    const bulge = bulges[i] ?? 0
    if (Math.abs(bulge) < 0.012) {
      path += ` L${b[0].toFixed(2)} ${b[1].toFixed(2)}`
      continue
    }

    const control = quadEdgeControl(a, b, bulge)
    path += ` Q${control[0].toFixed(2)} ${control[1].toFixed(2)} ${b[0].toFixed(2)} ${b[1].toFixed(2)}`
  }

  return `${path} Z`
}

export function polygonToPath(polygon: Point[]): string {
  if (polygon.length === 0) return ''
  const parts = polygon.map((point, index) => {
    const command = index === 0 ? 'M' : 'L'
    return `${command}${point[0].toFixed(2)} ${point[1].toFixed(2)}`
  })
  return `${parts.join(' ')} Z`
}

export function cellToPath(rings: Point[][], bulges?: number[]): string {
  const outer = rings[0]
  const corners = outer ? uniqueRing(outer) : []
  if (
    bulges &&
    (corners.length === 3 || corners.length === 4) &&
    bulges.length === corners.length
  ) {
    return quadToPath(corners, bulges)
  }
  return ringsToPath(rings)
}

export function ringsToPath(rings: Point[][]): string {
  return rings.map(polygonToPath).join(' ')
}
