import type { MultiPolygon } from 'polygon-clipping'
import { clampDensity, densityPlan } from './difficulty'
import { buildGraphVoronoiCells } from './graphVoronoi'
import {
  dist2,
  pointInLetterSolid,
  pointInRings,
  ringsArea,
  ringsCentroid,
  uniqueRing,
} from './geometry'
import { mulberry32, type Rng } from './rng'
import type { Point } from './types'

export type SiteRegion = 'interior' | 'exterior'

export type VoronoiSite = {
  id: number
  point: Point
  region: SiteRegion
  /** @deprecated use region === 'interior' */
  onLetter: boolean
}

export type VoronoiCurve = {
  a: number
  b: number
  points: Point[]
}

export type CurveVoronoiGraph = {
  sites: VoronoiSite[]
  curves: VoronoiCurve[]
}

export type CurveVoronoiPiece = {
  rings: Point[][]
  area: number
  isSolution: boolean
  centroid: Point
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function addCurve(
  curves: VoronoiCurve[],
  hasEdge: Set<string>,
  a: number,
  b: number,
  points: Point[],
): void {
  const key = edgeKey(a, b)
  if (hasEdge.has(key)) return
  hasEdge.add(key)
  curves.push({ a, b, points })
}

function gentleCurve(a: Point, b: Point, bulge: number, segments = 6): Point[] {
  const mx = (a[0] + b[0]) / 2
  const my = (a[1] + b[1]) / 2
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  const cx = mx + (-dy / len) * len * bulge
  const cy = my + (dx / len) * len * bulge
  const out: Point[] = []
  for (let step = 0; step <= segments; step++) {
    const t = step / segments
    const u = 1 - t
    out.push([
      u * u * a[0] + 2 * u * t * cx + t * t * b[0],
      u * u * a[1] + 2 * u * t * cy + t * t * b[1],
    ])
  }
  return out
}

function nearestUnconnected(
  from: VoronoiSite,
  candidates: VoronoiSite[],
  hasEdge: Set<string>,
  valid?: (from: VoronoiSite, to: VoronoiSite) => boolean,
): VoronoiSite | null {
  const ranked = candidates
    .filter((s) => s.id !== from.id && !hasEdge.has(edgeKey(from.id, s.id)))
    .map((s) => ({ s, d: dist2(from.point, s.point) }))
    .sort((a, b) => a.d - b.d)
  for (const { s } of ranked) {
    if (!valid || valid(from, s)) return s
  }
  return null
}

function nearestNUnconnected(
  from: VoronoiSite,
  candidates: VoronoiSite[],
  hasEdge: Set<string>,
  count: number,
  valid?: (from: VoronoiSite, to: VoronoiSite) => boolean,
): VoronoiSite[] {
  const ranked = candidates
    .filter((s) => s.id !== from.id && !hasEdge.has(edgeKey(from.id, s.id)))
    .map((s) => ({ s, d: dist2(from.point, s.point) }))
    .sort((a, b) => a.d - b.d)
  const out: VoronoiSite[] = []
  for (const { s } of ranked) {
    if (valid && !valid(from, s)) continue
    out.push(s)
    if (out.length >= count) break
  }
  return out
}

function segmentStaysInSolid(
  a: Point,
  b: Point,
  letterRings: Point[][],
  samples = 10,
): boolean {
  for (let i = 1; i < samples; i++) {
    const t = i / samples
    const p: Point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
    if (!pointInLetterSolid(p, letterRings)) return false
  }
  return true
}

/** Cross-region bridge must leave the letter, not shortcut through solid ink. */
function segmentLeavesLetter(
  a: Point,
  b: Point,
  letterRings: Point[][],
  samples = 10,
): boolean {
  for (let i = 1; i < samples - 1; i++) {
    const t = i / samples
    const p: Point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
    if (pointInLetterSolid(p, letterRings)) return false
  }
  return true
}

function sampleOutlineArc(ring: Point[], i0: number, i1: number): Point[] {
  const open = uniqueRing(ring)
  const n = open.length
  if (n < 2) return []
  const path: Point[] = []
  let i = i0 % n
  for (let guard = 0; guard <= n; guard++) {
    const p = open[i]
    if (p) path.push(p)
    if (i === i1 % n) break
    i = (i + 1) % n
  }
  return path
}

function randomPointOutside(
  rng: Rng,
  rings: Point[][],
  size: number,
  pad: number,
  tries = 80,
): Point | null {
  for (let i = 0; i < tries; i++) {
    const candidate: Point = [
      pad + rng() * (size - pad * 2),
      pad + rng() * (size - pad * 2),
    ]
    if (!pointInRings(candidate, rings)) return candidate
  }
  return null
}

function ringIndexForSite(site: VoronoiSite, ring: Point[]): number {
  const open = uniqueRing(ring)
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < open.length; i++) {
    const d = dist2(site.point, open[i]!)
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

function connectConsecutiveAlongRing(
  ring: Point[],
  ringSites: VoronoiSite[],
  curves: VoronoiCurve[],
  hasEdge: Set<string>,
): void {
  if (ringSites.length < 2) return
  const open = uniqueRing(ring)
  const ringIdx = ringSites.map((s) => ringIndexForSite(s, open))
  const order = ringIdx.map((ri, si) => ({ ri, si })).sort((a, b) => a.ri - b.ri)
  for (let i = 0; i < order.length; i++) {
    const curr = order[i]!
    const next = order[(i + 1) % order.length]!
    const arc = sampleOutlineArc(ring, curr.ri, next.ri)
    if (arc.length >= 2) {
      addCurve(curves, hasEdge, ringSites[curr.si]!.id, ringSites[next.si]!.id, arc)
    }
  }
}

function sampleOutlineSites(
  ring: Point[],
  count: number,
  rng: Rng,
): Point[] {
  const open = uniqueRing(ring)
  if (open.length < 4) return []
  const n = open.length
  const indices: number[] = []
  for (let i = 0; i < count; i++) {
    const t = (i + rng() * 0.4) / count
    indices.push(Math.min(n - 1, Math.floor(t * n)))
  }
  const points: Point[] = []
  for (const idx of [...new Set(indices)].sort((a, b) => a - b)) {
    const p = open[idx]
    if (p) points.push(p)
  }
  return points
}

/**
 * Build the point/curve graph with two separate regions:
 * - interior: sites on the letter outline (no points inside the letter solid)
 * - exterior: canvas corners + random points outside the letter
 *
 * Connections stay within a region except step 5 (letter → nearest exterior).
 */
export function buildCurveVoronoiGraph(
  outline: MultiPolygon,
  size: number,
  density: number,
  seed: number,
): CurveVoronoiGraph {
  const plan = densityPlan(density, size)
  const rng = mulberry32(seed ^ 0xc0ffee01)
  const polygon = outline[0]
  const letterRings: Point[][] = polygon
    ? polygon.map((ring) => uniqueRing(ring as Point[]))
    : []
  const outerRing = letterRings[0] ?? []

  const sites: VoronoiSite[] = []
  let nextId = 0
  const addSite = (point: Point, region: SiteRegion) => {
    const s: VoronoiSite = {
      id: nextId++,
      point,
      region,
      onLetter: region === 'interior',
    }
    sites.push(s)
    return s
  }

  const curves: VoronoiCurve[] = []
  const hasEdge = new Set<string>()
  const solidChord = (from: VoronoiSite, to: VoronoiSite) =>
    segmentStaysInSolid(from.point, to.point, letterRings)
  const exitChord = (from: VoronoiSite, to: VoronoiSite) =>
    segmentLeavesLetter(from.point, to.point, letterRings)

  // ── Exterior region: canvas corners ─────────────────────────────────
  const corners: VoronoiSite[] = [
    addSite([0, 0], 'exterior'),
    addSite([size, 0], 'exterior'),
    addSite([size, size], 'exterior'),
    addSite([0, size], 'exterior'),
  ]
  for (let i = 0; i < corners.length; i++) {
    const c = corners[i]!
    const n = corners[(i + 1) % corners.length]!
    addCurve(curves, hasEdge, c.id, n.id, [c.point, n.point])
  }

  // ── Interior region: random points on the letter outline ────────────
  const nOutline = Math.max(6, Math.round(plan.siteCount * 0.5))
  const interiorSites: VoronoiSite[] = []

  for (const p of sampleOutlineSites(outerRing, nOutline, rng)) {
    interiorSites.push(addSite(p, 'interior'))
  }

  // Hole boundaries get outline sites so cells respect cut-outs (holes stay empty)
  for (let h = 1; h < letterRings.length; h++) {
    const holeRing = letterRings[h]
    if (!holeRing) continue
    const nHole = Math.max(3, Math.round(nOutline * 0.35))
    for (const p of sampleOutlineSites(holeRing, nHole, rng)) {
      interiorSites.push(addSite(p, 'interior'))
    }
  }

  // ── 2. Connect consecutive outline points tracing the outline ─────
  connectConsecutiveAlongRing(outerRing, interiorSites.filter((s) =>
    outerRing.some((p) => dist2(p, s.point) < 4),
  ), curves, hasEdge)

  for (let h = 1; h < letterRings.length; h++) {
    const holeRing = letterRings[h]
    if (!holeRing) continue
    const holeSites = interiorSites.filter((s) =>
      holeRing.some((p) => dist2(p, s.point) < 4),
    )
    connectConsecutiveAlongRing(holeRing, holeSites, curves, hasEdge)
  }

  // ── 3. Each interior point → nearest unconnected interior neighbor ──
  for (const site of interiorSites) {
    const neighbor = nearestUnconnected(site, interiorSites, hasEdge, solidChord)
    if (!neighbor) continue
    addCurve(curves, hasEdge, site.id, neighbor.id,
      gentleCurve(site.point, neighbor.point, 0.08 * (rng() - 0.5)))
  }

  // ── 4. Additional exterior points ───────────────────────────────────
  const nExterior = Math.max(4, Math.round(plan.siteCount * 0.4))
  const exteriorSites: VoronoiSite[] = [...corners]
  for (let i = 0; i < nExterior; i++) {
    const pt = randomPointOutside(rng, letterRings, size, size * 0.05)
    if (pt) exteriorSites.push(addSite(pt, 'exterior'))
  }

  // ── 5. Each interior point → nearest exterior point (cross-region) ─
  for (const site of interiorSites) {
    const ext = nearestUnconnected(site, exteriorSites, hasEdge, exitChord)
    if (!ext) continue
    addCurve(curves, hasEdge, site.id, ext.id,
      gentleCurve(site.point, ext.point, 0.06 * (rng() - 0.5), 5))
  }

  // ── 6. Each point → 3 nearest unconnected neighbors in its region ───
  for (const site of interiorSites) {
    for (const neighbor of nearestNUnconnected(site, interiorSites, hasEdge, 3, solidChord)) {
      addCurve(curves, hasEdge, site.id, neighbor.id,
        gentleCurve(site.point, neighbor.point, 0.05 * (rng() - 0.5), 4))
    }
  }
  for (const site of exteriorSites) {
    for (const neighbor of nearestNUnconnected(site, exteriorSites, hasEdge, 3)) {
      addCurve(curves, hasEdge, site.id, neighbor.id,
        gentleCurve(site.point, neighbor.point, 0.05 * (rng() - 0.5), 4))
    }
  }

  return { sites, curves }
}

export type GraphVoronoiCellPreview = {
  siteId: number
  rings: Point[][]
  region: SiteRegion
}

/** Turn the site graph into Voronoi cells (separate diagrams per region). */
export function buildCurveVoronoiMesh(
  outline: MultiPolygon,
  size: number,
  density: number,
  seed: number,
): CurveVoronoiPiece[] {
  const level = clampDensity(density)
  const plan = densityPlan(level, size)
  const graph = buildCurveVoronoiGraph(outline, size, level, seed)
  const cells = buildGraphVoronoiCells(graph.sites, outline, size)

  const pieces: CurveVoronoiPiece[] = []
  for (const cell of cells) {
    const area = ringsArea(cell.rings)
    if (area < 4) continue
    if (cell.region === 'interior') {
      pieces.push({
        rings: cell.rings,
        area,
        isSolution: true,
        centroid: ringsCentroid(cell.rings),
      })
    } else if (area >= plan.mergeBelow * 0.15) {
      pieces.push({
        rings: cell.rings,
        area,
        isSolution: false,
        centroid: ringsCentroid(cell.rings),
      })
    }
  }

  return pieces
}

export function graphVoronoiCellsForPreview(
  outline: MultiPolygon,
  size: number,
  density: number,
  seed: number,
): GraphVoronoiCellPreview[] {
  const graph = buildCurveVoronoiGraph(outline, size, density, seed)
  return buildGraphVoronoiCells(graph.sites, outline, size)
}

export function curveVoronoiGraphForPreview(
  outline: MultiPolygon,
  size: number,
  density: number,
  seed: number,
): CurveVoronoiGraph {
  return buildCurveVoronoiGraph(outline, size, density, seed)
}
