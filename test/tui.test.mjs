import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { DEFAULTS, merge } from '../lib/config.mjs'
import { stripAnsi } from '../lib/format.mjs'
import { createLauncher } from '../lib/launch.mjs'
import { createPicker, createStepper, editLine, layout, stepLines, window } from '../lib/tui.mjs'
import { sampleIssue, sampleStory, tempDir } from './helpers.mjs'

describe('layout / window', () => {
  it('pins the footer and fills the body', () => {
    const out = layout(['a', 'b'], ['footer'], 5)
    assert.deepEqual(out, ['a', 'b', '', '', 'footer'])
    assert.deepEqual(layout(['a', 'b', 'c'], ['f'], 3), ['a', 'b', 'f'])
  })
  it('scrolls a window around the cursor', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    assert.deepEqual(window(items, 0, 3), { start: 0, visible: [1, 2, 3] })
    assert.deepEqual(window(items, 5, 3), { start: 4, visible: [5, 6, 7] })
    assert.deepEqual(window(items, 9, 3), { start: 7, visible: [8, 9, 10] })
    assert.deepEqual(window([1], 0, 3), { start: 0, visible: [1] })
  })
})

describe('editLine', () => {
  it('appends, deletes and clears', () => {
    assert.equal(editLine('ab', 'c'), 'abc')
    assert.equal(editLine('ab', '\x7f'), 'a')
    assert.equal(editLine('ab', '\x15'), '')
    assert.equal(editLine('ab', '\x1b[A'), 'ab')
    assert.equal(editLine('ab', '\x03'), 'ab')
  })
})

describe('stepper', () => {
  it('tracks running, done and failed steps', () => {
    let changes = 0
    const stepper = createStepper(() => changes++)
    stepper.begin('one')
    stepper.begin('two')
    assert.deepEqual(stepper.steps.map(step => step.status), ['done', 'running'])
    stepper.fail('boom')
    assert.deepEqual(stepper.steps.map(step => step.status), ['done', 'error', 'error'])
    assert.equal(changes, 3)
    const text = stripAnsi(stepLines(stepper.steps).join('\n'))
    assert.match(text, /✓ one/)
    assert.match(text, /✗ boom/)
  })
})

describe('picker', () => {
  const items = [{ id: 'claude', note: 'running in your pane' }, { id: 'codex' }, { id: 'gemini' }, { id: 'kimi' }]
  it('filters by typing and moves with arrows', () => {
    const picker = createPicker({ items, title: 'Agent' })
    assert.equal(picker.current().id, 'claude')
    assert.equal(picker.key('\x1b[B'), null)
    assert.equal(picker.current().id, 'codex')
    picker.key('k')
    assert.equal(picker.state.filter, 'k')
    assert.equal(picker.current().id, 'kimi', 'letters filter instead of moving')
    picker.key('\x7f')
    picker.key('g')
    assert.equal(picker.current().id, 'gemini')
    assert.equal(picker.key('\r'), 'pick')
    assert.equal(picker.key('\x1b'), 'cancel')
  })
  it('renders a frame with the cursor on the filter row', () => {
    const picker = createPicker({ items, title: 'Agent' })
    const { lines, cursor } = picker.lines(40, 10)
    assert.equal(cursor.row, 2)
    assert.match(stripAnsi(lines[0]), /Agent/)
    assert.match(stripAnsi(lines.join('\n')), /› claude {2}running in your pane/)
  })
})

describe('launcher', () => {
  const config = merge(DEFAULTS, {})
  const target = { root: '/repo', workspaceId: null }
  const kinds = ['claude', 'codex']
  const make = extra =>
    createLauncher({ issue: sampleIssue(), repo: 'acme/shop', target, config, configFile: path.join(tempDir(), 'config.json'), kinds, onRedraw: () => {}, onCancel: () => {}, onDone: () => {}, ...extra })

  it('opens the picker when nothing decided the agent', () => {
    const launcher = make({})
    assert.equal(launcher.state.view, 'pick')
    assert.equal(launcher.state.agent, null)
    launcher.key('\r')
    assert.equal(launcher.state.view, 'confirm')
    assert.equal(launcher.state.agent, 'claude')
    const text = stripAnsi(launcher.lines(100, 20).join('\n'))
    assert.match(text, /Agent\s+claude/)
    assert.match(text, /Branch\s+issue-482-returns-page-crashes-on-empty-address/)
    assert.match(text, /y start · d start and make claude the default/)
  })
  it('goes straight to confirm with the focused pane agent and lets you change it', () => {
    const launcher = make({ focusedAgent: 'codex' })
    assert.equal(launcher.state.view, 'confirm')
    assert.equal(launcher.state.agent, 'codex')
    launcher.key('a')
    assert.equal(launcher.state.view, 'pick')
    launcher.key('\x1b')
    assert.equal(launcher.state.view, 'confirm', 'Esc in the picker returns to confirm when an agent is set')
  })
  it('saves the default agent with d', () => {
    const configFile = path.join(tempDir(), 'config.json')
    let cancelled = false
    const launcher = createLauncher({
      issue: sampleIssue(),
      repo: 'acme/shop',
      target,
      config: merge(DEFAULTS, {}),
      configFile,
      kinds,
      focusedAgent: 'claude',
      onRedraw: () => {},
      onCancel: () => (cancelled = true),
      onDone: () => {},
    })
    // HERDR_BIN_PATH points nowhere useful here: the run itself fails, but the config must be saved first.
    process.env.HERDR_BIN_PATH = '/nonexistent/herdr'
    launcher.key('d')
    delete process.env.HERDR_BIN_PATH
    assert.equal(JSON.parse(fs.readFileSync(configFile, 'utf8')).agent, 'claude')
    assert.equal(launcher.state.view, 'starting')
    launcher.key('\x1b')
    assert.equal(cancelled, false, 'keys are ignored while the flow is running')
  })
  it('cancels from confirm with Esc', () => {
    let cancelled = false
    const launcher = make({ focusedAgent: 'claude', onCancel: () => (cancelled = true) })
    launcher.key('\x1b')
    assert.equal(cancelled, true)
  })
  const screenText = out => stripAnsi((Array.isArray(out) ? out : out.lines).join('\n'))
  it('asks for the repository of a story, preselecting the preferred one', async () => {
    const repos = {
      items: [
        { id: 'api', note: '/code/api', root: '/code/api', workspaceId: 'w3' },
        { id: 'shop', note: '/code/shop', root: '/code/shop', workspaceId: 'w1' },
      ],
      preferred: 1,
    }
    let redraws = 0
    const launcher = make({ issue: sampleStory(), repo: null, focusedAgent: 'codex', loadRepos: async () => repos, onRedraw: () => redraws++ })
    assert.equal(launcher.state.view, 'repo')
    assert.match(screenText(launcher.lines(100, 20)), /Looking at the workspaces open in herdr/)
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(redraws > 0)
    const picker = screenText(launcher.lines(100, 20))
    assert.match(picker, /Where should sc-482 be worked on\?/)
    assert.match(picker, /› shop/)
    launcher.key('\x1b[A')
    launcher.key('\r')
    assert.equal(launcher.state.view, 'confirm')
    assert.deepEqual(launcher.state.target, { root: '/code/api', workspaceId: 'w3', tab: false, cwd: null })
    const text = screenText(launcher.lines(100, 20))
    assert.match(text, /Start story · api/)
    assert.match(text, /Repository\s+api/)
    assert.match(text, /Branch\s+sc-482-returns-page-crashes-on-empty-address/)
    assert.match(text, /r change where/)
    launcher.key('r')
    assert.equal(launcher.state.view, 'repo')
    launcher.key('\x1b')
    assert.equal(launcher.state.view, 'confirm', 'Esc keeps the chosen repository')
  })
  it('offers a new tab in a workspace without git, and shows it on the confirm screen', async () => {
    const repos = {
      items: [
        { id: 'shop', note: '/code/shop', root: '/code/shop', workspaceId: 'w1' },
        { id: 'notes', note: '~/notes · new tab', cwd: '/home/ana/notes', workspaceId: 'w2', tab: true },
      ],
      preferred: 1,
    }
    const launcher = make({ issue: sampleStory(), repo: null, focusedAgent: 'claude', loadRepos: async () => repos })
    await new Promise(resolve => setImmediate(resolve))
    assert.match(screenText(launcher.lines(100, 20)), /› notes\s+~\/notes · new tab/)
    launcher.key('\r')
    assert.deepEqual(launcher.state.target, { root: null, workspaceId: 'w2', tab: true, cwd: '/home/ana/notes' })
    const text = screenText(launcher.lines(100, 20))
    assert.match(text, /Where\s+a new tab in notes\s+~\/notes\n/)
    assert.match(text, /Tab\s+sc-482 Returns page/)
    assert.doesNotMatch(text, /Branch/)
    launcher.key('r')
    assert.match(screenText(launcher.lines(100, 20)), /› notes/, 'the tab stays selected when coming back')
  })
  it('picks the only repository without asking, then asks for the agent', async () => {
    const launcher = make({ issue: sampleStory(), loadRepos: async () => ({ items: [{ id: 'shop', root: '/code/shop', workspaceId: 'w1' }], preferred: 0 }) })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(launcher.state.view, 'pick')
    assert.equal(launcher.state.repo, 'shop')
  })
  it('says so when herdr has no repository open, and Esc cancels', async () => {
    let cancelled = false
    const launcher = make({ issue: sampleStory(), focusedAgent: 'codex', loadRepos: async () => ({ items: [], preferred: -1 }), onCancel: () => (cancelled = true) })
    await new Promise(resolve => setImmediate(resolve))
    assert.match(screenText(launcher.lines(100, 20)), /No workspace is open in herdr/)
    launcher.key('\x1b')
    assert.equal(cancelled, true)
  })
})
