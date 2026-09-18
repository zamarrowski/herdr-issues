// GitHub issues browser popup for the repository of the focused pane.
//   Enter read · s start · o open in browser · r refresh · c show closed · / filter · j/k move · q quit
// The repository comes from HERDR_PLUGIN_CONTEXT_JSON (focused pane cwd), or --cwd PATH / --repo owner/name.
// Without a TTY it prints the list (JSON with --json) and exits, which is handy for scripts and agents.
import { parseArgs } from '../lib/args.mjs'
import { readCache, writeCache } from '../lib/cache.mjs'
import { loadConfig } from '../lib/config.mjs'
import { pickCwd, pickRepo, readContext, resolveTarget } from '../lib/context.mjs'
import { ago, c, lineLR, pad, paint, plural, truncate, visibleWidth, wrap } from '../lib/format.mjs'
import { assigneeText, labelText, listIssues, openInBrowser, repoInfo, viewIssue } from '../lib/github.mjs'
import { FALLBACK_KINDS, agentKinds } from '../lib/herdr.mjs'
import { createLauncher } from '../lib/launch.mjs'
import { createScreen, editLine, header, hint, inputRow, isArrowDown, isArrowUp, isCtrlC, isDown, isEnter, isEsc, isUp, layout, notice, rule, window } from '../lib/tui.mjs'

const USAGE = 'usage: issues.mjs [--cwd PATH] [--repo owner/name] [--agent KIND] [--closed] [--json]'
const args = parseArgs(process.argv.slice(2), { flags: ['json', 'closed', 'help'], values: ['cwd', 'repo', 'agent'] })
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

const state = {
  issues: [],
  fetchedAt: null,
  loading: false,
  error: null,
  cursor: 0,
  view: 'list', // list | detail | launch
  showClosed: false,
  filter: '',
  filtering: false,
  detail: null,
  detailFull: false,
  scroll: 0,
  message: warnings.length ? `config.json: ${warnings[0]}` : '',
  kinds: [...FALLBACK_KINDS],
  launcher: null,
  launchFrom: 'list',
}

// ── data ────────────────────────────────────────────────────────────────────

const haystack = issue => `#${issue.number} ${issue.title} ${labelText(issue)} ${assigneeText(issue)} ${issue.author?.login ?? ''}`.toLowerCase()
const visibleIssues = () => {
  const query = state.filter.trim().toLowerCase()

  return query ? state.issues.filter(issue => haystack(issue).includes(query)) : state.issues
}
const current = () => visibleIssues()[state.cursor]
const clampCursor = () => {
  state.cursor = Math.max(0, Math.min(state.cursor, visibleIssues().length - 1))
}

const resolveRepo = async () => {
  if (!target.root && !target.repo) {
    throw new Error(`${target.cwd} is not inside a git repository. Open the popup from a pane inside a GitHub checkout, or pass --repo owner/name.`)
  }
  const info = await repoInfo({ cwd: target.root ?? undefined, repo: target.repo })
  target.repo = info.nameWithOwner
  target.url = info.url
  target.resolved = true
}

const load = async ({ force = false } = {}) => {
  if (state.loading) return
  state.loading = true
  state.error = null
  draw()
  try {
    if (!target.resolved) await resolveRepo()
    if (!force && state.issues.length === 0 && !state.showClosed) {
      const cached = readCache(target.repo)
      if (cached?.issues?.length) {
        state.issues = cached.issues
        state.fetchedAt = cached.fetchedAt
        draw()
      }
    }
    state.issues = await listIssues({ cwd: target.root, repo: target.repo }, { state: state.showClosed ? 'all' : 'open', limit: config.limit })
    state.fetchedAt = Date.now()
    if (!state.showClosed) writeCache(target.repo, { fetchedAt: state.fetchedAt, issues: state.issues })
    clampCursor()
  } catch (error) {
    state.error = error.message
  } finally {
    state.loading = false
    draw()
  }
}

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
    const full = await viewIssue({ cwd: target.root, repo: target.repo }, issue.number)
    if (state.view === 'detail' && state.detail?.number === issue.number) {
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
    await openInBrowser({ cwd: target.root, repo: target.repo }, issue.number)
    state.message = `Opened #${issue.number} in the browser`
  } catch (error) {
    state.message = error.message
  }
  draw()
}

const askStart = () => {
  const issue = state.view === 'detail' ? state.detail : current()
  if (!issue) return
  if (!target.root) {
    state.message = 'Starting needs a local checkout: open the popup from a pane inside the repository'

    return
  }
  state.launchFrom = state.view
  state.launcher = createLauncher({
    issue,
    repo: target.repo,
    target,
    config,
    configFile,
    kinds: state.kinds,
    focusedAgent: target.focusedAgent,
    explicitAgent: args.values.agent ?? null,
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

// ── rendering ───────────────────────────────────────────────────────────────

const issueLine = (issue, selected, widths) => {
  const pointer = selected ? paint(c.cyan, '›') : ' '
  const number = paint(issue.state === 'CLOSED' ? c.dim : c.green, pad(`#${issue.number}`, widths.number))
  const title = selected ? paint(c.bold, truncate(issue.title, widths.title)) : truncate(issue.title, widths.title)
  const labels = paint(c.yellow, pad(truncate(labelText(issue), widths.labels), widths.labels))
  const assignee = paint(c.cyan, pad(truncate(assigneeText(issue), widths.assignee), widths.assignee))
  const age = paint(c.dim, pad(ago(issue.updatedAt), 4, true))

  return ` ${pointer} ${number} ${pad(title, widths.title)} ${labels} ${assignee} ${age}`
}

const listFrame = (width, height) => {
  const issues = visibleIssues()
  const open = state.issues.filter(issue => issue.state !== 'CLOSED').length
  let right = state.loading ? 'loading…' : state.fetchedAt ? `updated ${ago(state.fetchedAt)} ago` : ''
  if (state.issues.length) right = `${open} open${state.showClosed ? ` · ${state.issues.length - open} closed` : ''} · ${right}`
  const body = [header('Issues', { subtitle: target.repo ?? target.cwd, right }, width), rule(width)]

  const footer = []
  let cursor = null
  if (state.filtering) {
    const input = inputRow('Filter:', state.filter, width)
    footer.push(input.text)
    cursor = { row: height - 1, col: input.cursorCol }
  } else footer.push(notice(state.message || (state.filter ? `filter: ${state.filter} (Esc clears)` : '')))
  footer.push(hint(`Enter read · s start · o browser · r refresh · c ${state.showClosed ? 'hide' : 'show'} closed · / filter · j/k move · q quit`))

  const listRows = Math.max(1, height - body.length - footer.length)
  if (state.error) body.push(paint(c.red, ` ${state.error}`))
  else if (issues.length === 0) body.push(paint(c.dim, state.loading ? ' Loading issues…' : state.filter ? ' No issues match the filter.' : ' No open issues.'))
  else {
    const widths = { number: Math.max(...issues.map(issue => `#${issue.number}`.length)) }
    widths.labels = Math.min(22, Math.max(0, ...issues.map(issue => visibleWidth(labelText(issue)))))
    widths.assignee = Math.min(14, Math.max(0, ...issues.map(issue => visibleWidth(assigneeText(issue)))))
    widths.title = Math.max(10, width - 2 - 1 - widths.number - 1 - 1 - widths.labels - 1 - widths.assignee - 1 - 4 - 1)
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
  for (const line of wrap(`#${issue.number} ${issue.title}`, inner)) out.push(paint(c.bold, line))
  const meta = [issue.state, issue.author?.login ? `by ${issue.author.login}` : '', `opened ${ago(issue.createdAt)} ago`, `updated ${ago(issue.updatedAt)} ago`].filter(Boolean).join(' · ')
  out.push(paint(c.dim, meta))
  if (issue.labels?.length) out.push(paint(c.yellow, `labels: ${labelText(issue)}`))
  if (issue.assignees?.length) out.push(paint(c.cyan, `assignees: ${assigneeText(issue)}`))
  out.push(paint(c.dim, issue.url ?? ''))
  out.push('')
  if (!state.detailFull) out.push(paint(c.dim, 'Loading description…'))
  else if (issue.body?.trim()) out.push(...wrap(issue.body, inner))
  else out.push(paint(c.dim, '(no description)'))
  for (const comment of issue.comments ?? []) {
    out.push('')
    out.push(paint(c.dim, `── ${comment.author?.login ?? 'someone'} · ${ago(comment.createdAt)} ago`))
    out.push(...wrap(comment.body, inner))
  }

  return out
}

const detailFrame = (width, height) => {
  const issues = visibleIssues()
  const body = [header('Issue', { subtitle: target.repo ?? '', right: issues.length ? `${state.cursor + 1}/${issues.length}` : '' }, width), rule(width)]
  const footerSize = 2
  const bodyRows = Math.max(1, height - body.length - footerSize)
  const lines = detailLines(width)
  state.scroll = Math.max(0, Math.min(state.scroll, Math.max(0, lines.length - bodyRows)))
  body.push(...lines.slice(state.scroll, state.scroll + bodyRows).map(line => ` ${line}`))
  const more = lines.length - state.scroll - bodyRows
  const footer = [state.message ? notice(state.message) : more > 0 ? paint(c.dim, ` ↓ ${more} more lines`) : '', hint('s start · o browser · j/k scroll · space page · Esc back · q quit')]

  return layout(body, footer, height)
}

const render = (width, height) => {
  if (state.view === 'launch') return state.launcher.lines(width, height)
  if (state.view === 'detail') return detailFrame(width, height)

  return listFrame(width, height)
}

// ── keys ────────────────────────────────────────────────────────────────────

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
  if (state.filtering) return onFilterKey(key)
  if (key === 'q' || key === 'Q' || isCtrlC(key)) return screen.exit(0)
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
  else if (key === 's' || key === 'S') return askStart()
  else if (key === 'o' || key === 'O') return openBrowser()
}

const onKey = key => {
  if (state.view === 'launch') return state.launcher.key(key)
  if (state.view === 'detail') return onDetailKey(key)

  return onListKey(key)
}

// ── main ────────────────────────────────────────────────────────────────────

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  try {
    await resolveRepo()
    const issues = await listIssues({ cwd: target.root, repo: target.repo }, { state: args.flags.has('closed') ? 'all' : 'open', limit: config.limit })
    if (args.flags.has('json')) console.log(JSON.stringify({ repo: target.repo, url: target.url, issues }, null, 2))
    else {
      console.log(`${target.repo} · ${plural(issues.length, 'issue')}`)
      for (const issue of issues) {
        const flags = [issue.state === 'CLOSED' ? 'closed' : '', labelText(issue)].filter(Boolean).join(', ')
        console.log(`#${String(issue.number).padEnd(5)} ${issue.title}${flags ? `  [${flags}]` : ''}`)
      }
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
  process.exit(0)
}

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
