import { useCallback, useEffect, useMemo, useState } from 'react'
import { outlineToPath } from '../lib/baseShape'
import { cellToPath } from '../lib/geometry'
import { loadBaseLetterShape, type BaseLetterShape } from '../lib/letterMask'
import { curveVoronoiGraphForPreview, graphVoronoiCellsForPreview } from '../lib/curveVoronoiMesh'
import { sliceSeedForLetter } from '../lib/sliceCanvas'
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

  const graph = useMemo(() => {
    if (!shape) return null
    return curveVoronoiGraphForPreview(shape.outline, shape.width, density, sliceSeedForLetter(selected))
  }, [density, selected, shape])

  const voronoiCells = useMemo(() => {
    if (!shape) return []
    return graphVoronoiCellsForPreview(shape.outline, shape.width, density, sliceSeedForLetter(selected))
  }, [density, selected, shape])

  return (
    <main className="shape-preview">
      <p className="eyebrow">Step 2 — slice the base</p>
      <h1>Solution pieces</h1>
      <p className="lede">
        Graph nodes define sites; Voronoi cells are built separately per
        region (interior vs exterior), then clipped to the letter.
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
            {voronoiCells.map((cell, index) => (
              <path
                key={`voronoi-${cell.siteId}-${index}`}
                d={cellToPath(cell.rings)}
                fill={cell.region === 'interior' ? '#ffd166' : 'rgba(147, 197, 253, 0.35)'}
                stroke="#111"
                strokeWidth="2.5"
                fillRule="evenodd"
              />
            ))}
            <path
              className="shape-outline"
              d={outlineToPath(shape.outline)}
              fill="none"
              fillRule="evenodd"
            />
            {graph?.curves.map((curve, i) => {
              const siteA = graph.sites.find((s) => s.id === curve.a)
              const siteB = graph.sites.find((s) => s.id === curve.b)
              const cross =
                siteA && siteB && siteA.region !== siteB.region
              return (
                <polyline
                  key={`curve-${i}`}
                  points={curve.points.map((p) => `${p[0]},${p[1]}`).join(' ')}
                  fill="none"
                  stroke={cross ? '#a855f7' : siteA?.region === 'interior' ? '#ef4444' : '#3b82f6'}
                  strokeWidth={cross ? 2 : 1.5}
                  opacity={cross ? 0.7 : 0.45}
                  strokeDasharray={cross ? '6 4' : undefined}
                />
              )
            })}
            {graph?.sites.map((site) => (
              <circle
                key={`site-${site.id}`}
                cx={site.point[0]}
                cy={site.point[1]}
                r={site.region === 'interior' ? 5 : 4}
                fill={site.region === 'interior' ? '#ef4444' : '#3b82f6'}
                stroke="#fff"
                strokeWidth="1"
              />
            ))}
          </svg>
        ) : null}
      </div>

      <p className="hint shape-hint">
        {voronoiCells.filter((c) => c.region === 'interior').length} interior Voronoi
        cells at this difficulty. Adjust the slider to change site count.
      </p>
    </main>
  )
}
