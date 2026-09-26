import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseIssueRef, parseIssueUrl, sameRepo } from '../lib/github.mjs'
import { assigneeText, labelText } from '../lib/sources.mjs'
import { sampleIssue } from './helpers.mjs'

describe('parseIssueUrl', () => {
  it('parses the usual shapes', () => {
    for (const url of [
      'https://github.com/acme/shop/issues/482',
      'http://github.com/acme/shop/issues/482',
      'https://www.github.com/acme/shop/issues/482/',
      'github.com/acme/shop/issues/482#issuecomment-1',
      'https://github.com/acme/shop/issues/482?foo=bar',
      '  https://github.com/acme/shop/issues/482  ',
    ]) {
      assert.deepEqual(parseIssueUrl(url), { owner: 'acme', name: 'shop', repo: 'acme/shop', number: 482 }, url)
    }
  })
  it('strips .git from the repository name', () => {
    assert.equal(parseIssueUrl('https://github.com/acme/shop.git/issues/1').repo, 'acme/shop')
  })
  it('rejects pull requests, other hosts and garbage', () => {
    assert.equal(parseIssueUrl('https://github.com/acme/shop/pull/482'), null)
    assert.equal(parseIssueUrl('https://gitlab.com/acme/shop/issues/482'), null)
    assert.equal(parseIssueUrl('https://github.com/acme/shop/issues/'), null)
    assert.equal(parseIssueUrl('482'), null)
    assert.equal(parseIssueUrl(null), null)
  })
})

describe('parseIssueRef', () => {
  it('accepts numbers, #numbers and URLs', () => {
    assert.deepEqual(parseIssueRef('482'), { number: 482, repo: null, owner: null, name: null })
    assert.deepEqual(parseIssueRef(' #7 '), { number: 7, repo: null, owner: null, name: null })
    assert.equal(parseIssueRef('https://github.com/acme/shop/issues/3').repo, 'acme/shop')
    assert.equal(parseIssueRef('abc'), null)
    assert.equal(parseIssueRef(''), null)
  })
})

describe('sameRepo / texts', () => {
  it('compares repositories case-insensitively', () => {
    assert.equal(sameRepo('Acme/Shop', 'acme/shop'), true)
    assert.equal(sameRepo('acme/shop', 'acme/store'), false)
  })
  it('renders labels and assignees', () => {
    assert.equal(labelText(sampleIssue()), 'bug, p1')
    assert.equal(assigneeText(sampleIssue()), '@zamarrowski')
    assert.equal(labelText({}), '')
    assert.equal(assigneeText(null), '')
  })
})
