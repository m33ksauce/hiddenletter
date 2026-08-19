export const PALETTE = [
  { id: 'red', name: 'Red', hex: '#e53935' },
  { id: 'orange', name: 'Orange', hex: '#fb8c00' },
  { id: 'yellow', name: 'Yellow', hex: '#fdd835' },
  { id: 'green', name: 'Green', hex: '#43a047' },
  { id: 'blue', name: 'Blue', hex: '#1e88e5' },
  { id: 'purple', name: 'Purple', hex: '#8e24aa' },
  { id: 'pink', name: 'Pink', hex: '#ec407a' },
  { id: 'brown', name: 'Brown', hex: '#6d4c41' },
] as const

export const ERASER_ID = 'eraser'

export const DEFAULT_COLOR = PALETTE[0].hex

export function isPaletteColor(value: string): boolean {
  return PALETTE.some((color) => color.hex === value)
}
