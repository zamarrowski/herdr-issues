// Keeps herdr-plugin.toml, package.json and the scripts consistent with each other.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { PLUGIN_ID } from '../lib/paths.mjs'
import { projectRoot } from './helpers.mjs'

const manifest = fs.readFileSync(path.join(projectRoot, 'herdr-plugin.toml'), 'utf8')
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))

// Minimal TOML table-array reader: [[name]] blocks with `key = "string"` / `key = [array]` lines.
const tables = name => {
  const out = []
  const blocks = manifest.split(/^\[\[/m).slice(1)
  for (const block of blocks) {
    const [header, ...rest] = block.split('\n')
    if (header.trim() !== `${name}]]`) continue
    const entry = {}
    for (const line of rest) {
      if (/^\[\[/.test(line)) break
      const match = /^([a-z_]+)\s*=\s*(.+)$/.exec(line.trim())
      if (!match) continue
      const raw = match[2].trim()
      entry[match[1]] = raw.startsWith('[') ? JSON.parse(raw) : JSON.parse(raw)
    }
    out.push(entry)
  }

  return out
}
const top = key => /^KEY\s*=\s*"([^"]+)"/m.source && new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm').exec(manifest)?.[1]

describe('herdr-plugin.toml', () => {
  const actions = tables('actions')
  const panes = tables('panes')
  const handlers = tables('link_handlers')

  it('declares the plugin identity consistently', () => {
    assert.equal(top('id'), PLUGIN_ID)
    assert.equal(top('version'), pkg.version, 'package.json and the manifest must agree on the version')
    assert.match(top('min_herdr_version'), /^\d+\.\d+\.\d+$/)
    assert.ok(top('name'))
    assert.ok(top('description'))
  })

  it('has the expected actions, panes and link handlers', () => {
    assert.deepEqual(actions.map(a => a.id).sort(), ['open', 'setup', 'start'])
    assert.deepEqual(panes.map(p => p.id).sort(), ['browser', 'setup', 'start'])
    assert.deepEqual(handlers.map(h => h.id), ['github-issue', 'shortcut-story'], 'one link handler per source')
    for (const handler of handlers) assert.equal(handler.action, 'start')
  })

  it('points every action at a declared pane of this plugin', () => {
    for (const action of actions) {
      const shell = action.command.at(-1)
      const plugin = /--plugin (\S+)/.exec(shell)?.[1]
      const entrypoint = /--entrypoint (\S+)/.exec(shell)?.[1]
      assert.equal(plugin, PLUGIN_ID, `action ${action.id}`)
      assert.ok(panes.some(pane => pane.id === entrypoint), `action ${action.id} opens unknown pane ${entrypoint}`)
      assert.ok(shell.includes('"$HERDR_BIN_PATH"'), 'actions call herdr through HERDR_BIN_PATH')
    }
  })

  it('runs scripts that exist through bin/run.sh', () => {
    for (const pane of panes) {
      assert.deepEqual(pane.command.slice(0, 2), ['sh', 'bin/run.sh'], `pane ${pane.id}`)
      assert.ok(fs.existsSync(path.join(projectRoot, pane.command[2])), `${pane.command[2]} is missing`)
      assert.equal(pane.placement, 'popup')
    }
    assert.ok(fs.statSync(path.join(projectRoot, 'bin/run.sh')).mode & 0o111, 'bin/run.sh is executable')
  })

  it('matches GitHub issue URLs and nothing else with the link handler pattern', () => {
    const pattern = new RegExp(handlers.find(h => h.id === 'github-issue').pattern)
    assert.ok(pattern.test('https://github.com/acme/shop/issues/482'))
    assert.ok(pattern.test('https://github.com/acme/shop/issues/482#issuecomment-3'))
    assert.ok(!pattern.test('https://github.com/acme/shop/pull/482'))
    assert.ok(!pattern.test('https://github.com/acme/shop/issues'))
    assert.ok(!pattern.test('https://example.com/github.com/acme/shop/issues/1'))
    assert.ok(!pattern.test('https://app.shortcut.com/acme/story/482'))
  })

  it('matches Shortcut story URLs and nothing else with the story pattern', () => {
    const pattern = new RegExp(handlers.find(h => h.id === 'shortcut-story').pattern)
    assert.ok(pattern.test('https://app.shortcut.com/acme/story/482'))
    assert.ok(pattern.test('https://app.shortcut.com/acme/story/482/returns-page-crashes'))
    assert.ok(pattern.test('https://app.shortcut.com/acme/story/482?vc_group_by=day'))
    assert.ok(!pattern.test('https://app.shortcut.com/acme/epic/12'))
    assert.ok(!pattern.test('https://app.shortcut.com/acme/iteration/3'))
    assert.ok(!pattern.test('https://github.com/acme/shop/issues/482'))
  })

  it('parses what its link handlers match', async () => {
    const { parseRef } = await import('../lib/sources.mjs')
    assert.equal(parseRef('https://github.com/acme/shop/issues/482').source, 'github')
    assert.equal(parseRef('https://app.shortcut.com/acme/story/482/returns-page').source, 'shortcut')
  })
})

describe('package.json', () => {
  it('depends on highlight.js only, fetched by the manifest build step', () => {
    assert.deepEqual(Object.keys(pkg.dependencies), ['highlight.js'])
    assert.equal(pkg.devDependencies, undefined)
    assert.equal(pkg.type, 'module')
    assert.ok(fs.existsSync(path.join(projectRoot, 'package-lock.json')), 'npm ci needs package-lock.json')
    const build = tables('build')
    assert.equal(build.length, 1)
    assert.deepEqual(build[0].command.slice(0, 2), ['npm', 'ci'])
  })
  it('ships the example config with every default key', async () => {
    const { DEFAULTS } = await import('../lib/config.mjs')
    const example = JSON.parse(fs.readFileSync(path.join(projectRoot, 'config.example.json'), 'utf8'))
    for (const key of Object.keys(DEFAULTS)) assert.ok(key in example, `config.example.json lacks "${key}"`)
    for (const key of Object.keys(example)) assert.ok(key.startsWith('$') || key in DEFAULTS, `config.example.json has unknown "${key}"`)
    assert.deepEqual(example.timeouts, { ...DEFAULTS.timeouts })
    assert.deepEqual(example.shortcut, { ...DEFAULTS.shortcut })
    assert.deepEqual(example.tabs, [...DEFAULTS.tabs])
  })
})
