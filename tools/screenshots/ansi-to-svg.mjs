// Turns the last frame of a popup transcript (raw terminal output with ANSI colours) into an SVG
// "screenshot": a dark window with monospace text, one <text> per styled run, each pinned to its exact
// cell width so columns stay aligned whatever font the viewer has.
//   node ansi-to-svg.mjs <transcript> <out.svg> <cols> <rows> [title]
import fs from 'node:fs'

const [transcript, output, colsArg, rowsArg, title = 'herdr'] = process.argv.slice(2)
const cols = Number(colsArg)
const rows = Number(rowsArg)

const PALETTE = {
  bg: '#1e2127',
  chrome: '#2b303b',
  fg: '#c8ccd4',
  border: '#3b4048',
  colors: ['#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#dcdfe4'],
}
const FONT = 15
const CELL_W = FONT * 0.6
const CELL_H = Math.round(FONT * 1.36)
const PAD = 18
const BAR = 40

const raw = fs.readFileSync(transcript, 'latin1')
const text = Buffer.from(raw, 'latin1').toString('utf8')
// Frames start with "ESC[H ESC[2J"; the last one is the screenshot.
const frames = text.split('\x1b[H\x1b[2J')
let frame = frames.at(-1)
frame = frame.replace(/\x1b\[\?25[hl]/g, '').replace(/\x1b\[\?1049[hl]/g, '').replace(/\x1b\[\d+;\d+H[\s\S]*$/, '')

const parseLine = line => {
  const runs = []
  const state = { bold: false, dim: false, italic: false, strike: false, fg: null }
  let current = { ...state, text: '' }
  const flush = () => {
    if (current.text) runs.push(current)
    current = { ...state, text: '' }
  }
  let index = 0
  while (index < line.length) {
    if (line[index] === '\x1b') {
      const match = /^\x1b\[([0-9;?]*)([A-Za-z])/.exec(line.slice(index))
      if (!match) {
        index++
        continue
      }
      if (match[2] === 'm') {
        flush()
        for (const code of (match[1] || '0').split(';').map(Number)) {
          if (code === 0) Object.assign(state, { bold: false, dim: false, italic: false, strike: false, fg: null })
          else if (code === 1) state.bold = true
          else if (code === 2) state.dim = true
          else if (code === 3) state.italic = true
          else if (code === 9) state.strike = true
          else if (code === 22) state.bold = state.dim = false
          else if (code === 23) state.italic = false
          else if (code === 29) state.strike = false
          else if (code === 39) state.fg = null
          else if (code >= 30 && code <= 37) state.fg = code - 30
          else if (code >= 90 && code <= 97) state.fg = code - 90
        }
        current = { ...state, text: '' }
      }
      index += match[0].length
      continue
    }
    const char = [...line.slice(index)][0]
    current.text += char
    index += char.length
  }
  flush()

  return runs
}

const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const lines = frame.split('\n').slice(0, rows)
while (lines.length < rows) lines.push('')

const width = cols * CELL_W + PAD * 2
const height = rows * CELL_H + BAR + PAD * 2
const parts = []
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" font-size="${FONT}">`)
parts.push(`<rect width="${width}" height="${height}" rx="12" fill="${PALETTE.bg}" stroke="${PALETTE.border}"/>`)
parts.push(`<path d="M12 0h${width - 24}a12 12 0 0 1 12 12v${BAR - 12}H0V12A12 12 0 0 1 12 0z" fill="${PALETTE.chrome}"/>`)
for (const [index, color] of ['#ff5f57', '#febc2e', '#28c840'].entries()) parts.push(`<circle cx="${22 + index * 22}" cy="${BAR / 2}" r="6.5" fill="${color}"/>`)
parts.push(`<text x="${width / 2}" y="${BAR / 2 + 5}" text-anchor="middle" fill="#9da5b4" font-size="13">${escape(title)}</text>`)

lines.forEach((line, row) => {
  let col = 0
  const y = BAR + PAD + row * CELL_H + CELL_H - 5
  for (const run of parseLine(line)) {
    const chars = [...run.text]
    if (run.text.trim()) {
      const fill = run.fg === null ? PALETTE.fg : PALETTE.colors[run.fg]
      const attrs = [
        `x="${(PAD + col * CELL_W).toFixed(1)}"`,
        `y="${y}"`,
        `textLength="${(chars.length * CELL_W).toFixed(1)}"`,
        'lengthAdjust="spacingAndGlyphs"',
        'xml:space="preserve"',
        `fill="${fill}"`,
        run.bold ? 'font-weight="bold"' : '',
        run.italic ? 'font-style="italic"' : '',
        run.strike ? 'text-decoration="line-through"' : '',
        run.dim ? 'opacity="0.55"' : '',
      ].filter(Boolean)
      parts.push(`<text ${attrs.join(' ')}>${escape(run.text)}</text>`)
    }
    col += chars.length
  }
})
parts.push('</svg>')
fs.writeFileSync(output, `${parts.join('\n')}\n`)
console.log(`${output}: ${lines.length} rows × ${cols} cols, ${frames.length - 1} frames in transcript`)
