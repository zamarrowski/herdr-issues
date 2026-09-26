// Shortcut stories through the REST API v3, with Node's global fetch (no dependency), and the adapter
// that plugs them into the popups (`remote`, listed in lib/remotes.mjs).
//
// The token comes from SHORTCUT_API_TOKEN or from secrets.json, where the popup saves the one you type.
// It is sent in the Shortcut-Token header to the API host only, and never logged, cached or printed.
// Records are normalised to the shape the popups use for GitHub issues (see lib/sources.mjs).
import { ApiError, ME, byUpdatedDesc, checklist, fetchJson, notSetUp, peopleFilter, tokenFrom } from './integration.mjs'

export const TOKEN_ENV = 'SHORTCUT_API_TOKEN'
export const SECRET_KEY = 'shortcut_token'
export const DEFAULT_QUERY = '!is:done !is:archived'

// HERDR_ISSUES_SHORTCUT_API points the client at another server (the tests use a local one).
export const apiBase = (env = process.env) => (env.HERDR_ISSUES_SHORTCUT_API || 'https://api.app.shortcut.com/api/v3').replace(/\/+$/, '')

export const shortcutToken = ({ env = process.env, file } = {}) => tokenFrom({ envName: TOKEN_ENV, secretKey: SECRET_KEY, env, file })

const NAMES = { name: 'Shortcut', tokenName: 'API token', tokenEnv: TOKEN_ENV }

// GET (or `method`) a path under the API base, or an absolute URL on the same host (search `next` links).
export const request = async (target, { token, method = 'GET', base = apiBase(), timeoutMs = 20_000, what = 'Shortcut resource' } = {}) => {
  if (!token) throw new ApiError(notSetUp(NAMES))
  const url = new URL(/^https?:/.test(target) ? target : target.startsWith('/api/') ? target : `${base}${target}`, base)
  if (url.origin !== new URL(base).origin) throw new ApiError(`refusing to send the Shortcut token to ${url.origin}`)
  const { status, ok, data } = await fetchJson(url, {
    service: 'Shortcut',
    method,
    headers: { 'Shortcut-Token': token },
    timeoutMs,
    rejected: 'Shortcut rejected the token',
    rateLimited: 'Shortcut rate limit reached, try again in a minute',
  })
  if (status === 404) throw new ApiError(`${what} not found`, { status: 404 })
  if (!ok) {
    const detail = data?.message || data?.error || (Array.isArray(data?.errors) ? data.errors.join(', ') : '')
    throw new ApiError(`Shortcut answered ${status}${detail ? `: ${detail}` : ''}`, { status })
  }

  return data
}

// { mention, name, workspace } of the token's owner. Also the cheapest way to check a token.
export const currentMember = async (token, options = {}) => {
  const member = await request('/member', { ...options, token, what: 'member' })

  return { mention: member?.mention_name ?? '', name: member?.name ?? '', workspace: member?.workspace2?.url_slug ?? '' }
}

// Id → name maps for the fields stories carry as ids. Plain objects, so they can be cached with the list.
export const loadLookups = async (token, options = {}) => {
  const [members, workflows] = await Promise.all([request('/members', { ...options, token }), request('/workflows', { ...options, token })])
  const lookups = { members: {}, states: {}, people: [] }
  for (const member of Array.isArray(members) ? members : []) {
    const mention = member.profile?.mention_name || ''
    lookups.members[member.id] = mention || member.profile?.name || ''
    if (mention && !member.disabled && !member.profile?.deactivated) lookups.people.push({ mention, name: member.profile?.name ?? '' })
  }
  lookups.people.sort((a, b) => a.mention.localeCompare(b.mention))
  for (const workflow of Array.isArray(workflows) ? workflows : []) {
    for (const state of workflow.states ?? []) lookups.states[state.id] = { name: state.name, type: state.type }
  }

  return lookups
}

export const listTeams = async (token, options = {}) => {
  const groups = await request('/groups', { ...options, token })

  return (Array.isArray(groups) ? groups : []).filter(group => !group.archived).map(group => ({ id: group.id, name: group.name, mention: group.mention_name }))
}

// The search query: the configured base query, `team:"…"` when a team is set, `owner:` / `requester:`
// for the people filter (mention names), and without `!is:done` when done stories are wanted too.
export const buildQuery = ({ query = DEFAULT_QUERY, team = '', closed = false, owner = '', requester = '' } = {}) => {
  let text = String(query ?? '').trim() || DEFAULT_QUERY
  if (closed) text = text.replace(/(^|\s)!is:done(?=\s|$)/g, ' ')
  if (team) text += ` team:"${String(team).replace(/"/g, '')}"`
  const mention = name => String(name).replace(/^@/, '').replace(/[^\w.-]/g, '')
  if (owner && mention(owner)) text += ` owner:${mention(owner)}`
  if (requester && mention(requester)) text += ` requester:${mention(requester)}`

  return text.replace(/\s+/g, ' ').trim()
}

export const workspaceOfUrl = url => /^https?:\/\/app\.(?:shortcut\.com|clubhouse\.io)\/([^/]+)\//i.exec(String(url ?? ''))?.[1] ?? null

// A Shortcut story (slim or full) → the record the popups and the start flow use.
export const normalizeStory = (story, lookups = {}) => {
  const members = lookups.members ?? {}
  const state = lookups.states?.[story.workflow_state_id] ?? null
  const closed = Boolean(story.completed || story.archived)
  const mention = id => members[id] || ''
  const record = {
    source: 'shortcut',
    number: story.id,
    ref: `sc-${story.id}`,
    title: story.name ?? '',
    url: story.app_url ?? '',
    closed,
    state: closed ? 'CLOSED' : 'OPEN',
    stateName: story.archived ? 'Archived' : (state?.name ?? (story.completed ? 'Done' : '')),
    type: story.story_type ?? '',
    estimate: typeof story.estimate === 'number' ? story.estimate : null,
    labels: (story.labels ?? []).map(label => ({ name: label.name })),
    assignees: (story.owner_ids ?? []).map(mention).filter(Boolean).map(login => ({ login })),
    author: { login: mention(story.requested_by_id) },
    createdAt: story.created_at ?? null,
    updatedAt: story.updated_at ?? story.created_at ?? null,
    workspace: workspaceOfUrl(story.app_url),
    vcsBranch: story.formatted_vcs_branch_name ?? '',
  }
  if (story.description === undefined && story.comments === undefined) return record

  const tasks = checklist('Tasks', (story.tasks ?? []).map(task => ({ done: task.complete, text: task.description })))

  return {
    ...record,
    body: [String(story.description ?? '').trim(), tasks].filter(Boolean).join('\n\n'),
    comments: (story.comments ?? [])
      .filter(comment => !comment.deleted && comment.text)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .map(comment => ({ author: { login: mention(comment.author_id) }, body: comment.text, createdAt: comment.created_at })),
  }
}

// Stories matching the query, newest updated first (search returns relevance order), up to `limit`.
export const listStories = async (token, { query = DEFAULT_QUERY, team = '', closed = false, owner = '', requester = '', limit = 100, lookups = {}, ...options } = {}) => {
  const base = options.base ?? apiBase()
  const stories = []
  let next = `/search/stories?${new URLSearchParams({ query: buildQuery({ query, team, closed, owner, requester }), page_size: '25', detail: 'slim' })}`
  while (next && stories.length < limit) {
    const page = await request(next, { ...options, base, token, what: 'search' })
    stories.push(...(page?.data ?? []))
    next = page?.next || null
  }

  return stories.slice(0, limit).map(story => normalizeStory(story, lookups)).sort(byUpdatedDesc)
}

export const getStory = async (token, id, { lookups = {}, ...options } = {}) =>
  normalizeStory(await request(`/stories/${encodeURIComponent(id)}`, { ...options, token, what: `story sc-${id}` }), lookups)

// "sc-482", "[sc-482]" or a story URL (app.shortcut.com, or the old app.clubhouse.io) →
// { number, ref: 'sc-482', workspace | null }.
export const parseStoryRef = text => {
  const trimmed = String(text ?? '').trim()
  const url = /^(?:https?:\/\/)?app\.(?:shortcut\.com|clubhouse\.io)\/([^/\s]+)\/story\/(\d+)(?:[/?#]\S*)?$/i.exec(trimmed)
  const key = url ? null : /^\[?sc-(\d+)\]?$/i.exec(trimmed)
  const number = url ? url[2] : key?.[1]

  return number ? { number: Number(number), ref: `sc-${Number(number)}`, workspace: url ? url[1] : null } : null
}

// The people filter of the Shortcut tab: owner and requester, each anyone, ME or a mention name.
export const FILTER = peopleFilter([
  ['owner', 'Owner'],
  ['requester', 'Requester'],
])
export const { normalize: normalizeFilter, text: filterText } = FILTER
export { ME }

// Mention names for the search, with ME resolved against `me` ({ mention }).
export const resolveFilter = (filter, me) => {
  const one = item => (item === ME ? (me?.mention ?? '') : (item ?? ''))

  return { owner: one(filter?.owner), requester: one(filter?.requester) }
}

// The adapter the popups, the start flow and the setup checks use (the interface is in lib/remotes.mjs).
export const remote = Object.freeze({
  id: 'shortcut',
  ...NAMES,
  noun: 'story',
  plural: 'stories',
  refExample: 'sc-<id>',
  tokenWord: 'token',
  secretKey: SECRET_KEY,
  tokenHelp: 'Create a token in Shortcut under Settings → Your account → API Tokens, paste it here and press Enter.',
  link: { id: 'shortcut-story', pattern: '^https://app\\.shortcut\\.com/[^/]+/story/[0-9]+(?:[/?#].*)?$' },
  filter: FILTER,
  assigneeLabel: 'owners',
  parseRef: parseStoryRef,
  auth: options => shortcutToken(options),
  whoami: async token => {
    const me = await currentMember(token)

    return { ...me, handle: me.mention }
  },
  describe: me => `@${me.mention} in ${me.workspace}`,
  lookups: token => loadLookups(token),
  people: lookups => (lookups?.people ?? []).map(person => ({ handle: person.mention, name: person.name })),
  teams: async token => (await listTeams(token)).map(team => ({ names: [team.name, team.mention] })),
  team: config => config.shortcut?.team ?? '',
  list: (token, { config, closed, limit, lookups, filter, me }) =>
    listStories(token, { query: config.shortcut.query, team: config.shortcut.team, closed, limit, lookups, ...resolveFilter(filter, me) }),
  view: (token, item, { lookups } = {}) => getStory(token, item.number, { lookups: lookups ?? {} }),
  fetch: async (token, ref) => getStory(token, ref.number, { lookups: await loadLookups(token) }),
  meta: issue => [
    issue.stateName,
    issue.type,
    issue.estimate !== null && issue.estimate !== undefined ? `estimate ${issue.estimate}` : '',
    issue.author?.login ? `requested by ${issue.author.login}` : '',
  ],
  settingsRows: config => [
    ['Team', config.shortcut.team || 'every team (set "shortcut.team" in config.json to narrow it)', !config.shortcut.team],
    ['Query', config.shortcut.query],
  ],
})
