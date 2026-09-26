// Thin wrapper over the herdr CLI. "The entire herdr CLI is the plugin API": every call here is a
// `herdr …` subprocess through HERDR_BIN_PATH, which herdr sets for plugin commands.
//
// herdr prints one JSON line per call: {"id":…,"result":{…}} on stdout, or {"id":…,"error":{"code","message"}}
// on stderr with exit status 1. CLI syntax errors are plain text with exit status 2.
import os from 'node:os'
import { findBin, run } from './proc.mjs'

export class HerdrError extends Error {
  constructor(message, { code = null, args = [] } = {}) {
    super(message)
    this.name = 'HerdrError'
    this.code = code
    this.args = args
  }
}

export const herdrBin = () => process.env.HERDR_BIN_PATH || findBin('herdr', [`${os.homedir()}/.local/bin/herdr`])

// Finds the JSON envelope in a CLI transcript. Pure, so it can be unit tested.
export const parseCliOutput = (stdout = '', stderr = '') => {
  let result = null
  let error = null
  for (const line of `${stdout}\n${stderr}`.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error) error = parsed.error
    else if (parsed && typeof parsed === 'object' && 'result' in parsed) result = parsed.result
  }

  return { result, error }
}

export const herdr = async (args, { timeoutMs = 30_000 } = {}) => {
  const bin = herdrBin()
  const outcome = await run(bin, args, { timeoutMs })
  const { result, error } = parseCliOutput(outcome.stdout, outcome.stderr)
  if (error) throw new HerdrError(error.message || JSON.stringify(error), { code: error.code ?? 'error', args })
  if (outcome.timedOut) throw new HerdrError(`herdr ${args.slice(0, 2).join(' ')} did not answer within ${timeoutMs} ms`, { code: 'client_timeout', args })
  if (outcome.code !== 0) {
    const text = `${outcome.stdout}\n${outcome.stderr}`.trim()
    const code = outcome.code === 2 ? 'usage' : outcome.code === -1 ? 'spawn_failed' : `exit_${outcome.code}`
    throw new HerdrError(text || `herdr ${args.join(' ')} failed (${bin})`, { code, args })
  }

  return result
}

const focusFlag = focus => (focus ? '--focus' : '--no-focus')
// Source repo: the herdr workspace id when known (the one the popup was opened from), else a checkout path.
const source = ({ workspaceId, cwd }) => (workspaceId ? ['--workspace', workspaceId] : ['--cwd', cwd])
const trustFlag = trust => (trust ? ['--trust-repository'] : [])

export const worktreeCreate = ({ workspaceId, cwd, branch, base, label, focus = true, trustRepository = false, timeoutMs = 180_000 }) =>
  herdr(
    [
      'worktree',
      'create',
      ...source({ workspaceId, cwd }),
      '--branch',
      branch,
      ...(base ? ['--base', base] : []),
      ...(label ? ['--label', label] : []),
      focusFlag(focus),
      ...trustFlag(trustRepository),
    ],
    { timeoutMs },
  )

export const worktreeOpen = ({ workspaceId, cwd, branch, label, focus = true, trustRepository = false, timeoutMs = 60_000 }) =>
  herdr(['worktree', 'open', ...source({ workspaceId, cwd }), '--branch', branch, ...(label ? ['--label', label] : []), focusFlag(focus), ...trustFlag(trustRepository)], {
    timeoutMs,
  })

// Every open workspace; the ones inside a git checkout carry `worktree` (repo_key, repo_name, repo_root, …).
export const workspaceList = async () => (await herdr(['workspace', 'list'], { timeoutMs: 10_000 }))?.workspaces ?? []

// herdr accepts startup timeouts between 3 001 and 300 000 ms.
const clampStartTimeout = ms => Math.min(300_000, Math.max(3_001, Math.round(ms)))

export const agentStart = (name, paneId, { kind, args = [], timeoutMs = 90_000 } = {}) => {
  const startTimeout = clampStartTimeout(timeoutMs)

  return herdr(['agent', 'start', name, '--kind', kind, '--pane', paneId, '--timeout', String(startTimeout), ...(args.length ? ['--', ...args] : [])], {
    timeoutMs: startTimeout + 10_000,
  })
}

export const agentWait = (target, { until = ['idle', 'done'], timeoutMs = 60_000 } = {}) =>
  herdr(['agent', 'wait', target, ...until.flatMap(status => ['--until', status]), '--timeout', String(timeoutMs)], { timeoutMs: timeoutMs + 10_000 })

export const agentPrompt = (target, text, { wait = false, timeoutMs = 120_000 } = {}) =>
  herdr(['agent', 'prompt', target, text, ...(wait ? ['--wait', '--timeout', String(timeoutMs)] : [])], { timeoutMs: wait ? timeoutMs + 10_000 : timeoutMs })

export const agentSendKeys = (target, ...keys) => herdr(['agent', 'send-keys', target, ...keys])

// Types text into a pane without pressing Enter (`agent prompt` sends text plus Enter as one submission).
export const paneSendText = (paneId, text, { timeoutMs = 30_000 } = {}) => herdr(['pane', 'send-text', paneId, text], { timeoutMs })

// `agent read` prints plain text, not JSON.
export const agentRead = async (target, { lines = 60, source: readSource = 'visible' } = {}) => {
  const result = await run(herdrBin(), ['agent', 'read', target, '--source', readSource, '--lines', String(lines)], { timeoutMs: 10_000 })

  return result.stdout
}

// Kinds herdr 0.9.1 can start. Used only when `herdr agent` cannot be asked.
export const FALLBACK_KINDS = Object.freeze([
  'claude', 'codex', 'gemini', 'pi', 'opencode', 'cursor', 'copilot', 'droid', 'amp', 'kimi', 'kiro', 'grok', 'hermes', 'kilo', 'qwen',
  'cline', 'devin', 'agy', 'omp', 'mastracode', 'qodercli', 'letta', 'maki', 'muse',
])

// Parses the "kinds: a|b|c" line of the `herdr agent` usage text.
export const parseKinds = text => {
  const match = /kinds:\s*([a-z0-9_|-]+)/i.exec(String(text ?? ''))

  return match ? match[1].split('|').filter(Boolean) : null
}

// Agent kinds the installed herdr can start (`herdr agent` prints them in its usage).
export const agentKinds = async () => {
  const result = await run(herdrBin(), ['agent'], { timeoutMs: 10_000 })

  return parseKinds(`${result.stdout}\n${result.stderr}`) ?? [...FALLBACK_KINDS]
}

export const notify = (title, body, { position, sound } = {}) =>
  herdr(['notification', 'show', title, ...(body ? ['--body', body] : []), ...(position ? ['--position', position] : []), ...(sound ? ['--sound', sound] : [])], {
    timeoutMs: 10_000,
  })

// tokens: { name: value | null }; null clears a token. Shown with $name in [ui.sidebar.spaces].rows.
export const reportWorkspaceTokens = (workspaceId, source, tokens, { ttlMs } = {}) => {
  const args = ['workspace', 'report-metadata', workspaceId, '--source', source]
  for (const [name, value] of Object.entries(tokens)) {
    if (value === null || value === undefined) args.push('--clear-token', name)
    else args.push('--token', `${name}=${value}`)
  }
  if (ttlMs) args.push('--ttl-ms', String(ttlMs))

  return herdr(args, { timeoutMs: 10_000 })
}

export const reloadConfig = () => herdr(['server', 'reload-config'], { timeoutMs: 15_000 })

export const herdrVersion = async () => {
  const result = await run(herdrBin(), ['--version'], { timeoutMs: 10_000 })

  return result.code === 0 ? (/(\d+\.\d+\.\d+\S*)/.exec(result.stdout)?.[1] ?? result.stdout.trim()) : null
}

// "0.9.1" >= "0.9.0"
export const versionAtLeast = (version, minimum) => {
  const parse = text => String(text ?? '').split(/[.-]/).slice(0, 3).map(part => Number.parseInt(part, 10) || 0)
  const [a, b] = [parse(version), parse(minimum)]
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index]
  }

  return true
}
