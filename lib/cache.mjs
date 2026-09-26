// Last fetched list per source and project ("github:acme/shop", "shortcut:backend"), so the popup paints
// instantly and refreshes in the background. Lives in the plugin state directory; safe to delete.
// Holds titles and metadata, never tokens.
import fs from 'node:fs'
import path from 'node:path'
import { stateDir } from './paths.mjs'

const VERSION = 2

export const cacheFile = key => path.join(stateDir(), 'issues', `${String(key ?? 'unknown').replace(/[^A-Za-z0-9._-]+/g, '__')}.json`)

export const readCache = key => {
  try {
    const data = JSON.parse(fs.readFileSync(cacheFile(key), 'utf8'))

    return data?.version === VERSION && Array.isArray(data?.issues) ? data : null
  } catch {
    return null
  }
}

// `extra` carries source-specific data next to the list (the Shortcut workspace and the id → name maps).
export const writeCache = (key, { fetchedAt, issues, ...extra }) => {
  try {
    const file = cacheFile(key)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ version: VERSION, key, fetchedAt, issues, ...extra }))
  } catch {
    /* the cache is best effort */
  }
}

export const clearCache = key => {
  try {
    fs.rmSync(cacheFile(key), { force: true })
  } catch {
    /* best effort */
  }
}

// Removes every cached list whose key starts with `prefix` ("shortcut:" after a token change).
export const clearCaches = prefix => {
  try {
    const dir = path.join(stateDir(), 'issues')
    const start = path.basename(cacheFile(prefix), '.json')
    for (const name of fs.readdirSync(dir)) if (name.startsWith(start)) fs.rmSync(path.join(dir, name), { force: true })
  } catch {
    /* best effort */
  }
}

// Small per-user UI memory (the last tab, the Shortcut people filter), next to the cache.
const uiFile = () => path.join(stateDir(), 'ui.json')
export const readUiState = () => {
  try {
    const data = JSON.parse(fs.readFileSync(uiFile(), 'utf8'))

    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}
export const writeUiState = patch => {
  try {
    fs.mkdirSync(path.dirname(uiFile()), { recursive: true })
    fs.writeFileSync(uiFile(), JSON.stringify({ ...readUiState(), ...patch }))
  } catch {
    /* best effort */
  }
}
