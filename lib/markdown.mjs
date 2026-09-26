// Terminal rendering of the Markdown subset GitHub issues actually use: headings, emphasis, inline
// code, fenced code blocks, lists and task lists, block quotes, links and images, horizontal rules,
// plus GitHub extras (#123 references, Shortcut's sc-123, Linear's ENG-123, @mentions, the HTML comments left by issue templates,
// <details>/<summary>). Fenced code blocks are syntax-highlighted through lib/highlight.mjs when
// highlight.js is installed. Tables and other HTML are left as written.
//
// renderMarkdown(text, width) returns lines no wider than `width`. Styles are opened and closed on
// every line, so the caller can scroll through the lines freely. Line breaks are kept as GitHub
// renders them in issues and comments: one source line wraps on its own.
import { c, paint, stripAnsi, truncate, truncateText, visibleWidth } from './format.mjs'
import { highlight as defaultHighlight } from './highlight.mjs'

// ── inline ──────────────────────────────────────────────────────────────────

// Alternatives are tried in this order at the earliest position: code spans and URLs first, so
// emphasis markers inside them are never interpreted.
const INLINE = [
  '(?<ticks>`{1,2})(?<code>(?:(?!\\k<ticks>).)+?)\\k<ticks>',
  '!\\[(?<img_alt>[^\\]]*)\\]\\((?<img_url>[^)]*)\\)',
  '\\[(?<link_text>[^\\]]+)\\]\\((?<link_url>[^)\\s]+)(?:\\s+"[^"]*")?\\)',
  '(?<url>https?://[^\\s<>()]+)',
  '\\*\\*(?<bold>(?:(?!\\*\\*).)+)\\*\\*',
  '(?<![\\w_])__(?<bold2>(?:(?!__).)+)__(?![\\w_])',
  '~~(?<strike>(?:(?!~~).)+)~~',
  '(?<![\\w*])\\*(?<it>[^*\\s](?:[^*]*[^*\\s])?)\\*(?![\\w*])',
  '(?<![\\w_])_(?<it2>[^_\\s](?:[^_]*[^_\\s])?)_(?![\\w_])',
  '(?<=^|[\\s(\\[])#(?<ref>\\d+)\\b',
  '(?<=^|[\\s(\\[])(?<scref>[Ss][Cc]-\\d+)\\b',
  '(?<=^|[\\s(\\[])(?<linref>[A-Z][A-Z0-9]*-\\d+)\\b',
  '(?<=^|[\\s(\\[])@(?<mention>[A-Za-z0-9][A-Za-z0-9-]{0,38})\\b',
].join('|')

// Segments: [{ text, style }], style being a string of ANSI codes ('' for plain text).
export const parseInline = (text, base = '') => {
  const out = []
  const push = (chunk, style) => {
    if (chunk) out.push({ text: chunk, style })
  }
  const regex = new RegExp(INLINE, 'g') // a fresh instance: this function recurses
  let index = 0
  let match
  while ((match = regex.exec(text))) {
    push(text.slice(index, match.index), base)
    const g = match.groups
    if (g.code !== undefined) push(g.code, base + c.yellow)
    else if (g.img_alt !== undefined) push(`[image: ${g.img_alt.trim() || 'image'}]`, base + c.dim)
    else if (g.link_text !== undefined) {
      out.push(...parseInline(g.link_text, base))
      if (g.link_text.trim() !== g.link_url) push(` (${g.link_url})`, base + c.dim)
    } else if (g.url !== undefined) push(g.url, base)
    else if (g.bold !== undefined) out.push(...parseInline(g.bold, base + c.bold))
    else if (g.bold2 !== undefined) out.push(...parseInline(g.bold2, base + c.bold))
    else if (g.strike !== undefined) out.push(...parseInline(g.strike, base + c.strike))
    else if (g.it !== undefined) out.push(...parseInline(g.it, base + c.italic))
    else if (g.it2 !== undefined) out.push(...parseInline(g.it2, base + c.italic))
    else if (g.ref !== undefined) push(`#${g.ref}`, base + c.green)
    else if (g.scref !== undefined) push(g.scref, base + c.green)
    else if (g.linref !== undefined) push(g.linref, base + c.green)
    else if (g.mention !== undefined) push(`@${g.mention}`, base + c.cyan)
    index = match.index + match[0].length
  }
  push(text.slice(index), base)

  return out
}

const paintTokens = tokens => {
  let out = ''
  let current = null
  for (const token of tokens) {
    if (current && current.style === token.style) current.text += token.text
    else {
      if (current) out += paint(current.style, current.text)
      current = { ...token }
    }
  }
  if (current) out += paint(current.style, current.text)

  return out
}

// Word-wraps styled segments to `width` columns. Adjacent segments with no whitespace between them
// ("(" + code + ")") stay together as one word. `first` and `rest` are (possibly styled) prefixes for
// the first and the following lines.
export const wrapSegments = (segments, width, { first = '', rest = '' } = {}) => {
  // Words: runs of styled parts separated by whitespace.
  const words = []
  let word = null
  for (const segment of segments) {
    for (const piece of segment.text.split(/(\s+)/)) {
      if (!piece) continue
      if (/^\s+$/.test(piece)) {
        word = null
        continue
      }
      if (!word) {
        word = { parts: [], width: 0 }
        words.push(word)
      }
      word.parts.push({ text: piece, style: segment.style })
      word.width += [...piece].length
    }
  }

  const lines = []
  let prefix = first
  let tokens = []
  let used = visibleWidth(prefix)
  const flush = () => {
    lines.push(prefix + paintTokens(tokens))
    prefix = rest
    tokens = []
    used = visibleWidth(prefix)
  }
  for (const { parts, width: wordWidth } of words) {
    if (tokens.length && used + 1 + wordWidth > width) flush()
    if (tokens.length) {
      tokens.push({ text: ' ', style: tokens.at(-1).style })
      used += 1
    }
    if (wordWidth <= width - used) {
      tokens.push(...parts)
      used += wordWidth
      continue
    }
    // Longer than a line: cut it, part by part.
    for (const part of parts) {
      let remaining = part.text
      while (remaining) {
        if (width - used <= 0) flush()
        const room = Math.max(1, width - used)
        const chunk = [...remaining].slice(0, room).join('')
        tokens.push({ text: chunk, style: part.style })
        used += [...chunk].length
        remaining = [...remaining].slice(room).join('')
      }
    }
  }
  if (tokens.length || lines.length === 0) lines.push(prefix + paintTokens(tokens))

  return lines
}

// ── blocks ──────────────────────────────────────────────────────────────────

const stripHtml = text =>
  text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<summary[^>]*>([\s\S]*?)<\/summary>/gi, '**$1**')
    .replace(/<\/?(details|p|div|span|kbd)\b[^>]*>/gi, (tag, name) => (/^kbd$/i.test(name) ? '`' : ''))
    .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, '[image: $1]')
    .replace(/<img\b[^>]*>/gi, '[image]')

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*(\S*)/
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const QUOTE = /^\s{0,3}((?:>\s?)+)(.*)$/
const ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(?:\[([ xX])\]\s*)?(.*)$/

export const renderMarkdown = (source, width, { highlight = defaultHighlight } = {}) => {
  const columns = Math.max(10, width)
  const lines = []
  const blank = () => {
    if (lines.length && lines.at(-1) !== '') lines.push('')
  }
  let fence = null // { marker, language, code: [] } while inside a fenced block
  const flushCode = () => {
    if (!fence) return
    const styled = highlight(fence.code.join('\n'), fence.language)
    fence.code.forEach((raw, index) => {
      lines.push(styled ? `    ${truncate(styled[index] ?? '', columns - 4)}` : paint(c.dim, `    ${truncateText(raw, columns - 4)}`))
    })
    fence = null
  }
  for (const raw of stripHtml(String(source ?? '').replace(/\r/g, '')).split('\n')) {
    const line = raw.replace(/\t/g, '    ')
    if (fence) {
      if (line.trim().startsWith(fence.marker)) flushCode()
      else fence.code.push(line)
      continue
    }
    const opening = FENCE.exec(line)
    if (opening) {
      fence = { marker: opening[1], language: opening[2] || null, code: [] }
      if (opening[2]) lines.push(paint(c.dim, `    ${opening[2]}`))
      continue
    }
    if (line.trim() === '') {
      blank()
      continue
    }
    if (RULE.test(line)) {
      lines.push(paint(c.dim, '─'.repeat(columns)))
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blank()
      lines.push(...wrapSegments(parseInline(heading[2], c.bold), columns))
      continue
    }
    const quote = QUOTE.exec(line)
    if (quote) {
      const prefix = paint(c.dim, '│ '.repeat((quote[1].match(/>/g) ?? []).length))
      lines.push(...wrapSegments(parseInline(quote[2]), columns, { first: prefix, rest: prefix }))
      continue
    }
    const item = ITEM.exec(line)
    if (item) {
      const indent = ' '.repeat(Math.min(item[1].length, Math.floor(columns / 3)))
      const marker = /\d/.test(item[2]) ? `${item[2]} ` : '• '
      const box = item[3] === undefined ? '' : /x/i.test(item[3]) ? `${paint(c.green, '[x]')} ` : '[ ] '
      const first = indent + marker + box
      lines.push(...wrapSegments(parseInline(item[4]), columns, { first, rest: ' '.repeat(visibleWidth(first)) }))
      continue
    }
    lines.push(...wrapSegments(parseInline(line.trim()), columns))
  }
  flushCode()
  while (lines.length && stripAnsi(lines.at(-1)).trim() === '') lines.pop()
  while (lines.length && lines[0] === '') lines.shift()

  return lines
}
