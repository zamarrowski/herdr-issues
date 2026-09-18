// Small process helpers: async spawn with a timeout, binary lookup, git root.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

// Resolves with { code, stdout, stderr, timedOut }. Never rejects.
export const run = (command, args, { cwd, env, timeoutMs = 60_000 } = {}) =>
  new Promise(resolve => {
    let child
    try {
      child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      return resolve({ code: -1, stdout: '', stderr: error.message, timedOut: false })
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', chunk => (stdout += chunk))
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', error => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr || error.message, timedOut })
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr, timedOut })
    })
  })

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const isExecutable = file => {
  try {
    fs.accessSync(file, fs.constants.X_OK)

    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

// PATH first, then the usual install locations: plugin panes may run with a reduced PATH.
export const findBin = (name, candidates = []) => {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && isExecutable(path.join(dir, name))) return path.join(dir, name)
  }
  for (const candidate of candidates) if (candidate && isExecutable(candidate)) return candidate

  return name
}

export const gitRoot = async cwd => {
  if (!cwd) return null
  const result = await run('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { timeoutMs: 10_000 })

  return result.code === 0 ? result.stdout.trim() : null
}
