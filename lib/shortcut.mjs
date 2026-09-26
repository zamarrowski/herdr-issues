// Shortcut stories through the REST API v3, with Node's global fetch (no dependency).
//
// The token comes from SHORTCUT_API_TOKEN or from secrets.json, where the popup saves the one you type.
// It is sent in the Shortcut-Token header to the API host only, and never logged, cached or printed.
// Records are normalised to the shape the popups use for GitHub issues (see lib/sources.mjs).
import { readSecret } from './secrets.mjs'

export const TOKEN_ENV = 'SHORTCUT_API_TOKEN'
export const SECRET_KEY = 'shortcut_token'
export const DEFAULT_QUERY = '!is:done !is:archived'

// HERDR_ISSUES_SHORTCUT_API points the client at another server (the tests use a local one).
export const apiBase = (env = process.env) => (env.HERDR_ISSUES_SHORTCUT_API || 'https://api.app.shortcut.com/api/v3').replace(/\/+$/, '')

// { token, from: 'env' | 'file' } or null. The environment wins, so a token managed elsewhere is never shadowed.
export const shortcutToken = ({ env = process.env, file } = {}) => {
  const fromEnv = String(env[TOKEN_ENV] ?? '').trim()
  if (fromEnv) return { token: fromEnv, from: 'env' }
  const stored = readSecret(SECRET_KEY, file)

  return stored ? { token: stored, from: 'file' } : null
}

export class ShortcutError extends Error {
  constructor(message, { status = null } = {}) {
    super(message)
    this.name = 'ShortcutError'
    this.status = status
  }
}

const failure = async (response, what) => {
  if (response.status === 401 || response.status === 403) return new ShortcutError('Shortcut rejected the token', { status: response.status })
  if (response.status === 404) return new ShortcutError(`${what} not found`, { status: 404 })
  if (response.status === 429) return new ShortcutError('Shortcut rate limit reached, try again in a minute', { status: 429 })
  let detail = ''
  try {
    const body = await response.json()
    detail = body?.message || body?.error || (Array.isArray(body?.errors) ? body.errors.join(', ') : '')
  } catch {
    /* no JSON body */
  }

  return new ShortcutError(`Shortcut answered ${response.status}${detail ? `: ${detail}` : ''}`, { status: response.status })
}

// GET (or `method`) a path under the API base, or an absolute URL on the same host (search `next` links).
export const request = async (target, { token, method = 'GET', base = apiBase(), timeoutMs = 20_000, what = 'Shortcut resource' } = {}) => {
  if (!token) throw new ShortcutError('Shortcut is not set up: add an API token in the Shortcut tab of the issues popup, or set SHORTCUT_API_TOKEN')
  const url = new URL(/^https?:/.test(target) ? target : target.startsWith('/api/') ? target : `${base}${target}`, base)
  if (url.origin !== new URL(base).origin) throw new ShortcutError(`refusing to send the Shortcut token to ${url.origin}`)
  let response
  try {
    response = await fetch(url, { method, headers: { 'Shortcut-Token': token, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new ShortcutError(`Shortcut did not answer within ${Math.round(timeoutMs / 1000)} s`)
    throw new ShortcutError(`could not reach Shortcut: ${error?.cause?.message ?? error?.message ?? error}`)
  }
  if (!response.ok) throw await failure(response, what)

  return response.json()
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

const tasksMarkdown = tasks => {
  const list = (tasks ?? []).filter(task => task?.description)
  if (!list.length) return ''

  return `**Tasks**\n\n${list.map(task => `- [${task.complete ? 'x' : ' '}] ${task.description.replace(/\s*\n\s*/g, ' ')}`).join('\n')}`
}

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

  const tasks = tasksMarkdown(story.tasks)

  return {
    ...record,
    body: [String(story.description ?? '').trim(), tasks].filter(Boolean).join('\n\n'),
    comments: (story.comments ?? [])
      .filter(comment => !comment.deleted && comment.text)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .map(comment => ({ author: { login: mention(comment.author_id) }, body: comment.text, createdAt: comment.created_at })),
  }
}

const byUpdatedDesc = (a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)

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

// "sc-482", "[sc-482]" or a story URL (app.shortcut.com, or the old app.clubhouse.io) → { number, workspace | null }.
export const parseStoryRef = text => {
  const trimmed = String(text ?? '').trim()
  const url = /^(?:https?:\/\/)?app\.(?:shortcut\.com|clubhouse\.io)\/([^/\s]+)\/story\/(\d+)(?:[/?#]\S*)?$/i.exec(trimmed)
  if (url) return { number: Number(url[2]), workspace: url[1] }
  const ref = /^\[?sc-(\d+)\]?$/i.exec(trimmed)

  return ref ? { number: Number(ref[1]), workspace: null } : null
}

// The people filter of the Shortcut tab: { owner, requester }, each null (anyone), ME (the token's owner,
// whoever that is) or a mention name. Saved in the plugin state, so it survives across popups.
export const ME = '$me'

export const normalizeFilter = value => {
  const one = item => (item === ME ? ME : typeof item === 'string' && /^[\w.-]+$/.test(item.replace(/^@/, '')) ? item.replace(/^@/, '') : null)

  return { owner: one(value?.owner), requester: one(value?.requester) }
}

// Mention names for the search, with ME resolved against `me` ({ mention }).
export const resolveFilter = (filter, me) => {
  const one = item => (item === ME ? (me?.mention ?? '') : (item ?? ''))

  return { owner: one(filter?.owner), requester: one(filter?.requester) }
}

// "owner me · requester @bo", or '' without a filter.
export const filterText = filter =>
  [
    ['owner', filter?.owner],
    ['requester', filter?.requester],
  ]
    .filter(([, value]) => value)
    .map(([name, value]) => `${name} ${value === ME ? 'me' : `@${value}`}`)
    .join(' · ')
