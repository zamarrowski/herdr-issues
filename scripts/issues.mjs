// Issues browser popup: GitHub issues of the focused pane's repository and Shortcut stories, in tabs
// (All · GitHub · Shortcut, as configured in `tabs`).
//   Tab/1-3 switch tabs · Enter read · s start · o open in browser · r refresh · c show closed · / filter · j/k move · q quit
//   On the Shortcut tab: the token form when no token is set, `f` for the owner / requester filter (remembered),
//   `,` for the Shortcut settings (edit or remove the token).
// The repository comes from HERDR_PLUGIN_CONTEXT_JSON (focused pane cwd), or --cwd PATH / --repo owner/name.
// Without a TTY it prints the list (JSON with --json) and exits, which is handy for scripts and agents.
import { parseArgs } from '../lib/args.mjs'
import { clearCaches, readCache, readUiState, writeCache, writeUiState } from '../lib/cache.mjs'
import { loadConfig } from '../lib/config.mjs'
import { pickCwd, pickRepo, readContext, repoCandidates, resolveTarget } from '../lib/context.mjs'
import { ago, c, lineLR, pad, paint, plural, tildify, truncate, visibleWidth, wrap } from '../lib/format.mjs'
import { listIssues, openInBrowser, repoInfo, viewIssue } from '../lib/github.mjs'
import { FALLBACK_KINDS, agentKinds, workspaceList } from '../lib/herdr.mjs'
import { createLauncher } from '../lib/launch.mjs'
import { renderMarkdown } from '../lib/markdown.mjs'
import { secretsPath } from '../lib/paths.mjs'
import { openUrl } from '../lib/proc.mjs'
import { removeSecret, saveSecret } from '../lib/secrets.mjs'
import { ME, SECRET_KEY, TOKEN_ENV, currentMember, filterText, getStory, listStories, loadLookups, normalizeFilter, resolveFilter, shortcutToken } from '../lib/shortcut.mjs'
import { Noun, TABS, TAB_NAMES, assigneeText, haystack, labelText, mergeByUpdated, sourcesOf, stateText, visibleTabs } from '../lib/sources.mjs'
import { createPicker, createScreen, editLine, header, hint, inputRow, isArrowDown, isArrowUp, isCtrlC, isDown, isEnter, isEsc, isUp, layout, notice, rule, window } from '../lib/tui.mjs'

const USAGE = 'usage: issues.mjs [--source github|shortcut|all] [--owner NAME|me] [--requester NAME|me] [--cwd PATH] [--repo owner/name] [--agent KIND] [--closed] [--json]'
const args = parseArgs(process.argv.slice(2), { flags: ['json', 'closed', 'help'], values: ['cwd', 'repo', 'agent', 'source', 'owner', 'requester'] })
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
const remembered = readUiState()

const state = {
  tab: tabs.includes(remembered.tab) ? remembered.tab : tabs[0],
  cursor: 0,
  view: 'list', // list | detail | settings | launch
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
  scFilter: normalizeFilter(remembered.shortcut_filter), // { owner, requester }: null | ME | mention
  filterRow: 0, // 0 owner, 1 requester, on the filter screen
  peoplePicker: null,
}

const sources = {
  github: { items: [], fetchedAt: null, loading: false, error: null },
  shortcut: {
    items: [],
    fetchedAt: null,
    loading: false,
    error: null,
    auth: shortcutToken(), // { token, from: 'env' | 'file' } | null
    me: null, // { mention, name, workspace }
    workspace: null,
    lookups: null,
    form: { input: '', checking: false, error: null, editing: false },
  },
}
const shortcut = sources.shortcut
// One cached list per team and people filter, so switching the filter paints instantly too.
const shortcutCacheKey = () => `shortcut:${config.shortcut?.team || 'all'}:${state.scFilter.owner ?? '-'}:${state.scFilter.requester ?? '-'}`

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
// The Shortcut tab shows the token form instead of the list while no token is set (or while editing it).
const tokenFormActive = () => state.tab === 'shortcut' && (!shortcut.auth || shortcut.form.editing)

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

const loadShortcut = async ({ force = false } = {}) => {
  if (!shortcut.auth) return
  if (shortcut.loading) {
    shortcut.reload = true // a newer request (another filter) waits for this one

    return
  }
  shortcut.loading = true
  shortcut.error = null
  draw()
  try {
    if (!force && shortcut.items.length === 0 && !state.showClosed) {
      const cached = readCache(shortcutCacheKey())
      if (cached?.issues?.length) {
        shortcut.items = cached.issues
        shortcut.fetchedAt = cached.fetchedAt
        shortcut.workspace = cached.workspace ?? null
        shortcut.lookups = cached.lookups ?? null
        draw()
      }
    }
    const { token } = shortcut.auth
    const [me, lookups] = await Promise.all([shortcut.me ?? currentMember(token), loadLookups(token)])
    shortcut.me = me
    shortcut.workspace = me.workspace
    shortcut.lookups = lookups
    const filter = { ...state.scFilter }
    const items = await listStories(token, { query: config.shortcut.query, team: config.shortcut.team, closed: state.showClosed, limit: config.limit, lookups, ...resolveFilter(filter, me) })
    if (filter.owner !== state.scFilter.owner || filter.requester !== state.scFilter.requester) return // the filter changed meanwhile
    shortcut.items = items
    shortcut.fetchedAt = Date.now()
    if (!state.showClosed) writeCache(shortcutCacheKey(), { fetchedAt: shortcut.fetchedAt, issues: shortcut.items, workspace: shortcut.workspace, lookups })
  } catch (error) {
    shortcut.error = error.message
  } finally {
    shortcut.loading = false
    clampCursor()
    draw()
    if (shortcut.reload) {
      shortcut.reload = false
      loadShortcut()
    }
  }
}

const load = ({ force = false } = {}) =>
  Promise.all([needed.includes('github') ? loadGithub({ force }) : null, needed.includes('shortcut') ? loadShortcut({ force }) : null])

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
    const full =
      issue.source === 'shortcut'
        ? await getStory(shortcut.auth?.token, issue.number, { lookups: shortcut.lookups ?? {} })
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
    if (issue.source === 'shortcut') await openUrl(issue.url)
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
  const story = issue.source === 'shortcut'
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
    // Nothing ties a story to a repository: ask, with the pane's repository preselected.
    loadRepos: story ? async () => repoCandidates(await workspaceList(), { workspaceId: context.workspace_id ?? null, root: target.root }) : null,
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

// ── Shortcut token ──────────────────────────────────────────────────────────

const submitToken = async () => {
  const { form } = shortcut
  const token = form.input.trim()
  if (!token || form.checking) return
  form.checking = true
  form.error = null
  draw()
  try {
    const me = await currentMember(token)
    saveSecret(SECRET_KEY, token)
    clearCaches('shortcut:')
    Object.assign(shortcut, { auth: { token, from: 'file' }, me, workspace: me.workspace, items: [], fetchedAt: null, error: null })
    form.input = ''
    form.editing = false
    state.message = `Shortcut connected: @${me.mention} in ${me.workspace}`
    loadShortcut({ force: true })
  } catch (error) {
    form.error = error.message
  } finally {
    form.checking = false
    draw()
  }
}

const removeToken = () => {
  removeSecret(SECRET_KEY)
  clearCaches('shortcut:')
  Object.assign(shortcut, { auth: shortcutToken(), me: null, workspace: null, lookups: null, items: [], fetchedAt: null, error: null })
  state.confirmRemove = false
  state.view = 'list'
  state.cursor = 0
  state.message = 'Shortcut token removed'
}

// ── Shortcut people filter ──────────────────────────────────────────────────

const FILTER_FIELDS = [
  ['owner', 'Owner'],
  ['requester', 'Requester'],
]
const filterValueText = value => (value === ME ? `me${shortcut.me ? ` (@${shortcut.me.mention})` : ''}` : value ? `@${value}` : 'anyone')
const shortcutFilterAvailable = () => shortcut.auth && (state.tab === 'shortcut' || (state.tab === 'all' && needed.includes('shortcut')))

const openFilter = () => {
  state.view = 'sc-filter'
  state.peoplePicker = null
  state.message = ''
}

const setFilter = next => {
  state.scFilter = normalizeFilter(next)
  writeUiState({ shortcut_filter: state.scFilter })
  Object.assign(shortcut, { items: [], fetchedAt: null, error: null })
  state.cursor = 0
  loadShortcut()
}

const openPeoplePicker = () => {
  const people = shortcut.lookups?.people
  if (!people) {
    state.message = 'The members of the workspace are still loading'

    return
  }
  const [field, name] = FILTER_FIELDS[state.filterRow]
  const items = [
    { id: 'anyone', note: 'no filter', value: null },
    { id: 'me', note: shortcut.me ? `@${shortcut.me.mention}` : 'the owner of the token', value: ME },
    ...people.map(person => ({ id: `@${person.mention}`, note: person.name, value: person.mention })),
  ]
  state.peoplePicker = createPicker({ items, title: `${name} of the stories`, empty: 'nobody matches', matchNote: true })
  const current = items.findIndex(item => item.value === (state.scFilter[field] ?? null))
  if (current >= 0) state.peoplePicker.state.cursor = current
}

const openSettings = () => {
  state.view = 'settings'
  state.confirmRemove = false
  state.message = ''
  if (shortcut.auth && !shortcut.me) {
    currentMember(shortcut.auth.token)
      .then(me => {
        shortcut.me = me
      })
      .catch(error => {
        state.message = error.message
      })
      .finally(draw)
  }
}

// ── rendering ───────────────────────────────────────────────────────────────

const noun = tab => (tab === 'shortcut' ? 'stories' : tab === 'github' ? 'issues' : 'issues or stories')

const tabBar = width => {
  const count = tab => {
    const list = tab === 'all' ? needed.map(source => sources[source]) : [sources[tab]]
    if (tab === 'shortcut' && !shortcut.auth) return ''
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

const subtitle = tab => {
  const people = filterText(state.scFilter)
  const shortcutText = shortcut.workspace ? `${shortcut.workspace}${config.shortcut.team ? ` (${config.shortcut.team})` : ''}${people ? ` · ${people}` : ''}` : ''
  if (tab === 'github') return target.repo ?? target.cwd
  if (tab === 'shortcut') return shortcutText || 'Shortcut'

  return [needed.includes('github') ? target.repo : '', needed.includes('shortcut') ? shortcutText : ''].filter(Boolean).join(' + ')
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

const tokenFormLines = width => {
  const { form } = shortcut
  const masked = '•'.repeat(Math.min([...form.input].length, 48))
  const input = inputRow('API token:', masked, width)
  const lines = [
    '',
    paint(c.bold, form.editing ? ' Replace the Shortcut API token' : ' Connect Shortcut'),
    '',
    ' Create a token in Shortcut under Settings → Your account → API Tokens, paste it here and press Enter.',
    paint(c.dim, ` It is checked against the API, then saved in ${tildify(secretsPath())} (readable by you only).`),
    paint(c.dim, ` ${TOKEN_ENV}, when set, takes precedence.`),
    '',
    input.text,
    '',
  ]
  if (form.checking) lines.push(paint(c.dim, ' Checking the token…'))
  else if (form.error) lines.push(paint(c.red, ` ${form.error}`))

  return { lines, cursorRow: 8, cursorCol: input.cursorCol }
}

// One line per source that has something to say in the All tab (not set up, failed).
const sourceNotes = () => {
  const notes = []
  if (needed.includes('github') && sources.github.error) notes.push(paint(c.dim, ` GitHub: ${sources.github.error}`))
  if (needed.includes('shortcut')) {
    if (!shortcut.auth) notes.push(paint(c.dim, ` Shortcut is not set up: open the Shortcut tab (${tabs.indexOf('shortcut') >= 0 ? tabs.indexOf('shortcut') + 1 : 'add it to "tabs"'}) to add a token.`))
    else if (shortcut.error) notes.push(paint(c.dim, ` Shortcut: ${shortcut.error}`))
  }

  return notes
}

const listFrame = (width, height) => {
  const tab = state.tab
  const body = [header('Issues', { subtitle: subtitle(tab), right: headerRight(tab) }, width), tabBar(width), rule(width)]
  const footer = []
  let cursor = null

  if (tokenFormActive()) {
    const form = tokenFormLines(width)
    cursor = { row: body.length + form.cursorRow, col: form.cursorCol }
    body.push(...form.lines)
    footer.push(notice(state.message), hint(`Enter save${shortcut.form.editing ? ' · Esc cancel' : ''} · Tab switch tab · Ctrl+U clear · Ctrl+C quit`))

    return { lines: layout(body, footer, height), cursor }
  }

  if (state.filtering) {
    const input = inputRow('Filter:', state.filter, width)
    footer.push(input.text)
    cursor = { row: height - 1, col: input.cursorCol }
  } else footer.push(notice(state.message || (state.filter ? `filter: ${state.filter} (Esc clears)` : '')))
  footer.push(hint(`Tab switch · Enter read · s start · o browser · r refresh · c ${state.showClosed ? 'hide' : 'show'} closed · / filter · q quit`))
  if (shortcutFilterAvailable()) {
    const people = filterText(state.scFilter)
    footer.push(hint(`Shortcut: f owner/requester${people ? ` (${people})` : ''}${tab === 'shortcut' ? ' · , settings' : ''}`))
  }

  const issues = visibleIssues()
  const error = tab === 'all' ? null : sources[tab].error
  if (tab === 'all') body.push(...sourceNotes())
  const listRows = Math.max(1, height - body.length - footer.length)
  const loading = (tab === 'all' ? needed.map(source => sources[source]) : [sources[tab]]).some(source => source.loading)
  if (error) body.push(...wrap(error, Math.max(20, width - 2)).map(line => paint(c.red, ` ${line}`)))
  else if (issues.length === 0) {
    const people = tab === 'shortcut' && filterText(state.scFilter) ? ` for ${filterText(state.scFilter)} (f changes it)` : ''
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
  const story = issue.source === 'shortcut'
  const inner = Math.max(20, width - 2)
  const out = []
  for (const line of wrap(`${issue.ref} ${issue.title}`, inner)) out.push(paint(c.bold, line))
  const meta = story
    ? [
        issue.stateName,
        issue.type,
        issue.estimate !== null && issue.estimate !== undefined ? `estimate ${issue.estimate}` : '',
        issue.author?.login ? `requested by ${issue.author.login}` : '',
        `created ${ago(issue.createdAt)} ago`,
        `updated ${ago(issue.updatedAt)} ago`,
      ]
    : [issue.state, issue.author?.login ? `by ${issue.author.login}` : '', `opened ${ago(issue.createdAt)} ago`, `updated ${ago(issue.updatedAt)} ago`]
  out.push(paint(c.dim, meta.filter(Boolean).join(' · ')))
  if (issue.labels?.length) out.push(paint(c.yellow, `labels: ${labelText(issue)}`))
  if (issue.assignees?.length) out.push(paint(c.cyan, `${story ? 'owners' : 'assignees'}: ${assigneeText(issue)}`))
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
  const where = issue.source === 'shortcut' ? (shortcut.workspace ?? '') : (target.repo ?? '')
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
  const auth = shortcut.auth
  const me = shortcut.me
  const row = (name, value) => ` ${paint(c.dim, name.padEnd(12))} ${value}`
  const body = [header('Shortcut', { subtitle: shortcut.workspace ?? '' }, width), rule(width), '']
  body.push(row('Account', me ? `@${me.mention}${me.name ? ` (${me.name})` : ''} in ${me.workspace}` : paint(c.dim, 'checking…')))
  body.push(row('Token', auth?.from === 'env' ? `from ${TOKEN_ENV}` : `saved in ${tildify(secretsPath())}`))
  body.push(row('Team', config.shortcut.team || paint(c.dim, 'every team (set "shortcut.team" in config.json to narrow it)')))
  body.push(row('Query', config.shortcut.query))
  body.push('')
  if (auth?.from === 'env') body.push(paint(c.dim, ` The token comes from ${TOKEN_ENV}; change or unset it there to manage it here.`))
  const keys = auth?.from === 'env' ? 'Esc back · q quit' : state.confirmRemove ? 'y remove the token · any other key keeps it' : 'e replace token · x remove token · Esc back · q quit'
  const footer = [notice(state.confirmRemove ? `Remove the Shortcut token from ${tildify(secretsPath())}?` : state.message), hint(keys)]

  return layout(body, footer, height)
}

const filterFrame = (width, height) => {
  if (state.peoplePicker) {
    const { lines, cursor } = state.peoplePicker.lines(width, height - 2)

    return { lines: layout(lines, [notice(state.message), hint('Enter choose · ↑↓ / Tab move · type a name to filter · Esc back')], height), cursor }
  }
  const body = [header('Shortcut filter', { subtitle: shortcut.workspace ?? '' }, width), rule(width), '']
  FILTER_FIELDS.forEach(([field, name], index) => {
    const selected = index === state.filterRow
    const value = filterValueText(state.scFilter[field])
    body.push(` ${selected ? paint(c.cyan, '›') : ' '} ${paint(c.dim, name.padEnd(10))} ${selected ? paint(c.bold, value) : value}`)
  })
  body.push('', paint(c.dim, ' Only stories with this owner and requester are searched, and the choice is kept for next time.'))
  const footer = [notice(state.message), hint('Enter change · ↑↓ move · x clear both · Esc back')]

  return layout(body, footer, height)
}

const render = (width, height) => {
  if (state.view === 'launch') return state.launcher.lines(width, height)
  if (state.view === 'sc-filter') return filterFrame(width, height)
  if (state.view === 'detail') return detailFrame(width, height)
  if (state.view === 'settings') return settingsFrame(width, height)

  return listFrame(width, height)
}

// ── keys ────────────────────────────────────────────────────────────────────

const isTabKey = key => key === '\t' || key === '\x1b[Z'
const tabStep = key => (key === '\x1b[Z' ? -1 : 1)

const onTokenKey = key => {
  const { form } = shortcut
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
  if (isEnter(key)) return submitToken()
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
  else if (key === ',' && state.tab === 'shortcut') return openSettings()
  else if ((key === 'f' || key === 'F') && shortcutFilterAvailable()) return openFilter()
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
        removeToken()
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
  if (shortcut.auth?.from === 'env') return
  if (key === 'e' || key === 'E') {
    shortcut.form.editing = true
    shortcut.form.input = ''
    shortcut.form.error = null
    state.view = 'list'
  } else if (key === 'x' || key === 'X') state.confirmRemove = true
}

const onFilterScreenKey = key => {
  if (isCtrlC(key)) return screen.exit(0)
  if (state.peoplePicker) {
    const action = state.peoplePicker.key(key)
    if (action === 'cancel') state.peoplePicker = null
    if (action === 'pick') {
      const [field] = FILTER_FIELDS[state.filterRow]
      setFilter({ ...state.scFilter, [field]: state.peoplePicker.current().value })
      state.peoplePicker = null
    }

    return
  }
  state.message = ''
  if (isEsc(key) || key === 'q' || key === 'Q' || key === 'h') {
    state.view = 'list'

    return
  }
  if (isDown(key) || key === '\t') state.filterRow = Math.min(FILTER_FIELDS.length - 1, state.filterRow + 1)
  else if (isUp(key) || key === '\x1b[Z') state.filterRow = Math.max(0, state.filterRow - 1)
  else if (isEnter(key) || key === 'l') openPeoplePicker()
  else if ((key === 'x' || key === 'X') && (state.scFilter.owner || state.scFilter.requester)) setFilter({ owner: null, requester: null })
}

const onKey = key => {
  if (state.view === 'launch') return state.launcher.key(key)
  if (state.view === 'sc-filter') return onFilterScreenKey(key)
  if (state.view === 'detail') return onDetailKey(key)
  if (state.view === 'settings') return onSettingsKey(key)

  return onListKey(key)
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  const wanted = String(args.values.source ?? 'github').toLowerCase()
  if (!TABS.includes(wanted)) {
    console.error(`unknown --source "${wanted}" (use github, shortcut or all)`)
    process.exit(2)
  }
  const closed = args.flags.has('closed')
  const out = { issues: [] }
  const problems = []
  if (wanted !== 'shortcut') {
    try {
      await resolveRepo()
      out.repo = target.repo
      out.url = target.url
      out.issues.push(...(await listIssues({ cwd: target.root, repo: target.repo }, { state: closed ? 'all' : 'open', limit: config.limit })))
    } catch (error) {
      problems.push(`GitHub: ${error.message}`)
    }
  }
  if (wanted !== 'github') {
    try {
      if (!shortcut.auth) throw new Error(`not set up: add a token in the Shortcut tab of the issues popup, or set ${TOKEN_ENV}`)
      const token = shortcut.auth.token
      const [me, lookups] = await Promise.all([currentMember(token), loadLookups(token)])
      out.shortcut = { workspace: me.workspace, team: config.shortcut.team || null }
      const asFilter = value => (value === 'me' ? ME : value)
      const people = resolveFilter(normalizeFilter({ owner: asFilter(args.values.owner), requester: asFilter(args.values.requester) }), me)
      out.issues.push(...(await listStories(token, { query: config.shortcut.query, team: config.shortcut.team, closed, limit: config.limit, lookups, ...people })))
    } catch (error) {
      problems.push(`Shortcut: ${error.message}`)
    }
  }
  out.issues = mergeByUpdated([out.issues])
  for (const problem of problems) console.error(problem)
  if (problems.length && (wanted !== 'all' || problems.length === 2)) process.exit(1)
  if (args.flags.has('json')) console.log(JSON.stringify(out, null, 2))
  else {
    const unit = { github: ['issue'], shortcut: ['story', 'stories'], all: ['item'] }[wanted]
    console.log(`${[out.repo, out.shortcut?.workspace].filter(Boolean).join(' + ')} · ${plural(out.issues.length, ...unit)}`)
    for (const issue of out.issues) {
      const flags = [issue.closed ? 'closed' : '', issue.source === 'shortcut' ? stateText(issue) : '', labelText(issue)].filter(Boolean).join(', ')
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
