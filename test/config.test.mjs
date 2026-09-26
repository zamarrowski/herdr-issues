import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { DEFAULTS, envOverrides, forSource, loadConfig, merge, render, resolveAgent, sanitizeAgentName, sanitizeBranch, saveConfigValue, validate } from '../lib/config.mjs'
import { tempDir } from './helpers.mjs'

describe('merge', () => {
  it('deep merges plain objects and replaces everything else', () => {
    const out = merge(DEFAULTS, { timeouts: { prompt_ms: 1 }, agent_args: { codex: ['--x'] }, agent: 'codex' })
    assert.equal(out.timeouts.prompt_ms, 1)
    assert.equal(out.timeouts.worktree_ms, DEFAULTS.timeouts.worktree_ms)
    assert.deepEqual(out.agent_args, { codex: ['--x'] })
    assert.equal(out.agent, 'codex')
    assert.equal(DEFAULTS.timeouts.prompt_ms, 30_000, 'defaults are not mutated')
  })
  it('ignores undefined values, $-keys and non-object layers', () => {
    const out = merge(DEFAULTS, null, { agent: undefined, $comment: 'x' }, 'nope')
    assert.equal(out.agent, 'auto')
    assert.equal(out.$comment, undefined)
  })
})

describe('render', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    assert.equal(render('issue-{number}-{slug}', { number: 4, slug: 'x' }), 'issue-4-x')
    assert.equal(render('{number} {missing}', { number: 1 }), '1 {missing}')
    assert.equal(render('{a}', { a: null }), '{a}')
    assert.equal(render(undefined, {}), '')
  })
})

describe('envOverrides', () => {
  it('reads HERDR_ISSUES_AGENT and HERDR_ISSUES_BASE only', () => {
    assert.deepEqual(envOverrides({ HERDR_ISSUES_AGENT: 'codex', HERDR_ISSUES_BASE: 'origin/main', OTHER: '1' }), { agent: 'codex', base: 'origin/main' })
    assert.deepEqual(envOverrides({}), {})
  })
})

describe('validate', () => {
  it('accepts the defaults and $-prefixed keys', () => {
    assert.deepEqual(validate({ ...DEFAULTS, timeouts: { ...DEFAULTS.timeouts }, $comment: 'hi' }), [])
    assert.deepEqual(validate(null), [])
  })
  it('reports unknown keys, wrong types and bad patterns', () => {
    const warnings = validate({ nope: 1, limit: '10', agent_args: { codex: 'not-array' }, timeouts: { foo: 1, prompt_ms: -1 }, trust_prompt_pattern: '(', agent: 'Bad Kind' })
    assert.ok(warnings.some(w => w.includes('unknown key "nope"')))
    assert.ok(warnings.some(w => w.includes('"limit" should be a number')))
    assert.ok(warnings.some(w => w.includes('agent_args.codex')))
    assert.ok(warnings.some(w => w.includes('timeouts.foo')))
    assert.ok(warnings.some(w => w.includes('timeouts.prompt_ms')))
    assert.ok(warnings.some(w => w.includes('trust_prompt_pattern')))
    assert.ok(warnings.some(w => w.includes('"agent" does not look like')))
    assert.ok(validate({ prompt: 'a\nb' }).some(w => w.includes('line breaks')))
    assert.deepEqual(validate({ prompt: 'a\nb', submit: true }), [])
  })
  it('rejects non-objects', () => {
    assert.deepEqual(validate([1]), ['config.json must contain a JSON object'])
  })
})

describe('loadConfig', () => {
  it('returns defaults when the file is missing', () => {
    const { config, exists, warnings } = loadConfig({ file: path.join(tempDir(), 'none.json'), env: {} })
    assert.equal(exists, false)
    assert.deepEqual(warnings, [])
    assert.equal(config.agent, 'auto')
  })
  it('layers file and environment over the defaults', () => {
    const file = path.join(tempDir(), 'config.json')
    fs.writeFileSync(file, JSON.stringify({ agent: 'codex', timeouts: { prompt_ms: 5 } }))
    const { config, exists, warnings } = loadConfig({ file, env: { HERDR_ISSUES_AGENT: 'gemini' } })
    assert.equal(exists, true)
    assert.deepEqual(warnings, [])
    assert.equal(config.agent, 'gemini', 'environment wins over the file')
    assert.equal(config.timeouts.prompt_ms, 5)
    assert.equal(config.timeouts.worktree_ms, 180_000)
  })
  it('keeps the defaults and warns when the file is not valid JSON', () => {
    const file = path.join(tempDir(), 'config.json')
    fs.writeFileSync(file, '{ not json')
    const { config, warnings } = loadConfig({ file, env: {} })
    assert.equal(config.agent, 'auto')
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /could not parse/)
  })
})

describe('saveConfigValue', () => {
  it('creates the file and preserves other keys', () => {
    const file = path.join(tempDir(), 'nested', 'config.json')
    saveConfigValue('agent', 'codex', file)
    saveConfigValue('limit', 5, file)
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { agent: 'codex', limit: 5 })
  })
})

describe('sanitizeAgentName', () => {
  it('produces names herdr accepts', () => {
    const valid = /^[a-z][a-z0-9_-]{0,31}$/
    for (const input of ['issue-482', 'Issue #482', '482', '', '---', 'a'.repeat(50), 'ÉTÉ 12', 'x_y-z']) {
      assert.match(sanitizeAgentName(input), valid, `from ${JSON.stringify(input)}`)
    }
    assert.equal(sanitizeAgentName('Issue #482'), 'issue-482')
    assert.equal(sanitizeAgentName('482'), 'issue-482')
    assert.equal(sanitizeAgentName(''), 'issue')
  })
})

describe('sanitizeBranch', () => {
  it('removes what git refuses in ref names', () => {
    assert.equal(sanitizeBranch('issue 1: fix ~^ ? *[x]'), 'issue-1-fix-x')
    assert.equal(sanitizeBranch('a..b'), 'a.b')
    assert.equal(sanitizeBranch('/feature//x/'), 'feature/x')
    assert.equal(sanitizeBranch('name.lock'), 'name')
    assert.equal(sanitizeBranch('issue-482-returns-page'), 'issue-482-returns-page')
  })
})

describe('resolveAgent', () => {
  it('follows explicit > config (unless auto) > focused pane > null', () => {
    assert.equal(resolveAgent({ explicit: 'pi', config: { agent: 'codex' }, focusedAgent: 'claude' }), 'pi')
    assert.equal(resolveAgent({ config: { agent: 'codex' }, focusedAgent: 'claude' }), 'codex')
    assert.equal(resolveAgent({ config: { agent: 'auto' }, focusedAgent: 'claude' }), 'claude')
    assert.equal(resolveAgent({ config: { agent: 'auto' } }), null)
    assert.equal(resolveAgent(), null)
  })
})

describe('tabs and the shortcut block', () => {
  it('validates tab names and shortcut keys', () => {
    assert.deepEqual(validate({ tabs: ['github', 'shortcut'], shortcut: { team: 'Backend', branch: 'sc-{number}' } }), [])
    const warnings = validate({ tabs: ['jira'], shortcut: { token: 'x', nope: 1, team: 3 } })
    assert.ok(warnings.some(w => w.includes('unknown tab "jira"')))
    assert.ok(warnings.some(w => w.includes('"shortcut.token" is ignored')))
    assert.ok(warnings.some(w => w.includes('unknown key "shortcut.nope"')))
    assert.ok(warnings.some(w => w.includes('"shortcut.team" should be a string')))
    assert.ok(validate({ tabs: [] }).some(w => w.includes('"tabs" is empty')))
    assert.ok(validate({ tabs: 'github' }).some(w => w.includes('"tabs" should be a array')))
  })
  it('merges the shortcut block over its defaults', () => {
    const config = merge(DEFAULTS, { shortcut: { team: 'Backend' } })
    assert.equal(config.shortcut.team, 'Backend')
    assert.equal(config.shortcut.branch, 'sc-{number}-{slug}')
  })
  it('applies a source block only to its own records', () => {
    const config = merge(DEFAULTS, { branch: 'gh-{number}', shortcut: { label: 'S {ref}' } })
    assert.equal(forSource(config, 'github').branch, 'gh-{number}')
    assert.equal(forSource(config, undefined).branch, 'gh-{number}')
    assert.equal(forSource(config, 'shortcut').branch, 'sc-{number}-{slug}')
    assert.equal(forSource(config, 'shortcut').label, 'S {ref}')
    assert.equal(forSource(config, 'shortcut').prompt, '{url}')
  })
})
