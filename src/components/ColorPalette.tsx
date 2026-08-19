import { ERASER_ID, PALETTE } from '../lib/colors'

type ColorPaletteProps = {
  selected: string
  onSelect: (value: string) => void
}

export function ColorPalette({ selected, onSelect }: ColorPaletteProps) {
  return (
    <div className="palette" role="radiogroup" aria-label="Crayon colors">
      {PALETTE.map((color) => {
        const isSelected = selected === color.hex
        return (
          <button
            key={color.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={color.name}
            className={`crayon ${isSelected ? 'is-selected' : ''}`}
            style={{ backgroundColor: color.hex }}
            onClick={() => onSelect(color.hex)}
          />
        )
      })}
      <button
        type="button"
        role="radio"
        aria-checked={selected === ERASER_ID}
        aria-label="Eraser"
        className={`eraser ${selected === ERASER_ID ? 'is-selected' : ''}`}
        onClick={() => onSelect(ERASER_ID)}
      >
        Wipe
      </button>
    </div>
  )
}
