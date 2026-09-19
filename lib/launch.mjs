// The "start this issue" mini flow shared by the issues browser and the start popup:
// pick an agent (when nothing decided one) → confirm → run startIssue() with live progress →
// close on success, or show the error and wait for a key.
import { resolveAgent, saveConfigValue } from './config.mjs'
import { c, paint, truncateText } from './format.mjs'
import { assigneeText, labelText } from './github.mjs'
import { planIssue, startIssue } from './start.mjs'
import { createPicker, createStepper, field, header, hint, isCtrlC, isEsc, layout, notice, rule, stepLines } from './tui.mjs'

// kinds: agent kinds herdr can start. focusedAgent: agent in the pane the popup came from.
// onRedraw(): async state changed. onCancel(): user backed out. onDone(result): finished, close me.
export const createLauncher = ({ issue, repo, target, config, configFile, kinds, focusedAgent = null, explicitAgent = null, onRedraw, onCancel, onDone }) => {
  const state = {
    view: 'confirm', // confirm | pick | starting
    agent: resolveAgent({ explicit: explicitAgent, config, focusedAgent }),
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
    state.picker = createPicker({ items: pickerItems(), title: 'Which agent should take the issue?' })
    const preferred = pickerItems().findIndex(item => item.id === (state.agent ?? focusedAgent))
    if (preferred >= 0) state.picker.state.cursor = preferred
    state.view = 'pick'
  }

  const run = async () => {
    state.view = 'starting'
    state.failed = false
    state.stepper = createStepper(onRedraw)
    onRedraw()
    try {
      state.result = await startIssue({
        cwd: target.root,
        workspaceId: target.workspaceId,
        issue,
        repo,
        agent: state.agent,
        config,
        onStep: state.stepper.begin,
      })
      const { result } = state
      state.finished = true // before the last stepper update, which repaints the footer
      if (result.skipped === 'already_open') state.stepper.done(`Worktree "${result.label}" was already open`)
      else state.stepper.done(`${result.kind} is on #${issue.number} in "${result.label}"`)
      setTimeout(() => onDone(result), 1500)
    } catch (error) {
      state.failed = true
      state.stepper.fail(error.message)
    }
  }

  if (!state.agent) openPicker()

  const confirmLines = (width, height) => {
    const plan = planIssue({ issue, repo, config, agent: state.agent })
    const body = [
      header('Start issue', { subtitle: repo }, width),
      rule(width),
      ` ${paint(c.bold, `#${issue.number}`)} ${truncateText(issue.title, width - 10)}`,
      paint(c.dim, ` ${[labelText(issue), assigneeText(issue)].filter(Boolean).join(' · ')}`),
      '',
      field('Agent', `${state.agent}${state.agent === focusedAgent ? paint(c.dim, '  (running in your pane)') : ''}`, width),
      field('Branch', plan.branch, width),
      field('Workspace', plan.label, width),
      field('Agent name', plan.agentName, width),
      field('Prompt', plan.prompt, width),
    ]
    if (plan.agentArgs.length) body.push(field('Args', plan.agentArgs.join(' '), width))
    const footer = [notice(state.message), hint(`y start · d start and make ${state.agent} the default · a change agent · Esc cancel`)]

    return layout(body, footer, height)
  }

  const pickLines = (width, height) => {
    const { lines, cursor } = state.picker.lines(width, height - 3)
    const footer = [notice(state.message), hint('Enter choose · ↑↓ / Tab move · type to filter · Esc back')]

    return { lines: layout([...lines], footer, height), cursor }
  }

  const startingLines = (width, height) => {
    const body = [
      header(`Starting #${issue.number}`, { subtitle: repo }, width),
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

  const onStartingKey = () => {
    if (state.finished) return onDone(state.result)
    if (!state.failed) return
    state.view = 'confirm'
    state.message = ''
  }

  return {
    state,
    lines: (width, height) => (state.view === 'pick' ? pickLines(width, height) : state.view === 'starting' ? startingLines(width, height) : confirmLines(width, height)),
    key: key => {
      if (isCtrlC(key)) return onCancel(true)
      if (state.view === 'pick') return onPickKey(key)
      if (state.view === 'starting') return onStartingKey(key)

      return onConfirmKey(key)
    },
  }
}
