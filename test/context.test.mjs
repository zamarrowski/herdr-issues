import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { describeWorkspaces, pickCwd, pickRepo, readContext, repoCandidates, resolveTarget } from '../lib/context.mjs'
import { gitRepo } from '../lib/proc.mjs'
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

describe('describeWorkspaces', () => {
  const workspaces = [
    { workspace_id: 'w1', label: 'shop', active_tab_id: 'w1:t1', worktree: { checkout_path: '/code/shop', is_linked_worktree: false, repo_key: '/code/shop/.git', repo_name: 'shop', repo_root: '/code/shop' } },
    { workspace_id: 'w2', label: 'claudemon', active_tab_id: 'w2:t2' },
    { workspace_id: 'w3', label: 'notes', active_tab_id: 'w3:t1' },
    { workspace_id: 'w4', label: 'empty' },
  ]
  const panes = [
    { workspace_id: 'w1', tab_id: 'w1:t1', pane_id: 'w1:p1', cwd: '/code/shop/src' },
    { workspace_id: 'w2', tab_id: 'w2:t1', pane_id: 'w2:p1', cwd: '/elsewhere' },
    { workspace_id: 'w2', tab_id: 'w2:t2', pane_id: 'w2:p2', cwd: '/code/claudemon', foreground_cwd: '/code/claudemon/lib', focused: true },
    { workspace_id: 'w3', tab_id: 'w3:t1', pane_id: 'w3:p1', cwd: '/home/ana/notes' },
  ]
  const detect = async cwd => (cwd.startsWith('/code/claudemon') ? { checkout: '/code/claudemon', key: '/code/claudemon/.git', root: '/code/claudemon', linked: false } : null)
  it("finds the checkouts herdr did not recognise from the active tab's pane", async () => {
    const [shop, claudemon, notes, empty] = await describeWorkspaces(workspaces, panes, detect)
    assert.equal(shop.worktree.repo_root, '/code/shop')
    assert.equal(shop.detected, undefined)
    assert.equal(claudemon.cwd, '/code/claudemon/lib')
    assert.deepEqual(claudemon.worktree, { checkout_path: '/code/claudemon', is_linked_worktree: false, repo_key: '/code/claudemon/.git', repo_name: 'claudemon', repo_root: '/code/claudemon' })
    assert.equal(claudemon.detected, true)
    assert.equal(notes.worktree, undefined)
    assert.equal(notes.cwd, '/home/ana/notes')
    assert.equal(empty.cwd, null)
  })
  it('lists repositories first, then a new tab for each workspace without git', async () => {
    const { items, preferred } = repoCandidates(await describeWorkspaces(workspaces, panes, detect), { workspaceId: 'w3' })
    assert.deepEqual(
      items.map(item => [item.id, item.workspaceId, Boolean(item.tab)]),
      [
        ['claudemon', null, false],
        ['shop', 'w1', false],
        ['notes', 'w3', true],
      ],
      'a detected checkout is started with --cwd, since herdr does not know it as a repository',
    )
    assert.equal(items[2].cwd, '/home/ana/notes')
    assert.match(items[2].note, /new tab$/)
    assert.equal(preferred, 2, 'the workspace the popup came from')
  })
  it('reads the real git layout of a checkout and of a linked worktree', async () => {
    const dir = tempDir()
    gitInit(dir)
    execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'x'], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
    const real = fs.realpathSync(dir)
    assert.deepEqual(await gitRepo(dir), { checkout: real, key: path.join(real, '.git'), root: real, linked: false })
    const linked = path.join(tempDir(), 'wt')
    execFileSync('git', ['-C', dir, 'worktree', 'add', '-q', linked])
    assert.deepEqual(await gitRepo(linked), { checkout: fs.realpathSync(linked), key: path.join(real, '.git'), root: real, linked: true })
    assert.equal(await gitRepo(tempDir()), null)
  })
})
