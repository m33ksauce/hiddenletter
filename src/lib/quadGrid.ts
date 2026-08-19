import type { Rng } from './rng'
import type { Point } from './types'

export type QuadSpec = {
  corners: Point[]
  bulges: number[]
}

function irregularStops(count: number, start: number, end: number, rng: Rng): number[] {
  const weights = Array.from({ length: count }, () => 0.72 + rng() * 0.56)
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

export function buildQuadGrid(size: number, targetCount: number, rng: Rng): QuadSpec[] {
  const count = Math.max(4, Math.round(targetCount))
  const cols = Math.max(2, Math.ceil(Math.sqrt(count)))
  const rows = Math.max(2, Math.ceil(count / cols))
  const xs = irregularStops(cols, 0, size, rng)
  const ys = irregularStops(rows, 0, size, rng)
  const jitter = Math.min(size / cols, size / rows) * 0.22

  const vertexAt = (row: number, col: number): Point => {
    const x0 = xs[col] ?? 0
    const y0 = ys[row] ?? 0
    const onEdge = row === 0 || col === 0 || row === rows || col === cols
    if (onEdge) return [x0, y0]
    return [
      Math.min(size - 2, Math.max(2, x0 + (rng() - 0.5) * jitter)),
      Math.min(size - 2, Math.max(2, y0 + (rng() - 0.5) * jitter)),
    ]
  }

  const vertices: Point[][] = []
  for (let row = 0; row <= rows; row++) {
    const line: Point[] = []
    for (let col = 0; col <= cols; col++) {
      line.push(vertexAt(row, col))
    }
    vertices.push(line)
  }

  const hBulge: number[][] = []
  for (let row = 0; row <= rows; row++) {
    const line: number[] = []
    for (let col = 0; col < cols; col++) {
      line.push(row === 0 || row === rows ? 0 : (rng() - 0.5) * 0.22)
    }
    hBulge.push(line)
  }

  const vBulge: number[][] = []
  for (let row = 0; row < rows; row++) {
    const line: number[] = []
    for (let col = 0; col <= cols; col++) {
      line.push(col === 0 || col === cols ? 0 : (rng() - 0.5) * 0.22)
    }
    vBulge.push(line)
  }

  const quads: QuadSpec[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tl = vertices[row]?.[col]
      const tr = vertices[row]?.[col + 1]
      const br = vertices[row + 1]?.[col + 1]
      const bl = vertices[row + 1]?.[col]
      if (!tl || !tr || !br || !bl) continue
      quads.push({
        corners: [tl, tr, br, bl],
        bulges: [
          hBulge[row]?.[col] ?? 0,
          vBulge[row]?.[col + 1] ?? 0,
          -(hBulge[row + 1]?.[col] ?? 0),
          -(vBulge[row]?.[col] ?? 0),
        ],
      })
    }
  }

  return quads
}
