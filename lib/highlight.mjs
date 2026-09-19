// Syntax highlighting for fenced code blocks, through highlight.js when it is installed.
//
// highlight.js is the plugin's only dependency and it is optional at runtime: `herdr plugin install`
// runs `npm ci` (the [[build]] step in herdr-plugin.toml), but a linked checkout or a declined build
// has no node_modules. highlight() then returns null and the caller keeps the code block plain.
import { createRequire } from 'node:module'
import { c, paint } from './format.mjs'

// highlight.js scope → ANSI style. Sub-scopes ("title function_") use their base scope.
const SCOPES = {
  keyword: c.magenta,
  literal: c.magenta,
  doctag: c.magenta,
  'selector-tag': c.magenta,
  'template-tag': c.magenta,
  string: c.green,
  regexp: c.green,
  addition: c.green,
  char: c.green,
  number: c.yellow,
  symbol: c.yellow,
  bullet: c.yellow,
  link: c.yellow,
  'selector-class': c.yellow,
  'selector-id': c.yellow,
  'selector-attr': c.yellow,
  'selector-pseudo': c.yellow,
  comment: c.dim,
  quote: c.dim,
  built_in: c.cyan,
  type: c.cyan,
  title: c.cyan,
  attr: c.cyan,
  attribute: c.cyan,
  property: '', // obj.prop chains and UPPER_CASE constants stay plain: less noise than highlight.js' web themes
  variable: '',
  'template-variable': c.cyan,
  name: c.cyan,
  meta: c.cyan,
  deletion: c.red,
  section: c.bold,
  strong: c.bold,
  emphasis: c.italic,
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" }
const decode = text => text.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, entity => ENTITIES[entity])

const styleOf = classes => {
  for (const name of classes.split(/\s+/)) if (name.startsWith('hljs-')) return SCOPES[name.slice(5)] ?? ''

  return ''
}

// highlight.js HTML (`<span class="hljs-keyword">…</span>`) → one styled string per source line. Every
// styled run is closed before a line break, so lines can be shown or scrolled independently.
export const htmlToLines = html => {
  const lines = ['']
  const stack = []
  for (const match of String(html ?? '').matchAll(/<span class="([^"]*)">|<\/span>|[^<]+|</g)) {
    if (match[1] !== undefined) {
      stack.push(styleOf(match[1]))
      continue
    }
    if (match[0] === '</span>') {
      stack.pop()
      continue
    }
    const style = stack.length ? stack.at(-1) : ''
    decode(match[0])
      .split('\n')
      .forEach((part, index) => {
        if (index > 0) lines.push('')
        if (part) lines[lines.length - 1] += paint(style, part)
      })
  }

  return lines
}

const require = createRequire(import.meta.url)
const defaultLoader = () => {
  try {
    return require('highlight.js/lib/common')
  } catch {
    return null
  }
}

// Builds a highlighter around a loader that returns the highlight.js instance (or null when it is
// not installed). The loader runs once, on the first code block.
export const createHighlighter = (load = defaultLoader) => {
  let loaded = false
  let hljs = null
  const engine = () => {
    if (!loaded) {
      loaded = true
      hljs = load() ?? null
    }

    return hljs
  }

  // (code, language) → styled lines, or null when the language is unknown or highlight.js is missing.
  return (code, language) => {
    if (!language) return null
    const lib = engine()
    if (!lib || !lib.getLanguage(language)) return null
    try {
      return htmlToLines(lib.highlight(String(code ?? ''), { language, ignoreIllegals: true }).value)
    } catch {
      return null
    }
  }
}

export const highlight = createHighlighter()

// Installed highlight.js version, or null.
export const highlighterVersion = () => {
  try {
    return require('highlight.js/package.json').version ?? null
  } catch {
    return null
  }
}
