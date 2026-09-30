import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { DEFAULTS, merge } from '../lib/config.mjs'
import { stripAnsi } from '../lib/format.mjs'
import { createSettings, extraArgs, joinArgs, listedKinds, modeOf, modesFor, moveTab, splitArgs, tabRows, tabsValue, toggleTab, withExtra, withMode } from '../lib/settings.mjs'
import { tempDir } from './helpers.mjs'

const CLAUDE = modesFor(DEFAULTS, 'claude')

describe('splitArgs / joinArgs', () => {
  it('splits like a shell without expansions', () => {
    assert.deepEqual(splitArgs('--add-dir ../shared  -v'), ['--add-dir', '../shared', '-v'])
    assert.deepEqual(splitArgs(`--add-dir '../my dir' --msg "say \\"hi\\"" a\\ b`), ['--add-dir', '../my dir', '--msg', 'say "hi"', 'a b'])
    assert.deepEqual(splitArgs(`--empty '' x`), ['--empty', '', 'x'])
    assert.deepEqual(splitArgs('  '), [])
  })
  it('quotes what would be split, and round-trips', () => {
    const args = ['--add-dir', '../my dir', "it's", '', '--model=opus']
    assert.equal(joinArgs(args), `--add-dir '../my dir' 'it'\\''s' '' --model=opus`)
    assert.deepEqual(splitArgs(joinArgs(args)), args)
  })
})

describe('agent modes', () => {
  it('lists the valid modes of a kind and hides empty ones', () => {
    assert.deepEqual(CLAUDE.map(([name]) => name), ['accept edits', 'auto', 'plan', 'skip permissions (dangerous)'])
    const config = merge(DEFAULTS, { agent_modes: { claude: { auto: [] }, pi: { fast: ['--fast'], bad: 'x' } } })
    assert.ok(!modesFor(config, 'claude').some(([name]) => name === 'auto'))
    assert.deepEqual(modesFor(config, 'pi'), [['fast', ['--fast']]])
    assert.deepEqual(modesFor(config, 'nobody'), [])
  })
  it('finds the mode in the arguments and keeps the rest apart', () => {
    const args = ['--add-dir', '../shared', '--permission-mode', 'plan']
    assert.equal(modeOf(args, CLAUDE), 'plan')
    assert.deepEqual(extraArgs(args, CLAUDE), ['--add-dir', '../shared'])
    assert.equal(modeOf(['--add-dir', 'x'], CLAUDE), null)
    assert.equal(modeOf(['--permission-mode', 'nope'], CLAUDE), null, 'the whole run has to match')
  })
  it('switches the mode and keeps the extra arguments', () => {
    const args = ['--add-dir', '../shared', '--permission-mode', 'plan']
    assert.deepEqual(withMode(args, CLAUDE, 'skip permissions (dangerous)'), ['--dangerously-skip-permissions', '--add-dir', '../shared'])
    assert.deepEqual(withMode(args, CLAUDE, null), ['--add-dir', '../shared'])
    assert.deepEqual(withExtra(args, CLAUDE, ['--model', 'opus']), ['--permission-mode', 'plan', '--model', 'opus'])
    assert.deepEqual(withExtra([], CLAUDE, []), [])
  })
})

describe('tabs', () => {
  it('lists the shown tabs first, in their order, then the hidden ones', () => {
    assert.deepEqual(tabRows(['linear', 'github']), [
      { id: 'linear', on: true },
      { id: 'github', on: true },
      { id: 'all', on: false },
      { id: 'shortcut', on: false },
    ])
    assert.deepEqual(tabsValue(tabRows(undefined)), [...DEFAULTS.tabs])
  })
  it('toggles a tab but keeps the last one', () => {
    const rows = tabRows(['github', 'linear'])
    assert.deepEqual(tabsValue(toggleTab(rows, 'linear')), ['github'])
    assert.deepEqual(tabsValue(toggleTab(rows, 'all')), ['github', 'linear', 'all'], 'a tab shown again goes where it is in the list')
    const single = toggleTab(rows, 'linear')
    assert.equal(toggleTab(single, 'github'), single, 'hiding the last tab is refused')
  })
  it('moves a tab within bounds', () => {
    const rows = tabRows(['all', 'github', 'shortcut', 'linear'])
    assert.deepEqual(tabsValue(moveTab(rows, 'linear', -1)), ['all', 'github', 'linear', 'shortcut'])
    assert.equal(moveTab(rows, 'all', -1), rows)
    assert.equal(moveTab(rows, 'linear', 1), rows)
  })
})

describe('listedKinds', () => {
  it('lists the default, the pane agent, kinds with modes or arguments, and added ones, once each', () => {
    const config = merge(DEFAULTS, { agent: 'pi', agent_args: { opencode: ['-x'], claude: ['--y'] } })
    assert.deepEqual(listedKinds({ config, focusedAgent: 'claude', added: ['amp', 'pi'] }), ['pi', 'claude', 'codex', 'gemini', 'opencode', 'amp'])
    assert.deepEqual(listedKinds({ config: merge(DEFAULTS, { agent_modes: { gemini: { 'auto edit': [], 'yolo (dangerous)': [] } } }) }), ['claude', 'codex'])
  })
})

describe('createSettings', () => {
  const setup = (data = {}, extra = {}) => {
    const configFile = path.join(tempDir(), 'config.json')
    if (Object.keys(data).length) fs.writeFileSync(configFile, JSON.stringify(data))
    const config = merge(DEFAULTS, data)
    const changes = []
    let closed = null
    const settings = createSettings({ config, configFile, kinds: ['pi', 'claude', 'codex', 'gemini', 'amp'], env: {}, onChange: key => changes.push(key), onClose: quit => (closed = { quit }), ...extra })
    const text = () => stripAnsi(settings.lines(120, 40).lines.join('\n'))
    const saved = () => JSON.parse(fs.readFileSync(configFile, 'utf8'))
    const press = (...keys) => keys.forEach(key => settings.key(key))

    return { settings, config, configFile, changes, closed: () => closed, text, saved, press }
  }
  const down = n => Array(n).fill('j')

  it('shows the tabs, the default agent and how each agent starts', () => {
    const { text } = setup({ agent_args: { claude: ['--dangerously-skip-permissions', '--add-dir', '../shared'] } })
    const screen = text()
    assert.match(screen, /Tabs/)
    assert.match(screen, /\[x\] All/)
    assert.match(screen, /\[x\] Linear/)
    assert.match(screen, /Default\s+auto\s+the agent in your pane, otherwise ask/)
    assert.match(screen, /claude\s+skip permissions \(dangerous\) \+ --add-dir \.\.\/shared/)
    assert.match(screen, /codex\s+default/)
    assert.match(screen, /\+ another agent…/)
  })
  it('hides a tab, moves another, and saves both', () => {
    const { press, saved, config, changes } = setup()
    press(...down(3), ' ') // Linear
    assert.deepEqual(saved().tabs, ['all', 'github', 'shortcut'])
    assert.deepEqual(config.tabs, ['all', 'github', 'shortcut'])
    press('k', 'K') // Shortcut above GitHub
    assert.deepEqual(saved().tabs, ['all', 'shortcut', 'github'])
    assert.deepEqual(changes, ['tabs', 'tabs'])
  })
  it('picks the default agent', () => {
    const { press, saved, config, text } = setup()
    press(...down(4), '\r') // the agent row opens the picker
    assert.match(text(), /Which agent takes an issue by default\?/)
    press('c', 'o', 'd', '\r')
    assert.equal(saved().agent, 'codex')
    assert.equal(config.agent, 'codex')
    assert.match(text(), /Default agent: codex/)
  })
  it('keeps HERDR_ISSUES_AGENT in effect after saving the agent', () => {
    const { press, saved, config, text } = setup({}, { env: { HERDR_ISSUES_AGENT: 'pi' } })
    config.agent = 'pi'
    press(...down(4), '\r', 'c', 'l', 'a', '\r')
    assert.equal(saved().agent, 'claude')
    assert.equal(config.agent, 'pi')
    assert.match(text(), /Default\s+claude.*HERDR_ISSUES_AGENT=pi overrides it/)
  })
  it('sets the mode of an agent, then its extra arguments, and clears them', () => {
    const { press, saved, config, text } = setup()
    press(...down(5), '\r') // claude
    assert.match(text(), /How should claude start\?/)
    press('s', 'k', 'i', 'p', '\r')
    assert.deepEqual(saved().agent_args, { claude: ['--dangerously-skip-permissions'] })
    assert.match(text(), /herdr starts claude with: --dangerously-skip-permissions/)
    press('e', ...'--add-dir "../my dir"', '\r')
    assert.deepEqual(saved().agent_args, { claude: ['--dangerously-skip-permissions', '--add-dir', '../my dir'] })
    press('\r', ...'default', '\r') // the mode goes, the extra arguments stay
    assert.deepEqual(config.agent_args, { claude: ['--add-dir', '../my dir'] })
    press('x')
    assert.deepEqual(saved().agent_args, {})
    assert.deepEqual(DEFAULTS.agent_args, {}, 'the defaults are not mutated')
  })
  it('adds an agent without modes and types its arguments', () => {
    const { press, saved, text } = setup()
    press('G', '\r') // + another agent…
    assert.match(text(), /Which agent do you want to set up\?/)
    press('a', 'm', 'p', '\r')
    assert.match(text(), /amp has no modes: press e to type its arguments/)
    press('\r', ...'--dangerously-allow-all', '\r')
    assert.deepEqual(saved().agent_args, { amp: ['--dangerously-allow-all'] })
  })
  it('opens the account links and shows their message', () => {
    let opened = 0
    const links = [{ name: 'Linear', text: () => 'not connected', open: () => (opened++, 'Show the Linear tab first') }]
    const { press, text, settings } = setup({}, { links, focus: 'Linear' })
    assert.match(text(), /Accounts[\s\S]*› Linear\s+not connected/)
    press('\r')
    assert.equal(opened, 1)
    assert.equal(settings.state.message, 'Show the Linear tab first')
  })
  it('leaves a broken config.json alone and says so', () => {
    const { press, configFile, text, config } = setup()
    fs.writeFileSync(configFile, '{ nope')
    press(...down(3), ' ')
    assert.equal(fs.readFileSync(configFile, 'utf8'), '{ nope')
    assert.match(text(), /could not save: .*not valid JSON/)
    assert.deepEqual(config.tabs, [...DEFAULTS.tabs])
    assert.match(text(), /\[x\] Linear/)
  })
  it('closes with Esc and quits with Ctrl+C', () => {
    const one = setup()
    one.press('\x1b')
    assert.deepEqual(one.closed(), { quit: false })
    const two = setup()
    two.press('\x03')
    assert.deepEqual(two.closed(), { quit: true })
  })
})
