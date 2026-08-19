import polygonClipping from 'polygon-clipping'
import type { MultiPolygon, Polygon } from 'polygon-clipping'
import { clampDensity, densityPlan } from './difficulty'
import { closeRing, dist2, polygonArea, ringsArea, ringsCentroid, ringsNearlyTouch, uniqueRing } from './geometry'
import { unionRings } from './letterShape'
import { mulberry32, type Rng } from './rng'
import type { Point } from './types'

/**
 * First principles:
 * 1. The letter is a filled silhouette (holes stay empty).
 * 2. Slice each stroke across its short axis (local width). Cuts stay about as
 *    long as the stroke is thick — not chords across the whole letter.
 * 3. Each piece spans edge-to-edge across that width (outline to outline, or a
 *    hole). Never split a stroke sideways into tiles that only touch one edge.
 * 4. Fold specks into a neighbor. Do not rewrite corners, bulges, or side counts.
 * 5. Replace jagged (zigzag, low-amplitude) runs with a straight edge. Keep real curves.
 */
export type LetterQuad = {
  rings: Point[][]
  area: number
  box?: Box
}

export type Box = { x0: number; y0: number; x1: number; y1: number }

type Brick = [Point, Point, Point, Point]

function toPairRing(ring: Point[]): Array<[number, number]> {
  return closeRing(ring).map((point) => [point[0], point[1]] as [number, number])
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

function ringsBox(rings: Point[][]): Box {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const ring of rings) {
    for (const point of ring) {
      x0 = Math.min(x0, point[0])
      y0 = Math.min(y0, point[1])
      x1 = Math.max(x1, point[0])
      y1 = Math.max(y1, point[1])
    }
  }
  return { x0, y0, x1, y1 }
}

function clipWith(poly: Point[], geom: MultiPolygon | Polygon): Point[][][] {
  const shape: Polygon = [toPairRing(poly)]
  try {
    return asPolygons(polygonClipping.intersection(geom, shape))
  } catch {
    return []
  }
}

function clipRings(rings: Point[][], poly: Point[]): Point[][][] {
  return clipWith(
    poly,
    rings.map((ring) => toPairRing(ring)),
  )
}

function projectToSegment(point: Point, a: Point, b: Point): { q: Point; dist: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2))
  const q: Point = [a[0] + dx * t, a[1] + dy * t]
  return { q, dist: Math.hypot(point[0] - q[0], point[1] - q[1]) }
}

function snapToBrick(point: Point, brick: Brick, eps: number): Point {
  let best = point
  let bestDist = eps + 1
  for (let i = 0; i < 4; i++) {
    const a = brick[i]
    const b = brick[(i + 1) % 4]
    if (!a || !b) continue
    const hit = projectToSegment(point, a, b)
    if (hit.dist < bestDist) {
      bestDist = hit.dist
      best = hit.q
    }
  }
  return bestDist <= eps ? best : point
}

function colinear(a: Point, b: Point, c: Point, eps: number): boolean {
  const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
  const span = Math.hypot(c[0] - a[0], c[1] - a[1])
  return area2 <= eps * Math.max(1, span)
}

type CutLine = { origin: Point; dir: Point }

function snapToCutLine(point: Point, line: CutLine, eps: number): Point {
  const dx = point[0] - line.origin[0]
  const dy = point[1] - line.origin[1]
  const along = dx * line.dir[0] + dy * line.dir[1]
  if (along < -eps) return point
  const perp = Math.abs(-dx * line.dir[1] + dy * line.dir[0])
  if (perp > eps) return point
  return [line.origin[0] + line.dir[0] * along, line.origin[1] + line.dir[1] * along]
}

function cutLinesFromBrick(brick: Brick): CutLine[] {
  const lines: CutLine[] = []
  // Short-axis cuts between bands — edges 1-2 and 3-0.
  for (const [i, j] of [
    [1, 2],
    [3, 0],
  ] as const) {
    const a = brick[i]
    const b = brick[j]
    if (!a || !b) continue
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    lines.push({ origin: a, dir: [dx / len, dy / len] })
  }
  return lines
}

function cutLinesFromWedge(center: Point, a0: number, a1: number): CutLine[] {
  return [
    { origin: center, dir: unitAt(a0) },
    { origin: center, dir: unitAt(a1) },
  ]
}

function pointOnLine(line: CutLine, along: number): Point {
  return [line.origin[0] + line.dir[0] * along, line.origin[1] + line.dir[1] * along]
}

function nearCutLine(point: Point, line: CutLine, eps: number): boolean {
  const dx = point[0] - line.origin[0]
  const dy = point[1] - line.origin[1]
  const perp = Math.abs(-dx * line.dir[1] + dy * line.dir[0])
  const along = dx * line.dir[0] + dy * line.dir[1]
  return perp <= eps * 1.15 && along >= -eps
}

function segmentRayHit(a: Point, b: Point, line: CutLine): number | null {
  const rx = b[0] - a[0]
  const ry = b[1] - a[1]
  const sx = a[0] - line.origin[0]
  const sy = a[1] - line.origin[1]
  const den = rx * line.dir[1] - ry * line.dir[0]
  if (Math.abs(den) < 1e-9) return null
  const u = (sx * line.dir[1] - sy * line.dir[0]) / den
  const t = (sx * ry - sy * rx) / den
  if (u < -0.01 || u > 1.01 || t < 0) return null
  return t
}

function rayRingTs(ring: Point[], line: CutLine): number[] {
  const ts: number[] = []
  const pts = uniqueRing(ring)
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    if (!a || !b) continue
    const hit = segmentRayHit(a, b, line)
    if (hit !== null) ts.push(hit)
  }
  return ts
}

function cutLineExtents(
  ring: Point[],
  line: CutLine,
  eps: number,
  minAlong = 0,
): [number, number] | null {
  const ts = rayRingTs(ring, line)
  for (const point of uniqueRing(ring)) {
    if (nearCutLine(point, line, eps)) {
      const dx = point[0] - line.origin[0]
      const dy = point[1] - line.origin[1]
      ts.push(dx * line.dir[0] + dy * line.dir[1])
    }
  }
  const filtered = ts.filter((t) => t >= minAlong)
  if (filtered.length < 2) return null
  return [Math.min(...filtered), Math.max(...filtered)]
}

function brickCutExtents(brick: Brick, line: CutLine): [number, number] | null {
  const ts: number[] = []
  for (const [i, j] of [
    [0, 1],
    [2, 3],
  ] as const) {
    const a = brick[i]
    const b = brick[j]
    if (!a || !b) continue
    const hit = segmentRayHit(a, b, line)
    if (hit !== null) ts.push(hit)
  }
  if (ts.length < 2) return null
  return [Math.min(...ts), Math.max(...ts)]
}

function targetCutSpan(
  line: CutLine,
  ring: Point[],
  brick: Brick | null,
  eps: number,
): [number, number] | null {
  const snapEps = eps * 2.8
  const local = brick
    ? cutLineExtents(ring, line, snapEps)
    : cutLineExtents(ring, line, snapEps, eps * 1.2)
  if (!brick) return local
  const guide = brickCutExtents(brick, line)
  if (!local && !guide) return null
  if (!guide) return local
  if (!local) return guide
  const [l0, l1] = local
  const [g0, g1] = guide
  return [Math.min(l0, g0), Math.max(l1, g1)]
}

function edgeNearCutLine(a: Point, b: Point, line: CutLine, eps: number): boolean {
  const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  return nearCutLine(a, line, eps) || nearCutLine(b, line, eps) || nearCutLine(mid, line, eps)
}

/** Replace jagged band-cut runs with one straight edge; skip if topology would break. */
function straightenCutEdges(
  ring: Point[],
  lines: CutLine[],
  brick: Brick | null,
  eps: number,
): Point[] {
  const snapEps = eps * 2.8
  let out = uniqueRing(ring)
  if (out.length < 3) return out
  const beforeArea = Math.abs(polygonArea(out))

  for (const line of lines) {
    const span = targetCutSpan(line, out, brick, eps)
    if (!span) continue
    const [t0, t1] = span
    if (t1 - t0 < 6) continue
    if (!brick && t0 < eps * 1.2) continue
    const p0 = pointOnLine(line, t0)
    const p1 = pointOnLine(line, t1)

    const flagged = out.map((point, index) => {
      const next = out[(index + 1) % out.length]
      if (!next) return nearCutLine(point, line, snapEps)
      return edgeNearCutLine(point, next, line, snapEps)
    })
    if (flagged.filter(Boolean).length < 2) continue

    const next: Point[] = []
    let i = 0
    while (i < out.length) {
      if (!flagged[i]) {
        next.push(out[i]!)
        i += 1
        continue
      }
      let j = i
      while (j < out.length && flagged[j]) j += 1
      const prev = next[next.length - 1]
      const after = out[j % out.length]
      const dPrev0 = prev ? dist2(prev, p0) : Infinity
      const dPrev1 = prev ? dist2(prev, p1) : Infinity
      const dAfter0 = after ? dist2(after, p0) : Infinity
      const dAfter1 = after ? dist2(after, p1) : Infinity
      const first = dPrev0 + dAfter1 <= dPrev1 + dAfter0 ? p0 : p1
      const second = first === p0 ? p1 : p0
      if (!prev || dist2(prev, first) > 0.8) next.push(first)
      if (dist2(next[next.length - 1]!, second) > 0.8) next.push(second)
      i = j
    }

    if (next.length < 3) continue
    const nextArea = Math.abs(polygonArea(next))
    if (nextArea < beforeArea * 0.88) continue
    out = uniqueRing(next)
  }

  return out
}

function nudgeRadialEndpoints(ring: Point[], lines: CutLine[], eps: number): Point[] {
  const snapEps = eps * 3.6
  let out = uniqueRing(ring)
  for (const line of lines) {
    const span = cutLineExtents(out, line, snapEps, eps * 1.2)
    if (!span) continue
    const [t0, t1] = span
    if (t1 - t0 < 6) continue
    out = out.map((point) => {
      if (!nearCutLine(point, line, snapEps)) return point
      const dx = point[0] - line.origin[0]
      const dy = point[1] - line.origin[1]
      const t = dx * line.dir[0] + dy * line.dir[1]
      if (t <= t0 + snapEps * 0.5) return pointOnLine(line, t0)
      if (t >= t1 - snapEps * 0.5) return pointOnLine(line, t1)
      return snapToCutLine(point, line, snapEps)
    })
  }
  return out
}

function tidyRing(ring: Point[], brick: Brick | null, cutLines: CutLine[], eps: number): Point[] {
  const snapEps = cutLines.length > 0 && !brick ? eps * 3.6 : eps * 2.2
  const snapped = uniqueRing(ring).map((point) => {
    for (const line of cutLines) {
      const hit = snapToCutLine(point, line, snapEps)
      if (hit !== point) return hit
    }
    return brick ? snapToBrick(point, brick, snapEps) : point
  })
  const collapsed: Point[] = []
  for (const point of snapped) {
    if (collapsed.length >= 2) {
      const a = collapsed[collapsed.length - 2]
      const b = collapsed[collapsed.length - 1]
      if (a && b && colinear(a, b, point, 2.4)) collapsed.pop()
    }
    const last = collapsed[collapsed.length - 1]
    if (!last || dist2(last, point) > 0.8) collapsed.push(point)
  }
  return collapsed
}

function maxChordDist(pts: Point[], start: number, count: number): number {
  const n = pts.length
  const a = pts[start]
  const b = pts[(start + count - 1) % n]
  if (!a || !b) return Infinity
  let maxDist = 0
  for (let step = 1; step < count - 1; step++) {
    const point = pts[(start + step) % n]
    if (!point) continue
    maxDist = Math.max(maxDist, projectToSegment(point, a, b).dist)
  }
  return maxDist
}

/** Greedy: eat every near-straight run into one edge. Letter arcs sit farther from the chord, so they stay. */
function straightenJagged(ring: Point[]): Point[] {
  const pts = uniqueRing(ring)
  const n = pts.length
  if (n < 4) return pts

  const keep = Array.from({ length: n }, () => true)

  let i = 0
  while (i < n) {
    if (!keep[i]) {
      i += 1
      continue
    }
    let bestCount = 0
    for (let count = 3; count < n - 1; count++) {
      const a = pts[i]
      const b = pts[(i + count - 1) % n]
      if (!a || !b) break
      const chord = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (chord < 8) continue
      const amp = Math.max(6, Math.min(11, chord * 0.07))
      if (maxChordDist(pts, i, count) > amp) break
      bestCount = count
    }
    if (bestCount >= 3) {
      for (let step = 1; step < bestCount - 1; step++) keep[(i + step) % n] = false
      i += bestCount - 1
    } else {
      i += 1
    }
  }

  const out = pts.filter((_, index) => keep[index])
  return out.length >= 3 ? out : pts
}

function emitPiece(
  rings: Point[][],
  brick: Brick | null,
  eps: number,
  cutLines: CutLine[] = [],
): LetterQuad | null {
  const lines = cutLines.length > 0 ? cutLines : brick ? cutLinesFromBrick(brick) : []
  const tidied = rings
    .map((ring) => {
      let base = tidyRing(ring, brick, lines, eps)
      if (brick && lines.length > 0) base = straightenCutEdges(base, lines, brick, eps)
      else if (lines.length > 0) base = nudgeRadialEndpoints(base, lines, eps)
      if (brick) base = straightenJagged(base)
      return base
    })
    .filter((ring) => ring.length >= 3)
  if (!tidied[0]) return null
  const area = ringsArea(tidied)
  if (area < 8) return null
  return { rings: tidied, area, box: ringsBox(tidied) }
}

function irregularStops(count: number, start: number, end: number, rng: Rng): number[] {
  const weights = Array.from({ length: count }, () => 0.48 + rng() * 1.05)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const stops = [start]
  let cursor = start
  const span = end - start
  for (let i = 0; i < count; i++) {
    cursor += ((weights[i] ?? 1) / total) * span
    stops.push(cursor)
  }
  stops[stops.length - 1] = end
  return stops
}

function unitAt(angle: number): Point {
  return [Math.cos(angle), Math.sin(angle)]
}

function projectPoint(point: Point, normal: Point): number {
  return point[0] * normal[0] + point[1] * normal[1]
}

/** Strip between two cut lines — wide enough to cover the letter, never subdivided sideways. */
function stripBrick(n0: Point, d0: number, n1: Point, d1: number, reach: number): Brick {
  const c0: Point = [n0[0] * d0, n0[1] * d0]
  const c1: Point = [n1[0] * d1, n1[1] * d1]
  const tx0 = -n0[1]
  const ty0 = n0[0]
  const tx1 = -n1[1]
  const ty1 = n1[0]
  return [
    [c0[0] - tx0 * reach, c0[1] - ty0 * reach],
    [c0[0] + tx0 * reach, c0[1] + ty0 * reach],
    [c1[0] + tx1 * reach, c1[1] + ty1 * reach],
    [c1[0] - tx1 * reach, c1[1] - ty1 * reach],
  ]
}

function projectRing(ring: Point[], axis: Point): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const point of ring) {
    const value = projectPoint(point, axis)
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  return [min, max]
}

function polygonReach(rings: Point[][]): number {
  const box = ringsBox(rings)
  return Math.hypot(box.x1 - box.x0, box.y1 - box.y0) * 0.55
}

function clipSlab(rings: Point[][], n: Point, d0: number, d1: number, reach: number): Point[][][] {
  return clipRings(rings, stripBrick(n, d0, n, d1, reach))
}

function wedgePoly(center: Point, a0: number, a1: number, reach: number): Point[] {
  let span = a1 - a0
  while (span < 0) span += Math.PI * 2
  while (span > Math.PI) {
    const mid = a0 + span / 2
    return [
      center,
      [center[0] + Math.cos(a0) * reach, center[1] + Math.sin(a0) * reach],
      [center[0] + Math.cos(mid) * reach, center[1] + Math.sin(mid) * reach],
      [center[0] + Math.cos(a1) * reach, center[1] + Math.sin(a1) * reach],
    ]
  }
  return [
    center,
    [center[0] + Math.cos(a0) * reach, center[1] + Math.sin(a0) * reach],
    [center[0] + Math.cos(a1) * reach, center[1] + Math.sin(a1) * reach],
  ]
}

function sliceRadial(
  polygon: Point[][],
  hole: Point[],
  maxAlong: number,
  size: number,
  eps: number,
  rng: Rng,
  _depth: number,
  fanCount?: number,
): LetterQuad[] {
  const center = ringsCentroid([hole])
  const outer = polygon[0]
  if (!outer) return []
  let meanR = 0
  for (const point of outer) meanR += Math.hypot(point[0] - center[0], point[1] - center[1])
  meanR /= Math.max(1, outer.length)
  const count = fanCount ?? Math.max(8, Math.round((Math.PI * 2 * meanR) / maxAlong))
  const start = rng() * Math.PI * 2
  const angles = irregularStops(count, start, start + Math.PI * 2, rng)
  const reach = Math.max(size * 1.8, polygonReach(polygon))
  const out: LetterQuad[] = []

  for (let i = 0; i < angles.length - 1; i++) {
    const a0 = angles[i]
    const a1 = angles[i + 1]
    if (a0 === undefined || a1 === undefined) continue
    for (const clipped of clipRings(polygon, wedgePoly(center, a0, a1, reach))) {
      const piece = emitPiece(clipped, null, eps, cutLinesFromWedge(center, a0, a1))
      if (piece) out.push(piece)
    }
  }
  return out
}

function ringAt(ring: Point[], index: number): Point | undefined {
  if (ring.length === 0) return undefined
  return ring[((index % ring.length) + ring.length) % ring.length]
}

function isReflexVertex(ring: Point[], index: number): boolean {
  const a = ringAt(ring, index - 1)
  const b = ringAt(ring, index)
  const c = ringAt(ring, index + 1)
  if (!a || !b || !c) return false
  const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
  return cross < -0.8
}

function chordLength(ring: Point[], origin: Point, dir: Point): number {
  const ts: number[] = []
  const pts = uniqueRing(ring)
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    if (!a || !b) continue
    const rx = b[0] - a[0]
    const ry = b[1] - a[1]
    const den = dir[0] * ry - dir[1] * rx
    if (Math.abs(den) < 1e-8) continue
    const t = ((a[0] - origin[0]) * ry - (a[1] - origin[1]) * rx) / den
    const u = ((a[0] - origin[0]) * dir[1] - (a[1] - origin[1]) * dir[0]) / den
    if (u >= -0.02 && u <= 1.02) ts.push(t)
  }
  if (ts.length < 2) return Infinity
  ts.sort((a, b) => a - b)
  return (ts[ts.length - 1]! - ts[0]!) * Math.hypot(dir[0], dir[1])
}

function splitAtReflex(
  polygon: Point[][],
  reach: number,
): Point[][][] | null {
  const outer = polygon[0]
  if (!outer) return null
  const pts = uniqueRing(outer)
  let best: { length: number; parts: Point[][][] } | null = null

  for (let i = 0; i < pts.length; i++) {
    if (!isReflexVertex(pts, i)) continue
    const origin = pts[i]
    if (!origin) continue
    for (let step = 0; step < 8; step++) {
      const angle = (step * Math.PI) / 8
      const dir = unitAt(angle)
      const length = chordLength(pts, origin, dir)
      if (!Number.isFinite(length) || length < 12 || length > 420) continue
      const n: Point = [-dir[1], dir[0]]
      const d = projectPoint(origin, n)
      const parts = [...clipSlab(polygon, n, d - reach, d, reach), ...clipSlab(polygon, n, d, d + reach, reach)]
      if (parts.length < 2) continue
      const areas = parts.map((part) => ringsArea(part)).filter((area) => area >= 24)
      if (areas.length < 2) continue
      const total = areas.reduce((sum, area) => sum + area, 0)
      if (Math.min(...areas) < total * 0.08) continue
      if (!best || length < best.length) best = { length, parts }
    }
  }

  return best?.parts ?? null
}

function sliceBands(
  polygon: Point[][],
  maxAlong: number,
  size: number,
  eps: number,
  rng: Rng,
): LetterQuad[] {
  const outer = polygon[0]
  if (!outer) return []
  const reach = Math.max(size * 1.8, polygonReach(polygon))
  const box = ringsBox(polygon)
  const wide = box.x1 - box.x0 >= box.y1 - box.y0
  const along = unitAt((wide ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.55)
  const [minAlong, maxAlongSpan] = projectRing(outer, along)
  const alongSpan = maxAlongSpan - minAlong
  const count = Math.max(alongSpan > maxAlong * 1.05 ? 2 : 1, Math.round(alongSpan / maxAlong))
  if (count <= 1) {
    const piece = emitPiece(polygon, null, eps)
    return piece ? [piece] : []
  }

  const stops = irregularStops(count, minAlong, maxAlongSpan, rng)
  const out: LetterQuad[] = []
  for (let i = 0; i < stops.length - 1; i++) {
    const d0 = stops[i]
    const d1 = stops[i + 1]
    if (d0 === undefined || d1 === undefined) continue
    const brick = stripBrick(along, d0, along, d1, reach)
    for (const clipped of clipRings(polygon, brick)) {
      const piece = emitPiece(clipped, brick, eps)
      if (piece) out.push(piece)
    }
  }
  if (out.length === 0) {
    const piece = emitPiece(polygon, null, eps)
    return piece ? [piece] : []
  }
  return out
}

function pieceAreaSum(pieces: LetterQuad[]): number {
  return pieces.reduce((sum, piece) => sum + piece.area, 0)
}

function coversPolygon(pieces: LetterQuad[], area: number): boolean {
  return pieces.length > 0 && pieceAreaSum(pieces) >= area * 0.96
}

function slicePolygon(
  polygon: Point[][],
  maxAlong: number,
  size: number,
  eps: number,
  rng: Rng,
  depth: number,
): LetterQuad[] {
  const area = ringsArea(polygon)
  if (area < 8) return []
  if (depth > 10) {
    const piece = emitPiece(polygon, null, eps)
    return piece ? [piece] : []
  }

  const reach = Math.max(size * 1.8, polygonReach(polygon))
  const hole = polygon[1]
  const outer = polygon[0]
  if (hole && outer && uniqueRing(hole).length >= 3) {
    const holeArea = polygonArea(hole)
    const outerArea = polygonArea(outer)
    const ringLike = holeArea > outerArea * 0.12
    const fanCount = ringLike ? undefined : 4 + Math.floor(rng() * 3)
    const radial = sliceRadial(polygon, hole, maxAlong, size, eps, rng, depth, fanCount)
    if (radial.length > 0 && coversPolygon(radial, area)) return radial
  }

  if (!outer) return []
  const notches = splitAtReflex(polygon, reach)
  if (notches && notches.length >= 2) {
    const out: LetterQuad[] = []
    for (const part of notches) out.push(...sliceBands(part, maxAlong, size, eps, rng))
    if (coversPolygon(out, area)) return out
  }

  const bands = sliceBands(polygon, maxAlong, size, eps, rng)
  if (coversPolygon(bands, area)) return bands

  const finer = sliceBands(polygon, maxAlong * 0.62, size, eps, mulberry32((rng() * 1e9) >>> 0))
  if (coversPolygon(finer, area)) return finer

  if (finer.length > 0 && pieceAreaSum(finer) > pieceAreaSum(bands)) return finer
  if (bands.length > 0) return bands

  const piece = emitPiece(polygon, null, eps)
  return piece ? [piece] : []
}

function isScrap(piece: LetterQuad, bandThickness: number, minKeep: number): boolean {
  const box = piece.box ?? ringsBox(piece.rings)
  const w = box.x1 - box.x0
  const h = box.y1 - box.y0
  if (piece.area < minKeep) return true
  if (Math.min(w, h) < bandThickness * 0.28) return true
  return false
}

function nudgeRings(rings: Point[][], from: Point, to: Point, dist: number): Point[][] {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const len = Math.hypot(dx, dy) || 1
  const ox = (dx / len) * dist
  const oy = (dy / len) * dist
  return rings.map((ring) => ring.map((point) => [point[0] + ox, point[1] + oy] as Point))
}

function tryUnion(a: LetterQuad, b: LetterQuad): LetterQuad | null {
  const attempts = [
    unionRings(a.rings, b.rings),
    unionRings(nudgeRings(a.rings, ringsCentroid(a.rings), ringsCentroid(b.rings), 4), b.rings),
  ]
  for (const united of attempts) {
    if (!united) continue
    const next = emitPiece(united, null, 4.5)
    if (next) return next
  }
  return null
}

function mergeSlivers(pieces: LetterQuad[], bandThickness: number, minKeep: number): LetterQuad[] {
  const items = pieces.filter((piece) => piece.area >= 8)
  const skipped = new Set<LetterQuad>()
  const keep = Math.max(minKeep, bandThickness * bandThickness * 0.18)

  for (let pass = 0; pass < items.length + 12; pass++) {
    let scrapIndex = -1
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item || skipped.has(item) || !isScrap(item, bandThickness, keep)) continue
      if (scrapIndex < 0 || item.area < (items[scrapIndex]?.area ?? Infinity)) scrapIndex = i
    }
    if (scrapIndex < 0) break
    const scrap = items[scrapIndex]
    if (!scrap) break

    const candidates: Array<{ index: number; score: number }> = []
    for (let i = 0; i < items.length; i++) {
      if (i === scrapIndex) continue
      const other = items[i]
      if (!other) continue
      if (!ringsNearlyTouch(scrap.rings, other.rings, 22)) continue
      const dist = dist2(ringsCentroid(scrap.rings), ringsCentroid(other.rings))
      candidates.push({ index: i, score: other.area - dist * 0.0003 })
    }
    candidates.sort((a, b) => b.score - a.score)

    let merged: LetterQuad | null = null
    let neighborIndex = -1
    for (const candidate of candidates.slice(0, 8)) {
      const neighbor = items[candidate.index]
      if (!neighbor) continue
      const next = tryUnion(scrap, neighbor)
      if (!next) continue
      merged = next
      neighborIndex = candidate.index
      break
    }

    if (!merged || neighborIndex < 0) {
      skipped.add(scrap)
      continue
    }

    const high = Math.max(scrapIndex, neighborIndex)
    const low = Math.min(scrapIndex, neighborIndex)
    items.splice(high, 1)
    items.splice(low, 1)
    items.push(merged)
  }

  return items
}

function splitBox(box: Box, vertical: boolean, cut: number): [Box, Box] {
  if (vertical) {
    return [
      { x0: box.x0, y0: box.y0, x1: cut, y1: box.y1 },
      { x0: cut, y0: box.y0, x1: box.x1, y1: box.y1 },
    ]
  }
  return [
    { x0: box.x0, y0: box.y0, x1: box.x1, y1: cut },
    { x0: box.x0, y0: cut, x1: box.x1, y1: box.y1 },
  ]
}

function boxPoly(box: Box): Point[] {
  return [
    [box.x0, box.y0],
    [box.x1, box.y0],
    [box.x1, box.y1],
    [box.x0, box.y1],
  ]
}

function splitToTarget(rings: Point[][], box: Box, target: number, depth: number): LetterQuad[] {
  const area = ringsArea(rings)
  if (area < 8) return []
  const piece = emitPiece(rings, null, 2.4)
  if (!piece) return []
  if (area <= target * 1.35 || depth > 6) return [piece]

  const vertical = box.x1 - box.x0 >= box.y1 - box.y0
  const cut = vertical ? (box.x0 + box.x1) / 2 : (box.y0 + box.y1) / 2
  const [aBox, bBox] = splitBox(box, vertical, cut)
  const aPolys = clipRings(rings, boxPoly(aBox))
  const bPolys = clipRings(rings, boxPoly(bBox))
  if (aPolys.length === 0 || bPolys.length === 0) return [piece]

  const out: LetterQuad[] = []
  for (const poly of aPolys) out.push(...splitToTarget(poly, aBox, target, depth + 1))
  for (const poly of bPolys) out.push(...splitToTarget(poly, bBox, target, depth + 1))
  return out.length > 0 ? out : [piece]
}

export function partitionRings(
  rings: Point[][],
  box: Box,
  target: number,
  _size: number,
  _rng: Rng,
): LetterQuad[] {
  return splitToTarget(rings, box, target, 0)
}

export function buildLetterQuads(
  outline: MultiPolygon,
  size: number,
  density: number,
  seed: number,
): LetterQuad[] {
  const plan = densityPlan(density, size)
  const rng = mulberry32(seed ^ 0x51c6a4a1)
  const t = (clampDensity(density) - 1) / 4
  const maxAlong = Math.sqrt(plan.targetArea) * (1.45 - t * 0.83)
  const eps = Math.max(3.2, size * 0.0032)
  const pieces: LetterQuad[] = []

  for (const polygon of asPolygons(outline)) {
    pieces.push(...slicePolygon(polygon, maxAlong, size, eps, rng, 0))
  }

  return mergeSlivers(pieces, maxAlong * 0.4, maxAlong * maxAlong * 0.12)
}
