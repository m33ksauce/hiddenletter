import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import { ALL_LETTERS } from './lib/debug-tools.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'scripts', 'out')
const devUrl = process.env.POPULATE_URL ?? 'http://127.0.0.1:5173/'
const DENSITY = 3
const STEP = 8

mkdirSync(outDir, { recursive: true })

const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
await page.goto(devUrl, { waitUntil: 'networkidle0', timeout: 30000 })

const report = await page.evaluate(
  async (letters, density, step) => {
    const { loadBaseLetterShape } = await import('/src/lib/letterMask.ts')
    const { sliceSolutionOnly, sliceSeedForLetter } = await import('/src/lib/sliceCanvas.ts')
    const { ringsArea, pointInRings, cellToPath } = await import('/src/lib/geometry.ts')
    const { outlineToPath } = await import('/src/lib/baseShape.ts')

    const out = []
    for (const letter of letters) {
      const shape = await loadBaseLetterShape(letter)
      const slices = sliceSolutionOnly(shape.outline, shape.width, density, sliceSeedForLetter(letter))
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

      const paths = slices
        .map(
          (piece, i) =>
            `<path d="${cellToPath(piece.rings, piece.bulges)}" fill="#ffd166" stroke="#333" stroke-width="2" fill-rule="evenodd" data-i="${i}"/>`,
        )
        .join('\n')
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${shape.width} ${shape.height}" width="800" height="800">
  <rect width="100%" height="100%" fill="#fffdf8"/>
  ${paths}
  <path d="${outlineToPath(shape.outline)}" fill="none" stroke="#111" stroke-width="4"/>
</svg>`

      out.push({
        letter,
        svg,
        pieceCount: slices.length,
        areaRatio: letterArea ? sliceArea / letterArea : 1,
        inkMissPct: inkTotal ? (inkMissed / inkTotal) * 100 : 0,
        inkDouble,
      })
    }
    return out
  },
  ALL_LETTERS,
  DENSITY,
  STEP,
)

await browser.close()

let warnings = 0
for (const shape of report) {
  writeFileSync(join(outDir, `slice-${/[A-Z]/.test(shape.letter) ? 'upper' : 'lower'}-${shape.letter}.svg`), shape.svg)

  const row = {
    letter: shape.letter,
    pieceCount: shape.pieceCount,
    areaRatio: shape.areaRatio.toFixed(3),
    inkMissPct: shape.inkMissPct.toFixed(1),
    inkDouble: shape.inkDouble,
  }
  console.log(JSON.stringify(row))

  if (shape.areaRatio < 0.98 || shape.inkMissPct > 2 || shape.inkDouble > 0) warnings++
}

console.log(`Resliced ${report.length} letters → scripts/out/slice-upper-*.svg and slice-lower-*.svg`)
if (warnings > 0) {
  console.warn(`${warnings} letter(s) have coverage warnings (area < 98%, ink miss > 2%, or overlaps).`)
}
