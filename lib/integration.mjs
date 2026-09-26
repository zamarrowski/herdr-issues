// What every integration reached with an API token of its own (Shortcut, Linear, the next ones) needs:
// where the token comes from, JSON over Node's global fetch with a timeout and readable errors, the
// people filter, a Markdown checklist and the list order. An integration module (lib/shortcut.mjs,
// lib/linear.mjs) builds its API client on these and exports its adapter; lib/remotes.mjs lists them.
//
// Tokens are only ever read here and sent in the headers the integration passes to fetchJson: nothing
// here logs, caches or prints them, and error messages never include them.
import { readSecret } from './secrets.mjs'

// "Me" in a people filter: the owner of the token, whoever that is.
export const ME = '$me'

export class ApiError extends Error {
  constructor(message, { status = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// { token, from: 'env' | 'file' } or null. The environment wins, so a token managed elsewhere is never
// shadowed by the one saved from the popup (secrets.json).
export const tokenFrom = ({ envName, secretKey, env = process.env, file } = {}) => {
  const fromEnv = String(env[envName] ?? '').trim()
  if (fromEnv) return { token: fromEnv, from: 'env' }
  const stored = readSecret(secretKey, file)

  return stored ? { token: stored, from: 'file' } : null
}

// "Linear is not set up: add an API key in the Linear tab of the issues popup, or set LINEAR_API_KEY".
// `remote` is an adapter, or anything with its name, tokenName and tokenEnv.
export const notSetUp = remote => `${remote.name} is not set up: add an ${remote.tokenName} in the ${remote.name} tab of the issues popup, or set ${remote.tokenEnv}`

// One request, JSON both ways. Resolves to { status, ok, data } (data null without a JSON body) for the
// integration to interpret; throws ApiError when the server cannot be reached or does not answer in time,
// and for the answers every API gives the same meaning: 401 / 403 (`rejected`) and 429 (`rateLimited`).
export const fetchJson = async (url, { service, method = 'GET', headers = {}, body, timeoutMs = 20_000, rejected, rateLimited } = {}) => {
  let response
  try {
    response = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new ApiError(`${service} did not answer within ${Math.round(timeoutMs / 1000)} s`)
    throw new ApiError(`could not reach ${service}: ${error?.cause?.message ?? error?.message ?? error}`)
  }
  if (response.status === 401 || response.status === 403) throw new ApiError(rejected ?? `${service} rejected the token`, { status: response.status })
  if (response.status === 429) throw new ApiError(rateLimited ?? `${service} rate limit reached, try again later`, { status: 429 })
  let data = null
  try {
    data = await response.json()
  } catch {
    /* no JSON body */
  }

  return { status: response.status, ok: response.ok, data }
}

// The people filter of an integration: `fields` is [[field, Label]], e.g. [['owner', 'Owner'], ['requester',
// 'Requester']]. A filter is { [field]: null (anyone) | ME | handle }; it is saved in the plugin state, so
// normalize() drops whatever does not look like one.
export const peopleFilter = fields => {
  const names = fields.map(([field]) => field)
  const one = item => {
    if (item === ME) return ME
    const handle = typeof item === 'string' ? item.replace(/^@/, '') : ''

    return /^[\w.+-]+$/.test(handle) ? handle : null
  }

  return {
    fields,
    names,
    normalize: value => Object.fromEntries(names.map(name => [name, one(value?.[name])])),
    // "owner me · requester @bo", or '' without a filter.
    text: filter =>
      names
        .filter(name => filter?.[name])
        .map(name => `${name} ${filter[name] === ME ? 'me' : `@${filter[name]}`}`)
        .join(' · '),
  }
}

// "**Tasks**\n\n- [x] Reproduce\n- [ ] Fix": items are { done, text }; '' when there are none.
export const checklist = (title, items) => {
  const list = (items ?? []).filter(item => item?.text)
  if (!list.length) return ''

  return `**${title}**\n\n${list.map(item => `- [${item.done ? 'x' : ' '}] ${String(item.text).replace(/\s*\n\s*/g, ' ')}`).join('\n')}`
}

export const byUpdatedDesc = (a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)
