// The "start this issue" mini flow shared by the issues browser and the start popup:
// pick where to work (stories and Linear issues: nothing ties one to a repository; a repository gets a
// worktree, a workspace without git a new tab) → pick an agent (when nothing decided one) → confirm → run startIssue() with live progress → close on success, or show
// the error and wait for a key.
import { resolveAgent, saveConfigValue } from './config.mjs'
import { c, paint, truncateText } from './format.mjs'
import { isDangerous, joinArgs, modeOf, modesFor } from './settings.mjs'
import { assigneeText, labelText, noun } from './sources.mjs'
import { issueRef, planIssue, startIssue } from './start.mjs'
import { createPicker, createStepper, field, header, hint, isCtrlC, isEsc, layout, notice, rule, stepLines } from './tui.mjs'

// kinds: agent kinds herdr can start. focusedAgent: agent in the pane the popup came from.
// loadRepos(): for a story or a Linear issue, resolves to { items, preferred } (see repoCandidates in
// lib/context.mjs) and makes the launcher ask which repository gets the worktree; without it `repo` and
// `target` are used.
// onRedraw(): async state changed. onCancel(): user backed out. onDone(result): finished, close me.
export const createLauncher = ({ issue, repo, target, config, configFile, kinds, focusedAgent = null, explicitAgent = null, loadRepos = null, onRedraw, onCancel, onDone }) => {
  const ref = issueRef(issue)
  const state = {
    view: 'confirm', // repo | confirm | pick | starting
    agent: resolveAgent({ explicit: explicitAgent, config, focusedAgent }),
    repo: loadRepos ? null : repo,
    target: loadRepos ? null : target,
    repoNote: '',
    repos: null, // { items, preferred } once loaded
    repoError: null,
    repoPicker: null,
    picker: null,
    stepper: null,
    failed: false,
    finished: false,
    result: null,
    message: '',
  }

  const pickerItems = () =>
    kinds.map(kind => ({
      id: kind,
      note: [kind === focusedAgent ? 'running in your pane' : '', kind === config.agent ? 'config default' : ''].filter(Boolean).join(' · '),
    }))

  const openPicker = () => {
    state.picker = createPicker({ items: pickerItems(), title: `Which agent should take ${ref}?` })
    const preferred = pickerItems().findIndex(item => item.id === (state.agent ?? focusedAgent))
    if (preferred >= 0) state.picker.state.cursor = preferred
    state.view = 'pick'
  }

  const openRepoPicker = () => {
    state.view = 'repo'
    if (!state.repos) return
    state.repoPicker = createPicker({ items: state.repos.items, title: `Where should ${ref} be worked on?`, empty: 'nothing matches', matchNote: true })
    const current = state.repos.items.findIndex(item => (item.tab ? item.workspaceId === state.target?.workspaceId && state.target?.tab : item.root === state.target?.root))
    const preferred = current >= 0 ? current : state.repos.preferred
    if (preferred >= 0) state.repoPicker.state.cursor = preferred
  }

  const chooseRepo = item => {
    state.repo = item.id
    state.repoNote = item.note ?? ''
    // A workspace without git gets a new tab (`tab`, in `cwd`) instead of a worktree.
    state.target = { ...(target ?? {}), root: item.root ?? null, workspaceId: item.workspaceId ?? null, tab: Boolean(item.tab), cwd: item.cwd ?? null }
    state.message = ''
    if (!state.agent) openPicker()
    else state.view = 'confirm'
  }

  const run = async () => {
    state.view = 'starting'
    state.failed = false
    state.stepper = createStepper(onRedraw)
    onRedraw()
    try {
      state.result = await startIssue({
        cwd: state.target.tab ? state.target.cwd : state.target.root,
        workspaceId: state.target.workspaceId,
        tab: Boolean(state.target.tab),
        issue,
        repo: state.repo,
        agent: state.agent,
        config,
        onStep: state.stepper.begin,
      })
      const { result } = state
      state.finished = true // before the last stepper update, which repaints the footer
      if (result.skipped === 'already_open') state.stepper.done(`Worktree "${result.label}" was already open`)
      else if (result.mode === 'tab' && !result.agent) state.stepper.done(`Tab "${result.label}" is open in ${state.repo}`)
      else if (result.delivery === 'typed') {
        state.stepper.done(`${result.kind} has ${ref} typed in "${result.label}"`)
        state.stepper.done('Add context if you like, then press Enter to send it')
      } else state.stepper.done(`${result.kind} is on ${ref} in "${result.label}"`)
      setTimeout(() => onDone(result), 1500)
    } catch (error) {
      state.failed = true
      state.stepper.fail(error.message)
    }
  }

  if (loadRepos) {
    state.view = 'repo'
    Promise.resolve()
      .then(loadRepos)
      .then(
        repos => {
          state.repos = repos
          if (repos.items.length === 1) chooseRepo(repos.items[0])
          else if (repos.items.length && state.view === 'repo') openRepoPicker()
        },
        error => {
          state.repoError = error.message
        },
      )
      .finally(onRedraw)
  } else if (!state.agent) openPicker()

  const title = `Start ${noun(issue)}`

  const confirmLines = (width, height) => {
    const plan = planIssue({ issue, repo: state.repo, config, agent: state.agent })
    const body = [
      header(title, { subtitle: state.repo }, width),
      rule(width),
      ` ${paint(c.bold, ref)} ${truncateText(issue.title, width - ref.length - 3)}`,
      paint(c.dim, ` ${[labelText(issue), assigneeText(issue)].filter(Boolean).join(' · ')}`),
      '',
    ]
    const inTab = Boolean(state.target?.tab)
    if (loadRepos && inTab) body.push(field('Where', `a new tab in ${state.repo}${state.repoNote ? paint(c.dim, `  ${state.repoNote.replace(/ · new tab$/, '')}`) : ''}`, width))
    else if (loadRepos) body.push(field('Repository', `${state.repo}${state.repoNote ? paint(c.dim, `  ${state.repoNote}`) : ''}`, width))
    body.push(field('Agent', `${state.agent}${state.agent === focusedAgent ? paint(c.dim, '  (running in your pane)') : ''}`, width))
    if (inTab) body.push(field('Tab', plan.label, width))
    else body.push(field('Branch', plan.branch, width), field('Workspace', plan.label, width))
    body.push(
      field('Agent name', plan.agentName, width),
      field('Prompt', plan.prompt, width),
      field('Send', config.submit ? 'automatically' : 'typed only; you press Enter in the agent', width),
    )
    const mode = modeOf(plan.agentArgs, modesFor(config, state.agent))
    if (plan.agentArgs.length) body.push(field('Args', `${joinArgs(plan.agentArgs)}${mode ? paint(isDangerous(mode) ? c.red : c.dim, `  (${mode})`) : ''}`, width))
    const footer = [notice(state.message), hint(`y start · d start and make ${state.agent} the default · a change agent${loadRepos ? ' · r change where' : ''} · Esc cancel`)]

    return layout(body, footer, height)
  }

  const pickLines = (width, height) => {
    const { lines, cursor } = state.picker.lines(width, height - 3)
    const footer = [notice(state.message), hint('Enter choose · ↑↓ / Tab move · type to filter · Esc back')]

    return { lines: layout([...lines], footer, height), cursor }
  }

  const repoLines = (width, height) => {
    if (state.repoPicker) {
      const { lines, cursor } = state.repoPicker.lines(width, height - 3)
      const footer = [notice(state.message), hint('Enter choose · ↑↓ / Tab move · type to filter · Esc back')]

      return { lines: layout([...lines], footer, height), cursor }
    }
    const text = state.repoError
      ? paint(c.red, ` Could not list the workspaces open in herdr: ${state.repoError}`)
      : state.repos
        ? paint(c.yellow, ' No workspace is open in herdr. Open one, then try again.')
        : paint(c.dim, ' Looking at the workspaces open in herdr…')

    return layout([header(title, { subtitle: ref }, width), rule(width), '', text], [hint('Esc back')], height)
  }

  const startingLines = (width, height) => {
    const body = [
      header(`Starting ${ref}`, { subtitle: state.repo }, width),
      rule(width),
      ` ${truncateText(issue.title, width - 2)}`,
      '',
      ...stepLines(state.stepper?.steps ?? []),
    ]
    const footer = [hint(state.failed ? 'any key to go back' : state.finished ? 'done, closing this popup' : 'working… (Ctrl+C closes this popup, not the worktree)')]

    return layout(body, footer, height)
  }

  const onConfirmKey = key => {
    if (key === 'y' || key === 'Y') return run()
    if (key === 'd' || key === 'D') {
      try {
        saveConfigValue('agent', state.agent, configFile)
        config.agent = state.agent
      } catch (error) {
        state.message = `could not save config: ${error.message}`

        return
      }

      return run()
    }
    if (key === 'a' || key === 'A') return openPicker()
    if ((key === 'r' || key === 'R') && loadRepos) return openRepoPicker()
    if (isEsc(key) || key === 'n' || key === 'N' || key === 'q' || key === 'Q') return onCancel()
  }

  const onPickKey = key => {
    const action = state.picker.key(key)
    if (action === 'cancel') return state.agent ? (state.view = 'confirm') : onCancel()
    if (action === 'pick') {
      state.agent = state.picker.current().id
      state.message = ''
      state.view = 'confirm'
    }
  }

  const onRepoKey = key => {
    if (!state.repoPicker) return isEsc(key) || key === 'q' ? onCancel() : undefined
    const action = state.repoPicker.key(key)
    if (action === 'cancel') return state.repo ? (state.view = 'confirm') : onCancel()
    if (action === 'pick') chooseRepo(state.repoPicker.current())
  }

  const onStartingKey = () => {
    if (state.finished) return onDone(state.result)
    if (!state.failed) return
    state.view = 'confirm'
    state.message = ''
  }

  return {
    state,
    lines: (width, height) => {
      if (state.view === 'repo') return repoLines(width, height)
      if (state.view === 'pick') return pickLines(width, height)

      return state.view === 'starting' ? startingLines(width, height) : confirmLines(width, height)
    },
    key: key => {
      if (isCtrlC(key)) return onCancel(true)
      if (state.view === 'repo') return onRepoKey(key)
      if (state.view === 'pick') return onPickKey(key)
      if (state.view === 'starting') return onStartingKey(key)

      return onConfirmKey(key)
    },
  }
}
