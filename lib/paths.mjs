// Plugin identity and on-disk locations.
//
// herdr sets HERDR_PLUGIN_ROOT / HERDR_PLUGIN_CONFIG_DIR / HERDR_PLUGIN_STATE_DIR when it launches a
// plugin command. The fallbacks mirror herdr's own layout so the scripts also work from a plain shell.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLUGIN_ID = 'zamarrowski.issues'
export const PLUGIN_NAME = 'herdr-issues'
export const SOURCE = `plugin:${PLUGIN_ID}`
export const REPO_URL = 'https://github.com/zamarrowski/herdr-issues'

const home = os.homedir()
const xdgConfig = () => process.env.XDG_CONFIG_HOME || path.join(home, '.config')
const xdgState = () => process.env.XDG_STATE_HOME || path.join(home, '.local', 'state')

export const pluginRoot = () => process.env.HERDR_PLUGIN_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Runtime state: issue cache. Safe to delete at any time.
export const stateDir = () => process.env.HERDR_PLUGIN_STATE_DIR || path.join(xdgState(), 'herdr', 'plugins', PLUGIN_ID)

// User configuration: config.json. `herdr plugin config-dir zamarrowski.issues` prints the same path.
export const configDir = () => process.env.HERDR_PLUGIN_CONFIG_DIR || path.join(xdgConfig(), 'herdr', 'plugins', 'config', PLUGIN_ID)
export const configPath = () => process.env.HERDR_ISSUES_CONFIG || path.join(configDir(), 'config.json')
// API tokens entered in the popup, kept apart from config.json so that one can be shared. Mode 0600.
export const secretsPath = () => process.env.HERDR_ISSUES_SECRETS || path.join(configDir(), 'secrets.json')

export const herdrConfigPath = () => process.env.HERDR_CONFIG_PATH || path.join(xdgConfig(), 'herdr', 'config.toml')

export const ensureDir = dir => {
  fs.mkdirSync(dir, { recursive: true })

  return dir
}

export const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export const writeJsonAtomic = (file, data) => {
  ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

// The version declared in herdr-plugin.toml (the single source of truth).
export const pluginVersion = () => {
  try {
    const manifest = fs.readFileSync(path.join(pluginRoot(), 'herdr-plugin.toml'), 'utf8')

    return /^version\s*=\s*"([^"]+)"/m.exec(manifest)?.[1] ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
