import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { haystack, mergeByUpdated, parseRef, sourcesOf, stateText, visibleTabs } from '../lib/sources.mjs'
import { sampleIssue, sampleStory } from './helpers.mjs'

describe('tabs', () => {
  it('keeps known tabs in the configured order and falls back to all of them', () => {
    assert.deepEqual(visibleTabs(['shortcut', 'GitHub', 'jira', 'shortcut']), ['shortcut', 'github'])
    assert.deepEqual(visibleTabs([]), ['all', 'github', 'shortcut'])
    assert.deepEqual(visibleTabs(undefined), ['all', 'github', 'shortcut'])
  })
  it('knows which sources the tabs need', () => {
    assert.deepEqual(sourcesOf(['github']), ['github'])
    assert.deepEqual(sourcesOf(['shortcut', 'github']), ['github', 'shortcut'])
    assert.deepEqual(sourcesOf(['all']), ['github', 'shortcut'])
  })
})

describe('parseRef', () => {
  it('routes references to their source', () => {
    assert.deepEqual(parseRef('482'), { source: 'github', number: 482, repo: null, owner: null, name: null })
    assert.equal(parseRef('https://github.com/acme/shop/issues/3').repo, 'acme/shop')
    assert.deepEqual(parseRef('sc-482'), { source: 'shortcut', number: 482, workspace: null })
    assert.deepEqual(parseRef('https://app.shortcut.com/acme/story/9/x'), { source: 'shortcut', number: 9, workspace: 'acme' })
    assert.equal(parseRef('nope'), null)
  })
})

describe('records', () => {
  it('merges sources newest updated first', () => {
    const merged = mergeByUpdated([[sampleIssue()], [sampleStory()]])
    assert.deepEqual(merged.map(item => item.ref ?? `#${item.number}`), ['sc-482', '#482'])
  })
  it('shows the workflow state of stories and "closed" for closed issues', () => {
    assert.equal(stateText(sampleStory()), 'In Progress')
    assert.equal(stateText({ ...sampleIssue(), source: 'github', closed: true }), 'closed')
    assert.equal(stateText({ ...sampleIssue(), source: 'github', closed: false }), '')
  })
  it('filters on the reference, the state and the type too', () => {
    const text = haystack(sampleStory())
    for (const word of ['sc-482', 'in progress', 'bug', '@ana', 'returns', 'cy']) assert.ok(text.includes(word), word)
  })
})
