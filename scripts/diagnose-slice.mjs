import puppeteer from 'puppeteer'
import { ALL_LETTERS, requireDebugTools } from './lib/debug-tools.mjs'

requireDebugTools('diagnose-slice.mjs')

const DENSITY = 3
const STEP = 8
const devUrl = process.env.POPULATE_URL ?? 'http://127.0.0.1:5173/'

const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
await page.goto(devUrl, { waitUntil: 'networkidle0', timeout: 30000 })

const report = await page.evaluate(
  async (letters, density, step) => {
    const { loadBaseLetterShape } = await import('/src/lib/letterMask.ts')
    const { sliceSolutionOnly, sliceSeedForLetter } = await import('/src/lib/sliceCanvas.ts')
    const { densityPlan } = await import('/src/lib/difficulty.ts')
    const { pointInRings, ringsArea } = await import('/src/lib/geometry.ts')

    const out = []
    for (const letter of letters) {
      const shape = await loadBaseLetterShape(letter)
      const slices = sliceSolutionOnly(shape.outline, shape.width, density, sliceSeedForLetter(letter))
      const plan = densityPlan(density, shape.width)
      let letterArea = 0
      for (const poly of shape.outline) letterArea += ringsArea(poly)
      const sliceArea = slices.reduce((sum, piece) => sum + piece.area, 0)
      let inkTotal = 0
      let inkMissed = 0
      let inkDouble = 0

      for (let y = step / 2; y < shape.width; y += step) {
        for (let x = step / 2; x < shape.width; x += step) {
          let inLetter = false
          for (const poly of shape.outline) {
            const outer = poly[0]
            if (!outer || !pointInRings([x, y], [outer])) continue
            let inHole = false
            for (let h = 1; h < poly.length; h++) {
              const hole = poly[h]
              if (hole && pointInRings([x, y], [hole])) {
                inHole = true
                break
              }
            }
            if (!inHole) {
              inLetter = true
              break
            }
          }
          if (!inLetter) continue
          inkTotal++
          let hits = 0
          for (const piece of slices) {
            if (pointInRings([x, y], piece.rings)) hits++
          }
          if (hits === 0) inkMissed++
          else if (hits > 1) inkDouble++
        }
      }

      const areas = slices.map((s) => s.area).sort((a, b) => a - b)
      out.push({
        letter,
        pieceCount: slices.length,
        areaRatio: letterArea ? (sliceArea / letterArea).toFixed(3) : '1',
        inkMissPct: inkTotal ? ((inkMissed / inkTotal) * 100).toFixed(1) : '0',
        inkDouble,
        minArea: Math.round(areas[0] ?? 0),
        maxArea: Math.round(areas[areas.length - 1] ?? 0),
        targetArea: Math.round(plan.targetArea),
      })
    }
    return out
  },
  ALL_LETTERS,
  DENSITY,
  STEP,
)

for (const row of report) console.log(JSON.stringify(row))
await browser.close()
