// GitHub access through the `gh` CLI. It uses gh's own login; no tokens are handled here.
// `target` is { cwd, repo }: cwd is a checkout gh infers the repository from, repo an explicit
// "owner/name" that takes precedence when set.
import os from 'node:os'
import path from 'node:path'
import { findBin, run } from './proc.mjs'

const home = os.homedir()
export const ghBin = () =>
  process.env.GH_BIN || findBin('gh', [path.join(home, 'bin', 'gh'), '/opt/homebrew/bin/gh', '/usr/local/bin/gh', path.join(home, '.local', 'bin', 'gh')])

const GH_ENV = { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', GH_PAGER: 'cat' }

const gh = async (args, { cwd, repo } = {}, timeoutMs = 60_000) => {
  const full = repo ? [...args, '-R', repo] : args
  const result = await run(ghBin(), full, { cwd: cwd || undefined, timeoutMs, env: GH_ENV })
  if (result.code !== 0) {
    const text = (result.stderr || result.stdout || `gh ${args.join(' ')} failed`).trim()
    throw new Error(text.split('\n').find(line => line.trim()) ?? text)
  }

  return result.stdout
}

export const repoInfo = async ({ cwd, repo } = {}) =>
  JSON.parse(await gh(['repo', 'view', ...(repo ? [repo] : []), '--json', 'nameWithOwner,url'], { cwd }))

const LIST_FIELDS = 'number,title,state,labels,assignees,url,updatedAt,createdAt,author'
export const listIssues = async (target, { state = 'open', limit = 100 } = {}) =>
  JSON.parse(await gh(['issue', 'list', '--state', state, '--limit', String(limit), '--json', LIST_FIELDS], target))

const VIEW_FIELDS = 'number,title,body,comments,author,state,labels,assignees,createdAt,updatedAt,url'
export const viewIssue = async (target, number) => JSON.parse(await gh(['issue', 'view', String(number), '--json', VIEW_FIELDS], target))

export const openInBrowser = (target, number) => gh(['issue', 'view', String(number), '--web'], target, 15_000)

export const ghVersion = async () => {
  const result = await run(ghBin(), ['--version'], { timeoutMs: 10_000, env: GH_ENV })

  return result.code === 0 ? (/gh version (\S+)/.exec(result.stdout)?.[1] ?? result.stdout.trim()) : null
}

// { ok, login, message } from `gh auth status`.
export const authStatus = async () => {
  const result = await run(ghBin(), ['auth', 'status'], { timeoutMs: 20_000, env: GH_ENV })
  const text = `${result.stdout}\n${result.stderr}`
  const login = /logged in to \S+ (?:account|as) ([^\s(]+)/i.exec(text)?.[1] ?? null
  const message = text.split('\n').map(line => line.trim()).find(Boolean) ?? ''

  return { ok: result.code === 0, login, message }
}

// https://github.com/owner/name/issues/482 (with optional query/fragment) → { owner, name, repo, number }
export const parseIssueUrl = text => {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)\/issues\/(\d+)(?:[/?#].*)?$/i.exec(String(text ?? '').trim())
  if (!match) return null
  const name = match[2].replace(/\.git$/, '')

  return { owner: match[1], name, repo: `${match[1]}/${name}`, number: Number(match[3]) }
}

// "482", "#482" or an issue URL → { number, repo | null }
export const parseIssueRef = text => {
  const trimmed = String(text ?? '').trim()
  const fromUrl = parseIssueUrl(trimmed)
  if (fromUrl) return fromUrl
  const match = /^#?(\d+)$/.exec(trimmed)

  return match ? { number: Number(match[1]), repo: null, owner: null, name: null } : null
}

export const sameRepo = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()

export const labelText = issue => (issue?.labels ?? []).map(label => label.name).join(', ')
export const assigneeText = issue => (issue?.assignees ?? []).map(user => `@${user.login}`).join(' ')
