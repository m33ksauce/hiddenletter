export const MIN_DENSITY = 1
export const MAX_DENSITY = 5
export const DEFAULT_DENSITY = 3

export function clampDensity(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_DENSITY
  return Math.max(MIN_DENSITY, Math.min(MAX_DENSITY, Math.round(numeric)))
}

export function densityHint(density: number): string {
  const plan = densityPlan(density, 512)
  return `About ${plan.siteCount} blocks`
}

export function densityPlan(density: number, size: number) {
  const level = clampDensity(density)
  const t = (level - MIN_DENSITY) / (MAX_DENSITY - MIN_DENSITY)
  const siteCount = Math.round(12 + t * 24)
  const minDist = size / Math.sqrt(siteCount * 0.88)
  const targetArea = (size * size) / siteCount

  return {
    siteCount,
    minDist,
    targetArea,
    mergeBelow: targetArea * 0.45,
    minCells: Math.round(siteCount * 0.8),
    minSolution: 5,
    labelSize: Math.max(22, Math.min(42, Math.sqrt(targetArea) * 0.28)),
  }
}
