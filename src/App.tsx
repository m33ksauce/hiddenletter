import { useCallback, useEffect, useState } from 'react'
import { ShapePreview } from './components/ShapePreview'
import { GameScreen } from './components/GameScreen'
import { LetterPicker } from './components/LetterPicker'
import { DEFAULT_COLOR } from './lib/colors'
import { isDebugToolsEnabled } from './lib/features'
import { clampDensity, DEFAULT_DENSITY } from './lib/difficulty'
import { generatePuzzle } from './lib/generatePuzzle'
import { loadState, saveState } from './lib/storage'
import { GAME_STATE_VERSION } from './lib/types'
import type { GameState } from './lib/types'

export default function App() {
  const [state, setState] = useState<GameState | null>(() => loadState())
  const [density, setDensity] = useState(() =>
    clampDensity(loadState()?.density ?? DEFAULT_DENSITY),
  )
  const [screen, setScreen] = useState<'picker' | 'game' | 'shapes'>(() => {
    if (loadState()) return 'game'
    return 'picker'
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (state) {
      saveState(state)
    }
  }, [state])

  const startLetter = useCallback(async (letter: string) => {
    setError(null)
    setBusy(true)
    try {
      const puzzle = await generatePuzzle(letter, density)
      setState((current) => ({
        version: GAME_STATE_VERSION,
        puzzle,
        fills: {},
        selectedColor: current?.selectedColor ?? DEFAULT_COLOR,
        density,
      }))
      setScreen('game')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not make that puzzle.')
      setScreen('picker')
    } finally {
      setBusy(false)
    }
  }, [density])

  function handleGameChange(next: GameState) {
    setState(next)
    setDensity(next.density)
  }

  if (busy && (screen === 'picker' || !state)) {
    return (
      <div className="splash">
        <p>Drawing a hidden letter…</p>
      </div>
    )
  }

  if (isDebugToolsEnabled() && screen === 'shapes') {
    return (
      <ShapePreview
        density={density}
        onDensityChange={setDensity}
        onBack={() => setScreen('picker')}
        onPlay={(letter) => void startLetter(letter)}
      />
    )
  }

  if (screen === 'picker' || !state) {
    return (
      <>
        <LetterPicker
          onPick={(letter) => void startLetter(letter)}
          density={density}
          onDensityChange={setDensity}
          continueLetter={state?.puzzle.letter}
          onContinue={state ? () => setScreen('game') : undefined}
          onPreviewShapes={isDebugToolsEnabled() ? () => setScreen('shapes') : undefined}
        />
        {error ? <p className="error picker-error">{error}</p> : null}
      </>
    )
  }

  return (
    <GameScreen
      state={state}
      busy={busy}
      onChange={handleGameChange}
      onNewLetter={() => setScreen('picker')}
    />
  )
}
