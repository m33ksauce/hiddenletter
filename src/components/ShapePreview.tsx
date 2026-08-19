import { useCallback, useEffect, useMemo, useState } from 'react'
import { outlineToPath } from '../lib/baseShape'
import { cellToPath } from '../lib/geometry'
import { loadBaseLetterShape, type BaseLetterShape } from '../lib/letterMask'
import { sliceSeedForLetter, sliceSolutionOnly } from '../lib/sliceCanvas'
import { DifficultyMeter } from './DifficultyMeter'

import { UPPERCASE_LETTERS } from '../lib/letters'

type ShapePreviewProps = {
  density: number
  onDensityChange: (value: number) => void
  onBack: () => void
  onPlay: (letter: string) => void
}

export function ShapePreview({ density, onDensityChange, onBack, onPlay }: ShapePreviewProps) {
  const [uppercase, setUppercase] = useState(true)
  const [selected, setSelected] = useState('A')
  const [shape, setShape] = useState<BaseLetterShape | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadShape = useCallback(async (letter: string) => {
    setLoading(true)
    setError(null)
    try {
      const next = await loadBaseLetterShape(letter)
      setShape(next)
    } catch (err) {
      setShape(null)
      setError(err instanceof Error ? err.message : 'Could not load that shape.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadShape(selected)
  }, [loadShape, selected])

  const slices = useMemo(() => {
    if (!shape) return []
    return sliceSolutionOnly(shape.outline, shape.width, density, sliceSeedForLetter(selected))
  }, [density, selected, shape])

  return (
    <main className="shape-preview">
      <p className="eyebrow">Step 2 — slice the base</p>
      <h1>Solution pieces</h1>
      <p className="lede">
        Each piece crosses a stroke from outline to outline. Cuts follow the
        letter, stay short, and do not sit side-by-side on one edge. Holes
        stay empty.
      </p>

      <DifficultyMeter value={density} onChange={onDensityChange} />

      <div className="shape-actions">
        <button type="button" className="ghost" onClick={onBack}>
          Back to picker
        </button>
        <button type="button" className="continue" onClick={() => onPlay(selected)}>
          Play with {selected}
        </button>
      </div>

      <div className="case-toggle" role="tablist" aria-label="Letter case">
        <button
          type="button"
          role="tab"
          aria-selected={uppercase}
          className={uppercase ? 'is-active' : ''}
          onClick={() => {
            setUppercase(true)
            setSelected('A')
          }}
        >
          ABC
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!uppercase}
          className={!uppercase ? 'is-active' : ''}
          onClick={() => {
            setUppercase(false)
            setSelected('a')
          }}
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
              className={`letter-btn ${selected === value ? 'is-active' : ''}`}
              onClick={() => setSelected(value)}
            >
              {value}
            </button>
          )
        })}
      </div>

      <div className={`shape-stage ${loading ? 'is-loading' : ''}`}>
        {loading ? <p className="shape-status">Drawing {selected}…</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {shape && !error ? (
          <svg
            className="shape-board"
            viewBox={`0 0 ${shape.width} ${shape.height}`}
            role="img"
            aria-label={`Sliced base shape for ${shape.letter}`}
          >
            <rect width={shape.width} height={shape.height} fill="#fffdf8" />
            {slices.map((piece, index) => (
              <path
                key={`slice-${index}`}
                className="shape-slice"
                d={cellToPath(piece.rings, piece.bulges)}
                fill="#ffd166"
                fillRule="evenodd"
              />
            ))}
            <path
              className="shape-outline"
              d={outlineToPath(shape.outline)}
              fill="none"
              fillRule="evenodd"
            />
          </svg>
        ) : null}
      </div>

      <p className="hint shape-hint">
        {slices.length} solution pieces at this difficulty. Adjust the slider to change piece count.
      </p>
    </main>
  )
}
