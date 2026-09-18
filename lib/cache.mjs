// Last fetched issue list per repository, so the popup paints instantly and refreshes in the background.
// Lives in the plugin state directory; safe to delete.
import fs from 'node:fs'
import path from 'node:path'
import { stateDir } from './paths.mjs'

export const cacheFile = repo => path.join(stateDir(), 'issues', `${String(repo ?? 'unknown').replace('/', '__')}.json`)

export const readCache = repo => {
  try {
    const data = JSON.parse(fs.readFileSync(cacheFile(repo), 'utf8'))

    return Array.isArray(data?.issues) ? data : null
  } catch {
    return null
  }
}

export const writeCache = (repo, { fetchedAt, issues }) => {
  try {
    const file = cacheFile(repo)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ version: 1, repo, fetchedAt, issues }))
  } catch {
    /* the cache is best effort */
  }
}
