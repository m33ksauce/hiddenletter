import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ColorPalette } from './ColorPalette'
import { DifficultyMeter } from './DifficultyMeter'
import { PuzzleBoard } from './PuzzleBoard'
import { DEFAULT_COLOR, ERASER_ID, isPaletteColor } from '../lib/colors'
import { clampDensity } from '../lib/difficulty'
import { generatePuzzle } from '../lib/generatePuzzle'
import { printPuzzle } from '../lib/pdf'
import type { GameState } from '../lib/types'

type GameScreenProps = {
  state: GameState
  busy: boolean
  onChange: (state: GameState) => void
  onNewLetter: () => void
}

export function GameScreen({ state, busy, onChange, onNewLetter }: GameScreenProps) {
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [densityDraft, setDensityDraft] = useState(state.density)
  const { puzzle, fills, selectedColor } = state
  const letter = puzzle.letter
  const isBusy = busy || working
  const requestId = useRef(0)
  const stateRef = useRef(state)
  const onChangeRef = useRef(onChange)
  stateRef.current = state
  onChangeRef.current = onChange

  useEffect(() => {
    setDensityDraft(state.density)
  }, [state.density])

  const solved = useMemo(() => {
    return puzzle.cells
      .filter((cell) => cell.isSolution)
      .every((cell) => Boolean(fills[cell.id]))
  }, [fills, puzzle.cells])

  const revealColor = isPaletteColor(selectedColor) ? selectedColor : DEFAULT_COLOR

  const paint = useCallback(
    (cellId: string) => {
      const nextFills = { ...fills }
      if (selectedColor === ERASER_ID) {
        if (!(cellId in nextFills)) return
        delete nextFills[cellId]
      } else if (nextFills[cellId] === selectedColor) {
        return
      } else {
        nextFills[cellId] = selectedColor
      }
      onChange({ ...state, fills: nextFills })
    },
    [fills, onChange, selectedColor, state],
  )

  const buildPuzzle = useCallback(async (density: number, shuffle = false) => {
    const nextDensity = clampDensity(density)
    const latest = stateRef.current
    const id = requestId.current + 1
    requestId.current = id
    setError(null)
    setWorking(true)
    setRevealed(false)
    try {
      const nextPuzzle = await generatePuzzle(latest.puzzle.letter, nextDensity, shuffle)
      if (requestId.current !== id) return
      onChangeRef.current({
        ...latest,
        puzzle: nextPuzzle,
        fills: {},
        density: nextDensity,
      })
    } catch (err) {
      if (requestId.current !== id) return
      setError(err instanceof Error ? err.message : 'Could not make a new puzzle.')
    } finally {
      if (requestId.current === id) setWorking(false)
    }
  }, [])

  useEffect(() => {
    if (densityDraft === state.density) return
    const timer = window.setTimeout(() => {
      void buildPuzzle(densityDraft)
    }, 280)
    return () => window.clearTimeout(timer)
  }, [buildPuzzle, densityDraft, state.density])

  return (
    <main className="game">
      <header className="game-header no-print">
        <div className="game-heading">
          <div>
            <p className="eyebrow">Hidden Letter</p>
            <h1>
              Color every <span className="target-letter">{letter}</span>
            </h1>
          </div>
          <div className="actions">
            <button type="button" className="ghost" onClick={onNewLetter} disabled={isBusy}>
              New letter
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => void buildPuzzle(state.density, true)}
              disabled={isBusy}
            >
              New puzzle
            </button>
            <button
              type="button"
              className={`ghost ${revealed ? 'is-active' : ''}`}
              onClick={() => setRevealed((open) => !open)}
              disabled={isBusy}
            >
              {revealed ? 'Hide' : 'Reveal'}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => printPuzzle(puzzle)}
              disabled={isBusy}
            >
              Print
            </button>
          </div>
        </div>
        <DifficultyMeter value={densityDraft} disabled={isBusy} onChange={setDensityDraft} />
      </header>

      <section className="print-banner print-only" aria-hidden="true">
        <div className="print-banner-top">
          <h1>Hidden Letter Puzzle</h1>
          <p className="print-name">Name: ______________</p>
        </div>
        <div className="print-instructions">
          <p>Color the {letter} sections.</p>
          <p>Color the other sections a different color.</p>
        </div>
      </section>

      {error ? <p className="error no-print">{error}</p> : null}

      {solved ? (
        <p className="win no-print" role="status">
          You found the letter {letter}!
        </p>
      ) : (
        <p className="mission no-print">
          {revealed
            ? `Here is every ${letter} piece.`
            : `Color every ${letter} piece. They are simple jigsaw tiles — together they make the letter.`}
        </p>
      )}

      <div className={`board-wrap ${isBusy ? 'is-busy' : ''}`}>
        {isBusy ? <p className="busy no-print">Making a new puzzle…</p> : null}
        <PuzzleBoard
          puzzle={puzzle}
          fills={fills}
          selectedColor={selectedColor}
          onPaint={paint}
          solved={solved}
          revealed={revealed}
          revealColor={revealColor}
        />
      </div>

      <div className="no-print">
        <ColorPalette
          selected={selectedColor}
          onSelect={(value) => onChange({ ...state, selectedColor: value })}
        />
      </div>
    </main>
  )
}
