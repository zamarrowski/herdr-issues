import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { c, stripAnsi } from '../lib/format.mjs'
import { createHighlighter, highlight, highlighterVersion, htmlToLines } from '../lib/highlight.mjs'

describe('htmlToLines', () => {
  it('maps scopes to styles, innermost span winning, and decodes entities', () => {
    const lines = htmlToLines('<span class="hljs-keyword">if</span> (a &lt; b &amp;&amp; <span class="hljs-string">&quot;q<span class="hljs-subst">${x}</span>&quot;</span>)')
    assert.equal(lines.length, 1)
    assert.equal(stripAnsi(lines[0]), 'if (a < b && "q${x}")')
    assert.ok(lines[0].startsWith(`${c.magenta}if${c.reset}`))
    assert.ok(lines[0].includes(`${c.green}"q${c.reset}${'${x}'}${c.green}"${c.reset}`), 'the substitution inside the string is plain')
  })
  it('uses the base scope of sub-scoped classes and ignores unknown ones', () => {
    const lines = htmlToLines('<span class="hljs-title function_">main</span> <span class="language-xml">x</span> <span class="hljs-nonsense">y</span>')
    assert.equal(lines[0], `${c.cyan}main${c.reset} x y`)
  })
  it('closes styles at every line break', () => {
    const lines = htmlToLines('<span class="hljs-string">`one\ntwo`</span>')
    assert.deepEqual(lines, [`${c.green}\`one${c.reset}`, `${c.green}two\`${c.reset}`])
    assert.deepEqual(htmlToLines(''), [''])
    assert.deepEqual(htmlToLines('a\n\nb'), ['a', '', 'b'])
  })
})

describe('highlight (with highlight.js installed)', () => {
  it('colours keywords, numbers, strings and comments without losing text', () => {
    const source = 'const answer = 42 // the answer\nlet name = "herdr"'
    const lines = highlight(source, 'js')
    assert.equal(lines.length, 2)
    assert.equal(lines.map(stripAnsi).join('\n'), source)
    assert.ok(lines[0].includes(`${c.magenta}const${c.reset}`))
    assert.ok(lines[0].includes(`${c.yellow}42${c.reset}`))
    assert.ok(lines[0].includes(`${c.dim}// the answer${c.reset}`))
    assert.ok(lines[1].includes(`${c.green}"herdr"${c.reset}`))
  })
  it('preserves the text of every line for the usual languages', () => {
    const samples = {
      ts: 'interface A { x: number }\nconst a: A = { x: 1 < 2 ? 3 : 4 }',
      py: 'def f(x):\n    return f"{x}"  # comment',
      sh: 'if [ -z "$HOME" ]; then echo "no" >&2; fi',
      yml: 'name: ci\non:\n  push:\n    branches: [main]',
      json: '{ "a": [1, true, null], "b": "s" }',
      toml: '[section]\nkey = "value"',
      rs: 'fn main() { println!("{}", 1u32); }',
      go: 'func main() { fmt.Println("hi") }',
      sql: 'SELECT id FROM users WHERE name = \'x\';',
      diff: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new',
      html: '<div class="a">x &amp; y</div>',
      css: '.a { color: #fff; margin: 1px }',
      java: 'public class A { int x = 1; }',
      kt: 'val x: Int = 1',
      rb: 'puts "hi" if x.nil?',
      php: '<?php echo $x; ?>',
      cpp: '#include <iostream>\nint main() { return 0; }',
    }
    for (const [language, source] of Object.entries(samples)) {
      const lines = highlight(source, language)
      assert.ok(Array.isArray(lines), `${language} is highlighted`)
      assert.equal(lines.map(stripAnsi).join('\n'), source, `${language} keeps its text`)
      assert.ok(lines.some(line => line.includes('\x1b[')), `${language} gets at least one colour`)
    }
    const diff = highlight('-old\n+new', 'diff')
    assert.ok(diff[0].startsWith(c.red) && diff[1].startsWith(c.green))
  })
  it('returns null for unknown or missing languages', () => {
    assert.equal(highlight('x', 'nosuchlang'), null)
    assert.equal(highlight('x', null), null)
    assert.equal(highlight('x', ''), null)
    assert.deepEqual(highlight('', 'js'), [''])
  })
  it('reports the installed version', () => {
    assert.match(highlighterVersion(), /^\d+\.\d+\.\d+/)
  })
})

describe('createHighlighter fallbacks', () => {
  it('returns null when highlight.js is not installed', () => {
    let calls = 0
    const missing = createHighlighter(() => {
      calls++

      return null
    })
    assert.equal(missing('const x', 'js'), null)
    assert.equal(missing('const x', 'js'), null)
    assert.equal(calls, 1, 'the loader runs once')
  })
  it('returns null when highlight.js throws', () => {
    const broken = createHighlighter(() => ({
      getLanguage: () => true,
      highlight: () => {
        throw new Error('boom')
      },
    }))
    assert.equal(broken('x', 'js'), null)
  })
})
