import { writeFileSync, mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer'
import { ALL_LETTERS, requireDebugTools } from './lib/debug-tools.mjs'

requireDebugTools('export-slice-svg.mjs')

const devUrl = process.env.POPULATE_URL ?? 'http://127.0.0.1:5173/'

mkdirSync('scripts/out', { recursive: true })

const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
await page.goto(devUrl, { waitUntil: 'networkidle0', timeout: 30000 })

const shapes = await page.evaluate(async (letters) => {
  const { loadBaseLetterShape } = await import('/src/lib/letterMask.ts')
  const { sliceSolutionOnly, sliceSeedForLetter } = await import('/src/lib/sliceCanvas.ts')
  const { cellToPath } = await import('/src/lib/geometry.ts')
  const { outlineToPath } = await import('/src/lib/baseShape.ts')
  const out = []
  for (const letter of letters) {
    const shape = await loadBaseLetterShape(letter)
    const slices = sliceSolutionOnly(shape.outline, shape.width, 3, sliceSeedForLetter(letter))
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
    out.push({ letter: shape.letter, svg, pieceCount: slices.length })
  }
  return out
}, ALL_LETTERS)

await browser.close()

for (const shape of shapes) {
  writeFileSync(`scripts/out/slice-${/[A-Z]/.test(shape.letter) ? 'upper' : 'lower'}-${shape.letter}.svg`, shape.svg)
  console.log(`wrote slice-${/[A-Z]/.test(shape.letter) ? 'upper' : 'lower'}-${shape.letter}.svg (${shape.pieceCount} pieces)`)
}
