import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { pickCwd, pickRepo, readContext, repoCandidates, resolveTarget } from '../lib/context.mjs'
import { tempDir } from './helpers.mjs'

const gitInit = dir => {
  execFileSync('git', ['-C', dir, 'init', '-q'])

  return fs.realpathSync(dir)
}

describe('readContext', () => {
  it('parses HERDR_PLUGIN_CONTEXT_JSON and tolerates garbage', () => {
    assert.deepEqual(readContext({ HERDR_PLUGIN_CONTEXT_JSON: '{"workspace_id":"w1"}' }), { workspace_id: 'w1' })
    assert.deepEqual(readContext({ HERDR_PLUGIN_CONTEXT_JSON: 'nope' }), {})
    assert.deepEqual(readContext({}), {})
    assert.deepEqual(readContext({ HERDR_PLUGIN_CONTEXT_JSON: '[1]' }), {})
  })
})

describe('pickCwd / pickRepo', () => {
  it('follows flag > env > focused pane > workspace > fallback', () => {
    const context = { focused_pane_cwd: '/pane', workspace_cwd: '/ws' }
    assert.equal(pickCwd({ flag: '/flag', env: { HERDR_ISSUES_CWD: '/env' }, context }), '/flag')
    assert.equal(pickCwd({ env: { HERDR_ISSUES_CWD: '/env' }, context }), '/env')
    assert.equal(pickCwd({ env: {}, context }), '/pane')
    assert.equal(pickCwd({ env: {}, context: { workspace_cwd: '/ws' } }), '/ws')
    assert.equal(pickCwd({ env: {}, context: {}, fallback: '/fallback' }), '/fallback')
  })
  it('reads the repo override', () => {
    assert.equal(pickRepo({ flag: 'a/b', env: { HERDR_ISSUES_REPO: 'c/d' } }), 'a/b')
    assert.equal(pickRepo({ env: { HERDR_ISSUES_REPO: 'c/d' } }), 'c/d')
    assert.equal(pickRepo({ env: {} }), null)
  })
})

describe('resolveTarget', () => {
  it('finds the git root and reuses the workspace of the same repository', async () => {
    const repo = gitInit(tempDir())
    const sub = path.join(repo, 'src')
    fs.mkdirSync(sub)
    const target = await resolveTarget({ cwd: sub, context: { workspace_id: 'w1', workspace_cwd: repo, focused_pane_agent: 'claude' } })
    assert.equal(target.root, repo)
    assert.equal(target.workspaceId, 'w1')
    assert.equal(target.focusedAgent, 'claude')
    assert.equal(target.clickedUrl, null)
  })
  it('ignores the workspace when it belongs to another repository', async () => {
    const repo = gitInit(tempDir())
    const other = gitInit(tempDir())
    const target = await resolveTarget({ cwd: repo, context: { workspace_id: 'w1', workspace_cwd: other } })
    assert.equal(target.root, repo)
    assert.equal(target.workspaceId, null)
  })
  it('returns a null root outside git', async () => {
    const target = await resolveTarget({ cwd: tempDir(), repo: 'acme/shop', context: {} })
    assert.equal(target.root, null)
    assert.equal(target.repo, 'acme/shop')
  })
})

describe('repoCandidates', () => {
  const workspaces = [
    { workspace_id: 'w1', worktree: { checkout_path: '/code/shop', is_linked_worktree: false, repo_key: '/code/shop/.git', repo_name: 'shop', repo_root: '/code/shop' } },
    { workspace_id: 'w2', label: 'no git' },
    { workspace_id: 'w4', worktree: { checkout_path: '/wt/shop/sc-1', is_linked_worktree: true, repo_key: '/code/shop/.git', repo_name: 'shop', repo_root: '/code/shop' } },
    { workspace_id: 'w5', worktree: { checkout_path: '/wt/api/x', is_linked_worktree: true, repo_key: '/code/api/.git', repo_name: 'api', repo_root: '/code/api' } },
  ]
  it('lists each repository once, sorted, with its main checkout workspace', () => {
    const { items, preferred } = repoCandidates(workspaces)
    assert.deepEqual(
      items.map(item => [item.id, item.root, item.workspaceId]),
      [
        ['api', '/code/api', null],
        ['shop', '/code/shop', 'w1'],
      ],
    )
    assert.equal(preferred, -1)
  })
  it('prefers the repository of the workspace or checkout the popup came from', () => {
    assert.equal(repoCandidates(workspaces, { workspaceId: 'w4' }).preferred, 1)
    assert.equal(repoCandidates(workspaces, { root: '/wt/api/x' }).preferred, 0)
  })
  it('adds the pane checkout when no workspace covers it', () => {
    const { items, preferred } = repoCandidates(workspaces, { root: '/elsewhere/tool', workspaceId: 'w2' })
    assert.equal(items[preferred].id, 'tool')
    assert.equal(items[preferred].workspaceId, 'w2')
    assert.equal(items.length, 3)
  })
})
