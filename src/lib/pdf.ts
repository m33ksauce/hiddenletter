import { jsPDF } from 'jspdf'
import { uniqueRing } from './geometry'
import type { Puzzle } from './types'

function drawRing(
  doc: jsPDF,
  ring: Array<[number, number]>,
  originX: number,
  originY: number,
  scale: number,
  style: 'S' | 'FD',
) {
  const open = uniqueRing(ring)
  const start = open[0]
  if (!start || open.length < 3) return

  const lines: Array<[number, number]> = []
  for (let i = 1; i < open.length; i++) {
    const previous = open[i - 1]
    const current = open[i]
    if (!previous || !current) continue
    lines.push([(current[0] - previous[0]) * scale, (current[1] - previous[1]) * scale])
  }

  doc.lines(lines, originX + start[0] * scale, originY + start[1] * scale, [1, 1], style, true)
}

function puzzlePdfName(puzzle: Puzzle): string {
  return `hidden-letter-${puzzle.letter}.pdf`
}

function dottedBaseline(doc: jsPDF, x: number, y: number, width: number) {
  doc.setDrawColor(160, 160, 170)
  doc.setLineWidth(0.6)
  doc.setLineDashPattern([1.2, 2.2], 0)
  doc.line(x, y, x + width, y)
  doc.line(x, y - 16, x + width, y - 16)
  doc.line(x, y - 32, x + width, y - 32)
  doc.setLineDashPattern([], 0)
}

export function printPuzzle(puzzle: Puzzle): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 40
  const letter = puzzle.letter

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(40, 40, 50)
  doc.text('Hidden Letter Puzzle', margin, 46)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(13)
  doc.text('Name: ____________________', pageW - margin, 46, { align: 'right' })

  const boxTop = 62
  const boxH = 52
  const boxW = pageW - margin * 2 - 210
  doc.setDrawColor(40, 40, 50)
  doc.setLineWidth(1.1)
  doc.rect(margin, boxTop, boxW, boxH)

  doc.setFontSize(13)
  doc.setTextColor(40, 40, 50)
  doc.text(`Color the ${letter} sections.`, margin + 12, boxTop + 22)
  doc.text('Color the other sections a different color.', margin + 12, boxTop + 40)

  const writeX = margin + boxW + 16
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Write the letter', writeX, boxTop + 12)
  dottedBaseline(doc, writeX, boxTop + boxH - 4, 194)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(22)
  doc.setTextColor(190, 190, 198)
  doc.text(letter, writeX + 10, boxTop + 42)

  const top = boxTop + boxH + 16
  const bottom = pageH - 28
  const availW = pageW - margin * 2
  const availH = bottom - top
  const side = Math.min(availW, availH)
  const originX = (pageW - side) / 2
  const originY = top + (availH - side) / 2
  const scale = side / puzzle.width

  doc.setDrawColor(45, 42, 58)
  doc.setFillColor(255, 255, 255)
  doc.setLineWidth(0.9)
  doc.setTextColor(45, 42, 58)

  for (const cell of puzzle.cells) {
    const outer = cell.rings[0]
    if (!outer || outer.length < 3) continue
    doc.setFillColor(255, 255, 255)
    drawRing(doc, outer, originX, originY, scale, 'FD')
  }

  for (const cell of puzzle.cells) {
    if (cell.labelSize < 8) continue
    const fontSize = Math.max(10, cell.labelSize * scale * 0.72)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(fontSize)
    doc.text(cell.label, originX + cell.labelAnchor[0] * scale, originY + cell.labelAnchor[1] * scale, {
      align: 'center',
      baseline: 'middle',
    })
  }

  const filename = puzzlePdfName(puzzle)

  try {
    doc.autoPrint()
    const blobUrl = doc.output('bloburl')
    const popup = window.open(blobUrl, '_blank')
    if (!popup) doc.save(filename)
  } catch {
    doc.save(filename)
  }
}
