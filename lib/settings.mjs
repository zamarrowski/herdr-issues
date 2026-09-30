// The settings screen shared by the issues popup (`,`) and the setup popup (`s`): which tabs show and in
// which order, the default agent, and how each agent kind starts (a mode from `agent_modes` plus free
// arguments, both kept in `agent_args`). Every change is written to config.json straight away and applied
// to the in-memory config. The helpers above the screen are pure, so they can be unit tested.
import { DEFAULTS, readConfigFile, saveConfigValue } from './config.mjs'
import { c, lineLR, paint, tildify } from './format.mjs'
import { TABS, TAB_NAMES, visibleTabs } from './sources.mjs'
import { createPicker, editLine, header, hint, inputRow, isCtrlC, isDown, isEnter, isEsc, isUp, layout, notice, rule } from './tui.mjs'

// ── arguments ───────────────────────────────────────────────────────────────

// "--add-dir '../my dir' -v" → ['--add-dir', '../my dir', '-v']. Quotes group, a backslash escapes the
// next character (inside double quotes too), like a shell without expansions.
export const splitArgs = text => {
  const out = []
  const chars = [...String(text ?? '')]
  let current = null
  let quote = null
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index]
    if (quote) {
      if (char === quote) quote = null
      else if (char === '\\' && quote === '"' && index + 1 < chars.length) current += chars[++index]
      else current += char
    } else if (/\s/.test(char)) {
      if (current !== null) out.push(current)
      current = null
    } else if (char === '"' || char === "'") {
      quote = char
      current ??= ''
    } else if (char === '\\' && index + 1 < chars.length) current = (current ?? '') + chars[++index]
    else current = (current ?? '') + char
  }
  if (current !== null) out.push(current)

  return out
}

// The reverse of splitArgs: single quotes around anything a shell would split or expand.
export const joinArgs = args => (args ?? []).map(arg => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`)).join(' ')

// The modes of one agent kind, [[name, args]]; hidden ([]) and malformed ones are left out.
export const modesFor = (config, kind) =>
  Object.entries(config?.agent_modes?.[kind] ?? {}).filter(([, args]) => Array.isArray(args) && args.length && args.every(arg => typeof arg === 'string'))

const indexOfRun = (list, run) => {
  for (let index = 0; index + run.length <= list.length; index++) if (run.every((arg, offset) => list[index + offset] === arg)) return index

  return -1
}
const longestFirst = modes => [...modes].sort((a, b) => b[1].length - a[1].length)

// The mode whose arguments appear in `args` (the longest when several do), null for none.
export const modeOf = (args, modes) => longestFirst(modes).find(([, run]) => indexOfRun(args ?? [], run) >= 0)?.[0] ?? null

// `args` without the arguments of any mode: what was added besides the mode.
export const extraArgs = (args, modes) => {
  const out = [...(args ?? [])]
  for (const [, run] of longestFirst(modes)) {
    for (let at = indexOfRun(out, run); at >= 0; at = indexOfRun(out, run)) out.splice(at, run.length)
  }

  return out
}

const modeArgs = (modes, name) => modes.find(([mode]) => mode === name)?.[1] ?? []

// The arguments with `name` as the mode (null: none), the extra arguments kept after it.
export const withMode = (args, modes, name) => [...modeArgs(modes, name), ...extraArgs(args, modes)]

// The arguments with `extra` in place of the extra arguments, the mode kept.
export const withExtra = (args, modes, extra) => [...modeArgs(modes, modeOf(args, modes)), ...extra]

// ── tabs ────────────────────────────────────────────────────────────────────

// Every tab and whether it shows, the shown ones first in their configured order.
export const tabRows = tabs => {
  const shown = visibleTabs(tabs)

  return [...shown.map(id => ({ id, on: true })), ...TABS.filter(id => !shown.includes(id)).map(id => ({ id, on: false }))]
}
export const tabsValue = rows => rows.filter(row => row.on).map(row => row.id)

// Shows or hides a tab; the last shown one stays.
export const toggleTab = (rows, id) => {
  const next = rows.map(row => (row.id === id ? { ...row, on: !row.on } : row))

  return tabsValue(next).length ? next : rows
}

export const moveTab = (rows, id, step) => {
  const from = rows.findIndex(row => row.id === id)
  const to = from + step
  if (from < 0 || to < 0 || to >= rows.length) return rows
  const next = [...rows]
  ;[next[from], next[to]] = [next[to], next[from]]

  return next
}

// The agent kinds the screen lists: the default, the one in the pane, those with modes or arguments, and
// the ones added on the screen.
export const listedKinds = ({ config, focusedAgent = null, added = [] }) =>
  [
    ...new Set([
      config.agent && config.agent !== 'auto' ? config.agent : null,
      focusedAgent,
      ...Object.keys(config.agent_modes ?? {}).filter(kind => modesFor(config, kind).length),
      ...Object.keys(config.agent_args ?? {}),
      ...added,
    ]),
  ].filter(Boolean)

// ── screen ──────────────────────────────────────────────────────────────────

const SECTIONS = { tab: 'Tabs', agent: 'Agent', kind: 'How each agent starts', link: 'Accounts' }
// A mode says it is dangerous in its name ("skip permissions (dangerous)"); it is shown in red.
export const isDangerous = name => /danger/i.test(name ?? '')

// kinds: the agent kinds herdr can start (filled in later is fine). links: [{ name, text(), open() }], rows
// of an "Accounts" section; open() may return a message to show. focus: the name of the link to start on.
// onChange(key): a key was saved. onClose(quit): Esc (quit: Ctrl+C).
export const createSettings = ({ config, configFile, kinds = [], focusedAgent = null, links = [], focus = null, env = process.env, onChange = () => {}, onClose }) => {
  const state = { cursor: 0, tabs: tabRows(config.tabs), added: [], picker: null, pick: null, editing: null, message: '' }
  state.savedAgent = env.HERDR_ISSUES_AGENT ? (readConfigFile(configFile).data?.agent ?? DEFAULTS.agent) : config.agent

  const rows = () => [
    ...state.tabs.map(tab => ({ type: 'tab', id: tab.id })),
    { type: 'agent' },
    ...listedKinds({ config, focusedAgent, added: state.added }).map(kind => ({ type: 'kind', kind })),
    { type: 'add' },
    ...links.map(link => ({ type: 'link', link })),
  ]
  const row = () => rows()[state.cursor]
  if (focus) state.cursor = Math.max(0, rows().findIndex(entry => entry.link?.name === focus))
  const argsOf = kind => (Array.isArray(config.agent_args?.[kind]) ? config.agent_args[kind] : [])

  const save = (key, value, text) => {
    try {
      saveConfigValue(key, value, configFile)
    } catch (error) {
      state.message = `could not save: ${error.message}`

      return false
    }
    config[key] = value
    state.message = text
    onChange(key)

    return true
  }

  // Moving a hidden tab changes nothing on disk; anything else is kept only once saved.
  const saveTabs = next => {
    const value = tabsValue(next)
    if (value.join() === tabsValue(state.tabs).join() || save('tabs', value, `Tabs: ${value.map(id => TAB_NAMES[id]).join(', ')}`)) state.tabs = next
  }

  const saveAgent = agent => {
    const overridden = env.HERDR_ISSUES_AGENT
    if (!save('agent', agent, `Default agent: ${agent}${overridden ? `, but HERDR_ISSUES_AGENT=${overridden} still wins` : ''}`)) return
    state.savedAgent = agent
    if (overridden) config.agent = overridden
  }

  const saveArgs = (kind, args) => {
    const next = { ...config.agent_args }
    if (args.length) next[kind] = args
    else delete next[kind]
    save('agent_args', next, `Saved: ${kind} starts with ${args.length ? joinArgs(args) : 'no extra arguments'}`)
  }

  const openPicker = (pick, items, title, selected) => {
    state.pick = pick
    state.picker = createPicker({ items, title, matchNote: true })
    const index = items.findIndex(item => item.value === selected)
    if (index >= 0) state.picker.state.cursor = index
  }

  const openAgentPicker = () =>
    openPicker(
      { type: 'agent' },
      [{ id: 'auto', note: 'the agent in your pane, otherwise ask', value: 'auto' }, ...kinds.map(kind => ({ id: kind, note: kind === focusedAgent ? 'running in your pane' : '', value: kind }))],
      'Which agent takes an issue by default?',
      config.agent,
    )

  const openModePicker = kind => {
    const modes = modesFor(config, kind)
    const items = [{ id: 'default', note: 'no mode arguments', value: null }, ...modes.map(([name, args]) => ({ id: name, note: joinArgs(args), value: name }))]
    openPicker({ type: 'mode', kind }, items, `How should ${kind} start?`, modeOf(argsOf(kind), modes))
  }

  const openAddPicker = () => {
    const listed = listedKinds({ config, focusedAgent, added: state.added })
    const items = kinds.filter(kind => !listed.includes(kind)).map(kind => ({ id: kind, value: kind }))
    if (!items.length) {
      state.message = 'Every agent herdr knows is listed already'

      return
    }
    openPicker({ type: 'add' }, items, 'Which agent do you want to set up?', null)
  }

  const onPicked = value => {
    const { pick } = state
    if (pick.type === 'agent') saveAgent(value)
    else if (pick.type === 'mode') {
      const modes = modesFor(config, pick.kind)
      saveArgs(pick.kind, withMode(argsOf(pick.kind), modes, value))
    } else if (pick.type === 'add') {
      state.added.push(value)
      state.cursor = rows().findIndex(entry => entry.kind === value)
      state.message = modesFor(config, value).length ? '' : `${value} has no modes: press e to type its arguments`
    }
  }

  const startEditing = kind => {
    state.editing = { kind, input: joinArgs(extraArgs(argsOf(kind), modesFor(config, kind))) }
    state.message = ''
  }

  const activate = () => {
    const current = row()
    if (!current) return
    if (current.type === 'tab') saveTabs(toggleTab(state.tabs, current.id))
    else if (current.type === 'agent') openAgentPicker()
    else if (current.type === 'kind') {
      if (modesFor(config, current.kind).length) openModePicker(current.kind)
      else startEditing(current.kind)
    } else if (current.type === 'add') openAddPicker()
    else if (current.type === 'link') state.message = current.link.open() ?? ''
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  const kindText = kind => {
    const args = argsOf(kind)
    const modes = modesFor(config, kind)
    const mode = modeOf(args, modes)
    const extra = extraArgs(args, modes)
    const modeText = mode ? paint(isDangerous(mode) ? c.red : c.reset, mode) : paint(c.dim, 'default')

    return `${modeText}${extra.length ? paint(c.dim, ` + ${joinArgs(extra)}`) : ''}`
  }

  // With HERDR_ISSUES_AGENT set, the in-memory agent is the environment's; the row shows config.json's.
  const agentText = () => {
    const overridden = env.HERDR_ISSUES_AGENT
    const agent = overridden ? state.savedAgent : config.agent
    const note = agent === 'auto' ? paint(c.dim, '  the agent in your pane, otherwise ask') : ''

    return `${agent}${note}${overridden ? paint(c.yellow, `  HERDR_ISSUES_AGENT=${overridden} overrides it`) : ''}`
  }

  const rowLine = (entry, selected, labelWidth) => {
    const pointer = selected ? paint(c.cyan, '›') : ' '
    const label = text => (selected ? paint(c.bold, text.padEnd(labelWidth)) : text.padEnd(labelWidth))
    if (entry.type === 'tab') {
      const on = state.tabs.find(tab => tab.id === entry.id).on
      const note = entry.id === 'all' ? paint(c.dim, 'every source together') : ''

      return ` ${pointer} ${on ? paint(c.green, '[x]') : paint(c.dim, '[ ]')} ${label(TAB_NAMES[entry.id])}${note}`
    }
    if (entry.type === 'agent') return ` ${pointer} ${label('Default')}${agentText()}`
    if (entry.type === 'kind') {
      const notes = [entry.kind === config.agent ? 'default' : '', entry.kind === focusedAgent ? 'in your pane' : ''].filter(Boolean).join(', ')

      return ` ${pointer} ${label(entry.kind)}${kindText(entry.kind)}${notes ? paint(c.dim, `  (${notes})`) : ''}`
    }
    if (entry.type === 'add') return ` ${pointer} ${paint(selected ? c.bold : c.dim, '+ another agent…')}`

    return ` ${pointer} ${label(entry.link.name)}${entry.link.text()}`
  }

  // One line under the list about the selected row.
  const detail = entry => {
    if (!entry) return ''
    if (entry.type === 'tab') return entry.id === 'all' ? 'All lists every source together, newest updated first.' : 'A hidden tab is not loaded, unless All is shown: All lists every source.'
    if (entry.type === 'agent') return 'Used when you start an issue; d on the confirmation screen sets it too.'
    if (entry.type === 'kind') {
      const args = argsOf(entry.kind)

      return args.length ? `herdr starts ${entry.kind} with: ${joinArgs(args)}` : `herdr starts ${entry.kind} with no extra arguments.`
    }
    if (entry.type === 'add') return 'Set up the arguments of an agent that is not listed.'

    return ''
  }

  const keysHint = entry => {
    if (!entry) return 'Esc back'
    if (entry.type === 'tab') return 'Enter show/hide · J/K move the tab · ↑↓ move · Esc back'
    if (entry.type === 'kind') return `Enter ${modesFor(config, entry.kind).length ? 'choose the mode' : 'type the arguments'} · e extra arguments · x clear · ↑↓ move · Esc back`

    return 'Enter change · ↑↓ move · Esc back'
  }

  const lines = (width, height) => {
    if (state.picker) {
      const { lines: body, cursor } = state.picker.lines(width, height - 2)

      return { lines: layout(body, [notice(state.message), hint('Enter choose · ↑↓ / Tab move · type to filter · Esc back')], height), cursor }
    }
    const list = rows()
    const labelWidth = Math.max(12, ...list.map(entry => (entry.type === 'kind' ? entry.kind.length + 2 : 0)))
    const head = [header('Settings', { subtitle: tildify(configFile) }, width), rule(width)]
    const body = []
    let cursorLine = 0
    let section = null
    list.forEach((entry, index) => {
      const name = SECTIONS[entry.type === 'add' ? 'kind' : entry.type]
      if (name !== section) {
        section = name
        body.push('', paint(c.bold, ` ${name}`))
      }
      if (index === state.cursor) cursorLine = body.length
      body.push(rowLine(entry, index === state.cursor, labelWidth))
    })
    const footer = []
    let cursor = null
    if (state.editing) {
      const { kind } = state.editing
      const mode = modeOf(argsOf(kind), modesFor(config, kind))
      const input = inputRow(`${kind} arguments:`, state.editing.input, width)
      footer.push(paint(c.dim, ` ${mode ? `Typed after the ${mode} mode arguments. ` : ''}Quote arguments with spaces.`), input.text, hint('Enter save · Esc cancel · Ctrl+U clear'))
      cursor = { row: height - 1, col: input.cursorCol }
    } else footer.push(paint(c.dim, ` ${detail(row())}`), notice(state.message), hint(keysHint(row())))
    // Scroll the list when it does not fit, keeping the selected row in view.
    const room = Math.max(1, height - head.length - footer.length)
    const start = body.length > room ? Math.min(Math.max(0, cursorLine - Math.floor(room / 2)), body.length - room) : 0
    const shown = body.slice(start, start + room)
    if (start > 0) shown[0] = lineLR(shown[0], paint(c.dim, `↑ ${start} more `), width)
    if (start + room < body.length) shown[shown.length - 1] = lineLR(shown.at(-1), paint(c.dim, `↓ ${body.length - start - room} more `), width)

    return { lines: layout([...head, ...shown], footer, height), cursor }
  }

  // ── keys ──────────────────────────────────────────────────────────────────

  const onEditKey = key => {
    const { kind, input } = state.editing
    if (isEsc(key)) state.editing = null
    else if (isEnter(key)) {
      state.editing = null
      saveArgs(kind, withExtra(argsOf(kind), modesFor(config, kind), splitArgs(input)))
    } else state.editing.input = editLine(input, key)
  }

  const onPickerKey = key => {
    const action = state.picker.key(key)
    if (action === 'cancel') state.picker = null
    if (action === 'pick') {
      const { value } = state.picker.current()
      state.picker = null
      onPicked(value)
    }
  }

  const key = key => {
    if (isCtrlC(key)) return onClose(true)
    if (state.picker) return onPickerKey(key)
    if (state.editing) return onEditKey(key)
    if (isEsc(key) || key === 'q' || key === 'Q') return onClose(false)
    state.message = ''
    const count = rows().length
    const current = row()
    if (isDown(key) || key === '\t') state.cursor = Math.min(count - 1, state.cursor + 1)
    else if (isUp(key) || key === '\x1b[Z') state.cursor = Math.max(0, state.cursor - 1)
    else if (key === 'g' || key === '\x1b[H') state.cursor = 0
    else if (key === 'G' || key === '\x1b[F') state.cursor = count - 1
    else if (isEnter(key) || key === ' ' || key === 'l') activate()
    else if ((key === 'J' || key === 'K') && current?.type === 'tab') {
      const before = state.tabs
      saveTabs(moveTab(state.tabs, current.id, key === 'J' ? 1 : -1))
      if (state.tabs !== before) state.cursor += key === 'J' ? 1 : -1
    } else if ((key === 'e' || key === 'E') && current?.type === 'kind') startEditing(current.kind)
    else if ((key === 'x' || key === 'X') && current?.type === 'kind') saveArgs(current.kind, [])
    state.cursor = Math.max(0, Math.min(state.cursor, rows().length - 1)) // a cleared agent may leave the list
  }

  return { state, lines, key }
}
