import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { PLUGIN_ID } from '../lib/paths.mjs'
import { MARK_END, MARK_START, hasBlock, initConfig, insertBlock, keyBlock, removeKeys, stripBlock, writeKeys } from '../lib/setup.mjs'
import { projectRoot, tempDir } from './helpers.mjs'

describe('keyBlock', () => {
  it('binds the open and start actions of this plugin', () => {
    const block = keyBlock()
    assert.ok(block.startsWith(MARK_START))
    assert.ok(block.endsWith(MARK_END))
    assert.match(block, new RegExp(`command = "${PLUGIN_ID.replace('.', '\\.')}\\.open"`))
    assert.match(block, new RegExp(`command = "${PLUGIN_ID.replace('.', '\\.')}\\.start"`))
    assert.match(block, /type = "plugin_action"/)
    assert.match(keyBlock({ open: 'alt+i', start: 'alt+shift+i' }), /key = "alt\+i"/)
  })
})

describe('insertBlock / stripBlock', () => {
  const existing = 'onboarding = false\n\n[theme]\nname = "one-dark"\n'
  it('appends the block after the existing content with one blank line', () => {
    const out = insertBlock(existing)
    assert.ok(out.startsWith(existing.trimEnd()))
    assert.ok(out.includes(`\n\n${MARK_START}`))
    assert.ok(out.endsWith(`${MARK_END}\n`))
    assert.equal(hasBlock(out), true)
  })
  it('is idempotent and replaces an older block', () => {
    const once = insertBlock(existing)
    assert.equal(insertBlock(once), once)
    const older = once.replace('key = "prefix+i"', 'key = "prefix+x"')
    const refreshed = insertBlock(older)
    assert.equal(refreshed, once)
    assert.equal(refreshed.split(MARK_START).length, 2)
  })
  it('strips the block and keeps everything around it', () => {
    const middle = `${existing}\n${keyBlock()}\n\n[ui]\nsidebar_width = 30\n`
    const out = stripBlock(middle)
    assert.equal(hasBlock(out), false)
    assert.ok(out.includes('[theme]'))
    assert.ok(out.includes('[ui]\nsidebar_width = 30'))
    assert.ok(!out.includes('plugin_action'))
    assert.equal(stripBlock(existing), existing)
    assert.equal(stripBlock(insertBlock('')), '')
  })
})

describe('writeKeys / removeKeys', () => {
  it('writes with a one-time backup and removes cleanly', () => {
    const dir = tempDir()
    const file = path.join(dir, 'config.toml')
    fs.writeFileSync(file, 'onboarding = false\n')
    const first = writeKeys(file)
    assert.equal(first.changed, true)
    assert.equal(first.backup, `${file}.herdr-issues.bak`)
    assert.equal(fs.readFileSync(first.backup, 'utf8'), 'onboarding = false\n')
    assert.equal(writeKeys(file).changed, false)
    assert.equal(removeKeys(file).changed, true)
    assert.equal(fs.readFileSync(file, 'utf8'), 'onboarding = false\n')
    assert.equal(removeKeys(file).changed, false)
    assert.equal(removeKeys(path.join(dir, 'missing.toml')).changed, false)
  })
  it('creates the config file when it does not exist', () => {
    const file = path.join(tempDir(), 'sub', 'config.toml')
    const result = writeKeys(file)
    assert.equal(result.changed, true)
    assert.equal(result.backup, null)
    assert.ok(hasBlock(fs.readFileSync(file, 'utf8')))
  })
})

describe('initConfig', () => {
  it('copies the example once', () => {
    const file = path.join(tempDir(), 'cfg', 'config.json')
    const example = path.join(projectRoot, 'config.example.json')
    assert.deepEqual(initConfig({ file, example }), { created: true, file })
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).agent, 'auto')
    assert.deepEqual(initConfig({ file, example }), { created: false, file })
  })
})
