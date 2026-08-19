import { ringsToPath } from './geometry'
import type { MultiPolygon } from 'polygon-clipping'
import type { Point } from './types'

export function outlineToPath(outline: MultiPolygon): string {
  return outline
    .map((polygon) => ringsToPath(polygon.map((ring) => ring as Point[])))
    .join(' ')
}
