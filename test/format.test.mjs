import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ago, lineLR, pad, plural, slug, splitKeys, stripAnsi, truncate, truncateText, visibleWidth, wrap } from '../lib/format.mjs'

describe('slug', () => {
  it('lowercases, strips accents and joins words with dashes', () => {
    assert.equal(slug('Página de Devoluciones: crash!'), 'pagina-de-devoluciones-crash')
  })
  it('cuts at a word boundary near the maximum', () => {
    assert.equal(slug('Returns page crashes on empty address field', 20), 'returns-page-crashes')
    assert.ok(slug('a'.repeat(100), 10).length <= 10)
  })
  it('handles empty and symbol-only input', () => {
    assert.equal(slug(''), '')
    assert.equal(slug('???'), '')
    assert.equal(slug(null), '')
  })
})

describe('truncate / widths', () => {
  it('measures visible width without ANSI codes', () => {
    assert.equal(visibleWidth('\x1b[1mbold\x1b[0m'), 4)
    assert.equal(stripAnsi('\x1b[32m#1\x1b[0m'), '#1')
  })
  it('truncates by visible columns and keeps ANSI sequences', () => {
    const out = truncate('\x1b[1mhello world\x1b[0m', 6)
    assert.equal(visibleWidth(out), 6)
    assert.ok(out.startsWith('\x1b[1m'))
    assert.ok(stripAnsi(out).endsWith('…'))
    assert.equal(truncate('short', 10), 'short')
    assert.equal(truncate('anything', 0), '')
  })
  it('pads left or right', () => {
    assert.equal(pad('ab', 4), 'ab  ')
    assert.equal(pad('ab', 4, true), '  ab')
    assert.equal(pad('abcdef', 4), 'abcdef')
  })
  it('lays out left and right parts', () => {
    assert.equal(lineLR('L', 'R', 5), 'L   R')
    assert.equal(visibleWidth(lineLR('a long left side', 'right', 10)), 10)
  })
  it('truncates plain text by code points', () => {
    assert.equal(truncateText('héllo wörld', 6), 'héllo…')
    assert.equal(truncateText('ok', 6), 'ok')
  })
})

describe('wrap', () => {
  it('wraps words and keeps blank lines', () => {
    assert.deepEqual(wrap('one two three four', 9), ['one two', 'three', 'four'])
    assert.deepEqual(wrap('a\n\nb', 10), ['a', '', 'b'])
  })
  it('cuts words longer than the width', () => {
    assert.deepEqual(wrap('abcdefghij', 4), ['abcd', 'efgh', 'ij'])
  })
})

describe('ago', () => {
  const now = Date.parse('2026-09-19T12:00:00Z')
  it('formats relative ages', () => {
    assert.equal(ago('2026-09-19T11:57:00Z', now), '3m')
    assert.equal(ago('2026-09-19T09:00:00Z', now), '3h')
    assert.equal(ago('2026-09-14T12:00:00Z', now), '5d')
    assert.equal(ago('2026-06-19T12:00:00Z', now), '3mo')
    assert.equal(ago('2024-09-19T12:00:00Z', now), '2y')
    assert.equal(ago(now - 90_000, now), '1m')
  })
  it('returns an empty string for garbage', () => {
    assert.equal(ago('not a date', now), '')
  })
})

describe('splitKeys', () => {
  it('splits a chunk into escape sequences and code points', () => {
    assert.deepEqual(splitKeys('ab\x1b[Ac\x1b'), ['a', 'b', '\x1b[A', 'c', '\x1b'])
    assert.deepEqual(splitKeys('é\x1bOA'), ['é', '\x1bOA'])
  })
})

describe('plural', () => {
  it('picks the form', () => {
    assert.equal(plural(1, 'issue'), '1 issue')
    assert.equal(plural(2, 'issue'), '2 issues')
    assert.equal(plural(0, 'entry', 'entries'), '0 entries')
  })
})
