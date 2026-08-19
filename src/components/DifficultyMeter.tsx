import { densityHint, MAX_DENSITY, MIN_DENSITY } from '../lib/difficulty'

type DifficultyMeterProps = {
  value: number
  disabled?: boolean
  onChange: (value: number) => void
}

export function DifficultyMeter({ value, disabled, onChange }: DifficultyMeterProps) {
  return (
    <div className="density">
      <div className="density-head">
        <p className="density-title">Difficulty</p>
        <p className="density-hint">{densityHint(value)}</p>
      </div>
      <div className="density-row">
        <span>Easy</span>
        <input
          type="range"
          min={MIN_DENSITY}
          max={MAX_DENSITY}
          step={1}
          value={value}
          disabled={disabled}
          aria-label="Puzzle difficulty"
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span>Hard</span>
      </div>
    </div>
  )
}
