// A stand-in for the herdr CLI used by the tests.
//
// Every invocation is appended to FAKE_HERDR_LOG (one JSON array per line) so tests can assert on the
// exact commands the plugin ran. Answers follow FAKE_HERDR_SCENARIO and mimic herdr's real envelopes:
// {"id","result"} on stdout, {"id","error":{"code","message"}} on stderr with exit 1, plain text + exit 2
// for CLI syntax errors. Only the commands the plugin uses are implemented.
import fs from 'node:fs'

const args = process.argv.slice(2)
const scenario = process.env.FAKE_HERDR_SCENARIO || 'happy'
const log = process.env.FAKE_HERDR_LOG
const history = log && fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
if (log) fs.appendFileSync(log, `${JSON.stringify(args)}\n`)

// How many times this (group, command) ran before the current call.
const previous = (group, command) => history.filter(entry => entry[0] === group && entry[1] === command).length
const value = flag => {
  const index = args.indexOf(flag)

  return index >= 0 ? args[index + 1] : undefined
}
const values = flag => args.flatMap((arg, index) => (arg === flag ? [args[index + 1]] : []))

const ok = result => {
  process.stdout.write(`${JSON.stringify({ id: 'fake', result })}\n`)
  process.exit(0)
}
const fail = (code, message) => {
  process.stderr.write(`${JSON.stringify({ id: 'fake', error: { code, message } })}\n`)
  process.exit(1)
}

const pane = { pane_id: 'w9:p1', terminal_id: 'term_fake', workspace_id: 'w9', tab_id: 'w9:t1', focused: true, agent_status: 'unknown', revision: 1 }
const tab = { tab_id: 'w9:t1', workspace_id: 'w9', number: 1, label: '1', focused: true, pane_count: 1, agent_status: 'unknown' }
const worktreeInfo = branch => ({
  path: `/tmp/worktrees/repo/${branch}`,
  branch,
  is_bare: false,
  is_detached: false,
  is_prunable: false,
  is_linked_worktree: true,
  label: value('--label') ?? branch,
  open_workspace_id: 'w9',
})
const workspaceInfo = branch => ({
  workspace_id: 'w9',
  number: 9,
  label: value('--label') ?? branch,
  focused: true,
  pane_count: 1,
  tab_count: 1,
  active_tab_id: 'w9:t1',
  agent_status: 'unknown',
  worktree: { checkout_path: `/tmp/worktrees/repo/${branch}`, is_linked_worktree: true, repo_key: '/repo/.git', repo_name: 'repo', repo_root: '/repo' },
})

const [group, command] = args

if (group === '--version') {
  process.stdout.write('herdr 0.9.1\n')
  process.exit(0)
}
if (group === 'agent' && command === undefined) {
  process.stdout.write('herdr agent commands:\n  herdr agent list\n  kinds: pi|claude|codex|gemini|opencode\n')
  process.exit(0)
}

switch (`${group} ${command}`) {
  case 'worktree create': {
    const branch = value('--branch')
    if (scenario === 'branch-exists' || scenario === 'already-open') fail('worktree_branch_exists', `branch ${branch} already exists`)
    if (scenario === 'not-a-repo') fail('not_git_worktree', 'Herdr worktree actions require a path inside a Git work tree')
    ok({ type: 'worktree_created', workspace: workspaceInfo(branch), tab, root_pane: pane, worktree: worktreeInfo(branch) })
    break
  }
  case 'worktree open': {
    const branch = value('--branch')
    ok({ type: 'worktree_opened', already_open: scenario === 'already-open', workspace: workspaceInfo(branch), tab, root_pane: pane, worktree: worktreeInfo(branch) })
    break
  }
  case 'agent start': {
    const attempt = previous('agent', 'start')
    const kind = value('--kind')
    if (scenario === 'bad-kind') {
      process.stderr.write(`unsupported interactive agent kind: ${kind}\n`)
      process.exit(2)
    }
    if (scenario === 'not-ready' && attempt === 0) fail('agent_not_ready', 'agent is blocked during startup')
    if (scenario === 'name-taken' && attempt === 0) fail('agent_name_in_use', `agent name ${args[2]} is already in use`)
    if (scenario === 'shell-not-ready' && attempt === 0) fail('pane_not_at_prompt', 'pane is not at an interactive shell prompt')
    const dash = args.indexOf('--')
    ok({ type: 'agent_started', agent: { name: args[2], pane_id: value('--pane'), agent: kind, agent_status: 'idle' }, argv: [kind, ...(dash >= 0 ? args.slice(dash + 1) : [])] })
    break
  }
  case 'agent wait': {
    const until = values('--until')
    const attempt = previous('agent', 'wait')
    // While blocked on the trust dialog the agent never turns idle; Enter (send-keys) answers it.
    const answered = history.some(entry => entry[0] === 'agent' && entry[1] === 'send-keys')
    if (scenario === 'not-ready' && until.includes('idle') && !answered) fail('timeout', 'timed out waiting for idle')
    if (scenario === 'prompt-swallowed' && until.includes('working') && attempt === 0) fail('timeout', 'timed out waiting for working')
    ok({ type: 'agent_wait', agent: { name: args[2], agent_status: until[0] } })
    break
  }
  case 'agent read':
    process.stdout.write(scenario === 'not-ready' ? 'Do you trust the files in this folder?\n\n ❯ Yes, proceed\n   No, exit\n' : '> \n')
    process.exit(0)
    break
  case 'agent send-keys':
    ok({ type: 'ok' })
    break
  case 'agent prompt':
    ok({ type: 'agent_prompted', agent: { name: args[2], agent_status: 'working' } })
    break
  case 'notification show':
    ok({ type: 'notification_show', shown: true, reason: 'shown' })
    break
  case 'workspace report-metadata':
    ok({ type: 'ok' })
    break
  case 'server reload-config':
    ok({ type: 'ok' })
    break
  default:
    fail('unknown_command', `fake herdr does not implement: ${args.join(' ')}`)
}
