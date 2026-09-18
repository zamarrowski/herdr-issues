// Minimal full-screen terminal UI helpers shared by the popups: raw-mode screen loop, frame pieces,
// key predicates, a progress "stepper" and a filterable list picker. No dependencies.
import { c, lineLR, paint, splitKeys, truncate, visibleWidth } from './format.mjs'

export const cols = () => process.stdout.columns || 100
export const rows = () => process.stdout.rows || 30

// ── frame pieces ────────────────────────────────────────────────────────────

export const header = (title, { subtitle = '', right = '' } = {}, width) =>
  lineLR(paint(c.bold, ` ${title}`) + (subtitle ? paint(c.dim, ` · ${subtitle}`) : ''), paint(c.dim, `${right} `), width)
export const rule = width => paint(c.dim, '─'.repeat(Math.max(0, width)))
export const hint = text => paint(c.dim, ` ${text}`)
export const notice = text => (text ? paint(c.yellow, ` ${text}`) : '')
export const field = (name, value, width) => ` ${paint(c.dim, name.padEnd(10))} ${truncate(String(value ?? ''), Math.max(1, width - 13))}`

// Body on top, footer pinned to the bottom, exactly `height` rows.
export const layout = (body, footer, height) => {
  const room = Math.max(0, height - footer.length)
  const out = body.slice(0, room)
  while (out.length < room) out.push('')

  return [...out, ...footer]
}

// Window of `items` around `cursor` that fits in `room` rows: { start, visible }.
export const window = (items, cursor, room) => {
  const size = Math.max(1, room)
  let start = 0
  if (items.length > size) start = Math.min(Math.max(0, cursor - Math.floor(size / 2)), items.length - size)

  return { start, visible: items.slice(start, start + size) }
}

export const STEP_ICON = { running: paint(c.yellow, '…'), done: paint(c.green, '✓'), error: paint(c.red, '✗'), info: paint(c.dim, '·') }
export const stepLines = steps => steps.map(step => ` ${STEP_ICON[step.status] ?? ' '} ${step.status === 'error' ? paint(c.red, step.text) : step.text}`)

// Collects onStep() callbacks from the start flow into a list for stepLines().
export const createStepper = (onChange = () => {}) => {
  const steps = []
  const closeRunning = status => {
    for (const step of steps) if (step.status === 'running') step.status = status
  }

  return {
    steps,
    begin: text => {
      closeRunning('done')
      steps.push({ text, status: 'running' })
      onChange()
    },
    done: text => {
      closeRunning('done')
      if (text) steps.push({ text, status: 'done' })
      onChange()
    },
    fail: text => {
      closeRunning('error')
      steps.push({ text, status: 'error' })
      onChange()
    },
  }
}

// ── keys ────────────────────────────────────────────────────────────────────

export const isUp = key => key === 'k' || key === '\x1b[A'
export const isDown = key => key === 'j' || key === '\x1b[B'
export const isArrowUp = key => key === '\x1b[A' || key === '\x1bOA'
export const isArrowDown = key => key === '\x1b[B' || key === '\x1bOB'
export const isEnter = key => key === '\r' || key === '\n'
export const isEsc = key => key === '\x1b'
export const isCtrlC = key => key === '\x03'
export const isBackspace = key => key === '\x7f' || key === '\b'
export const isEscapeSequence = key => key.length > 1 && key.startsWith('\x1b')
export const isPrintable = key => !isEscapeSequence(key) && !/[\x00-\x1f\x7f]/.test(key)

// One line of text editing: backspace, Ctrl+U clears, printable keys append.
export const editLine = (value, key) => {
  if (isBackspace(key)) return [...value].slice(0, -1).join('')
  if (key === '\x15') return ''
  if (isPrintable(key)) return value + key

  return value
}

export const inputRow = (label, value, width) => {
  const text = `${paint(c.cyan, ` ${label} `)}${truncate(value, Math.max(1, width - visibleWidth(label) - 3))}`

  return { text, cursorCol: Math.min(width, visibleWidth(label) + 2 + visibleWidth(value) + 1) }
}

// ── picker ──────────────────────────────────────────────────────────────────

// Filterable list. items: [{ id, note? }]. Letters type into the filter, arrows/Tab move,
// Enter picks, Esc cancels. key() returns 'pick' | 'cancel' | null.
export const createPicker = ({ items, title, empty = 'no matches' }) => {
  const state = { filter: '', cursor: 0 }
  const visible = () => {
    const query = state.filter.toLowerCase()

    return items.filter(item => !query || item.id.toLowerCase().includes(query))
  }
  const clamp = () => {
    state.cursor = Math.max(0, Math.min(state.cursor, visible().length - 1))
  }

  return {
    state,
    current: () => visible()[state.cursor] ?? null,
    lines: (width, height) => {
      const list = visible()
      const input = inputRow('Filter:', state.filter, width)
      const out = [paint(c.bold, ` ${title}`), input.text, '']
      const { start, visible: shown } = window(list, state.cursor, height - out.length)
      shown.forEach((item, index) => {
        const selected = start + index === state.cursor
        out.push(` ${selected ? paint(c.cyan, '›') : ' '} ${selected ? paint(c.bold, item.id) : item.id}${item.note ? paint(c.dim, `  ${item.note}`) : ''}`)
      })
      if (!list.length) out.push(paint(c.dim, `   ${empty}`))

      return { lines: out, cursor: { row: 2, col: input.cursorCol } }
    },
    key: key => {
      if (isEsc(key)) return 'cancel'
      if (isEnter(key)) return visible()[state.cursor] ? 'pick' : null
      if (isArrowDown(key) || key === '\t' || key === '\x0e') state.cursor++
      else if (isArrowUp(key) || key === '\x1b[Z' || key === '\x10') state.cursor--
      else {
        const before = state.filter
        state.filter = editLine(state.filter, key)
        if (state.filter !== before) state.cursor = 0
      }
      clamp()

      return null
    },
  }
}

// ── screen loop ─────────────────────────────────────────────────────────────

// render(width, height) returns an array of lines or { lines, cursor: { row, col } } (1-based).
// onKey(key) is called for every key; the screen is redrawn afterwards. draw() redraws on demand
// (after async updates); exit() restores the terminal and ends the process.
export const createScreen = ({ render, onKey }) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('the interactive screen needs a TTY')
  let closed = false

  const draw = () => {
    if (closed) return
    const width = cols()
    const height = rows()
    const rendered = render(width, height)
    const lines = Array.isArray(rendered) ? rendered : rendered.lines
    const cursor = Array.isArray(rendered) ? null : rendered.cursor
    let out = `\x1b[?25l\x1b[H\x1b[2J${lines.slice(0, height).map(line => truncate(line, width)).join('\n')}`
    if (cursor) out += `\x1b[${Math.max(1, cursor.row)};${Math.max(1, Math.min(cursor.col, width))}H\x1b[?25h`
    process.stdout.write(out)
  }

  const exit = (code = 0) => {
    if (closed) return
    closed = true
    process.stdout.write('\x1b[?25h\x1b[?1049l')
    process.exit(code)
  }

  process.stdout.write('\x1b[?1049h')
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    for (const key of splitKeys(chunk)) onKey(key)
    draw()
  })
  process.stdout.on('resize', draw)
  process.on('SIGINT', () => exit(0))
  process.on('SIGTERM', () => exit(0))

  return { draw, exit }
}
