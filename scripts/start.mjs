// Start one issue: worktree → agent → prompt. Two faces:
//
//   • popup (TTY), opened by the `start` action: from a Ctrl+click on a GitHub issue URL, a Shortcut story
//     URL or a Linear issue URL (the URL arrives in HERDR_ISSUES_URL) or from a keybinding, in which case it
//     asks for a number, sc-<id>, ENG-123 or URL. Then pick the repository (stories and Linear issues only),
//     confirm, pick the agent if needed, and watch.
//   • CLI (no TTY): start.mjs <number|sc-id|ENG-123|url> [--cwd PATH] [--repo owner/name] [--agent KIND] [--no-agent] [--no-focus] [--json]
//     A story or a Linear issue is started in the checkout of --cwd (or the focused pane).
import path from 'node:path'
import { parseArgs } from '../lib/args.mjs'
import { loadConfig, resolveAgent } from '../lib/config.mjs'
import { pickCwd, pickRepo, readContext, resolveTarget, startTargets } from '../lib/context.mjs'
import { c, paint } from '../lib/format.mjs'
import { repoInfo, sameRepo, viewIssue } from '../lib/github.mjs'
import { FALLBACK_KINDS, agentKinds } from '../lib/herdr.mjs'
import { createLauncher } from '../lib/launch.mjs'
import { notSetUp } from '../lib/integration.mjs'
import { REMOTES } from '../lib/remotes.mjs'
import { parseRef, sourcesOf, visibleTabs } from '../lib/sources.mjs'
import { issueRef, startIssue } from '../lib/start.mjs'
import { createScreen, editLine, header, hint, inputRow, isCtrlC, isEnter, isEsc, layout, rule } from '../lib/tui.mjs'

const remotes = Object.values(REMOTES)
const USAGE = `usage: start.mjs [<number>|${remotes.map(remote => remote.refExample).join('|')}|<url>] [--cwd PATH] [--repo owner/name] [--agent KIND] [--no-agent] [--no-focus] [--json]`
// "a GitHub issue, Shortcut story or Linear issue URL"
const urlKinds = [['GitHub', 'issue'], ...remotes.map(remote => [remote.name, remote.noun])].map(kind => kind.join(' '))
const urlText = `${urlKinds.slice(0, -1).join(', ')} or ${urlKinds.at(-1)} URL`
const args = parseArgs(process.argv.slice(2), { flags: ['no-agent', 'no-focus', 'json', 'help'], values: ['cwd', 'repo', 'agent'] })
if (args.flags.has('help')) {
  console.log(USAGE)
  process.exit(0)
}

const context = readContext()
const { config, file: configFile, warnings } = loadConfig()
if (args.flags.has('no-focus')) config.focus = false
const initialRef = args.positional[0] || process.env.HERDR_ISSUES_URL || context.clicked_url || ''
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)

// A Shortcut story or a Linear issue, with the token of its source.
const fetchRemote = async ref => {
  const remote = REMOTES[ref.source]
  const auth = remote.auth()
  if (!auth) throw new Error(notSetUp(remote))
  try {
    return await remote.fetch(auth.token, ref)
  } catch (error) {
    if (error.status === 404 && ref.workspace) throw new Error(`${remote.noun} ${ref.ref} not found in the workspace of your ${remote.tokenName} (the link is from ${ref.workspace})`)
    throw error
  }
}

// Resolves the checkout, the repository and the issue behind a "482", "#482", "sc-482", "ENG-123" or URL
// reference. A story or a Linear issue has no repository: `story` is true and the popup asks which one (the
// CLI uses the checkout).
const prepare = async text => {
  const ref = parseRef(text, sourcesOf(visibleTabs(config.tabs)))
  if (!ref) throw new Error(`"${text}" is not an issue number, ${remotes.map(remote => remote.refExample).join(', ')}, or a ${urlText}`)
  const target = await resolveTarget({ cwd: pickCwd({ flag: args.values.cwd, context }), repo: pickRepo({ flag: args.values.repo }), context })
  if (REMOTES[ref.source]) {
    const issue = await fetchRemote(ref)

    return { target, repo: target.root ? path.basename(target.root) : null, issue, story: true }
  }
  if (!target.root) throw new Error(`${target.cwd} is not inside a git repository. Run this from (or open the popup over) a checkout of the repository.`)
  const info = await repoInfo({ cwd: target.root, repo: target.repo })
  const repo = target.repo ?? info.nameWithOwner
  if (ref.repo && !target.repo && !sameRepo(ref.repo, info.nameWithOwner)) {
    throw new Error(`that issue belongs to ${ref.repo} but this checkout is ${info.nameWithOwner}. Open a pane inside a checkout of ${ref.repo}, or pass --repo ${ref.repo}.`)
  }
  const issue = await viewIssue({ cwd: target.root, repo: target.repo }, ref.number)

  return { target, repo, issue, story: false }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (!interactive) {
  if (!initialRef) {
    console.error(USAGE)
    process.exit(2)
  }
  try {
    for (const warning of warnings) console.error(`config.json: ${warning}`)
    const { target, repo, issue, story } = await prepare(initialRef)
    // Outside a git checkout a story or a Linear issue gets a new tab in the workspace the command runs in.
    const inTab = story && !target.root
    if (inTab && !context.workspace_id) throw new Error(`${target.cwd} is not inside a git repository. Pass --cwd with the checkout the ${REMOTES[issue.source].noun} should be worked on in.`)
    const withAgent = !args.flags.has('no-agent')
    const agent = withAgent ? resolveAgent({ explicit: args.values.agent, config, focusedAgent: target.focusedAgent }) : null
    if (withAgent && !agent) {
      throw new Error('no agent chosen: pass --agent <kind>, set HERDR_ISSUES_AGENT, or set "agent" in config.json (run `herdr agent` to list the kinds)')
    }
    console.log(`${issueRef(issue)} ${issue.title}`)
    const result = await startIssue({ cwd: inTab ? target.cwd : target.root, workspaceId: inTab ? context.workspace_id : target.workspaceId, tab: inTab, issue, repo, agent, config, withAgent, onStep: text => console.log(`… ${text}`) })
    if (args.flags.has('json')) console.log(JSON.stringify(result, null, 2))
    else {
      if (result.branch) console.log(`✓ branch ${result.branch}`)
      if (result.tabId) console.log(`✓ tab ${result.tabId} (${result.label})`)
      if (result.path) console.log(`✓ path ${result.path}`)
      if (result.workspaceId && !result.tabId) console.log(`✓ workspace ${result.workspaceId} (${result.label})`)
      if (result.paneId) console.log(`✓ pane ${result.paneId}`)
      if (result.skipped === 'already_open') console.log('! the worktree was already open; no agent started')
      if (result.agent && result.delivery === 'typed') console.log(`✓ agent ${result.agent} (${result.kind}) — ${issueRef(issue)} typed into its input; add context and press Enter there to send it`)
      else if (result.agent) console.log(`${result.submitted ? '✓' : '!'} agent ${result.agent} (${result.kind}) — prompt ${result.submitted ? 'sent, the agent is working' : 'sent but not confirmed as submitted; check its pane'}`)
    }
  } catch (error) {
    console.error(`✗ ${error.message}`)
    process.exit(1)
  }
  process.exit(0)
}

// ── popup ───────────────────────────────────────────────────────────────────

const state = {
  view: initialRef ? 'loading' : 'input', // input | loading | launch
  input: initialRef,
  error: warnings.length ? `config.json: ${warnings[0]}` : null,
  launcher: null,
  kinds: [...FALLBACK_KINDS],
}

const inputFrame = (width, height) => {
  const input = inputRow(`Issue number, ${remotes.map(remote => remote.refExample).join(', ')} or URL:`, state.input, width)
  const body = [header('Start issue', {}, width), rule(width), '', input.text, '']
  if (state.error) body.push(...state.error.split('\n').map(line => paint(c.red, ` ${line}`)))
  body.push('', paint(c.dim, ` Tip: Ctrl+click a ${urlText} in any pane to land here with it filled in.`))

  return { lines: layout(body, [hint('Enter continue · Esc quit')], height), cursor: { row: 4, col: input.cursorCol } }
}

const loadingFrame = (width, height) => layout([header('Start issue', {}, width), rule(width), '', paint(c.dim, ` Fetching ${state.input}…`)], [hint('Ctrl+C quit')], height)

const render = (width, height) => {
  if (state.view === 'launch') return state.launcher.lines(width, height)
  if (state.view === 'loading') return loadingFrame(width, height)

  return inputFrame(width, height)
}

const begin = async text => {
  state.view = 'loading'
  state.error = null
  screen.draw()
  try {
    const { target, repo, issue, story } = await prepare(text)
    state.launcher = createLauncher({
      issue,
      repo,
      target,
      loadRepos: story ? () => startTargets({ workspaceId: context.workspace_id ?? null, root: target.root }) : null,
      config,
      configFile,
      kinds: state.kinds,
      focusedAgent: target.focusedAgent,
      explicitAgent: args.values.agent ?? null,
      onRedraw: () => screen.draw(),
      onCancel: quit => {
        if (quit) return screen.exit(0)
        state.view = 'input'
        state.launcher = null
      },
      onDone: () => screen.exit(0),
    })
    state.view = 'launch'
  } catch (error) {
    state.error = error.message
    state.view = 'input'
  }
  screen.draw()
}

const onKey = key => {
  if (state.view === 'launch') return state.launcher.key(key)
  if (isCtrlC(key)) return screen.exit(0)
  if (state.view === 'loading') return
  if (isEsc(key)) return screen.exit(0)
  if (isEnter(key)) return state.input.trim() ? begin(state.input.trim()) : undefined
  state.input = editLine(state.input, key)
}

const screen = createScreen({ render, onKey })
screen.draw()
agentKinds()
  .then(kinds => {
    state.kinds.splice(0, state.kinds.length, ...kinds)
  })
  .catch(() => {})
if (initialRef) begin(initialRef)
