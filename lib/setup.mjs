// Setup helpers: the keybinding block for config.toml, the starter config.json and environment checks.
// Pure text functions live here so they can be unit tested; scripts/setup.mjs is the UI.
import fs from 'node:fs'
import path from 'node:path'
import { authStatus, ghVersion } from './github.mjs'
import { herdrVersion, versionAtLeast } from './herdr.mjs'
import { highlighterVersion } from './highlight.mjs'
import { PLUGIN_ID, configPath, ensureDir, herdrConfigPath, pluginRoot } from './paths.mjs'
import { loadConfig, readConfigFile, validate } from './config.mjs'
import { TOKEN_ENV, currentMember, listTeams, shortcutToken } from './shortcut.mjs'
import { sourcesOf, visibleTabs } from './sources.mjs'

export const MARK_START = `# >>> ${PLUGIN_ID}`
export const MARK_END = `# <<< ${PLUGIN_ID}`

export const DEFAULT_KEYS = Object.freeze({ open: 'prefix+i', start: 'prefix+shift+i' })

export const keyBlock = (keys = DEFAULT_KEYS) => `${MARK_START} — herdr-issues keybindings. Regenerate with \`herdr plugin action invoke ${PLUGIN_ID}.setup\`
[[keys.command]]
key = "${keys.open}"
type = "plugin_action"
command = "${PLUGIN_ID}.open"
description = "issues and stories"

[[keys.command]]
key = "${keys.start}"
type = "plugin_action"
command = "${PLUGIN_ID}.start"
description = "start an issue or a story"
${MARK_END}`

export const hasBlock = text => text.includes(MARK_START) && text.indexOf(MARK_END) > text.indexOf(MARK_START)

// Removes the plugin block (markers included), leaving one blank line where it was.
export const stripBlock = text => {
  const start = text.indexOf(MARK_START)
  const end = text.indexOf(MARK_END)
  if (start < 0 || end < start) return text
  const before = text.slice(0, start).replace(/\s*$/, '')
  const after = text.slice(end + MARK_END.length).replace(/^\n+/, '')

  return before ? `${before}\n${after ? `\n${after}` : ''}` : after
}

// Replaces or appends the plugin block at the end of the file text.
export const insertBlock = (text, block = keyBlock()) => {
  const base = stripBlock(text).replace(/\s*$/, '')

  return `${base ? `${base}\n\n` : ''}${block}\n`
}

const backupOnce = file => {
  const backup = `${file}.herdr-issues.bak`
  if (fs.existsSync(file) && !fs.existsSync(backup)) {
    fs.copyFileSync(file, backup)

    return backup
  }

  return fs.existsSync(backup) ? backup : null
}

export const writeKeys = (file = herdrConfigPath(), keys = DEFAULT_KEYS) => {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const next = insertBlock(text, keyBlock(keys))
  if (next === text) return { changed: false, backup: null, file }
  const backup = backupOnce(file)
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, next)

  return { changed: true, backup, file }
}

export const removeKeys = (file = herdrConfigPath()) => {
  if (!fs.existsSync(file)) return { changed: false, file }
  const text = fs.readFileSync(file, 'utf8')
  const next = stripBlock(text)
  if (next === text) return { changed: false, file }
  fs.writeFileSync(file, next)

  return { changed: true, file }
}

export const examplePath = () => path.join(pluginRoot(), 'config.example.json')

// Copies config.example.json into the plugin config dir unless a config.json already exists.
export const initConfig = ({ file = configPath(), example = examplePath() } = {}) => {
  if (fs.existsSync(file)) return { created: false, file }
  ensureDir(path.dirname(file))
  fs.copyFileSync(example, file)

  return { created: true, file }
}

export const MIN_HERDR = (() => {
  try {
    return /^min_herdr_version\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(pluginRoot(), 'herdr-plugin.toml'), 'utf8'))?.[1] ?? '0.9.0'
  } catch {
    return '0.9.0'
  }
})()

// Shortcut: a token (environment or secrets.json) that the API accepts, and the configured team.
export const shortcutChecks = async (config, { env = process.env } = {}) => {
  const auth = shortcutToken({ env })
  if (!auth) return [{ ok: null, text: `Shortcut not set up: open the Shortcut tab of the issues popup to add a token (or set ${TOKEN_ENV})` }]
  const from = auth.from === 'env' ? TOKEN_ENV : 'secrets.json'
  let me
  try {
    me = await currentMember(auth.token)
  } catch (error) {
    return [{ ok: false, text: `Shortcut: ${error.message} (token from ${from})` }]
  }
  const checks = [{ ok: true, text: `Shortcut: @${me.mention} in ${me.workspace} (token from ${from})` }]
  const team = config?.shortcut?.team
  if (team) {
    const teams = await listTeams(auth.token).catch(() => null)
    const found = teams?.some(entry => [entry.name, entry.mention].some(name => String(name ?? '').toLowerCase() === team.toLowerCase()))
    checks.push({ ok: teams ? Boolean(found) : null, text: teams ? (found ? `Shortcut team "${team}"` : `Shortcut team "${team}" not found in ${me.workspace}`) : `Shortcut team "${team}" could not be checked` })
  }

  return checks
}

// Environment checks shown by the setup popup: [{ ok: true | false | null, text }].
export const runChecks = async ({ configFile = configPath(), herdrConfig = herdrConfigPath() } = {}) => {
  const checks = []

  const herdrV = await herdrVersion().catch(() => null)
  if (!herdrV) checks.push({ ok: false, text: 'herdr not found (HERDR_BIN_PATH is unset and no `herdr` on PATH)' })
  else checks.push({ ok: versionAtLeast(herdrV, MIN_HERDR), text: `herdr ${herdrV}${versionAtLeast(herdrV, MIN_HERDR) ? '' : ` (this plugin needs ≥ ${MIN_HERDR})`}` })

  checks.push({ ok: true, text: `node ${process.version}` })

  const { config: effective } = loadConfig({ file: configFile })
  const sources = sourcesOf(visibleTabs(effective.tabs))
  if (sources.includes('github')) {
    const ghV = await ghVersion().catch(() => null)
    if (!ghV) checks.push({ ok: false, text: 'gh (GitHub CLI) not found: install it from https://cli.github.com and run `gh auth login`' })
    else {
      const auth = await authStatus().catch(() => ({ ok: false, login: null, message: '' }))
      checks.push({ ok: auth.ok, text: auth.ok ? `gh ${ghV}, logged in${auth.login ? ` as ${auth.login}` : ''}` : `gh ${ghV} is not logged in: run \`gh auth login\`` })
    }
  }
  if (sources.includes('shortcut')) checks.push(...(await shortcutChecks(effective)))

  const hljs = highlighterVersion()
  checks.push({
    ok: hljs ? true : null,
    text: hljs ? `highlight.js ${hljs} (syntax highlighting in code blocks)` : 'highlight.js not installed: code blocks are shown plain (run `npm ci` in the plugin directory, or reinstall)',
  })

  const config = readConfigFile(configFile)
  if (!config.exists) checks.push({ ok: null, text: `config.json not created yet, defaults apply  ${configFile}` })
  else if (config.error) checks.push({ ok: false, text: `config.json is not valid JSON: ${config.error}  ${configFile}` })
  else {
    const warnings = validate(config.data)
    checks.push({ ok: warnings.length === 0, text: warnings.length ? `config.json: ${warnings.join('; ')}` : `config.json  ${configFile}` })
  }

  const keysText = fs.existsSync(herdrConfig) ? fs.readFileSync(herdrConfig, 'utf8') : ''
  checks.push({ ok: hasBlock(keysText) ? true : null, text: hasBlock(keysText) ? `keybindings present in ${herdrConfig}` : `keybindings not in ${herdrConfig} yet` })

  return checks
}
