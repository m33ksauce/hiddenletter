import '@fontsource-variable/fredoka'
import { letterOutlinePath } from './letters'
import { traceLetter } from './letterShape'
import type { MultiPolygon } from 'polygon-clipping'

export const LETTER_FONT = 'Fredoka Variable'
export const PUZZLE_SIZE = 1000

export type LetterMask = {
  width: number
  height: number
  isInk: (x: number, y: number) => boolean
  isHole: (x: number, y: number) => boolean
  inkPoints: Array<[number, number]>
  backgroundPoints: Array<[number, number]>
  holePoints: Array<[number, number]>
  pixels: Uint8Array
}

export type BaseLetterShape = {
  letter: string
  width: number
  height: number
  mask: LetterMask
  outline: MultiPolygon
}

type CachedLetterShape = {
  letter: string
  width: number
  height: number
  outline: MultiPolygon
}

const outlineCache = new Map<string, Promise<CachedLetterShape | null>>()

function loadCachedLetterShape(letter: string): Promise<CachedLetterShape | null> {
  const cached = outlineCache.get(letter)
  if (cached) return cached

  const request = fetch(letterOutlinePath(letter))
    .then(async (response) => {
      if (!response.ok) return null
      return (await response.json()) as CachedLetterShape
    })
    .catch(() => null)

  outlineCache.set(letter, request)
  return request
}

function stubMask(size: number): LetterMask {
  return {
    width: size,
    height: size,
    isInk: () => false,
    isHole: () => false,
    inkPoints: [],
    backgroundPoints: [],
    holePoints: [],
    pixels: new Uint8Array(size * size),
  }
}

function sampleStep(size: number): number {
  return Math.max(4, Math.round(size / 180))
}

/** Close hairline gaps that would merge counters (B, 8) without growing the silhouette. */
function sealPinholes(pixels: Uint8Array, width: number, height: number) {
  const dilated = new Uint8Array(pixels)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      if (pixels[i] === 1) continue
      if (
        pixels[i - 1] === 1 ||
        pixels[i + 1] === 1 ||
        pixels[i - width] === 1 ||
        pixels[i + width] === 1
      ) {
        dilated[i] = 1
      }
    }
  }
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      pixels[i] =
        dilated[i] === 1 &&
        dilated[i - 1] === 1 &&
        dilated[i + 1] === 1 &&
        dilated[i - width] === 1 &&
        dilated[i + width] === 1
          ? 1
          : 0
    }
  }
}

function markReachableBackground(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const reachable = new Uint8Array(width * height)
  const stack: number[] = []

  const tryPush = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const index = y * width + x
    if (pixels[index] === 1 || reachable[index] === 1) return
    reachable[index] = 1
    stack.push(index)
  }

  for (let x = 0; x < width; x++) {
    tryPush(x, 0)
    tryPush(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    tryPush(0, y)
    tryPush(width - 1, y)
  }

  while (stack.length > 0) {
    const index = stack.pop()
    if (index === undefined) break
    const x = index % width
    const y = (index / width) | 0
    tryPush(x + 1, y)
    tryPush(x - 1, y)
    tryPush(x, y + 1)
    tryPush(x, y - 1)
  }

  return reachable
}

/** Filled glyph silhouette — the iteration-2 base shape with holes preserved. */
export async function createBaseLetterMask(letter: string, size = PUZZLE_SIZE): Promise<LetterMask> {
  await document.fonts.load(`700 ${size}px "${LETTER_FONT}"`)
  await document.fonts.ready

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('Could not create a drawing canvas')
  }

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  const pad = size * 0.08
  const maxDim = size - pad * 2
  ctx.font = `700 ${size}px "${LETTER_FONT}"`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  const probe = ctx.measureText(letter)
  const glyphW = Math.max(
    1,
    (probe.actualBoundingBoxLeft ?? 0) + (probe.actualBoundingBoxRight ?? probe.width),
  )
  const glyphH = Math.max(
    1,
    (probe.actualBoundingBoxAscent ?? size * 0.7) + (probe.actualBoundingBoxDescent ?? size * 0.2),
  )
  const fontSize = Math.floor(size * Math.min(maxDim / glyphW, maxDim / glyphH))

  ctx.font = `700 ${fontSize}px "${LETTER_FONT}"`
  const metrics = ctx.measureText(letter)
  const ascent = metrics.actualBoundingBoxAscent ?? fontSize * 0.72
  const descent = metrics.actualBoundingBoxDescent ?? fontSize * 0.18
  const baseline = (size - (ascent + descent)) / 2 + ascent

  ctx.fillStyle = '#000000'
  ctx.fillText(letter, size / 2, baseline)

  const image = ctx.getImageData(0, 0, size, size)
  const data = image.data
  const inkGrid = new Uint8Array(size * size)

  for (let i = 0; i < size * size; i++) {
    const red = data[i * 4] ?? 255
    inkGrid[i] = red < 128 ? 1 : 0
  }
  sealPinholes(inkGrid, size, size)

  const exterior = markReachableBackground(inkGrid, size, size)
  const holeGrid = new Uint8Array(size * size)
  for (let i = 0; i < size * size; i++) {
    if (inkGrid[i] === 0 && exterior[i] === 0) holeGrid[i] = 1
  }

  const isInk = (x: number, y: number) => {
    const ix = Math.max(0, Math.min(size - 1, Math.round(x)))
    const iy = Math.max(0, Math.min(size - 1, Math.round(y)))
    return inkGrid[iy * size + ix] === 1
  }

  const isHole = (x: number, y: number) => {
    const ix = Math.max(0, Math.min(size - 1, Math.round(x)))
    const iy = Math.max(0, Math.min(size - 1, Math.round(y)))
    return holeGrid[iy * size + ix] === 1
  }

  const step = sampleStep(size)
  const inkPoints: Array<[number, number]> = []
  const backgroundPoints: Array<[number, number]> = []
  const holePoints: Array<[number, number]> = []

  for (let y = step / 2; y < size; y += step) {
    for (let x = step / 2; x < size; x += step) {
      if (isInk(x, y)) {
        inkPoints.push([x, y])
      } else if (isHole(x, y)) {
        holePoints.push([x, y])
      } else {
        backgroundPoints.push([x, y])
      }
    }
  }

  if (inkPoints.length < 12) {
    throw new Error('Could not draw that letter. Try another one.')
  }

  return {
    width: size,
    height: size,
    isInk,
    isHole,
    inkPoints,
    backgroundPoints,
    holePoints,
    pixels: inkGrid,
  }
}

export async function loadBaseLetterShape(letter: string, size = PUZZLE_SIZE): Promise<BaseLetterShape> {
  const cached = await loadCachedLetterShape(letter)
  if (cached?.outline?.length) {
    const mask = stubMask(cached.width)
    return {
      letter: cached.letter,
      width: cached.width,
      height: cached.height,
      mask,
      outline: cached.outline,
    }
  }

  const mask = await createBaseLetterMask(letter, size)
  const outline = traceLetter(mask.pixels, mask.width, mask.height)
  if (outline.length === 0) {
    throw new Error('Could not trace that letter shape.')
  }
  return { letter, width: mask.width, height: mask.height, mask, outline }
}

/** @deprecated Use createBaseLetterMask — puzzle generation will move to shape slicing next. */
export async function createLetterMask(letter: string, size = PUZZLE_SIZE): Promise<LetterMask> {
  return createBaseLetterMask(letter, size)
}

export async function createCoreLetterMask(letter: string, size = PUZZLE_SIZE): Promise<LetterMask> {
  return createBaseLetterMask(letter, size)
}
