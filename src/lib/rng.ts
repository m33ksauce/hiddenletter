export type Rng = () => number

export function randomSeed(): number {
  const bytes = new Uint32Array(1)
  crypto.getRandomValues(bytes)
  return bytes[0] ?? Date.now()
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const next = items.slice()
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const current = next[i]
    const swap = next[j]
    if (current === undefined || swap === undefined) continue
    next[i] = swap
    next[j] = current
  }
  return next
}

export function pickOne<T>(items: readonly T[], rng: Rng): T {
  const item = items[Math.floor(rng() * items.length)]
  if (item === undefined) {
    throw new Error('Cannot pick from an empty list')
  }
  return item
}
