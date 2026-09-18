import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULTS, merge } from '../lib/config.mjs'
import { issueVars, planIssue, startIssue } from '../lib/start.mjs'
import { commandsOf, find, sampleIssue, withFakeHerdr } from './helpers.mjs'

// Short timeouts keep the retry loops fast; the fake herdr answers instantly anyway.
const fastConfig = (overrides = {}) => merge(DEFAULTS, { timeouts: { agent_ready_ms: 50, submit_check_ms: 50, retry_ms: 10 } }, overrides)
const repo = 'acme/shop'

describe('planIssue', () => {
  it('derives branch, label, agent name and prompt from the defaults', () => {
    const plan = planIssue({ issue: sampleIssue(), repo, config: DEFAULTS, agent: 'codex' })
    assert.equal(plan.branch, 'issue-482-returns-page-crashes-on-empty-address')
    assert.equal(plan.label, '#482 Returns page crashes on empty addr…')
    assert.equal(plan.agentName, 'issue-482')
    assert.match(plan.prompt, /GitHub issue #482 \(https:\/\/github.com\/acme\/shop\/issues\/482\)/)
    assert.match(plan.prompt, /gh issue view 482 --comments/)
    assert.match(plan.prompt, /branch issue-482-returns-page-crashes-on-empty-address/)
    assert.deepEqual(plan.agentArgs, [])
    assert.equal(plan.vars.owner, 'acme')
    assert.equal(plan.vars.name, 'shop')
    assert.equal(plan.vars.labels, 'bug, p1')
    assert.equal(plan.vars.author, 'zamarrowski')
  })
  it('honours custom templates and per-agent args', () => {
    const config = merge(DEFAULTS, {
      branch: 'gh/{owner}/{number}',
      label: '{agent} · #{number}',
      agent_name: '{agent}-{number}',
      prompt: 'Fix {url} on {branch}',
      agent_args: { codex: ['--full-auto'], claude: ['--x'] },
      slug_max: 5,
    })
    const plan = planIssue({ issue: sampleIssue(), repo, config, agent: 'codex' })
    assert.equal(plan.branch, 'gh/acme/482')
    assert.equal(plan.label, 'codex · #482')
    assert.equal(plan.agentName, 'codex-482')
    assert.equal(plan.prompt, 'Fix https://github.com/acme/shop/issues/482 on gh/acme/482')
    assert.deepEqual(plan.agentArgs, ['--full-auto'])
  })
  it('sanitizes unsafe templates', () => {
    const config = merge(DEFAULTS, { branch: 'issue {number}: {title}', agent_name: 'Issue #{number}!' })
    const plan = planIssue({ issue: sampleIssue({ title: 'Fix ~ this ^ now' }), repo, config })
    assert.equal(plan.branch, 'issue-482-Fix-this-now')
    assert.equal(plan.agentName, 'issue-482')
  })
  it('exposes slug with the configured maximum', () => {
    assert.equal(issueVars({ issue: sampleIssue(), repo, config: merge(DEFAULTS, { slug_max: 12 }) }).slug, 'returns-page')
  })
})

describe('startIssue', () => {
  const issue = sampleIssue()
  const base = { cwd: '/repo', workspaceId: 'w1', issue, repo }

  it('creates the worktree, starts the agent and sends the prompt', async () => {
    const steps = []
    const config = fastConfig({ agent_args: { codex: ['--full-auto'] } })
    const { result, calls } = await withFakeHerdr('happy', () => startIssue({ ...base, agent: 'codex', config, onStep: text => steps.push(text) }))

    assert.deepEqual(commandsOf(calls), [
      'worktree create',
      'workspace report-metadata',
      'agent start',
      'agent prompt',
      'agent wait',
      'notification show',
    ])
    const [create] = find(calls, 'worktree', 'create')
    assert.deepEqual(create.slice(2, 4), ['--workspace', 'w1'])
    assert.ok(create.includes('issue-482-returns-page-crashes-on-empty-address'))
    assert.ok(create.includes('--focus'))
    assert.ok(!create.includes('--base'))
    assert.ok(!create.includes('--trust-repository'))

    const [start] = find(calls, 'agent', 'start')
    assert.equal(start[2], 'issue-482')
    assert.deepEqual(start.slice(3, 7), ['--kind', 'codex', '--pane', 'w9:p1'])
    assert.deepEqual(start.slice(-2), ['--', '--full-auto'])

    const [prompt] = find(calls, 'agent', 'prompt')
    assert.equal(prompt[2], 'w9:p1')
    assert.match(prompt[3], /issue #482/)

    const [token] = find(calls, 'workspace', 'report-metadata')
    assert.equal(token[2], 'w9')
    assert.ok(token.includes('issue=#482'))

    assert.equal(result.agent, 'issue-482')
    assert.equal(result.kind, 'codex')
    assert.equal(result.submitted, true)
    assert.equal(result.paneId, 'w9:p1')
    assert.equal(result.workspaceId, 'w9')
    assert.equal(result.path, '/tmp/worktrees/repo/issue-482-returns-page-crashes-on-empty-address')
    assert.deepEqual(steps, ['Creating worktree issue-482-returns-page-crashes-on-empty-address', 'Starting codex in the new worktree', 'Sending issue #482 to codex'])
  })

  it('passes base, no-focus and trust-repository through, and uses --cwd without a workspace', async () => {
    const config = fastConfig({ base: 'origin/main', focus: false, trust_repository: true, notify: false, workspace_token: false })
    const { calls } = await withFakeHerdr('happy', () => startIssue({ ...base, workspaceId: null, agent: 'claude', config }))
    const [create] = find(calls, 'worktree', 'create')
    assert.deepEqual(create.slice(2, 4), ['--cwd', '/repo'])
    assert.ok(create.includes('--base') && create[create.indexOf('--base') + 1] === 'origin/main')
    assert.ok(create.includes('--no-focus'))
    assert.ok(create.includes('--trust-repository'))
    assert.equal(find(calls, 'notification', 'show').length, 0)
    assert.equal(find(calls, 'workspace', 'report-metadata').length, 0)
  })

  it('falls back to `worktree open` when the branch already exists', async () => {
    const { result, calls } = await withFakeHerdr('branch-exists', () => startIssue({ ...base, agent: 'codex', config: fastConfig() }))
    assert.deepEqual(commandsOf(calls).slice(0, 2), ['worktree create', 'worktree open'])
    assert.equal(result.agent, 'issue-482')
  })

  it('does not touch the pane when the worktree was already open', async () => {
    const { result, calls } = await withFakeHerdr('already-open', () => startIssue({ ...base, agent: 'codex', config: fastConfig() }))
    assert.equal(result.skipped, 'already_open')
    assert.equal(result.alreadyOpen, true)
    assert.equal(find(calls, 'agent', 'start').length, 0)
  })

  it('stops after the worktree with withAgent: false', async () => {
    const { result, calls } = await withFakeHerdr('happy', () => startIssue({ ...base, agent: null, config: fastConfig(), withAgent: false }))
    assert.equal(result.skipped, 'no_agent_requested')
    assert.deepEqual(commandsOf(calls), ['worktree create', 'workspace report-metadata'])
  })

  it('refuses to start an agent when no kind was chosen', async () => {
    await withFakeHerdr('happy', async () => {
      await assert.rejects(startIssue({ ...base, agent: null, config: fastConfig() }), error => error.code === 'no_agent')
    })
  })

  it('accepts a trust prompt when the agent starts blocked', async () => {
    const steps = []
    const { result, calls } = await withFakeHerdr('not-ready', () => startIssue({ ...base, agent: 'claude', config: fastConfig(), onStep: text => steps.push(text) }))
    const commands = commandsOf(calls)
    assert.equal(find(calls, 'agent', 'start').length, 1)
    assert.ok(commands.includes('agent read'))
    const sendKeys = find(calls, 'agent', 'send-keys')
    assert.equal(sendKeys.length, 1)
    assert.deepEqual(sendKeys[0].slice(2), ['w9:p1', 'enter'])
    assert.ok(steps.includes('Accepting the trust prompt'))
    assert.equal(result.submitted, true)
  })

  it('does not answer a startup dialog when auto_accept_trust_prompt is off', async () => {
    await withFakeHerdr('not-ready', async () => {
      await assert.rejects(startIssue({ ...base, agent: 'claude', config: fastConfig({ auto_accept_trust_prompt: false }) }), error => error.code === 'agent_never_ready')
    })
  })

  it('picks another name when the agent name is taken', async () => {
    const { result, calls } = await withFakeHerdr('name-taken', () => startIssue({ ...base, agent: 'codex', config: fastConfig() }))
    const starts = find(calls, 'agent', 'start')
    assert.equal(starts.length, 2)
    assert.equal(starts[0][2], 'issue-482')
    assert.match(starts[1][2], /^issue-482-[a-z0-9]{1,3}$/)
    assert.equal(result.agent, starts[1][2])
  })

  it('retries when the new pane is not at its prompt yet', async () => {
    const { calls } = await withFakeHerdr('shell-not-ready', () => startIssue({ ...base, agent: 'codex', config: fastConfig() }))
    assert.equal(find(calls, 'agent', 'start').length, 2)
  })

  it('gives up immediately on an unsupported agent kind', async () => {
    await withFakeHerdr('bad-kind', async () => {
      const { calls } = await withFakeHerdr('bad-kind', async () => {
        await assert.rejects(startIssue({ ...base, agent: 'nope', config: fastConfig() }), error => error.code === 'usage')
      })
      assert.equal(find(calls, 'agent', 'start').length, 1)
    })
  })

  it('re-sends Enter when the agent did not react to the prompt', async () => {
    const { result, calls } = await withFakeHerdr('prompt-swallowed', () => startIssue({ ...base, agent: 'codex', config: fastConfig() }))
    const sendKeys = find(calls, 'agent', 'send-keys')
    assert.equal(sendKeys.length, 1)
    assert.equal(sendKeys[0][3], 'enter')
    assert.equal(find(calls, 'agent', 'wait').length, 2)
    assert.equal(result.submitted, true)
  })
})
