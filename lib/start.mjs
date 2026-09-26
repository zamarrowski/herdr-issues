// The "start an issue" flow, agent-agnostic:
//
//   1. herdr worktree create  (branch from the issue; falls back to `worktree open` when the branch exists),
//      or herdr tab create    (`tab: true`: a new tab in a workspace that is not a git checkout)
//   2. herdr agent start      (any kind herdr supports, in the new workspace's or tab's pane)
//   3. herdr pane send-text   (the rendered prompt, by default the issue URL, typed into the agent's input
//                             and left there for the user to complete; `submit: true` sends it with
//                             `herdr agent prompt` instead)
//
// Every step reports through onStep(text) so the popup and the CLI can show progress.
import { forSource, render, sanitizeAgentName, sanitizeBranch } from './config.mjs'
import { slug, truncateText } from './format.mjs'
import {
  HerdrError,
  agentPrompt,
  agentRead,
  agentSendKeys,
  agentStart,
  agentWait,
  notify,
  paneSendText,
  reportWorkspaceTokens,
  tabCreate,
  workspaceFocus,
  worktreeCreate,
  worktreeOpen,
} from './herdr.mjs'
import { SOURCE } from './paths.mjs'
import { sleep } from './proc.mjs'
import { Noun, noun } from './sources.mjs'

// "#482" for a GitHub issue, "sc-482" for a Shortcut story, "ENG-123" for a Linear issue.
export const issueRef = issue => issue?.ref ?? `#${issue?.number}`

// Template variables for one issue. `repo` is "owner/name" for GitHub, the repository name for a story or a
// Linear issue.
export const issueVars = ({ issue, repo, config, agent = null }) => {
  const [owner, name] = String(repo ?? '').includes('/') ? String(repo).split('/') : ['', String(repo ?? '')]
  const base = {
    number: issue.number,
    ref: issueRef(issue),
    source: issue.source ?? 'github',
    title: issue.title ?? '',
    slug: slug(issue.title, config.slug_max),
    url: issue.url ?? '',
    repo: repo ?? '',
    owner,
    name,
    agent: agent ?? '',
    author: issue.author?.login ?? '',
    labels: (issue.labels ?? []).map(label => label.name).join(', '),
    // The branch name the tracker suggests (Shortcut's formatted_vcs_branch_name, Linear's branchName).
    vcs_branch: issue.vcsBranch ?? '',
  }
  const branch = sanitizeBranch(render(config.branch, base))
  const label = truncateText(render(config.label, { ...base, branch }), config.label_max)

  return { ...base, branch, label }
}

// Everything the flow will do for an issue, computed up front (and shown on the confirm screen).
// Templates come from the issue's source: a story uses the `shortcut` block over the global templates, a Linear
// issue the `linear` block.
export const planIssue = ({ issue, repo, config: baseConfig, agent = null }) => {
  const config = forSource(baseConfig, issue.source)
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

// A worktree on the issue's branch, opened as a new workspace (or the existing one when the branch exists).
const openWorktree = async ({ cwd, workspaceId, plan, config, onStep }) => {
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

  return {
    workspace,
    workspaceId: workspace?.workspace_id ?? null,
    paneId: created?.root_pane?.pane_id ?? null,
    path: created?.worktree?.path ?? workspace?.worktree?.checkout_path ?? null,
    alreadyOpen: created?.already_open === true,
  }
}

// A new tab, labelled like the workspace would be, in a workspace where no worktree can be made.
const openTab = async ({ cwd, workspaceId, plan, config, onStep }) => {
  onStep('Opening a new tab')
  const created = await tabCreate({ workspaceId, cwd, label: plan.label, focus: config.focus, timeoutMs: config.timeouts.worktree_ms })
  if (config.focus) await workspaceFocus(workspaceId).catch(() => {})

  return { workspace: null, workspaceId, tabId: created?.tab?.tab_id ?? null, paneId: created?.root_pane?.pane_id ?? null, path: cwd ?? null, alreadyOpen: false }
}

// onStep(text) marks the beginning of a step; the previous one is considered finished.
// `tab: true` opens a tab in `workspaceId` (with `cwd`) instead of creating a worktree: no branch, and no
// workspace token, since the workspace is not the issue's own.
export const startIssue = async ({ cwd, workspaceId = null, tab = false, issue, repo, agent = null, config, withAgent = true, onStep = () => {} }) => {
  const plan = planIssue({ issue, repo, config, agent })
  if (tab && !workspaceId) throw new HerdrError('a new tab needs a workspace', { code: 'no_workspace' })
  const opened = await (tab ? openTab : openWorktree)({ cwd, workspaceId, plan, config, onStep })
  const summary = {
    ...plan,
    ...(tab ? { branch: null } : {}),
    mode: tab ? 'tab' : 'worktree',
    kind: agent,
    tabId: null,
    ...opened,
    agent: null,
    delivery: null,
    submitted: null,
    skipped: null,
  }

  if (config.workspace_token && summary.workspaceId && !tab) {
    await reportWorkspaceTokens(summary.workspaceId, SOURCE, { issue: issueRef(issue) }).catch(() => {})
  }
  if (!withAgent) return { ...summary, skipped: 'no_agent_requested' }
  if (summary.alreadyOpen) {
    onStep('That worktree was already open; leaving its pane alone')

    return { ...summary, skipped: 'already_open' }
  }
  if (!agent) throw new HerdrError('no agent kind chosen', { code: 'no_agent' })
  if (!summary.paneId) throw new HerdrError(`herdr returned no pane for the new ${tab ? 'tab' : 'worktree'}`, { code: 'no_pane' })

  onStep(`Starting ${agent} in the new ${tab ? 'tab' : 'worktree'}`)
  const name = await startAgent({ paneId: summary.paneId, name: plan.agentName, kind: agent, args: plan.agentArgs, config, onStep })

  if (config.submit) {
    onStep(`Sending ${noun(issue)} ${issueRef(issue)} to ${agent}`)
    await agentPrompt(summary.paneId, plan.prompt, { timeoutMs: config.timeouts.prompt_ms })
    const submitted = await confirmSubmitted(summary.paneId, config)
    if (!submitted) onStep(`${agent} has the prompt but has not started yet; check its pane`)
    if (config.notify) {
      await notify(`${Noun(issue)} ${issueRef(issue)}`, `${agent} is on "${truncateText(issue.title, 60)}" in ${plan.label}`).catch(() => {})
    }

    return { ...summary, agent: name, delivery: 'submitted', submitted }
  }

  // A newline would send the text, so the typed prompt is always one line.
  onStep(`Typing ${noun(issue)} ${issueRef(issue)} into ${agent}`)
  await paneSendText(summary.paneId, plan.prompt.replace(/\s*\r?\n\s*/g, ' ').trim(), { timeoutMs: config.timeouts.prompt_ms })
  if (config.notify) {
    await notify(`${Noun(issue)} ${issueRef(issue)}`, `${agent} has it typed in ${plan.label}: add context and press Enter`).catch(() => {})
  }

  return { ...summary, agent: name, delivery: 'typed', submitted: false }
}
