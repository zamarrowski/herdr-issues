// Text helpers for the terminal UI: ANSI colours, widths, truncation, wrapping, slugs, key splitting.
const colorEnabled = !process.env.NO_COLOR

export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  strike: '\x1b[9m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
}

export const paint = (code, text) => (colorEnabled && code ? `${code}${text}${c.reset}` : `${text}`)

const ANSI = /\x1b\[[0-9;]*m/g
export const stripAnsi = text => String(text ?? '').replace(ANSI, '')
export const visibleWidth = text => [...stripAnsi(text)].length

export const pad = (text, width, right = false) => {
  const missing = width - visibleWidth(text)
  if (missing <= 0) return text

  return right ? ' '.repeat(missing) + text : text + ' '.repeat(missing)
}

// Cuts `text` to `width` visible columns, keeping ANSI sequences intact and ending with an ellipsis.
export const truncate = (text, width) => {
  if (width <= 0) return ''
  if (visibleWidth(text) <= width) return text
  let out = ''
  let count = 0
  let index = 0
  while (index < text.length && count < width - 1) {
    const match = /^\x1b\[[0-9;]*m/.exec(text.slice(index))
    if (match) {
      out += match[0]
      index += match[0].length
      continue
    }
    const char = [...text.slice(index)][0]
    out += char
    index += char.length
    count++
  }

  return `${out}…${colorEnabled ? c.reset : ''}`
}

export const lineLR = (left, right, width) => {
  const gap = width - visibleWidth(left) - visibleWidth(right)
  if (gap < 1) return truncate(left, width)

  return left + ' '.repeat(gap) + right
}

// Plain-text truncation (no ANSI awareness needed), by code points.
export const truncateText = (text, width) => {
  const chars = [...(text ?? '')]

  return chars.length <= width ? chars.join('') : `${chars.slice(0, Math.max(0, width - 1)).join('')}…`
}

// Word wrap to `width` columns; blank lines are kept, over-long words are cut.
export const wrap = (text, width) => {
  const lines = []
  for (const paragraph of String(text ?? '').replace(/\r/g, '').split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('')
      continue
    }
    let line = ''
    for (let word of paragraph.trim().split(/\s+/)) {
      while ([...word].length > width) {
        if (line) lines.push(line)
        line = ''
        lines.push([...word].slice(0, width).join(''))
        word = [...word].slice(width).join('')
      }
      if (!line) line = word
      else if ([...line].length + 1 + [...word].length <= width) line += ` ${word}`
      else {
        lines.push(line)
        line = word
      }
    }
    if (line) lines.push(line)
  }

  return lines
}

// "3m", "2h", "5d", "3mo", "1y" since an ISO timestamp (or a Date / epoch ms).
export const ago = (when, now = Date.now()) => {
  const then = typeof when === 'number' ? when : Date.parse(when)
  const ms = now - then
  if (!Number.isFinite(ms)) return ''
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${Math.max(minutes, 0)}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`

  return `${Math.floor(days / 365)}y`
}

// URL/branch-safe slug: lowercase ASCII words joined by "-", cut at a word boundary near `max`.
export const slug = (text, max = 40) => {
  const base = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (base.length <= max) return base
  const cut = base.slice(0, max + 1)
  const boundary = cut.lastIndexOf('-')

  return (boundary > 0 ? cut.slice(0, boundary) : base.slice(0, max)).replace(/-+$/, '')
}

export const plural = (count, singular, pluralForm = `${singular}s`) => `${count} ${count === 1 ? singular : pluralForm}`

// One stdin chunk may carry several keys (paste, fast typing): split it into
// complete escape sequences and single code points.
export const splitKeys = chunk => {
  const keys = []
  let index = 0
  while (index < chunk.length) {
    if (chunk[index] === '\x1b') {
      const match = /^\x1b(\[[0-9;]*[@-~]|O[A-Za-z])/.exec(chunk.slice(index))
      const key = match ? match[0] : '\x1b'
      keys.push(key)
      index += key.length
      continue
    }
    const char = [...chunk.slice(index)][0]
    keys.push(char)
    index += char.length
  }

  return keys
}
