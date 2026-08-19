import puppeteer from 'puppeteer'
import { mkdirSync } from 'node:fs'
import { ALL_LETTERS, requireDebugTools } from './lib/debug-tools.mjs'

requireDebugTools('capture-metrics.mjs')

mkdirSync('scripts/out', { recursive: true })

const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 1200, height: 900 })

await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 30000 })
await page.click('button.shape-review-btn')
await page.waitForSelector('.shape-board path.shape-slice', { timeout: 20000 })

const report = await page.evaluate(async (letters) => {
  const { loadBaseLetterShape } = await import('/src/lib/letterMask.ts')
  const { sliceSolutionOnly, sliceSeedForLetter } = await import('/src/lib/sliceCanvas.ts')
  const { densityPlan } = await import('/src/lib/difficulty.ts')
  const { sampleQuadRing } = await import('/src/lib/geometry.ts')

  const density = 3
  const step = 8
  const out = []

  for (const letter of letters) {
    const shape = await loadBaseLetterShape(letter)
    const slices = sliceSolutionOnly(shape.outline, shape.width, density, sliceSeedForLetter(letter))
    const plan = densityPlan(density, shape.width)
    let inkTotal = 0
    let inkMissed = 0
    let inkDouble = 0

    const pointInRing = (pt, ring) => {
      let inside = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0]
        const yi = ring[i][1]
        const xj = ring[j][0]
        const yj = ring[j][1]
        const intersect = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi
        if (intersect) inside = !inside
      }
      return inside
    }
    const pointInRings = (pt, rings) => {
      const outer = rings[0]
      if (!outer || !pointInRing(pt, outer)) return false
      for (let h = 1; h < rings.length; h++) if (pointInRing(pt, rings[h])) return false
      return true
    }

    for (let y = step / 2; y < shape.width; y += step) {
      for (let x = step / 2; x < shape.width; x += step) {
        if (!shape.mask.isInk(x, y) || shape.mask.isHole(x, y)) continue
        inkTotal++
        let hits = 0
        for (const piece of slices) {
          const ring = piece.rings[0]
          const shapeRings =
            piece.bulges && ring && ring.length === 4
              ? [sampleQuadRing(ring, piece.bulges, 10)]
              : piece.rings
          if (pointInRings([x, y], shapeRings)) hits++
        }
        if (hits === 0) inkMissed++
        else if (hits > 1) inkDouble++
      }
    }

    const verts = slices.map((s) => s.rings[0]?.length ?? 0)
    const areas = slices.map((s) => s.area)
    const mean = areas.reduce((a, b) => a + b, 0) / Math.max(areas.length, 1)
    const maxAspect = Math.max(
      ...slices.map((s) => {
        const ring = s.rings[0] ?? []
        let x0 = Infinity,
          y0 = Infinity,
          x1 = -Infinity,
          y1 = -Infinity
        for (const p of ring) {
          x0 = Math.min(x0, p[0])
          y0 = Math.min(y0, p[1])
          x1 = Math.max(x1, p[0])
          y1 = Math.max(y1, p[1])
        }
        const w = x1 - x0,
          h = y1 - y0
        return w < 1 || h < 1 ? 1 : Math.max(w / h, h / w)
      }),
    )
    out.push({
      letter,
      pieces: slices.length,
      inkMissPct: inkTotal ? +((100 * inkMissed) / inkTotal).toFixed(1) : 0,
      inkDouble,
      slivers: slices.filter((s) => s.area < plan.targetArea * 0.25).length,
      avgVerts: +(verts.reduce((a, b) => a + b, 0) / verts.length).toFixed(1),
      areaRatio: +(Math.max(...areas) / Math.max(1, Math.min(...areas))).toFixed(2),
      maxAspect: +maxAspect.toFixed(2),
      meanArea: Math.round(mean),
    })
  }
  return out
}, ALL_LETTERS)

console.log(JSON.stringify(report, null, 2))
await browser.close()
