import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HerdrError, agentKinds, herdr, herdrVersion, parseCliOutput, parseKinds, versionAtLeast } from '../lib/herdr.mjs'
import { withFakeHerdr } from './helpers.mjs'

describe('parseCliOutput', () => {
  it('finds the result envelope on stdout', () => {
    assert.deepEqual(parseCliOutput('{"id":"cli","result":{"type":"ok"}}\n', ''), { result: { type: 'ok' }, error: null })
  })
  it('finds the error envelope on stderr and prefers it', () => {
    const out = parseCliOutput('{"id":"cli","result":{"type":"ok"}}', '{"id":"cli","error":{"code":"agent_not_found","message":"nope"}}')
    assert.equal(out.error.code, 'agent_not_found')
  })
  it('skips noise lines', () => {
    const out = parseCliOutput('warning: something\n{"id":"x","result":{"a":1}}\ntrailing', 'not json {')
    assert.deepEqual(out.result, { a: 1 })
    assert.equal(out.error, null)
  })
  it('returns nulls when there is no JSON', () => {
    assert.deepEqual(parseCliOutput('plain text', ''), { result: null, error: null })
  })
})

describe('parseKinds', () => {
  it('reads the kinds line of `herdr agent`', () => {
    assert.deepEqual(parseKinds('herdr agent commands:\n  ...\n  kinds: pi|claude|codex\n'), ['pi', 'claude', 'codex'])
    assert.equal(parseKinds('nothing here'), null)
  })
})

describe('versionAtLeast', () => {
  it('compares semantic versions', () => {
    assert.equal(versionAtLeast('0.9.1', '0.9.0'), true)
    assert.equal(versionAtLeast('0.9.0', '0.9.0'), true)
    assert.equal(versionAtLeast('0.8.9', '0.9.0'), false)
    assert.equal(versionAtLeast('1.0.0-beta.1', '0.9.0'), true)
    assert.equal(versionAtLeast('garbage', '0.9.0'), false)
  })
})

describe('herdr() against the fake CLI', () => {
  it('returns the result payload', async () => {
    const { result, calls } = await withFakeHerdr('happy', () => herdr(['agent', 'send-keys', 'w1:p1', 'enter']))
    assert.deepEqual(result, { type: 'ok' })
    assert.deepEqual(calls, [['agent', 'send-keys', 'w1:p1', 'enter']])
  })
  it('turns error envelopes into HerdrError with the code', async () => {
    await withFakeHerdr('happy', async () => {
      await assert.rejects(herdr(['no', 'such']), error => error instanceof HerdrError && error.code === 'unknown_command' && /does not implement/.test(error.message))
    })
  })
  it('maps CLI syntax errors (exit 2) to code "usage"', async () => {
    await withFakeHerdr('bad-kind', async () => {
      await assert.rejects(herdr(['agent', 'start', 'x', '--kind', 'nope', '--pane', 'w1:p1']), error => error.code === 'usage' && /unsupported/.test(error.message))
    })
  })
  it('reads the version and the agent kinds', async () => {
    await withFakeHerdr('happy', async () => {
      assert.equal(await herdrVersion(), '0.9.1')
      assert.deepEqual(await agentKinds(), ['pi', 'claude', 'codex', 'gemini', 'opencode'])
    })
  })
})
