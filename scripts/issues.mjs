// Issues browser popup: GitHub issues of the focused pane's repository, Shortcut stories and Linear issues,
// in tabs (All · GitHub · Shortcut · Linear, as configured in `tabs`).
//   Tab/1-4 switch tabs · Enter read · s start · o open in browser · r refresh · c show closed · / filter · j/k move · q quit
//   On the Shortcut and Linear tabs: the token form when no token is set, `f` for the people filter
//   (owner / requester, assignee / creator; remembered), `,` for the settings (edit or remove the token).
// The repository comes from HERDR_PLUGIN_CONTEXT_JSON (focused pane cwd), or --cwd PATH / --repo owner/name.
// Without a TTY it prints the list (JSON with --json) and exits, which is handy for scripts and agents.
import { parseArgs } from '../lib/args.mjs'
import { clearCaches, readCache, readUiState, writeCache, writeUiState } from '../lib/cache.mjs'
import { loadConfig } from '../lib/config.mjs'
import { pickCwd, pickRepo, readContext, resolveTarget, startTargets } from '../lib/context.mjs'
import { ago, c, lineLR, pad, paint, plural, tildify, truncate, visibleWidth, wrap } from '../lib/format.mjs'
import { listIssues, openInBrowser, repoInfo, viewIssue } from '../lib/github.mjs'
import { FALLBACK_KINDS, agentKinds } from '../lib/herdr.mjs'
import { createLauncher } from '../lib/launch.mjs'
import { renderMarkdown } from '../lib/markdown.mjs'
import { secretsPath } from '../lib/paths.mjs'
import { openUrl } from '../lib/proc.mjs'
import { notSetUp } from '../lib/integration.mjs'
import { ME, REMOTES } from '../lib/remotes.mjs'
import { removeSecret, saveSecret } from '../lib/secrets.mjs'
import { Noun, REMOTE_SOURCES, TABS, TAB_NAMES, assigneeText, haystack, isRemote, labelText, mergeByUpdated, sourcesOf, stateText, visibleTabs } from '../lib/sources.mjs'
import { createPicker, createScreen, editLine, header, hint, inputRow, isArrowDown, isArrowUp, isCtrlC, isDown, isEnter, isEsc, isUp, layout, notice, rule, window } from '../lib/tui.mjs'

// --owner / --requester for Shortcut, --assignee / --creator for Linear: every people filter field.
const PEOPLE_FLAGS = [...new Set(Object.values(REMOTES).flatMap(remote => remote.filter.names))]
const USAGE = `usage: issues.mjs [--source ${TABS.slice(1).join('|')}|all] ${PEOPLE_FLAGS.map(flag => `[--${flag} NAME|me]`).join(' ')} [--cwd PATH] [--repo owner/name] [--agent KIND] [--closed] [--json]`
const args = parseArgs(process.argv.slice(2), { flags: ['json', 'closed', 'help'], values: ['cwd', 'repo', 'agent', 'source', ...PEOPLE_FLAGS] })
if (args.flags.has('help')) {
  console.log(USAGE)
  process.exit(0)
}

const context = readContext()
const { config, file: configFile, warnings } = loadConfig()
const target = {
  ...(await resolveTarget({ cwd: pickCwd({ flag: args.values.cwd, context }), repo: pickRepo({ flag: args.values.repo }), context })),
  url: null,
  resolved: false,
}
const tabs = visibleTabs(config.tabs)
const needed = sourcesOf(tabs)
// Shortcut and Linear, when a tab shows them: each has its token, its account and its people filter.
const remoteIds = REMOTE_SOURCES.filter(id => needed.includes(id))
const remembered = readUiState()

const state = {
  tab: tabs.includes(remembered.tab) ? remembered.tab : tabs[0],
  cursor: 0,
  view: 'list', // list | detail | settings | filter | launch
  showClosed: false,
  filter: '',
  filtering: false,
  detail: null,
  detailFull: false,
  rendered: true, // Markdown rendering in the detail view; m toggles the raw text
  scroll: 0,
  message: warnings.length ? `config.json: ${warnings[0]}` : '',
  kinds: [...FALLBACK_KINDS],
  launcher: null,
  launchFrom: 'list',
  confirmRemove: false,
  filterRow: 0, // row of the people filter screen
  peoplePicker: null,
}

const sources = { github: { items: [], fetchedAt: null, loading: false, error: null } }
for (const id of REMOTE_SOURCES) {
  sources[id] = {
    items: [],
    fetchedAt: null,
    loading: false,
    error: null,
    auth: REMOTES[id].auth(), // { token, from: 'env' | 'file' } | null
    me: null, // { handle, name, workspace }
    workspace: null,
    lookups: null,
    // { owner, requester } for Shortcut, { assignee, creator } for Linear: null | ME | handle
    filter: REMOTES[id].filter.normalize(remembered[`${id}_filter`]),
    form: { input: '', checking: false, error: null, editing: false },
  }
}
// One cached list per team and people filter, so switching the filter paints instantly too.
const cacheKey = id => `${id}:${REMOTES[id].team(config) || 'all'}:${REMOTES[id].filter.names.map(field => sources[id].filter[field] ?? '-').join(':')}`

// ── data ────────────────────────────────────────────────────────────────────

const tabItems = tab => (tab === 'all' ? mergeByUpdated(needed.map(source => sources[source].items)) : (sources[tab]?.items ?? []))
const visibleIssues = () => {
  const query = state.filter.trim().toLowerCase()
  const items = tabItems(state.tab)

  return query ? items.filter(issue => haystack(issue).includes(query)) : items
}
const current = () => visibleIssues()[state.cursor]
const clampCursor = () => {
  state.cursor = Math.max(0, Math.min(state.cursor, visibleIssues().length - 1))
}
// The Shortcut and Linear tabs show the token form instead of the list while no token is set (or while editing it).
const tokenFormActive = () => Boolean(REMOTES[state.tab]) && (!sources[state.tab].auth || sources[state.tab].form.editing)

const resolveRepo = async () => {
  if (!target.root && !target.repo) {
    throw new Error('Not inside a git repository. Open the popup from a pane inside a GitHub checkout to see its issues.')
  }
  const info = await repoInfo({ cwd: target.root ?? undefined, repo: target.repo })
  target.repo = info.nameWithOwner
  target.url = info.url
  target.resolved = true
}

const loadGithub = async ({ force = false } = {}) => {
  const source = sources.github
  if (source.loading) return
  source.loading = true
  source.error = null
  draw()
  try {
    if (!target.resolved) await resolveRepo()
    const key = `github:${target.repo}`
    if (!force && source.items.length === 0 && !state.showClosed) {
      const cached = readCache(key)
      if (cached?.issues?.length) {
        source.items = cached.issues
        source.fetchedAt = cached.fetchedAt
        draw()
      }
    }
    source.items = await listIssues({ cwd: target.root, repo: target.repo }, { state: state.showClosed ? 'all' : 'open', limit: config.limit })
    source.fetchedAt = Date.now()
    if (!state.showClosed) writeCache(key, { fetchedAt: source.fetchedAt, issues: source.items })
  } catch (error) {
    source.error = error.message
  } finally {
    source.loading = false
    clampCursor()
    draw()
  }
}

const loadRemote = async (id, { force = false } = {}) => {
  const remote = REMOTES[id]
  const source = sources[id]
  if (!source.auth) return
  if (source.loading) {
    source.reload = true // a newer request (another filter) waits for this one

    return
  }
  source.loading = true
  source.error = null
  draw()
  try {
    if (!force && source.items.length === 0 && !state.showClosed) {
      const cached = readCache(cacheKey(id))
      if (cached?.issues?.length) {
        source.items = cached.issues
        source.fetchedAt = cached.fetchedAt
        source.workspace = cached.workspace ?? null
        source.lookups = cached.lookups ?? null
        draw()
      }
    }
    const { token } = source.auth
    const [me, lookups] = await Promise.all([source.me ?? remote.whoami(token), remote.lookups(token)])
    source.me = me
    source.workspace = me.workspace
    source.lookups = lookups
    const filter = { ...source.filter }
    const items = await remote.list(token, { config, closed: state.showClosed, limit: config.limit, lookups, filter, me })
    if (remote.filter.names.some(field => filter[field] !== source.filter[field])) return // the filter changed meanwhile
    source.items = items
    source.fetchedAt = Date.now()
    if (!state.showClosed) writeCache(cacheKey(id), { fetchedAt: source.fetchedAt, issues: source.items, workspace: source.workspace, lookups })
  } catch (error) {
    source.error = error.message
  } finally {
    source.loading = false
    clampCursor()
    draw()
    if (source.reload) {
      source.reload = false
      loadRemote(id)
    }
  }
}

const load = ({ force = false } = {}) => Promise.all([needed.includes('github') ? loadGithub({ force }) : null, ...remoteIds.map(id => loadRemote(id, { force }))])

const openDetail = async () => {
  const issue = current()
  if (!issue) return
  state.view = 'detail'
  state.detail = issue
  state.detailFull = false
  state.scroll = 0
  state.message = ''
  draw()
  try {
    const remote = sources[issue.source]
    const full = isRemote(issue)
      ? await REMOTES[issue.source].view(remote.auth?.token, issue, { lookups: remote.lookups ?? {} })
      : await viewIssue({ cwd: target.root, repo: target.repo }, issue.number)
    if (state.view === 'detail' && state.detail?.ref === issue.ref) {
      state.detail = full
      state.detailFull = true
    }
  } catch (error) {
    state.message = error.message
  }
  draw()
}

const openBrowser = async () => {
  const issue = state.view === 'detail' ? state.detail : current()
  if (!issue) return
  try {
    if (isRemote(issue)) await openUrl(issue.url)
    else await openInBrowser({ cwd: target.root, repo: target.repo }, issue.number)
    state.message = `Opened ${issue.ref} in the browser`
  } catch (error) {
    state.message = error.message
  }
  draw()
}

const askStart = () => {
  const issue = state.view === 'detail' ? state.detail : current()
  if (!issue) return
  const story = isRemote(issue) // a Shortcut story or a Linear issue: no repository of its own
  if (!story && !target.root) {
    state.message = 'Starting needs a local checkout: open the popup from a pane inside the repository'

    return
  }
  state.launchFrom = state.view
  state.launcher = createLauncher({
    issue,
    repo: story ? null : target.repo,
    target,
    config,
    configFile,
    kinds: state.kinds,
    focusedAgent: target.focusedAgent,
    explicitAgent: args.values.agent ?? null,
    // Nothing ties a story or a Linear issue to a repository: ask, with the pane's repository preselected.
    loadRepos: story ? () => startTargets({ workspaceId: context.workspace_id ?? null, root: target.root }) : null,
    onRedraw: () => draw(),
    onCancel: quit => {
      if (quit) return screen.exit(0)
      state.view = state.launchFrom
      state.launcher = null
    },
    onDone: () => screen.exit(0),
  })
  state.view = 'launch'
}

const switchTab = next => {
  if (!tabs.includes(next) || next === state.tab) return
  state.tab = next
  state.cursor = 0
  state.message = ''
  writeUiState({ tab: next })
}
const cycleTab = step => switchTab(tabs[(tabs.indexOf(state.tab) + step + tabs.length) % tabs.length])

// ── Shortcut and Linear tokens ──────────────────────────────────────────────

const submitToken = async id => {
  const remote = REMOTES[id]
  const source = sources[id]
  const { form } = source
  const token = form.input.trim()
  if (!token || form.checking) return
  form.checking = true
  form.error = null
  draw()
  try {
    const me = await remote.whoami(token)
    saveSecret(remote.secretKey, token)
    clearCaches(`${id}:`)
    Object.assign(source, { auth: { token, from: 'file' }, me, workspace: me.workspace, items: [], fetchedAt: null, error: null })
    form.input = ''
    form.editing = false
    state.message = `${remote.name} connected: @${me.handle} in ${me.workspace}`
    loadRemote(id, { force: true })
  } catch (error) {
    form.error = error.message
  } finally {
    form.checking = false
    draw()
  }
}

const removeToken = id => {
  const remote = REMOTES[id]
  removeSecret(remote.secretKey)
  clearCaches(`${id}:`)
  Object.assign(sources[id], { auth: remote.auth(), me: null, workspace: null, lookups: null, items: [], fetchedAt: null, error: null })
  state.confirmRemove = false
  state.view = 'list'
  state.cursor = 0
  state.message = `${remote.name} ${remote.tokenName} removed`
}

// ── people filter (Shortcut owner / requester, Linear assignee / creator) ──

// The sources the filter screen covers: the tab's own, or every connected one on the All tab.
const filterRemotes = () => (REMOTES[state.tab] ? [state.tab] : state.tab === 'all' ? remoteIds : []).filter(id => sources[id].auth)
const filterRows = () => {
  const ids = filterRemotes()

  return ids.flatMap(id => REMOTES[id].filter.fields.map(([field, name]) => ({ id, field, name: ids.length > 1 ? `${REMOTES[id].name} ${name.toLowerCase()}` : name })))
}
const filterValueText = (id, value) => {
  const me = sources[id].me

  return value === ME ? `me${me ? ` (@${me.handle})` : ''}` : value ? `@${value}` : 'anyone'
}

const openFilter = () => {
  state.view = 'filter'
  state.filterRow = Math.min(state.filterRow, filterRows().length - 1)
  state.peoplePicker = null
  state.message = ''
}

const setFilter = (id, next) => {
  const source = sources[id]
  source.filter = REMOTES[id].filter.normalize(next)
  writeUiState({ [`${id}_filter`]: source.filter })
  Object.assign(source, { items: [], fetchedAt: null, error: null })
  state.cursor = 0
  loadRemote(id)
}

const openPeoplePicker = () => {
  const row = filterRows()[state.filterRow]
  if (!row) return
  const remote = REMOTES[row.id]
  const source = sources[row.id]
  if (!source.lookups) {
    state.message = 'The members of the workspace are still loading'

    return
  }
  const items = [
    { id: 'anyone', note: 'no filter', value: null },
    { id: 'me', note: source.me ? `@${source.me.handle}` : `the owner of the ${remote.tokenWord}`, value: ME },
    ...remote.people(source.lookups).map(person => ({ id: `@${person.handle}`, note: person.name, value: person.handle })),
  ]
  const [, name] = remote.filter.fields.find(([field]) => field === row.field)
  state.peoplePicker = createPicker({ items, title: `${name} of the ${remote.plural}`, empty: 'nobody matches', matchNote: true })
  const current = items.findIndex(item => item.value === (source.filter[row.field] ?? null))
  if (current >= 0) state.peoplePicker.state.cursor = current
}

const openSettings = () => {
  const id = state.tab
  const source = sources[id]
  state.view = 'settings'
  state.confirmRemove = false
  state.message = ''
  if (source.auth && !source.me) {
    REMOTES[id]
      .whoami(source.auth.token)
      .then(me => {
        source.me = me
      })
      .catch(error => {
        state.message = error.message
      })
      .finally(draw)
  }
}

// ── rendering ───────────────────────────────────────────────────────────────

// "stories" on the Shortcut tab, "issues or stories" on All when Shortcut is one of its sources.
const noun = tab => (REMOTES[tab] ? REMOTES[tab].plural : tab === 'github' ? 'issues' : [...new Set(['issues', ...remoteIds.map(id => REMOTES[id].plural)])].join(' or '))

const tabBar = width => {
  const count = tab => {
    const list = tab === 'all' ? needed.map(source => sources[source]) : [sources[tab]]
    if (REMOTES[tab] && !sources[tab].auth) return ''
    if (list.some(source => source.loading) && !tabItems(tab).length) return ' …'
    if (list.every(source => source.error)) return ' !'

    return ` ${tabItems(tab).filter(issue => !issue.closed).length}`
  }
  const parts = tabs.map((tab, index) => {
    const text = ` ${index + 1} ${TAB_NAMES[tab]}${count(tab)} `

    return tab === state.tab ? paint(c.bold + c.cyan, `[${text.trim()}]`) : paint(c.dim, ` ${text.trim()} `)
  })

  return truncate(` ${parts.join(' ')}`, width)
}

// "acme (Backend) · owner me": the workspace, the configured team and the people filter of a source.
const remoteText = id => {
  const { workspace, filter } = sources[id]
  if (!workspace) return ''
  const team = REMOTES[id].team(config)
  const people = REMOTES[id].filter.text(filter)

  return `${workspace}${team ? ` (${team})` : ''}${people ? ` · ${people}` : ''}`
}

const subtitle = tab => {
  if (tab === 'github') return target.repo ?? target.cwd
  if (REMOTES[tab]) return remoteText(tab) || REMOTES[tab].name
  const remotes = remoteIds.filter(remoteText)
  // Two workspaces are told apart by their source ("Shortcut acme + Linear acme").
  const named = id => (remotes.length > 1 ? `${REMOTES[id].name} ${remoteText(id)}` : remoteText(id))

  return [needed.includes('github') ? target.repo : '', ...remotes.map(named)].filter(Boolean).join(' + ')
}

const headerRight = tab => {
  const list = tab === 'all' ? needed.map(source => sources[source]) : [sources[tab]]
  const items = tabItems(tab)
  const fetched = list.map(source => source.fetchedAt).filter(Boolean)
  let right = list.some(source => source.loading) ? 'loading…' : fetched.length ? `updated ${ago(Math.min(...fetched))} ago` : ''
  if (items.length) {
    const open = items.filter(issue => !issue.closed).length
    right = `${open} open${state.showClosed ? ` · ${items.length - open} closed` : ''} · ${right}`
  }

  return right
}

const issueLine = (issue, selected, widths) => {
  const pointer = selected ? paint(c.cyan, '›') : ' '
  const number = paint(issue.closed ? c.dim : c.green, pad(issue.ref, widths.number))
  const title = selected ? paint(c.bold, truncate(issue.title, widths.title)) : truncate(issue.title, widths.title)
  const status = widths.state ? ` ${paint(c.magenta, pad(truncate(stateText(issue), widths.state), widths.state))}` : ''
  const labels = paint(c.yellow, pad(truncate(labelText(issue), widths.labels), widths.labels))
  const assignee = paint(c.cyan, pad(truncate(assigneeText(issue), widths.assignee), widths.assignee))
  const age = paint(c.dim, pad(ago(issue.updatedAt), 4, true))

  return ` ${pointer} ${number} ${pad(title, widths.title)}${status} ${labels} ${assignee} ${age}`
}

const tokenFormLines = (id, width) => {
  const remote = REMOTES[id]
  const { form } = sources[id]
  const masked = '•'.repeat(Math.min([...form.input].length, 48))
  const input = inputRow(`${remote.tokenName}:`, masked, width)
  const lines = [
    '',
    paint(c.bold, form.editing ? ` Replace the ${remote.name} ${remote.tokenName}` : ` Connect ${remote.name}`),
    '',
    ...wrap(remote.tokenHelp, Math.max(20, width - 2)).map(line => ` ${line}`),
    paint(c.dim, ` It is checked against the API, then saved in ${tildify(secretsPath())} (readable by you only).`),
    paint(c.dim, ` ${remote.tokenEnv}, when set, takes precedence.`),
    '',
  ]
  const cursorRow = lines.length
  lines.push(input.text, '')
  if (form.checking) lines.push(paint(c.dim, ` Checking the ${remote.tokenWord}…`))
  else if (form.error) lines.push(paint(c.red, ` ${form.error}`))

  return { lines, cursorRow, cursorCol: input.cursorCol }
}

// One line per source that has something to say in the All tab (not set up, failed).
const sourceNotes = () => {
  const notes = []
  if (needed.includes('github') && sources.github.error) notes.push(paint(c.dim, ` GitHub: ${sources.github.error}`))
  for (const id of remoteIds) {
    const remote = REMOTES[id]
    const where = tabs.includes(id) ? tabs.indexOf(id) + 1 : 'add it to "tabs"'
    if (!sources[id].auth) notes.push(paint(c.dim, ` ${remote.name} is not set up: open the ${remote.name} tab (${where}) to add an ${remote.tokenName}.`))
    else if (sources[id].error) notes.push(paint(c.dim, ` ${remote.name}: ${sources[id].error}`))
  }

  return notes
}

// The people filter hint: "Shortcut: f owner/requester (owner me) · , settings" on a source tab, both
// sources in one line on the All tab.
const filterHint = tab => {
  const ids = filterRemotes()
  const people = id => REMOTES[id].filter.text(sources[id].filter)
  if (ids.length === 1) {
    const [id] = ids
    const fields = REMOTES[id].filter.names.join('/')

    return hint(`${REMOTES[id].name}: f ${fields}${people(id) ? ` (${people(id)})` : ''}${tab === id ? ' · , settings' : ''}`)
  }

  return hint(`f people filter: ${ids.map(id => `${REMOTES[id].name}${people(id) ? ` (${people(id)})` : ''}`).join(' · ')}`)
}

const listFrame = (width, height) => {
  const tab = state.tab
  const body = [header('Issues', { subtitle: subtitle(tab), right: headerRight(tab) }, width), tabBar(width), rule(width)]
  const footer = []
  let cursor = null

  if (tokenFormActive()) {
    const form = tokenFormLines(tab, width)
    cursor = { row: body.length + form.cursorRow, col: form.cursorCol }
    body.push(...form.lines)
    footer.push(notice(state.message), hint(`Enter save${sources[tab].form.editing ? ' · Esc cancel' : ''} · Tab switch tab · Ctrl+U clear · Ctrl+C quit`))

    return { lines: layout(body, footer, height), cursor }
  }

  if (state.filtering) {
    const input = inputRow('Filter:', state.filter, width)
    footer.push(input.text)
    cursor = { row: height - 1, col: input.cursorCol }
  } else footer.push(notice(state.message || (state.filter ? `filter: ${state.filter} (Esc clears)` : '')))
  footer.push(hint(`Tab switch · Enter read · s start · o browser · r refresh · c ${state.showClosed ? 'hide' : 'show'} closed · / filter · q quit`))
  if (filterRemotes().length) footer.push(filterHint(tab))

  const issues = visibleIssues()
  const error = tab === 'all' ? null : sources[tab].error
  if (tab === 'all') body.push(...sourceNotes())
  const listRows = Math.max(1, height - body.length - footer.length)
  const loading = (tab === 'all' ? needed.map(source => sources[source]) : [sources[tab]]).some(source => source.loading)
  if (error) body.push(...wrap(error, Math.max(20, width - 2)).map(line => paint(c.red, ` ${line}`)))
  else if (issues.length === 0) {
    const people = REMOTES[tab]?.filter.text(sources[tab].filter) ? ` for ${REMOTES[tab].filter.text(sources[tab].filter)} (f changes it)` : ''
    body.push(paint(c.dim, loading ? ` Loading ${noun(tab)}…` : state.filter ? ` No ${noun(tab)} match the filter.` : ` No open ${noun(tab)}${people}.`))
  }
  else {
    const widths = { number: Math.max(...issues.map(issue => issue.ref.length)) }
    widths.state = Math.min(16, Math.max(0, ...issues.map(issue => visibleWidth(stateText(issue)))))
    widths.labels = Math.min(22, Math.max(0, ...issues.map(issue => visibleWidth(labelText(issue)))))
    widths.assignee = Math.min(14, Math.max(0, ...issues.map(issue => visibleWidth(assigneeText(issue)))))
    widths.title = Math.max(10, width - 2 - 1 - widths.number - 1 - 1 - (widths.state ? widths.state + 1 : 0) - widths.labels - 1 - widths.assignee - 1 - 4 - 1)
    const { start, visible } = window(issues, state.cursor, listRows)
    visible.forEach((issue, index) => body.push(issueLine(issue, start + index === state.cursor, widths)))
    const hidden = issues.length - start - visible.length
    if (hidden > 0) body[body.length - 1] = lineLR(body[body.length - 1], paint(c.dim, `↓ ${hidden} more `), width)
  }

  return { lines: layout(body, footer, height), cursor }
}

const detailLines = width => {
  const issue = state.detail
  const inner = Math.max(20, width - 2)
  const out = []
  for (const line of wrap(`${issue.ref} ${issue.title}`, inner)) out.push(paint(c.bold, line))
  const remote = REMOTES[issue.source]
  const meta = remote
    ? [...remote.meta(issue), `created ${ago(issue.createdAt)} ago`, `updated ${ago(issue.updatedAt)} ago`]
    : [issue.state, issue.author?.login ? `by ${issue.author.login}` : '', `opened ${ago(issue.createdAt)} ago`, `updated ${ago(issue.updatedAt)} ago`]
  for (const line of wrap(meta.filter(Boolean).join(' · '), inner)) out.push(paint(c.dim, line))
  if (issue.labels?.length) out.push(paint(c.yellow, `labels: ${labelText(issue)}`))
  if (issue.assignees?.length) out.push(paint(c.cyan, `${remote?.assigneeLabel ?? 'assignees'}: ${assigneeText(issue)}`))
  out.push(paint(c.dim, issue.url ?? ''))
  out.push('')
  const body = text => (state.rendered ? renderMarkdown(text, inner) : wrap(text, inner))
  if (!state.detailFull) out.push(paint(c.dim, 'Loading description…'))
  else if (issue.body?.trim()) out.push(...body(issue.body))
  else out.push(paint(c.dim, '(no description)'))
  for (const comment of issue.comments ?? []) {
    out.push('')
    out.push(paint(c.dim, `── ${comment.author?.login || 'someone'} · ${ago(comment.createdAt)} ago`))
    out.push(...body(comment.body))
  }

  return out
}

const detailFrame = (width, height) => {
  const issues = visibleIssues()
  const issue = state.detail
  const where = isRemote(issue) ? (sources[issue.source].workspace ?? '') : (target.repo ?? '')
  const body = [header(Noun(issue), { subtitle: where, right: issues.length ? `${state.cursor + 1}/${issues.length}` : '' }, width), rule(width)]
  const footerSize = 2
  const bodyRows = Math.max(1, height - body.length - footerSize)
  const lines = detailLines(width)
  state.scroll = Math.max(0, Math.min(state.scroll, Math.max(0, lines.length - bodyRows)))
  body.push(...lines.slice(state.scroll, state.scroll + bodyRows).map(line => ` ${line}`))
  const more = lines.length - state.scroll - bodyRows
  const footer = [state.message ? notice(state.message) : more > 0 ? paint(c.dim, ` ↓ ${more} more lines`) : '', hint(`s start · o browser · m ${state.rendered ? 'raw text' : 'markdown'} · j/k scroll · space page · Esc back · q quit`)]

  return layout(body, footer, height)
}

const settingsFrame = (width, height) => {
  const remote = REMOTES[state.tab]
  const { auth, me, workspace } = sources[state.tab]
  const row = (name, value) => ` ${paint(c.dim, name.padEnd(12))} ${value}`
  const body = [header(remote.name, { subtitle: workspace ?? '' }, width), rule(width), '']
  body.push(row('Account', me ? `@${me.handle}${me.name ? ` (${me.name})` : ''} in ${me.workspace}` : paint(c.dim, 'checking…')))
  body.push(row('Token', auth?.from === 'env' ? `from ${remote.tokenEnv}` : `saved in ${tildify(secretsPath())}`))
  for (const [name, text, placeholder] of remote.settingsRows(config)) body.push(row(name, placeholder ? paint(c.dim, text) : text))
  body.push('')
  if (auth?.from === 'env') body.push(paint(c.dim, ` The token comes from ${remote.tokenEnv}; change or unset it there to manage it here.`))
  const keys = auth?.from === 'env' ? 'Esc back · q quit' : state.confirmRemove ? 'y remove the token · any other key keeps it' : 'e replace token · x remove token · Esc back · q quit'
  const footer = [notice(state.confirmRemove ? `Remove the ${remote.name} token from ${tildify(secretsPath())}?` : state.message), hint(keys)]

  return layout(body, footer, height)
}

const filterFrame = (width, height) => {
  if (state.peoplePicker) {
    const { lines, cursor } = state.peoplePicker.lines(width, height - 2)

    return { lines: layout(lines, [notice(state.message), hint('Enter choose · ↑↓ / Tab move · type a name to filter · Esc back')], height), cursor }
  }
  const ids = filterRemotes()
  const rows = filterRows()
  const single = ids.length === 1 ? REMOTES[ids[0]] : null
  const title = single ? `${single.name} filter` : 'People filter'
  const where = ids.filter(id => sources[id].workspace).map(id => (single ? '' : `${REMOTES[id].name} `) + sources[id].workspace)
  const body = [header(title, { subtitle: where.join(' + ') }, width), rule(width), '']
  const labelWidth = Math.max(10, ...rows.map(row => row.name.length + 1))
  rows.forEach((row, index) => {
    const selected = index === state.filterRow
    const value = filterValueText(row.id, sources[row.id].filter[row.field])
    body.push(` ${selected ? paint(c.cyan, '›') : ' '} ${paint(c.dim, row.name.padEnd(labelWidth))} ${selected ? paint(c.bold, value) : value}`)
  })
  const explain = single
    ? `Only ${single.plural} with this ${single.filter.names.join(' and ')} are searched`
    : 'Each source searches only for the people set here'
  body.push('', paint(c.dim, ` ${explain}, and the choice is kept for next time.`))
  const footer = [notice(state.message), hint(`Enter change · ↑↓ move · x clear ${rows.length > 2 ? 'all' : 'both'} · Esc back`)]

  return layout(body, footer, height)
}

const render = (width, height) => {
  if (state.view === 'launch') return state.launcher.lines(width, height)
  if (state.view === 'filter') return filterFrame(width, height)
  if (state.view === 'detail') return detailFrame(width, height)
  if (state.view === 'settings') return settingsFrame(width, height)

  return listFrame(width, height)
}

// ── keys ────────────────────────────────────────────────────────────────────

const isTabKey = key => key === '\t' || key === '\x1b[Z'
const tabStep = key => (key === '\x1b[Z' ? -1 : 1)

const onTokenKey = key => {
  const { form } = sources[state.tab]
  if (isCtrlC(key)) return screen.exit(0)
  if (isTabKey(key)) return cycleTab(tabStep(key))
  if (form.checking) return
  if (isEsc(key)) {
    if (form.editing) {
      form.editing = false
      form.input = ''
      form.error = null
    } else if (form.input) form.input = ''
    else return screen.exit(0)

    return
  }
  if (isEnter(key)) return submitToken(state.tab)
  form.input = editLine(form.input, key)
  form.error = null
}

const onFilterKey = key => {
  if (isCtrlC(key)) return screen.exit(0)
  if (isEsc(key)) {
    state.filter = ''
    state.filtering = false
  } else if (isEnter(key)) state.filtering = false
  else if (isArrowDown(key)) state.cursor++
  else if (isArrowUp(key)) state.cursor--
  else {
    const before = state.filter
    state.filter = editLine(state.filter, key)
    if (state.filter !== before) state.cursor = 0
  }
  clampCursor()
}

const onListKey = key => {
  if (tokenFormActive()) return onTokenKey(key)
  if (state.filtering) return onFilterKey(key)
  if (key === 'q' || key === 'Q' || isCtrlC(key)) return screen.exit(0)
  if (isTabKey(key)) return cycleTab(tabStep(key))
  if (/^[1-9]$/.test(key) && Number(key) <= tabs.length) return switchTab(tabs[Number(key) - 1])
  if (isEsc(key)) {
    if (!state.filter) return screen.exit(0)
    state.filter = ''
  } else if (isDown(key)) state.cursor++
  else if (isUp(key)) state.cursor--
  else if (key === 'g' || key === '\x1b[H') state.cursor = 0
  else if (key === 'G' || key === '\x1b[F') state.cursor = Number.MAX_SAFE_INTEGER
  else if (isEnter(key) || key === 'l' || key === '\x1b[C') return openDetail()
  else if (key === 's' || key === 'S') return askStart()
  else if (key === 'o' || key === 'O') return openBrowser()
  else if (key === 'r' || key === 'R') return load({ force: true })
  else if (key === ',' && REMOTES[state.tab]) return openSettings()
  else if ((key === 'f' || key === 'F') && filterRemotes().length) return openFilter()
  else if (key === '/') {
    state.filtering = true
    state.message = ''
  } else if (key === 'c' || key === 'C') {
    state.showClosed = !state.showClosed

    return load({ force: true })
  }
  clampCursor()
}

const onDetailKey = key => {
  if (key === 'q' || key === 'Q' || isCtrlC(key)) return screen.exit(0)
  if (isEsc(key) || key === 'h' || key === '\x7f' || key === '\x1b[D') {
    state.view = 'list'
    state.message = ''

    return
  }
  if (isDown(key)) state.scroll++
  else if (isUp(key)) state.scroll = Math.max(0, state.scroll - 1)
  else if (key === ' ' || key === '\x1b[6~') state.scroll += Math.max(1, process.stdout.rows - 6)
  else if (key === '\x1b[5~') state.scroll = Math.max(0, state.scroll - Math.max(1, process.stdout.rows - 6))
  else if (key === 'g') state.scroll = 0
  else if (key === 'G') state.scroll = Number.MAX_SAFE_INTEGER
  else if (key === 'm' || key === 'M') {
    state.rendered = !state.rendered
    state.scroll = 0
  } else if (key === 's' || key === 'S') return askStart()
  else if (key === 'o' || key === 'O') return openBrowser()
}

const onSettingsKey = key => {
  if (isCtrlC(key)) return screen.exit(0)
  if (state.confirmRemove) {
    if (key === 'y' || key === 'Y') {
      try {
        removeToken(state.tab)
      } catch (error) {
        state.confirmRemove = false
        state.message = `could not remove the token: ${error.message}`
      }
    } else state.confirmRemove = false

    return
  }
  if (key === 'q' || key === 'Q') return screen.exit(0)
  if (isEsc(key) || key === 'h' || key === '\x7f') {
    state.view = 'list'
    state.message = ''

    return
  }
  const source = sources[state.tab]
  if (source.auth?.from === 'env') return
  if (key === 'e' || key === 'E') {
    source.form.editing = true
    source.form.input = ''
    source.form.error = null
    state.view = 'list'
  } else if (key === 'x' || key === 'X') state.confirmRemove = true
}

const onFilterScreenKey = key => {
  if (isCtrlC(key)) return screen.exit(0)
  if (state.peoplePicker) {
    const action = state.peoplePicker.key(key)
    if (action === 'cancel') state.peoplePicker = null
    if (action === 'pick') {
      const row = filterRows()[state.filterRow]
      if (row) setFilter(row.id, { ...sources[row.id].filter, [row.field]: state.peoplePicker.current().value })
      state.peoplePicker = null
    }

    return
  }
  state.message = ''
  if (isEsc(key) || key === 'q' || key === 'Q' || key === 'h') {
    state.view = 'list'

    return
  }
  const rows = filterRows()
  if (isDown(key) || key === '\t') state.filterRow = Math.min(rows.length - 1, state.filterRow + 1)
  else if (isUp(key) || key === '\x1b[Z') state.filterRow = Math.max(0, state.filterRow - 1)
  else if (isEnter(key) || key === 'l') openPeoplePicker()
  else if (key === 'x' || key === 'X') {
    for (const id of filterRemotes()) if (Object.values(sources[id].filter).some(Boolean)) setFilter(id, {})
  }
}

const onKey = key => {
  if (state.view === 'launch') return state.launcher.key(key)
  if (state.view === 'filter') return onFilterScreenKey(key)
  if (state.view === 'detail') return onDetailKey(key)
  if (state.view === 'settings') return onSettingsKey(key)

  return onListKey(key)
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  const wanted = String(args.values.source ?? 'github').toLowerCase()
  if (!TABS.includes(wanted)) {
    console.error(`unknown --source "${wanted}" (use ${TABS.slice(1).join(', ')} or all)`)
    process.exit(2)
  }
  const list = wanted === 'all' ? needed : [wanted]
  const closed = args.flags.has('closed')
  const out = { issues: [] }
  const problems = []
  if (list.includes('github')) {
    try {
      await resolveRepo()
      out.repo = target.repo
      out.url = target.url
      out.issues.push(...(await listIssues({ cwd: target.root, repo: target.repo }, { state: closed ? 'all' : 'open', limit: config.limit })))
    } catch (error) {
      problems.push(`GitHub: ${error.message}`)
    }
  }
  for (const id of list.filter(source => REMOTES[source])) {
    const remote = REMOTES[id]
    try {
      if (!sources[id].auth) throw new Error(notSetUp(remote).replace(`${remote.name} is `, ''))
      const token = sources[id].auth.token
      const [me, lookups] = await Promise.all([remote.whoami(token), remote.lookups(token)])
      out[id] = { workspace: me.workspace, team: remote.team(config) || null }
      // "me" is the token's owner.
      const asFilter = value => (value === 'me' ? ME : value)
      const filter = remote.filter.normalize(Object.fromEntries(remote.filter.names.map(field => [field, asFilter(args.values[field])])))
      out.issues.push(...(await remote.list(token, { config, closed, limit: config.limit, lookups, filter, me })))
    } catch (error) {
      problems.push(`${remote.name}: ${error.message}`)
    }
  }
  out.issues = mergeByUpdated([out.issues])
  for (const problem of problems) console.error(problem)
  if (problems.length && (wanted !== 'all' || problems.length === list.length)) process.exit(1)
  if (args.flags.has('json')) console.log(JSON.stringify(out, null, 2))
  else {
    const unit = REMOTES[wanted] ? [REMOTES[wanted].noun, REMOTES[wanted].plural] : [wanted === 'all' ? 'item' : 'issue']
    console.log(`${[out.repo, ...REMOTE_SOURCES.map(id => out[id]?.workspace)].filter(Boolean).join(' + ')} · ${plural(out.issues.length, ...unit)}`)
    for (const issue of out.issues) {
      const flags = [issue.closed ? 'closed' : '', isRemote(issue) ? stateText(issue) : '', labelText(issue)].filter(Boolean).join(', ')
      console.log(`${issue.ref.padEnd(8)} ${issue.title}${flags ? `  [${flags}]` : ''}`)
    }
  }
  process.exit(0)
}

// ── main ────────────────────────────────────────────────────────────────────

let screen = null
const draw = () => screen?.draw()
screen = createScreen({ render, onKey })
draw()
load()
agentKinds()
  .then(kinds => {
    state.kinds.splice(0, state.kinds.length, ...kinds)
  })
  .catch(() => {})
