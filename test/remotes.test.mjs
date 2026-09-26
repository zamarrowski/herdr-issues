// Every integration in lib/remotes.mjs implements the whole adapter interface, and the rest of the
// plugin (tabs, manifest, config) knows about it. A new integration that forgets a piece fails here.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { DEFAULTS, validate } from '../lib/config.mjs'
import { REMOTES } from '../lib/remotes.mjs'
import { SOURCES, TAB_NAMES, parseRef } from '../lib/sources.mjs'
import { projectRoot } from './helpers.mjs'

const STRINGS = ['id', 'name', 'noun', 'plural', 'refExample', 'tokenName', 'tokenWord', 'tokenEnv', 'secretKey', 'tokenHelp', 'assigneeLabel']
const FUNCTIONS = ['parseRef', 'auth', 'whoami', 'describe', 'lookups', 'people', 'teams', 'team', 'list', 'view', 'fetch', 'meta', 'settingsRows']
const manifest = fs.readFileSync(path.join(projectRoot, 'herdr-plugin.toml'), 'utf8')

for (const remote of Object.values(REMOTES)) {
  describe(`${remote.id} adapter`, () => {
    it('implements the interface', () => {
      for (const key of STRINGS) assert.equal(typeof remote[key], 'string', `${remote.id}.${key}`)
      for (const key of FUNCTIONS) assert.equal(typeof remote[key], 'function', `${remote.id}.${key}`)
      assert.ok(remote.filter.fields.length > 0 && typeof remote.filter.normalize === 'function' && typeof remote.filter.text === 'function')
      assert.ok(/^[a-z]+$/.test(remote.id))
    })
    it('has a tab, a config block and a secrets key of its own', () => {
      assert.ok(SOURCES.includes(remote.id))
      assert.equal(TAB_NAMES[remote.id], remote.name)
      assert.ok(DEFAULTS.tabs.includes(remote.id), 'shown by default')
      assert.ok(DEFAULTS[remote.id] && typeof DEFAULTS[remote.id] === 'object', `DEFAULTS.${remote.id}`)
      assert.deepEqual(validate({ [remote.id]: { ...DEFAULTS[remote.id] } }), [], 'its defaults validate')
      assert.ok(validate({ [remote.id]: { token: 'x' } }).some(warning => warning.includes('is ignored')), 'a token in config.json is refused')
      const others = Object.values(REMOTES).filter(other => other !== remote)
      assert.ok(others.every(other => other.secretKey !== remote.secretKey && other.tokenEnv !== remote.tokenEnv))
    })
    it('declares its link handler in the manifest, and parses what it matches', () => {
      const block = manifest.split('[[link_handlers]]').find(part => part.includes(`id = "${remote.link.id}"`))
      assert.ok(block, `herdr-plugin.toml lacks the ${remote.link.id} link handler`)
      assert.equal(JSON.parse(/^pattern = (.+)$/m.exec(block)[1]), remote.link.pattern)
      assert.match(block, /action = "start"/)
    })
    it('routes its example reference to itself when its tab is shown', () => {
      const example = remote.refExample.replace('<id>', '42')
      assert.equal(parseRef(example, ['github', remote.id])?.source, remote.id)
    })
  })
}
