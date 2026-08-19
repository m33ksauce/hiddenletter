import { useCallback, useRef, type PointerEvent } from 'react'
import { cellToPath } from '../lib/geometry'
import { ERASER_ID } from '../lib/colors'
import type { Puzzle } from '../lib/types'

type PuzzleBoardProps = {
  puzzle: Puzzle
  fills: Record<string, string>
  selectedColor: string
  onPaint: (cellId: string) => void
  solved: boolean
  revealed: boolean
  revealColor: string
}

export function PuzzleBoard({
  puzzle,
  fills,
  selectedColor,
  onPaint,
  solved,
  revealed,
  revealColor,
}: PuzzleBoardProps) {
  const painting = useRef(false)
  const lastCell = useRef<string | null>(null)

  const paintFromEvent = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      const node = document.elementFromPoint(event.clientX, event.clientY)
      const host = node?.closest('[data-cell-id]')
      const cellId = host?.getAttribute('data-cell-id')
      if (!cellId || cellId === lastCell.current) return
      lastCell.current = cellId
      onPaint(cellId)
    },
    [onPaint],
  )

  return (
    <svg
      className={`board ${solved ? 'is-solved' : ''} ${revealed ? 'is-revealed' : ''}`}
      viewBox={`0 0 ${puzzle.width} ${puzzle.height}`}
      role="img"
      aria-label={`Coloring puzzle for the letter ${puzzle.letter}`}
      onPointerDown={(event) => {
        event.preventDefault()
        painting.current = true
        lastCell.current = null
        event.currentTarget.setPointerCapture(event.pointerId)
        paintFromEvent(event)
      }}
      onPointerMove={(event) => {
        if (!painting.current) return
        paintFromEvent(event)
      }}
      onPointerUp={() => {
        painting.current = false
        lastCell.current = null
      }}
      onPointerCancel={() => {
        painting.current = false
        lastCell.current = null
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <g className="board-shapes">
        {puzzle.cells.map((cell) => {
          const fill = revealed && cell.isSolution ? revealColor : (fills[cell.id] ?? '#fffdf8')
          return (
            <g key={cell.id} data-cell-id={cell.id}>
              <path
                className={`cell-shape ${revealed && cell.isSolution ? 'is-answer' : ''}`}
                d={cellToPath(cell.rings, cell.bulges)}
                fill={fill}
                fillRule="evenodd"
                style={{ cursor: selectedColor === ERASER_ID ? 'cell' : 'pointer' }}
              />
            </g>
          )
        })}
      </g>
      <g className="board-labels">
        {puzzle.cells.map((cell) =>
          cell.labelSize >= 8 ? (
            <text
              key={`${cell.id}-label`}
              className="cell-label"
              x={cell.labelAnchor[0]}
              y={cell.labelAnchor[1]}
              fontSize={cell.labelSize}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {cell.label}
            </text>
          ) : null,
        )}
      </g>
    </svg>
  )
}
