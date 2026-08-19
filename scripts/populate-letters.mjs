import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import { ALL_LETTERS } from './lib/debug-tools.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'letters')
const devUrl = process.env.POPULATE_URL ?? 'http://127.0.0.1:5173/'

mkdirSync(outDir, { recursive: true })

const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
await page.goto(devUrl, { waitUntil: 'networkidle0', timeout: 30000 })

const shapes = await page.evaluate(async (letters) => {
  const { createBaseLetterMask } = await import('/src/lib/letterMask.ts')
  const { traceLetter } = await import('/src/lib/letterShape.ts')
  const out = []
  for (const letter of letters) {
    const mask = await createBaseLetterMask(letter)
    const outline = traceLetter(mask.pixels, mask.width, mask.height)
    if (!outline.length) throw new Error(`Could not trace ${letter}`)
    out.push({ letter, width: mask.width, height: mask.height, outline })
  }
  return out
}, ALL_LETTERS)

await browser.close()

for (const shape of shapes) {
  const bucket = /[A-Z]/.test(shape.letter) ? 'upper' : 'lower'
  const dir = join(outDir, bucket)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${shape.letter}.json`), `${JSON.stringify(shape)}\n`)
  console.log(`wrote letters/${bucket}/${shape.letter}.json`)
}

console.log(`Populated ${shapes.length} letter outlines.`)
