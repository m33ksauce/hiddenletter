import { Delaunay } from 'd3-delaunay'
import type { MultiPolygon } from 'polygon-clipping'
import { closeRing, ringsArea, uniqueRing } from './geometry'
import { splitCellByLetter } from './letterShape'
import type { Point } from './types'

export type GraphVoronoiCell = {
  siteId: number
  rings: Point[][]
  region: 'interior' | 'exterior'
}

type SiteInput = { id: number; point: Point; region: 'interior' | 'exterior' }

function ringsFromVoronoiCell(cell: Point[] | null): Point[][] | null {
  if (!cell || cell.length < 3) return null
  return [closeRing(uniqueRing(cell))]
}

function voronoiCellsForSites(
  sites: SiteInput[],
  size: number,
): Map<number, Point[][]> {
  const out = new Map<number, Point[][]>()
  if (sites.length === 0) return out
  if (sites.length === 1) {
    const only = sites[0]!
    out.set(only.id, ringsFromVoronoiCell([
      [0, 0], [size, 0], [size, size], [0, size],
    ]) ?? [])
    return out
  }

  const coords = sites.map((s) => s.point)
  const delaunay = Delaunay.from(coords)
  const pad = 1
  const voronoi = delaunay.voronoi([-pad, -pad, size + pad, size + pad])

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i]
    if (!site) continue
    const rings = ringsFromVoronoiCell(voronoi.cellPolygon(i))
    if (rings) out.set(site.id, rings)
  }
  return out
}

/** Build separate interior / exterior Voronoi diagrams from graph site positions. */
export function buildGraphVoronoiCells(
  sites: SiteInput[],
  outline: MultiPolygon,
  size: number,
): GraphVoronoiCell[] {
  const interiorSites = sites.filter((s) => s.region === 'interior')
  const exteriorSites = sites.filter((s) => s.region === 'exterior')
  const cells: GraphVoronoiCell[] = []

  const interiorVoronoi = voronoiCellsForSites(interiorSites, size)
  for (const site of interiorSites) {
    const rings = interiorVoronoi.get(site.id)
    if (!rings) continue
    const { inside } = splitCellByLetter(rings[0] ?? [], outline)
    for (const poly of inside) {
      if ((poly[0]?.length ?? 0) >= 3 && ringsArea(poly) >= 4) {
        cells.push({ siteId: site.id, rings: poly, region: 'interior' })
      }
    }
  }

  const exteriorVoronoi = voronoiCellsForSites(exteriorSites, size)
  for (const site of exteriorSites) {
    const rings = exteriorVoronoi.get(site.id)
    if (!rings) continue
    const { outside } = splitCellByLetter(rings[0] ?? [], outline)
    for (const poly of outside) {
      if ((poly[0]?.length ?? 0) >= 3 && ringsArea(poly) >= 4) {
        cells.push({ siteId: site.id, rings: poly, region: 'exterior' })
      }
    }
  }

  return cells
}

export function voronoiCellPolygon(
  focus: Point,
  others: Point[],
  size: number,
): Point[] | null {
  const sites = [{ id: 0, point: focus, region: 'interior' as const }, ...others.map((p, i) => ({
    id: i + 1,
    point: p,
    region: 'interior' as const,
  }))]
  const map = voronoiCellsForSites(sites, size)
  return map.get(0)?.[0] ?? null
}
