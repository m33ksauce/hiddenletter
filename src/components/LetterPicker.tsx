import { useEffect, useState } from 'react'
import { DifficultyMeter } from './DifficultyMeter'

import { UPPERCASE_LETTERS } from '../lib/letters'

type LetterPickerProps = {
  onPick: (letter: string) => void
  density: number
  onDensityChange: (value: number) => void
  continueLetter?: string
  onContinue?: () => void
  onPreviewShapes?: () => void
}

export function LetterPicker({
  onPick,
  density,
  onDensityChange,
  continueLetter,
  onContinue,
  onPreviewShapes,
}: LetterPickerProps) {
  const [uppercase, setUppercase] = useState(true)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.length === 1 && /^[A-Za-z]$/.test(event.key)) {
        event.preventDefault()
        onPick(event.key)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onPick])

  return (
    <main className="picker">
      <p className="eyebrow">A writing trainer</p>
      <h1>Hidden Letter</h1>
      <p className="lede">
        Pick a letter. Color the matching puzzle pieces — they are big and
        simple, like a jigsaw for little hands. Together they make the letter.
      </p>

      <DifficultyMeter value={density} onChange={onDensityChange} />

      {onPreviewShapes ? (
        <button type="button" className="ghost shape-review-btn" onClick={onPreviewShapes}>
          Review base letter shapes
        </button>
      ) : null}

      {continueLetter && onContinue ? (
        <button type="button" className="continue" onClick={onContinue}>
          Keep coloring {continueLetter}
        </button>
      ) : null}

      <div className="case-toggle" role="tablist" aria-label="Letter case">
        <button
          type="button"
          role="tab"
          aria-selected={uppercase}
          className={uppercase ? 'is-active' : ''}
          onClick={() => setUppercase(true)}
        >
          ABC
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!uppercase}
          className={!uppercase ? 'is-active' : ''}
          onClick={() => setUppercase(false)}
        >
          abc
        </button>
      </div>

      <div className="letter-grid" role="list">
        {UPPERCASE_LETTERS.map((letter) => {
          const value = uppercase ? letter : letter.toLowerCase()
          return (
            <button
              key={value}
              type="button"
              role="listitem"
              className="letter-btn"
              onClick={() => onPick(value)}
            >
              {value}
            </button>
          )
        })}
      </div>

      <p className="hint">You can also type a letter on a keyboard.</p>
    </main>
  )
}
