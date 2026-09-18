// Shared test helpers: temp dirs, the fake herdr binary, sample issues.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
export const projectRoot = path.resolve(fixtures, '..', '..')

export const tempDir = (prefix = 'herdr-issues-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix))

// Points HERDR_BIN_PATH at the fake herdr for the duration of `fn` and returns the recorded calls.
export const withFakeHerdr = async (scenario, fn) => {
  const dir = tempDir()
  const log = path.join(dir, 'calls.log')
  const saved = { bin: process.env.HERDR_BIN_PATH, scenario: process.env.FAKE_HERDR_SCENARIO, log: process.env.FAKE_HERDR_LOG, node: process.env.FAKE_HERDR_NODE }
  process.env.HERDR_BIN_PATH = path.join(fixtures, 'fake-herdr')
  process.env.FAKE_HERDR_SCENARIO = scenario
  process.env.FAKE_HERDR_LOG = log
  process.env.FAKE_HERDR_NODE = process.execPath
  try {
    const result = await fn()
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []

    return { result, calls }
  } finally {
    for (const [key, name] of [['bin', 'HERDR_BIN_PATH'], ['scenario', 'FAKE_HERDR_SCENARIO'], ['log', 'FAKE_HERDR_LOG'], ['node', 'FAKE_HERDR_NODE']]) {
      if (saved[key] === undefined) delete process.env[name]
      else process.env[name] = saved[key]
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

export const sampleIssue = (overrides = {}) => ({
  number: 482,
  title: 'Returns page crashes on empty address',
  state: 'OPEN',
  url: 'https://github.com/acme/shop/issues/482',
  author: { login: 'zamarrowski', name: 'Sergio Zamarro', is_bot: false },
  labels: [
    { name: 'bug', color: 'd73a4a', description: '' },
    { name: 'p1', color: 'b60205', description: '' },
  ],
  assignees: [{ login: 'zamarrowski' }],
  createdAt: '2026-09-10T09:00:00Z',
  updatedAt: '2026-09-18T20:00:00Z',
  ...overrides,
})

export const commandsOf = calls => calls.map(call => call.slice(0, 2).join(' '))
export const find = (calls, group, command) => calls.filter(call => call[0] === group && call[1] === command)
