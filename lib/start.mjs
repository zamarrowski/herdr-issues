// The "start an issue" flow, agent-agnostic:
//
//   1. herdr worktree create  (branch from the issue; falls back to `worktree open` when the branch exists)
//   2. herdr agent start      (any kind herdr supports, in the new workspace's pane)
//   3. herdr agent prompt     (the issue URL and title, from the configurable prompt template)
//
// Every step reports through onStep(text) so the popup and the CLI can show progress.
import { render, sanitizeAgentName, sanitizeBranch } from './config.mjs'
import { slug, truncateText } from './format.mjs'
import {
  HerdrError,
  agentPrompt,
  agentRead,
  agentSendKeys,
  agentStart,
  agentWait,
  notify,
  reportWorkspaceTokens,
  worktreeCreate,
  worktreeOpen,
} from './herdr.mjs'
import { SOURCE } from './paths.mjs'
import { sleep } from './proc.mjs'

// Template variables for one issue.
export const issueVars = ({ issue, repo, config, agent = null }) => {
  const [owner = '', name = ''] = String(repo ?? '').split('/')
  const base = {
    number: issue.number,
    title: issue.title ?? '',
    slug: slug(issue.title, config.slug_max),
    url: issue.url ?? '',
    repo: repo ?? '',
    owner,
    name,
    agent: agent ?? '',
    author: issue.author?.login ?? '',
    labels: (issue.labels ?? []).map(label => label.name).join(', '),
  }
  const branch = sanitizeBranch(render(config.branch, base))
  const label = truncateText(render(config.label, { ...base, branch }), config.label_max)

  return { ...base, branch, label }
}

// Everything the flow will do for an issue, computed up front (and shown on the confirm screen).
export const planIssue = ({ issue, repo, config, agent = null }) => {
  const vars = issueVars({ issue, repo, config, agent })

  return {
    branch: vars.branch,
    label: vars.label,
    agentName: sanitizeAgentName(render(config.agent_name, vars)),
    prompt: render(config.prompt, vars),
    agentArgs: Array.isArray(config.agent_args?.[agent]) ? config.agent_args[agent] : [],
    vars,
  }
}

const looksLikeExists = error => /exist|already|checked out/i.test(`${error.code ?? ''} ${error.message}`)
const looksLikeNotReady = error => error.code === 'agent_not_ready' || error.code === 'agent_blocked' || /not ready|blocked/i.test(error.message)
const looksLikeNameTaken = error => /name/i.test(`${error.code ?? ''} ${error.message}`) && /in.?use|taken|exist|unique|already|duplicate/i.test(`${error.code ?? ''} ${error.message}`)

const trustPrompt = (screen, config) => {
  if (!config.auto_accept_trust_prompt || !screen) return false
  try {
    return new RegExp(config.trust_prompt_pattern, 'i').test(screen)
  } catch {
    return false
  }
}

// `agent start` can return agent_not_ready while an agent shows its startup banner or a first-run
// dialog. Wait for idle; if the pane shows a folder-trust prompt, accept it with Enter and wait again.
export const settleAgent = async (paneId, config, onStep = () => {}) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await agentWait(paneId, { until: ['idle', 'done'], timeoutMs: config.timeouts.agent_ready_ms })

      return
    } catch {
      /* still blocked or not yet detected */
    }
    const screen = await agentRead(paneId).catch(() => '')
    if (trustPrompt(screen, config)) {
      onStep('Accepting the trust prompt')
      await agentSendKeys(paneId, 'enter').catch(() => {})
    } else {
      await sleep(config.timeouts.retry_ms)
    }
  }
  throw new HerdrError('the agent started but never became ready for input; check its pane', { code: 'agent_never_ready' })
}

// Starts `kind` in `paneId` under `name`, working around the usual hiccups: a shell that is not at
// its prompt yet, a name already in use, or an agent blocked on a startup dialog.
export const startAgent = async ({ paneId, name, kind, args = [], config, onStep = () => {} }) => {
  let current = name
  let lastError
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await agentStart(current, paneId, { kind, args, timeoutMs: config.timeouts.agent_start_ms })

      return current
    } catch (error) {
      lastError = error
      if (looksLikeNotReady(error)) {
        await settleAgent(paneId, config, onStep)

        return current
      }
      if (looksLikeNameTaken(error)) {
        current = sanitizeAgentName(`${name}-${Date.now().toString(36).slice(-3)}`)
        continue
      }
      // Syntax errors (unsupported kind, bad pane id) will not fix themselves.
      if (error.code === 'usage' || error.code === 'agent_pane_not_found' || error.code === 'spawn_failed') throw error
      // Typically the new pane's shell has not printed its prompt yet.
      await sleep(config.timeouts.retry_ms)
    }
  }
  throw lastError
}

// `agent prompt` acknowledges the write, not the turn. Check that the agent reacted (working or
// asking something); if not, the Enter was probably swallowed by a redraw: send it once more.
export const confirmSubmitted = async (paneId, config) => {
  const reacted = () => agentWait(paneId, { until: ['working', 'blocked'], timeoutMs: config.timeouts.submit_check_ms }).then(() => true, () => false)
  if (await reacted()) return true
  await agentSendKeys(paneId, 'enter').catch(() => {})

  return reacted()
}

// onStep(text) marks the beginning of a step; the previous one is considered finished.
export const startIssue = async ({ cwd, workspaceId = null, issue, repo, agent = null, config, withAgent = true, onStep = () => {} }) => {
  const plan = planIssue({ issue, repo, config, agent })
  const worktreeArgs = { workspaceId, cwd, branch: plan.branch, label: plan.label, focus: config.focus, trustRepository: config.trust_repository }

  onStep(`Creating worktree ${plan.branch}`)
  let created
  try {
    created = await worktreeCreate({ ...worktreeArgs, base: config.base || null, timeoutMs: config.timeouts.worktree_ms })
  } catch (error) {
    if (!looksLikeExists(error)) throw error
    onStep('Branch already exists, opening its worktree')
    created = await worktreeOpen({ ...worktreeArgs, timeoutMs: config.timeouts.worktree_ms })
  }

  const workspace = created?.workspace ?? null
  const summary = {
    ...plan,
    kind: agent,
    workspace,
    workspaceId: workspace?.workspace_id ?? null,
    paneId: created?.root_pane?.pane_id ?? null,
    path: created?.worktree?.path ?? workspace?.worktree?.checkout_path ?? null,
    alreadyOpen: created?.already_open === true,
    agent: null,
    submitted: null,
    skipped: null,
  }

  if (config.workspace_token && summary.workspaceId) {
    await reportWorkspaceTokens(summary.workspaceId, SOURCE, { issue: `#${issue.number}` }).catch(() => {})
  }
  if (!withAgent) return { ...summary, skipped: 'no_agent_requested' }
  if (summary.alreadyOpen) {
    onStep('That worktree was already open; leaving its pane alone')

    return { ...summary, skipped: 'already_open' }
  }
  if (!agent) throw new HerdrError('no agent kind chosen', { code: 'no_agent' })
  if (!summary.paneId) throw new HerdrError('herdr returned no pane for the new worktree', { code: 'no_pane' })

  onStep(`Starting ${agent} in the new worktree`)
  const name = await startAgent({ paneId: summary.paneId, name: plan.agentName, kind: agent, args: plan.agentArgs, config, onStep })

  onStep(`Sending issue #${issue.number} to ${agent}`)
  await agentPrompt(summary.paneId, plan.prompt, { timeoutMs: config.timeouts.prompt_ms })
  const submitted = await confirmSubmitted(summary.paneId, config)
  if (!submitted) onStep(`${agent} has the prompt but has not started yet; check its pane`)

  if (config.notify) {
    await notify(`Issue #${issue.number}`, `${agent} is on "${truncateText(issue.title, 60)}" in ${plan.label}`).catch(() => {})
  }

  return { ...summary, agent: name, submitted }
}
