import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { haystack, mergeByUpdated, parseRef, sourcesOf, stateText, visibleTabs } from '../lib/sources.mjs'
import { sampleIssue, sampleLinear, sampleStory } from './helpers.mjs'

describe('tabs', () => {
  it('keeps known tabs in the configured order and falls back to all of them', () => {
    assert.deepEqual(visibleTabs(['shortcut', 'GitHub', 'jira', 'shortcut']), ['shortcut', 'github'])
    assert.deepEqual(visibleTabs(['Linear', 'jira']), ['linear'])
    assert.deepEqual(visibleTabs([]), ['all', 'github', 'shortcut', 'linear'])
    assert.deepEqual(visibleTabs(undefined), ['all', 'github', 'shortcut', 'linear'])
  })
  it('knows which sources the tabs need', () => {
    assert.deepEqual(sourcesOf(['github']), ['github'])
    assert.deepEqual(sourcesOf(['shortcut', 'github']), ['github', 'shortcut'])
    assert.deepEqual(sourcesOf(['linear', 'github']), ['github', 'linear'])
    assert.deepEqual(sourcesOf(['all']), ['github', 'shortcut', 'linear'])
  })
})

describe('parseRef', () => {
  it('routes references to their source', () => {
    assert.deepEqual(parseRef('482'), { source: 'github', number: 482, repo: null, owner: null, name: null })
    assert.equal(parseRef('https://github.com/acme/shop/issues/3').repo, 'acme/shop')
    assert.deepEqual(parseRef('sc-482'), { source: 'shortcut', number: 482, ref: 'sc-482', workspace: null })
    assert.deepEqual(parseRef('https://app.shortcut.com/acme/story/9/x'), { source: 'shortcut', number: 9, ref: 'sc-9', workspace: 'acme' })
    assert.deepEqual(parseRef('ENG-123'), { source: 'linear', number: 123, ref: 'ENG-123', workspace: null })
    assert.deepEqual(parseRef('https://linear.app/acme/issue/ENG-123/x'), { source: 'linear', number: 123, ref: 'ENG-123', workspace: 'acme' })
    assert.equal(parseRef('nope'), null)
  })
  it('reads sc-482 as a Linear key only when Linear is shown and Shortcut is not', () => {
    assert.equal(parseRef('sc-482').source, 'shortcut')
    assert.equal(parseRef('sc-482', ['github', 'linear']).source, 'linear')
    assert.equal(parseRef('sc-482', ['github']).source, 'shortcut')
    assert.equal(parseRef('https://app.shortcut.com/acme/story/9', ['linear']).source, 'shortcut', 'a story URL is always a story')
    assert.equal(parseRef('[sc-482]', ['linear']).source, 'shortcut')
  })
})

describe('records', () => {
  it('merges sources newest updated first', () => {
    const merged = mergeByUpdated([[sampleIssue()], [sampleStory()], [sampleLinear()]])
    assert.deepEqual(merged.map(item => item.ref ?? `#${item.number}`), ['ENG-123', 'sc-482', '#482'])
  })
  it('shows the workflow state of stories and "closed" for closed issues', () => {
    assert.equal(stateText(sampleStory()), 'In Progress')
    assert.equal(stateText(sampleLinear({ stateName: 'Todo' })), 'Todo')
    assert.equal(stateText({ ...sampleIssue(), source: 'github', closed: true }), 'closed')
    assert.equal(stateText({ ...sampleIssue(), source: 'github', closed: false }), '')
  })
  it('filters on the reference, the state and the type too', () => {
    const text = haystack(sampleStory())
    for (const word of ['sc-482', 'in progress', 'bug', '@ana', 'returns', 'cy']) assert.ok(text.includes(word), word)
    for (const word of ['eng-123', 'high', 'in progress']) assert.ok(haystack(sampleLinear()).includes(word), word)
  })
})
