import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { c, stripAnsi, visibleWidth } from '../lib/format.mjs'
import { parseInline, renderMarkdown, wrapSegments } from '../lib/markdown.mjs'

const noHighlight = { highlight: () => null }

const plain = lines => lines.map(stripAnsi)
const styled = (lines, code) => lines.some(line => line.includes(code))

describe('parseInline', () => {
  it('styles bold, italic, strike and code, and leaves the rest plain', () => {
    const segments = parseInline('a **b** *c* _d_ ~~e~~ `f` g')
    assert.deepEqual(
      segments.map(s => [s.text, s.style]),
      [
        ['a ', ''],
        ['b', c.bold],
        [' ', ''],
        ['c', c.italic],
        [' ', ''],
        ['d', c.italic],
        [' ', ''],
        ['e', c.strike],
        [' ', ''],
        ['f', c.yellow],
        [' g', ''],
      ],
    )
  })
  it('nests styles', () => {
    const segments = parseInline('**bold with `code` inside**')
    assert.deepEqual(segments.map(s => [s.text, s.style]), [['bold with ', c.bold], ['code', c.bold + c.yellow], [' inside', c.bold]])
  })
  it('does not treat underscores inside words or markers inside code as emphasis', () => {
    assert.deepEqual(parseInline('snake_case_name and 2*3*4'), [{ text: 'snake_case_name and 2*3*4', style: '' }])
    assert.deepEqual(parseInline('`a_b_c **x**`'), [{ text: 'a_b_c **x**', style: c.yellow }])
    assert.deepEqual(parseInline('see https://x.dev/a_b_c_d now').map(s => s.text).join(''), 'see https://x.dev/a_b_c_d now')
    assert.equal(parseInline('see https://x.dev/a_b_c_d now').every(s => s.style === ''), true)
  })
  it('renders links, images, references and mentions', () => {
    assert.deepEqual(parseInline('[docs](https://d.ev/x)').map(s => [s.text, s.style]), [['docs', ''], [' (https://d.ev/x)', c.dim]])
    assert.deepEqual(parseInline('[https://d.ev](https://d.ev)').map(s => s.text), ['https://d.ev'])
    assert.deepEqual(parseInline('![screen shot](https://i.png)').map(s => [s.text, s.style]), [['[image: screen shot]', c.dim]])
    assert.deepEqual(parseInline('fixes #12 (#7) mail a@b.com, #notref').map(s => [s.text, s.style]), [
      ['fixes ', ''],
      ['#12', c.green],
      [' (', ''],
      ['#7', c.green],
      [') mail a@b.com, #notref', ''],
    ])
    assert.deepEqual(parseInline('cc @ana-b').map(s => [s.text, s.style]), [['cc ', ''], ['@ana-b', c.cyan]])
    assert.deepEqual(parseInline('see sc-12 [SC-7] misc-3').map(s => [s.text, s.style]), [
      ['see ', ''],
      ['sc-12', c.green],
      [' [', ''],
      ['SC-7', c.green],
      ['] misc-3', ''],
    ])
    assert.deepEqual(parseInline('fixes ENG-123 (WEB-7) not eng-1').map(s => [s.text, s.style]), [
      ['fixes ', ''],
      ['ENG-123', c.green],
      [' (', ''],
      ['WEB-7', c.green],
      [') not eng-1', ''],
    ])
  })
  it('leaves unbalanced markers alone', () => {
    assert.deepEqual(parseInline('**oops and `tick'), [{ text: '**oops and `tick', style: '' }])
  })
})

describe('wrapSegments', () => {
  it('wraps by words keeping every line within the width', () => {
    const lines = wrapSegments(parseInline('one **two three** four five six seven'), 12)
    assert.deepEqual(plain(lines), ['one two', 'three four', 'five six', 'seven'])
    for (const line of lines) assert.ok(visibleWidth(line) <= 12)
    assert.match(lines[0], /\x1b\[1mtwo\x1b\[0m$/, 'style closed at the end of the line')
    assert.match(lines[1], /^\x1b\[1mthree \x1b\[0mfour$/, 'style reopened on the next line; the space after a styled word keeps its style')
  })
  it('uses first and rest prefixes and cuts over-long words', () => {
    const lines = wrapSegments(parseInline('abcdefghijkl mn'), 8, { first: '• ', rest: '  ' })
    assert.deepEqual(plain(lines), ['• abcdef', '  ghijkl', '  mn'])
    assert.deepEqual(plain(wrapSegments([], 8, { first: '│ ' })), ['│ '])
  })
})

describe('renderMarkdown', () => {
  const doc = `<!-- template comment -->
# Title

Some **bold** text and \`code\`.
Second line stays a line.

## Steps
1. First step
2. Second step that is rather long and needs wrapping across the line
- [ ] todo item
- [x] done item
  - nested bullet

> quoted **words**

\`\`\`js
const x = 1 // no **bold** here, and a very long line that must not wrap but be truncated instead ok
\`\`\`

---
<details><summary>More</summary>
hidden text
</details>
| a | b |
`
  const lines = renderMarkdown(doc, 40, noHighlight)
  const text = plain(lines)

  it('keeps every line within the width', () => {
    for (const line of lines) assert.ok(visibleWidth(line) <= 40, JSON.stringify(stripAnsi(line)))
  })
  it('drops HTML comments and details tags, bolds headings and summaries', () => {
    assert.ok(!text.join('\n').includes('template comment'))
    assert.ok(!text.join('\n').includes('<details>'))
    assert.equal(text[0], 'Title')
    assert.ok(lines[0].includes(c.bold))
    assert.ok(text.includes('Steps'))
    assert.ok(text.includes('More'))
    assert.ok(text.includes('hidden text'))
  })
  it('keeps GitHub line breaks and collapses blank runs', () => {
    assert.ok(text.includes('Some bold text and code.'))
    assert.ok(text.includes('Second line stays a line.'))
    assert.ok(!text.some((line, index) => line === '' && text[index + 1] === ''))
    assert.notEqual(text[0], '')
    assert.notEqual(text.at(-1), '')
  })
  it('renders lists, task lists and nesting', () => {
    assert.ok(text.includes('1. First step'))
    const second = text.findIndex(line => line.startsWith('2. Second step'))
    assert.ok(second > 0)
    assert.ok(text[second + 1].startsWith('   '), 'continuation is indented under the text')
    assert.ok(text.includes('• [ ] todo item'))
    assert.ok(text.includes('• [x] done item'))
    assert.ok(lines.some(line => line.includes(`${c.green}[x]`)))
    assert.ok(text.includes('  • nested bullet'))
  })
  it('renders quotes, rules and code blocks without wrapping code', () => {
    assert.ok(text.includes('│ quoted words'))
    assert.ok(text.includes('─'.repeat(40)))
    assert.ok(text.includes('    js'))
    const code = text.find(line => line.includes('const x = 1'))
    assert.ok(code.startsWith('    const x = 1 // no **bold** here'))
    assert.ok(code.endsWith('…'))
    assert.ok(!styled([lines[text.indexOf(code)]], c.bold), 'no emphasis inside code blocks')
  })
  it('leaves tables as written', () => {
    assert.ok(text.includes('| a | b |'))
  })
  it('handles empty input and unclosed fences', () => {
    assert.deepEqual(renderMarkdown('', 40), [])
    assert.deepEqual(renderMarkdown(null, 40), [])
    assert.deepEqual(plain(renderMarkdown('```\nx\n', 40)), ['    x'])
    assert.deepEqual(plain(renderMarkdown('```js\nlet a\nlet b', 40)), ['    js', '    let a', '    let b'], 'an unclosed highlighted block is still flushed')
  })

  it('syntax-highlights fenced blocks and stays within the width', () => {
    const block = '```js\nconst answer = 42 // the answer to a rather long question that will not fit in forty columns\n```'
    const highlighted = renderMarkdown(block, 40)
    assert.ok(highlighted[1].includes(`${c.magenta}const`), 'keywords are coloured')
    assert.ok(highlighted[1].includes(`${c.yellow}42`), 'numbers are coloured')
    for (const line of highlighted) assert.ok(visibleWidth(line) <= 40)
    assert.ok(stripAnsi(highlighted[1]).endsWith('…'))
    const dim = renderMarkdown(block, 40, noHighlight)
    assert.ok(dim[1].startsWith(c.dim), 'without a highlighter the block is dim')
    assert.ok(!dim[1].includes(c.magenta))
    const unknown = renderMarkdown('```nosuchlang\nconst x\n```', 40)
    assert.ok(unknown[1].startsWith(c.dim), 'unknown languages stay dim')
  })
})
