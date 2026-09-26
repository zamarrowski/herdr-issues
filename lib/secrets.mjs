// API tokens the user typed into the popup, in secrets.json next to config.json (mode 0600).
// Values are never logged, cached or printed; errors mention the file, never its content.
import fs from 'node:fs'
import path from 'node:path'
import { ensureDir, secretsPath } from './paths.mjs'

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export const readSecrets = (file = secretsPath()) => {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))

    return isPlainObject(data) ? data : {}
  } catch {
    return {}
  }
}

const writeSecrets = (file, data) => {
  ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, file)
}

export const readSecret = (key, file = secretsPath()) => {
  const value = readSecrets(file)[key]

  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export const saveSecret = (key, value, file = secretsPath()) => {
  writeSecrets(file, { ...readSecrets(file), [key]: value })

  return file
}

// Removes the key; deletes the file when nothing is left in it.
export const removeSecret = (key, file = secretsPath()) => {
  const data = readSecrets(file)
  if (!(key in data)) return false
  delete data[key]
  if (Object.keys(data).length) writeSecrets(file, data)
  else fs.rmSync(file, { force: true })

  return true
}
