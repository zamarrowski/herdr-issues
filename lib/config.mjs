// Plugin configuration: defaults, config.json in HERDR_PLUGIN_CONFIG_DIR, environment overrides,
// and the {placeholder} templates used for branch names, labels, agent names and prompts.
import fs from 'node:fs'
import { configPath, writeJsonAtomic } from './paths.mjs'

export const DEFAULTS = Object.freeze({
  // Tabs of the issues popup, in this order: "all" (every source together), "github", "shortcut".
  tabs: Object.freeze(['all', 'github', 'shortcut']),
  // herdr agent kind to start ("claude", "codex", "gemini", …; run `herdr agent` for the list).
  // "auto" = the agent running in the pane the popup was opened from, otherwise the UI asks.
  agent: 'auto',
  // Extra argv passed to the agent after `--`, per kind. Example: { "claude": ["--add-dir", "../shared"] }
  agent_args: {},
  // herdr agent name, so `herdr agent prompt issue-482 "…"` addresses it later. Must match [a-z][a-z0-9_-]{0,31}.
  agent_name: 'issue-{number}',
  // Git branch for the worktree.
  branch: 'issue-{number}-{slug}',
  // Base ref for the new branch ("" = herdr's default, the source checkout's HEAD). Example: "origin/main"
  base: '',
  // Workspace label shown in the herdr sidebar, cut to `label_max` characters. {ref} is "#482" or "sc-482".
  label: '{ref} {title}',
  label_max: 40,
  // Length of {slug} (cut at a word boundary).
  slug_max: 40,
  // The text typed into the agent. Same placeholders as the other templates. The default is just the
  // issue URL: every agent knows what to do with it, and you can add context before sending.
  prompt: '{url}',
  // Press Enter after typing the prompt. false leaves it in the agent's input for you to complete and send.
  submit: false,
  // Focus the new workspace when it opens.
  focus: true,
  // Pass --trust-repository to herdr worktree commands (only if you have verified the repository).
  trust_repository: false,
  // Some agents ask to trust the folder on first start. When the pane shows text matching
  // `trust_prompt_pattern`, the plugin answers with Enter so the prompt can be delivered.
  auto_accept_trust_prompt: true,
  trust_prompt_pattern: 'trust the files|trust this (folder|directory|workspace|repository)|do you trust|yes, proceed',
  // Show a herdr toast when the agent has the issue.
  notify: true,
  // Publish an `issue` workspace token ("#482") for the herdr sidebar ($issue in [ui.sidebar.spaces].rows).
  workspace_token: true,
  // How many issues (and how many stories) to list.
  limit: 100,
  // Shortcut stories. The API token is not configured here: the Shortcut tab asks for it and keeps it in
  // secrets.json, or it comes from SHORTCUT_API_TOKEN. branch, label, agent_name and prompt set here apply
  // to stories only, over the global templates.
  shortcut: Object.freeze({
    // Team name, added to the search as team:"…". Empty lists the stories of the whole workspace.
    team: '',
    // Shortcut search query. `c` in the popup drops !is:done to include done stories.
    query: '!is:done !is:archived',
    // Shortcut attaches branches that contain sc-<id> to the story.
    branch: 'sc-{number}-{slug}',
    agent_name: 'sc-{number}',
  }),
  timeouts: Object.freeze({
    worktree_ms: 180_000, // herdr worktree create/open
    agent_start_ms: 90_000, // herdr agent start (herdr clamps to 3 000–300 000)
    agent_ready_ms: 20_000, // each wait for the agent to become idle after a blocked start
    prompt_ms: 30_000, // herdr agent prompt
    submit_check_ms: 6_000, // how long to wait for the agent to react to the prompt before re-sending Enter
    retry_ms: 1_000, // pause between attempts while the new pane's shell or the agent settles
  }),
})

const TYPES = {
  tabs: 'array',
  agent: 'string',
  agent_args: 'object',
  agent_name: 'string',
  branch: 'string',
  base: 'string',
  label: 'string',
  label_max: 'number',
  slug_max: 'number',
  prompt: 'string',
  submit: 'boolean',
  focus: 'boolean',
  trust_repository: 'boolean',
  auto_accept_trust_prompt: 'boolean',
  trust_prompt_pattern: 'string',
  notify: 'boolean',
  workspace_token: 'boolean',
  limit: 'number',
  shortcut: 'object',
  timeouts: 'object',
}

// Templates a source block (`shortcut`) may override for its own records.
export const SOURCE_TEMPLATES = ['branch', 'label', 'agent_name', 'prompt']
const SHORTCUT_KEYS = ['team', 'query', ...SOURCE_TEMPLATES]

// Placeholders available in every template.
export const TEMPLATE_VARS = ['number', 'ref', 'source', 'title', 'slug', 'url', 'repo', 'owner', 'name', 'branch', 'label', 'agent', 'author', 'labels']

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

// Deep merge for plain objects (timeouts, agent_args); anything else is replaced.
export const merge = (base, ...layers) => {
  const out = { ...base }
  for (const layer of layers) {
    if (!isPlainObject(layer)) continue
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined || key.startsWith('$')) continue
      out[key] = isPlainObject(value) && isPlainObject(out[key]) ? merge(out[key], value) : value
    }
  }

  return out
}

// Replaces {name} placeholders. Unknown placeholders are left as written so typos stay visible.
export const render = (template, vars = {}) =>
  String(template ?? '').replace(/\{([a-z_]+)\}/g, (match, key) => (vars[key] === undefined || vars[key] === null ? match : String(vars[key])))

export const envOverrides = (env = process.env) => {
  const out = {}
  if (env.HERDR_ISSUES_AGENT) out.agent = env.HERDR_ISSUES_AGENT
  if (env.HERDR_ISSUES_BASE) out.base = env.HERDR_ISSUES_BASE

  return out
}

// Human-readable problems with a parsed config.json. Never throws; unknown keys are only warnings.
export const validate = data => {
  const warnings = []
  if (data === null || data === undefined) return warnings
  if (!isPlainObject(data)) return ['config.json must contain a JSON object']
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('$')) continue // "$comment", "$schema" and friends are allowed
    if (!(key in TYPES)) {
      warnings.push(`unknown key "${key}"`)
      continue
    }
    const actual = Array.isArray(value) ? 'array' : typeof value
    if (actual !== TYPES[key]) warnings.push(`"${key}" should be a ${TYPES[key]}, got ${actual}`)
  }
  if (isPlainObject(data.agent_args)) {
    for (const [kind, args] of Object.entries(data.agent_args)) {
      if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) warnings.push(`"agent_args.${kind}" should be an array of strings`)
    }
  }
  if (isPlainObject(data.timeouts)) {
    for (const [key, value] of Object.entries(data.timeouts)) {
      if (!(key in DEFAULTS.timeouts)) warnings.push(`unknown key "timeouts.${key}"`)
      else if (typeof value !== 'number' || value <= 0) warnings.push(`"timeouts.${key}" should be a positive number of milliseconds`)
    }
  }
  if (Array.isArray(data.tabs)) {
    for (const tab of data.tabs) if (!['all', 'github', 'shortcut'].includes(String(tab).toLowerCase())) warnings.push(`"tabs" has an unknown tab ${JSON.stringify(tab)} (use "all", "github", "shortcut")`)
    if (!data.tabs.length) warnings.push('"tabs" is empty: every tab is shown')
  }
  if (isPlainObject(data.shortcut)) {
    for (const [key, value] of Object.entries(data.shortcut)) {
      if (key.startsWith('$')) continue
      if (key === 'token' || key === 'api_token') warnings.push(`"shortcut.${key}" is ignored: tokens do not go in config.json; add it in the Shortcut tab or set SHORTCUT_API_TOKEN`)
      else if (!SHORTCUT_KEYS.includes(key)) warnings.push(`unknown key "shortcut.${key}"`)
      else if (typeof value !== 'string') warnings.push(`"shortcut.${key}" should be a string, got ${Array.isArray(value) ? 'array' : typeof value}`)
    }
  }
  if (typeof data.trust_prompt_pattern === 'string') {
    try {
      new RegExp(data.trust_prompt_pattern, 'i')
    } catch (error) {
      warnings.push(`"trust_prompt_pattern" is not a valid regular expression: ${error.message}`)
    }
  }
  if (typeof data.prompt === 'string' && /\r|\n/.test(data.prompt) && data.submit !== true) {
    warnings.push('"prompt" has line breaks: without "submit": true they are typed as spaces, since a newline would send the text')
  }
  if (typeof data.agent === 'string' && data.agent !== 'auto' && !/^[a-z][a-z0-9_-]*$/.test(data.agent)) warnings.push(`"agent" does not look like a herdr agent kind: ${data.agent}`)

  return warnings
}

export const readConfigFile = (file = configPath()) => {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return { exists: false, data: null, error: null }
  }
  try {
    return { exists: true, data: JSON.parse(text), error: null }
  } catch (error) {
    return { exists: true, data: null, error: error.message }
  }
}

// Effective configuration: DEFAULTS ← config.json ← environment.
export const loadConfig = ({ file = configPath(), env = process.env } = {}) => {
  const read = readConfigFile(file)
  const warnings = read.error ? [`could not parse ${file}: ${read.error}`] : validate(read.data)
  const config = merge(DEFAULTS, isPlainObject(read.data) ? read.data : {}, envOverrides(env))

  return { config, file, exists: read.exists, warnings }
}

// Persist one key into config.json without touching the rest of the file.
export const saveConfigValue = (key, value, file = configPath()) => {
  const read = readConfigFile(file)
  const data = isPlainObject(read.data) ? read.data : {}
  data[key] = value
  writeJsonAtomic(file, data)

  return file
}

// The configuration for one record's source: the source block's templates over the global ones.
export const forSource = (config, source) => {
  const block = source && source !== 'github' && isPlainObject(config?.[source]) ? config[source] : {}
  const out = { ...config }
  for (const key of SOURCE_TEMPLATES) if (typeof block[key] === 'string' && block[key]) out[key] = block[key]

  return out
}

// herdr agent names must match [a-z][a-z0-9_-]{0,31} and be unique among live agents.
export const sanitizeAgentName = name => {
  let out = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
  if (!/^[a-z]/.test(out)) out = out ? `issue-${out}` : 'issue'

  return out.slice(0, 32).replace(/[-_]+$/, '')
}

// Git refuses whitespace, "..", "~^:?*[\" and a few more in ref names. Templates built on {slug}
// are already safe; this covers {title} or hand-typed branch templates.
export const sanitizeBranch = name =>
  String(name ?? '')
    .replace(/[\s~^:?*[\]\\]+/g, '-')
    .replace(/@\{/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/\/{2,}/g, '/')
    .replace(/-{2,}/g, '-')
    .replace(/^[-./]+|[-./]+$/g, '')
    .replace(/\.lock$/, '')

// Which agent kind to start, highest precedence first: an explicit choice (CLI flag or the picker),
// then config.agent (HERDR_ISSUES_AGENT included) unless it is "auto", then the agent already running
// in the focused pane. null means "nothing decided": the popup asks, the CLI refuses.
export const resolveAgent = ({ explicit = null, config = DEFAULTS, focusedAgent = null } = {}) =>
  explicit || (config?.agent && config.agent !== 'auto' ? config.agent : null) || focusedAgent || null
