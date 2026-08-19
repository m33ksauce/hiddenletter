import puppeteer from 'puppeteer'
import { mkdirSync } from 'node:fs'
import { UPPERCASE_LETTERS, requireDebugTools } from './lib/debug-tools.mjs'

requireDebugTools('capture-preview.mjs')

mkdirSync('scripts/out', { recursive: true })

const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 1100, deviceScaleFactor: 2 })
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 30000 })
await page.click('button.shape-review-btn')
await page.waitForSelector('.shape-board path.shape-slice', { timeout: 20000 })
await new Promise((r) => setTimeout(r, 700))

for (const letter of UPPERCASE_LETTERS) {
  const index = letter.charCodeAt(0) - 64
  if (letter !== 'A') {
    await page.click(`.letter-grid .letter-btn:nth-child(${index})`)
    await new Promise((r) => setTimeout(r, 700))
  }
  await page.screenshot({ path: `scripts/out/preview-${letter}.png`, fullPage: true })
  const stats = await page.evaluate(() => ({
    hint: document.querySelector('.shape-hint')?.textContent?.trim() ?? '',
    sliceCount: document.querySelectorAll('.shape-slice').length,
  }))
  console.log(letter, JSON.stringify(stats))
}

await browser.close()
