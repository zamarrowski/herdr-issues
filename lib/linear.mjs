// Linear issues through the GraphQL API, with Node's global fetch (no dependency), and the adapter that
// plugs them into the popups (`remote`, listed in lib/remotes.mjs).
//
// The API key comes from LINEAR_API_KEY or from secrets.json, where the popup saves the one you type.
// It is sent in the Authorization header to the API host only, and never logged, cached or printed.
// Records are normalised to the shape the popups use for GitHub issues (see lib/sources.mjs).
import { ApiError, ME, byUpdatedDesc, checklist, fetchJson, notSetUp, peopleFilter, tokenFrom } from './integration.mjs'

export const TOKEN_ENV = 'LINEAR_API_KEY'
export const SECRET_KEY = 'linear_token'

// HERDR_ISSUES_LINEAR_API points the client at another server (the tests use a local one).
export const apiUrl = (env = process.env) => env.HERDR_ISSUES_LINEAR_API || 'https://api.linear.app/graphql'

export const linearToken = ({ env = process.env, file } = {}) => tokenFrom({ envName: TOKEN_ENV, secretKey: SECRET_KEY, env, file })

const NAMES = { name: 'Linear', tokenName: 'API key', tokenEnv: TOKEN_ENV }
const REJECTED = 'Linear rejected the API key'
const RATE_LIMITED = 'Linear rate limit reached, try again in a few minutes'

// GraphQL answers errors with HTTP 200 (or 400) and an `errors` array: turn the first one into a message.
const graphqlFailure = (errors, what) => {
  const first = errors[0] ?? {}
  const code = first.extensions?.code ?? ''
  const message = String(first.message ?? '')
  if (code === 'AUTHENTICATION_ERROR' || /authenticat/i.test(message)) return new ApiError(REJECTED, { status: 401 })
  if (code === 'RATELIMITED') return new ApiError(RATE_LIMITED, { status: 429 })
  if (/entity not found|could not find/i.test(message)) return new ApiError(`${what} not found`, { status: 404 })

  return new ApiError(`Linear answered: ${first.extensions?.userPresentableMessage || message || 'unknown error'}`)
}

// Runs one query. `what` names the thing being read, for "… not found".
export const request = async (query, variables = {}, { token, url = apiUrl(), timeoutMs = 20_000, what = 'Linear resource' } = {}) => {
  if (!token) throw new ApiError(notSetUp(NAMES))
  const { status, ok, data: body } = await fetchJson(url, {
    service: 'Linear',
    method: 'POST',
    headers: { Authorization: token },
    body: { query, variables },
    timeoutMs,
    rejected: REJECTED,
    rateLimited: RATE_LIMITED,
  })
  if (Array.isArray(body?.errors) && body.errors.length) throw graphqlFailure(body.errors, what)
  if (!ok || !body?.data) throw new ApiError(`Linear answered ${status}`, { status })

  return body.data
}

// { handle, name, workspace, organization } of the key's owner. Also the cheapest way to check a key.
export const viewer = async (token, options = {}) => {
  const data = await request('query Viewer { viewer { id name displayName organization { name urlKey } } }', {}, { ...options, token, what: 'viewer' })
  const me = data.viewer ?? {}

  return { handle: me.displayName ?? '', name: me.name ?? '', workspace: me.organization?.urlKey ?? '', organization: me.organization?.name ?? '' }
}

export const listTeams = async (token, options = {}) => {
  const data = await request('query Teams { teams(first: 250) { nodes { key name } } }', {}, { ...options, token })

  return (data.teams?.nodes ?? []).map(team => ({ key: team.key, name: team.name }))
}

// The people the filter can pick: active members of the workspace, by display name.
export const loadLookups = async (token, options = {}) => {
  const data = await request('query Users { users(first: 250) { nodes { displayName name active } } }', {}, { ...options, token })
  const people = (data.users?.nodes ?? [])
    .filter(user => user.active !== false && user.displayName)
    .map(user => ({ handle: user.displayName, name: user.name ?? '' }))
    .sort((a, b) => a.handle.localeCompare(b.handle))

  return { people }
}

const CLOSED_TYPES = ['completed', 'canceled']

const userFilter = value => (value === ME ? { isMe: { eq: true } } : { displayName: { eq: value } })

// The IssueFilter of the list: the team (key or name) when set, not completed or canceled unless closed
// issues are wanted, the people filter (display names, or ME), and the `linear.filter` conditions on top.
export const buildFilter = ({ team = '', closed = false, assignee = null, creator = null, extra = null } = {}) => {
  const parts = []
  if (team) parts.push({ team: { or: [{ key: { eqIgnoreCase: team } }, { name: { eqIgnoreCase: team } }] } })
  if (!closed) parts.push({ state: { type: { nin: CLOSED_TYPES } } })
  if (assignee) parts.push({ assignee: userFilter(assignee) })
  if (creator) parts.push({ creator: userFilter(creator) })
  if (extra && typeof extra === 'object' && !Array.isArray(extra) && Object.keys(extra).length) parts.push(extra)

  return parts.length ? { and: parts } : {}
}

export const workspaceOfUrl = url => /^https?:\/\/linear\.app\/([^/]+)\//i.exec(String(url ?? ''))?.[1] ?? null

const LIST_FIELDS = `id identifier number title url branchName priority priorityLabel estimate createdAt updatedAt
  state { name type } assignee { displayName } creator { displayName } labels(first: 20) { nodes { name } }`
const VIEW_FIELDS = `${LIST_FIELDS} description project { name } cycle { number name } parent { identifier title }
  children(first: 50) { nodes { identifier title state { type } } }
  comments(first: 100) { nodes { body createdAt user { displayName } botActor { name } } }`

// A Linear issue (list or full fields) → the record the popups and the start flow use.
export const normalizeIssue = issue => {
  const closed = CLOSED_TYPES.includes(issue.state?.type)
  const record = {
    source: 'linear',
    number: issue.number,
    ref: issue.identifier,
    id: issue.id,
    title: issue.title ?? '',
    url: issue.url ?? '',
    closed,
    state: closed ? 'CLOSED' : 'OPEN',
    stateName: issue.state?.name ?? '',
    priority: issue.priority ? (issue.priorityLabel ?? null) : null,
    estimate: typeof issue.estimate === 'number' ? issue.estimate : null,
    labels: (issue.labels?.nodes ?? []).map(label => ({ name: label.name })),
    assignees: issue.assignee?.displayName ? [{ login: issue.assignee.displayName }] : [],
    author: { login: issue.creator?.displayName ?? '' },
    createdAt: issue.createdAt ?? null,
    updatedAt: issue.updatedAt ?? issue.createdAt ?? null,
    workspace: workspaceOfUrl(issue.url),
    vcsBranch: issue.branchName ?? '',
  }
  if (issue.description === undefined && issue.comments === undefined) return record

  const cycle = issue.cycle ? issue.cycle.name || `Cycle ${issue.cycle.number}` : null
  const children = checklist(
    'Sub-issues',
    (issue.children?.nodes ?? []).filter(child => child?.identifier).map(child => ({ done: CLOSED_TYPES.includes(child.state?.type), text: `${child.identifier} ${child.title ?? ''}` })),
  )

  return {
    ...record,
    project: issue.project?.name ?? null,
    cycle,
    parent: issue.parent?.identifier ?? null,
    body: [String(issue.description ?? '').trim(), children].filter(Boolean).join('\n\n'),
    comments: (issue.comments?.nodes ?? [])
      .filter(comment => comment.body)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .map(comment => ({ author: { login: comment.user?.displayName || comment.botActor?.name || '' }, body: comment.body, createdAt: comment.createdAt })),
  }
}

const LIST_QUERY = `query Issues($first: Int!, $after: String, $filter: IssueFilter) {
  issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) { nodes { ${LIST_FIELDS} } pageInfo { hasNextPage endCursor } }
}`

// Issues matching the filter, newest updated first, up to `limit`, following the cursor page by page.
export const listIssues = async (token, { team = '', closed = false, assignee = null, creator = null, extra = null, limit = 100, ...options } = {}) => {
  const filter = buildFilter({ team, closed, assignee, creator, extra })
  const issues = []
  let after = null
  do {
    const data = await request(LIST_QUERY, { first: Math.min(50, limit - issues.length), after, filter }, { ...options, token, what: 'issues' })
    issues.push(...(data.issues?.nodes ?? []))
    after = data.issues?.pageInfo?.hasNextPage ? data.issues.pageInfo.endCursor : null
  } while (after && issues.length < limit)

  return issues.slice(0, limit).map(normalizeIssue).sort(byUpdatedDesc)
}

// `ref` is the identifier ("ENG-123"): Linear accepts it wherever it takes the UUID.
export const getIssue = async (token, ref, options = {}) => {
  const data = await request(`query Issue($id: String!) { issue(id: $id) { ${VIEW_FIELDS} } }`, { id: ref }, { ...options, token, what: `issue ${ref}` })
  if (!data.issue) throw new ApiError(`issue ${ref} not found`, { status: 404 })

  return normalizeIssue(data.issue)
}

// "ENG-123" (any case) or an issue URL (linear.app/<workspace>/issue/ENG-123[/<slug>]) →
// { number, ref: 'ENG-123', workspace | null }.
export const parseLinearRef = text => {
  const trimmed = String(text ?? '').trim()
  const url = /^(?:https?:\/\/)?linear\.app\/([^/\s]+)\/issue\/([A-Za-z][A-Za-z0-9]*)-(\d+)(?:[/?#]\S*)?$/i.exec(trimmed)
  const key = url ? null : /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(trimmed)
  const [team, number] = url ? [url[2], url[3]] : key ? [key[1], key[2]] : []
  if (!team) return null

  return { number: Number(number), ref: `${team.toUpperCase()}-${Number(number)}`, workspace: url ? url[1] : null }
}

// The people filter of the Linear tab: assignee and creator, each anyone, ME or a display name.
export const FILTER = peopleFilter([
  ['assignee', 'Assignee'],
  ['creator', 'Creator'],
])
export const { normalize: normalizeFilter, text: filterText } = FILTER
export { ME }

// The adapter the popups, the start flow and the setup checks use (the interface is in lib/remotes.mjs).
export const remote = Object.freeze({
  id: 'linear',
  ...NAMES,
  noun: 'issue',
  plural: 'issues',
  refExample: 'ENG-123',
  tokenWord: 'key',
  secretKey: SECRET_KEY,
  tokenHelp: 'Create a personal API key in Linear under Settings → Security & access → Personal API keys, paste it here and press Enter.',
  link: { id: 'linear-issue', pattern: '^https://linear\\.app/[^/]+/issue/[A-Za-z][A-Za-z0-9]*-[0-9]+(?:[/?#].*)?$' },
  filter: FILTER,
  assigneeLabel: 'assignee',
  parseRef: parseLinearRef,
  auth: options => linearToken(options),
  whoami: token => viewer(token),
  describe: me => `${me.name || me.handle} in ${me.organization || me.workspace}`,
  lookups: token => loadLookups(token),
  people: lookups => lookups?.people ?? [],
  teams: async token => (await listTeams(token)).map(team => ({ names: [team.key, team.name] })),
  team: config => config.linear?.team ?? '',
  list: (token, { config, closed, limit, filter }) =>
    listIssues(token, { team: config.linear.team, extra: config.linear.filter, closed, limit, assignee: filter?.assignee, creator: filter?.creator }),
  view: (token, item) => getIssue(token, item.ref),
  fetch: (token, ref) => getIssue(token, ref.ref),
  meta: issue => [
    issue.stateName,
    issue.priority,
    issue.project ? `project ${issue.project}` : '',
    issue.cycle,
    issue.estimate !== null && issue.estimate !== undefined ? `estimate ${issue.estimate}` : '',
    issue.parent ? `sub-issue of ${issue.parent}` : '',
    issue.author?.login ? `by ${issue.author.login}` : '',
  ],
  settingsRows: config => {
    const extra = config.linear.filter && Object.keys(config.linear.filter).length ? JSON.stringify(config.linear.filter) : ''

    return [
      ['Team', config.linear.team || 'every team (set "linear.team" in config.json to narrow it)', !config.linear.team],
      ['Filter', extra ? `not completed or canceled, and ${extra}` : 'not completed or canceled (add conditions with "linear.filter")', !extra],
    ]
  },
})
