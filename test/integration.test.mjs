import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { ApiError, ME, byUpdatedDesc, checklist, fetchJson, notSetUp, peopleFilter, tokenFrom } from '../lib/integration.mjs'
import { saveSecret } from '../lib/secrets.mjs'
import { tempDir } from './helpers.mjs'

describe('tokenFrom', () => {
  it('prefers the environment, then secrets.json', () => {
    const file = path.join(tempDir(), 'secrets.json')
    const where = { envName: 'ACME_TOKEN', secretKey: 'acme_token', file }
    assert.equal(tokenFrom({ ...where, env: {} }), null)
    saveSecret('acme_token', ' saved ', file)
    assert.deepEqual(tokenFrom({ ...where, env: {} }), { token: 'saved', from: 'file' })
    assert.deepEqual(tokenFrom({ ...where, env: { ACME_TOKEN: ' env ' } }), { token: 'env', from: 'env' })
    assert.deepEqual(tokenFrom({ ...where, env: { ACME_TOKEN: '  ' } }), { token: 'saved', from: 'file' })
  })
  it('says how to set a token up', () => {
    assert.equal(notSetUp({ name: 'Acme', tokenName: 'API key', tokenEnv: 'ACME_TOKEN' }), 'Acme is not set up: add an API key in the Acme tab of the issues popup, or set ACME_TOKEN')
  })
})

describe('peopleFilter', () => {
  const filter = peopleFilter([
    ['lead', 'Lead'],
    ['reporter', 'Reporter'],
  ])
  it('keeps anyone, me and handles, and drops anything else', () => {
    assert.deepEqual(filter.names, ['lead', 'reporter'])
    assert.deepEqual(filter.normalize(undefined), { lead: null, reporter: null })
    assert.deepEqual(filter.normalize({ lead: ME, reporter: '@bo.li+x', other: 'ana' }), { lead: ME, reporter: 'bo.li+x' })
    assert.deepEqual(filter.normalize({ lead: 'a b', reporter: 3 }), { lead: null, reporter: null })
  })
  it('describes itself', () => {
    assert.equal(filter.text({ lead: ME, reporter: 'bo' }), 'lead me · reporter @bo')
    assert.equal(filter.text({ lead: null, reporter: 'bo' }), 'reporter @bo')
    assert.equal(filter.text({}), '')
  })
})

describe('checklist and order', () => {
  it('renders a Markdown task list, one line per item', () => {
    assert.equal(checklist('Tasks', [{ done: true, text: 'One' }, { done: false, text: 'Two\nlines' }, { text: '' }]), '**Tasks**\n\n- [x] One\n- [ ] Two lines')
    assert.equal(checklist('Tasks', []), '')
    assert.equal(checklist('Tasks', undefined), '')
  })
  it('sorts newest updated first', () => {
    const items = [{ updatedAt: '2026-01-01' }, { updatedAt: '2026-03-01' }, { updatedAt: null }]
    assert.deepEqual(items.sort(byUpdatedDesc).map(item => item.updatedAt), ['2026-03-01', '2026-01-01', null])
  })
})

describe('fetchJson', () => {
  let server
  let base
  const seen = []
  before(async () => {
    server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', chunk => (raw += chunk))
      req.on('end', () => {
        seen.push({ method: req.method, auth: req.headers.authorization, type: req.headers['content-type'] ?? null, body: raw })
        const status = Number(new URL(req.url, 'http://x').searchParams.get('status') ?? 200)
        if (req.url.includes('text')) {
          res.writeHead(status)

          return res.end('not json')
        }
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ echo: raw ? JSON.parse(raw) : null }))
      })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${server.address().port}`
  })
  after(() => new Promise(resolve => server.close(resolve)))

  it('sends JSON with the given headers and returns the parsed answer', async () => {
    const answer = await fetchJson(`${base}/x`, { service: 'Acme', method: 'POST', headers: { Authorization: 'k' }, body: { a: 1 } })
    assert.deepEqual(answer, { status: 200, ok: true, data: { echo: { a: 1 } } })
    assert.deepEqual(seen.at(-1), { method: 'POST', auth: 'k', type: 'application/json', body: '{"a":1}' })
    await fetchJson(`${base}/x`, { service: 'Acme' })
    assert.equal(seen.at(-1).type, null, 'no body, no content type')
  })
  it('hands other answers to the integration, with null data without JSON', async () => {
    assert.deepEqual(await fetchJson(`${base}/x?status=404`, { service: 'Acme' }), { status: 404, ok: false, data: { echo: null } })
    assert.deepEqual(await fetchJson(`${base}/text?status=500`, { service: 'Acme' }), { status: 500, ok: false, data: null })
  })
  it('turns rejections, rate limits and network failures into ApiError', async () => {
    await assert.rejects(fetchJson(`${base}/x?status=401`, { service: 'Acme' }), error => error instanceof ApiError && error.message === 'Acme rejected the token' && error.status === 401)
    await assert.rejects(fetchJson(`${base}/x?status=403`, { service: 'Acme', rejected: 'no way' }), { message: 'no way', status: 403 })
    await assert.rejects(fetchJson(`${base}/x?status=429`, { service: 'Acme', rateLimited: 'slow down' }), { message: 'slow down', status: 429 })
    await assert.rejects(fetchJson('http://127.0.0.1:9/x', { service: 'Acme', timeoutMs: 2000 }), /could not reach Acme|Acme did not answer/)
  })
})
