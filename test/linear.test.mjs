import assert from 'node:assert/strict'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { saveSecret } from '../lib/secrets.mjs'
import {
  ME,
  SECRET_KEY,
  buildFilter,
  filterText,
  getIssue,
  linearToken,
  listIssues,
  listTeams,
  loadLookups,
  normalizeFilter,
  normalizeIssue,
  parseLinearRef,
  request,
  viewer,
  workspaceOfUrl,
} from '../lib/linear.mjs'
import { REMOTES } from '../lib/remotes.mjs'
import { remoteChecks } from '../lib/setup.mjs'
import { TOKEN, issue123, startFakeLinear } from './fixtures/fake-linear.mjs'
import { tempDir, withEnv } from './helpers.mjs'

describe('parseLinearRef', () => {
  it('accepts identifiers in any case and issue URLs with or without the slug', () => {
    assert.deepEqual(parseLinearRef('ENG-123'), { number: 123, ref: 'ENG-123', workspace: null })
    assert.deepEqual(parseLinearRef(' eng-123 '), { number: 123, ref: 'ENG-123', workspace: null })
    assert.deepEqual(parseLinearRef('https://linear.app/acme/issue/ENG-123'), { number: 123, ref: 'ENG-123', workspace: 'acme' })
    assert.deepEqual(parseLinearRef('https://linear.app/acme/issue/eng-123/returns-page?x=1'), { number: 123, ref: 'ENG-123', workspace: 'acme' })
    assert.deepEqual(parseLinearRef('A2B-7'), { number: 7, ref: 'A2B-7', workspace: null })
  })
  it('rejects bare numbers, other Linear pages and GitHub URLs', () => {
    assert.equal(parseLinearRef('123'), null)
    assert.equal(parseLinearRef('#123'), null)
    assert.equal(parseLinearRef('2B-7'), null)
    assert.equal(parseLinearRef('https://linear.app/acme/project/returns-1234'), null)
    assert.equal(parseLinearRef('https://linear.app/acme/team/ENG/active'), null)
    assert.equal(parseLinearRef('https://linear.app/acme/issue/ENG'), null)
    assert.equal(parseLinearRef('https://github.com/acme/shop/issues/482'), null)
    assert.equal(parseLinearRef(''), null)
  })
  it('reads the workspace of an issue URL', () => {
    assert.equal(workspaceOfUrl('https://linear.app/acme/issue/ENG-1/x'), 'acme')
    assert.equal(workspaceOfUrl('nope'), null)
  })
})

describe('buildFilter', () => {
  it('leaves completed and canceled issues out unless asked', () => {
    assert.deepEqual(buildFilter({}), { and: [{ state: { type: { nin: ['completed', 'canceled'] } } }] })
    assert.deepEqual(buildFilter({ closed: true }), {})
  })
  it('adds the team, the people filter and the configured conditions', () => {
    const filter = buildFilter({ team: 'ENG', assignee: ME, creator: 'bo', extra: { priority: { lte: 2 } } })
    assert.deepEqual(filter.and, [
      { team: { or: [{ key: { eqIgnoreCase: 'ENG' } }, { name: { eqIgnoreCase: 'ENG' } }] } },
      { state: { type: { nin: ['completed', 'canceled'] } } },
      { assignee: { isMe: { eq: true } } },
      { creator: { displayName: { eq: 'bo' } } },
      { priority: { lte: 2 } },
    ])
    assert.equal(buildFilter({ closed: true, extra: {} }).and, undefined)
    assert.equal(buildFilter({ closed: true, extra: [1] }).and, undefined)
  })
})

describe('people filter', () => {
  it('keeps anyone, me and display names, and drops anything else', () => {
    assert.deepEqual(normalizeFilter(undefined), { assignee: null, creator: null })
    assert.deepEqual(normalizeFilter({ assignee: ME, creator: '@bo' }), { assignee: ME, creator: 'bo' })
    assert.deepEqual(normalizeFilter({ assignee: 'a b', creator: 3, owner: 'ana' }), { assignee: null, creator: null })
  })
  it('describes itself', () => {
    assert.equal(filterText({ assignee: ME, creator: 'bo' }), 'assignee me · creator @bo')
    assert.equal(filterText({ assignee: null, creator: null }), '')
  })
})

describe('normalizeIssue', () => {
  it('maps a full issue to the shared record shape', () => {
    const record = normalizeIssue(issue123)
    assert.equal(record.source, 'linear')
    assert.equal(record.number, 123)
    assert.equal(record.ref, 'ENG-123')
    assert.equal(record.id, 'uuid-123')
    assert.equal(record.closed, false)
    assert.equal(record.state, 'OPEN')
    assert.equal(record.stateName, 'In Progress')
    assert.equal(record.priority, 'High')
    assert.equal(record.estimate, 3)
    assert.equal(record.workspace, 'acme')
    assert.equal(record.vcsBranch, 'ana/eng-123-returns-page-crashes-on-empty-address')
    assert.deepEqual(record.labels, [{ name: 'Bug' }, { name: 'returns' }])
    assert.deepEqual(record.assignees, [{ login: 'ana' }])
    assert.deepEqual(record.author, { login: 'cy' })
    assert.equal(record.project, 'Returns')
    assert.equal(record.cycle, 'Cycle 12')
    assert.equal(record.parent, 'ENG-100')
    assert.equal(record.body, 'The page **crashes** when the address is empty. See WEB-7.\n\n**Sub-issues**\n\n- [x] ENG-124 Reproduce\n- [ ] ENG-125 Fix the validation')
    assert.deepEqual(
      record.comments.map(comment => [comment.author.login, comment.body]),
      [
        ['ana', 'First'],
        ['bo', 'Second'],
        ['GitHub', 'Linked a pull request'],
      ],
      'oldest first, bots by name',
    )
  })
  it('marks completed and canceled issues closed, and list nodes have no body', () => {
    const { description, comments, children, parent, project, cycle, ...slim } = issue123
    const done = normalizeIssue({ ...slim, state: { name: 'Done', type: 'completed' } })
    assert.equal(done.closed, true)
    assert.equal(done.state, 'CLOSED')
    assert.equal(done.body, undefined)
    assert.equal(normalizeIssue({ ...slim, state: { name: 'Duplicate', type: 'canceled' } }).closed, true)
    assert.equal(normalizeIssue({ ...slim, state: { name: 'Triage', type: 'triage' } }).closed, false)
    assert.equal(normalizeIssue({ ...slim, priority: 0, priorityLabel: 'No priority' }).priority, null)
    assert.deepEqual(normalizeIssue({ ...slim, assignee: null }).assignees, [])
  })
})

describe('Linear API client', () => {
  let fake
  const options = () => ({ url: fake.url })
  before(async () => {
    fake = await startFakeLinear()
  })
  after(() => fake.close())

  it('reads the viewer, the teams and the people with the key header (no Bearer)', async () => {
    fake.requests.length = 0
    assert.deepEqual(await viewer(TOKEN, options()), { handle: 'ana', name: 'Ana Pérez', workspace: 'acme', organization: 'Acme' })
    assert.deepEqual((await listTeams(TOKEN, options())).map(team => team.key), ['ENG', 'WEB'])
    assert.deepEqual((await loadLookups(TOKEN, options())).people.map(person => person.handle), ['ana', 'bo', 'cy'], 'inactive members left out')
    assert.ok(fake.requests.every(entry => entry.token === TOKEN))
  })
  it('follows the cursor up to the limit, newest updated first', async () => {
    fake.requests.length = 0
    const issues = await listIssues(TOKEN, { ...options(), limit: 55, team: 'eng' })
    assert.equal(issues.length, 55)
    assert.equal(issues[0].ref, 'ENG-123')
    assert.ok(issues.every(issue => issue.ref.startsWith('ENG-') && issue.body === undefined))
    const pages = fake.requests.filter(entry => entry.operation === 'Issues')
    assert.deepEqual(
      pages.map(entry => [entry.variables.first, entry.variables.after]),
      [
        [50, null],
        [5, '50'],
      ],
    )
    assert.ok(issues.every((issue, index) => index === 0 || Date.parse(issues[index - 1].updatedAt) >= Date.parse(issue.updatedAt)))
  })
  it('stops at the last page, and includes completed issues on request', async () => {
    assert.equal((await listIssues(TOKEN, { ...options(), limit: 100 })).length, 61)
    const all = await listIssues(TOKEN, { ...options(), limit: 100, closed: true })
    assert.equal(all.length, 62)
    assert.ok(all.some(issue => issue.closed && issue.ref === 'ENG-90'))
    assert.equal((await listIssues(TOKEN, { ...options(), team: 'Web' })).length, 1, 'team by name too')
  })
  it('sends the people filter and the configured conditions', async () => {
    assert.deepEqual((await listIssues(TOKEN, { ...options(), assignee: ME })).map(issue => issue.ref), ['ENG-123'])
    assert.deepEqual((await listIssues(TOKEN, { ...options(), assignee: 'bo' })).length, 0)
    assert.deepEqual((await listIssues(TOKEN, { ...options(), extra: { priority: { lte: 2 } } })).map(issue => issue.ref), ['ENG-123'])
  })
  it('reads one issue by its identifier', async () => {
    const issue = await getIssue(TOKEN, 'ENG-123', options())
    assert.equal(issue.stateName, 'In Progress')
    assert.equal(issue.comments.length, 3)
    assert.match(issue.body, /Sub-issues/)
  })
  it('maps errors to readable messages without the key', async () => {
    await assert.rejects(viewer('wrong', options()), error => error.message === 'Linear rejected the API key' && error.status === 401 && !error.message.includes('wrong'))
    await assert.rejects(getIssue(TOKEN, 'ENG-9999', options()), error => error.message === 'issue ENG-9999 not found' && error.status === 404)
    fake.rateLimitOnce()
    await assert.rejects(viewer(TOKEN, options()), error => /rate limit/.test(error.message) && error.status === 429)
    await assert.rejects(request('query Viewer { viewer { id } }', {}, { token: null, ...options() }), /not set up/)
  })
  it('reports an unreachable server', async () => {
    await assert.rejects(viewer(TOKEN, { url: 'http://127.0.0.1:9/graphql', timeoutMs: 2000 }), /could not reach Linear|did not answer/)
  })
  it('checks the key and the team for the setup popup', () =>
    withEnv({ HERDR_ISSUES_LINEAR_API: fake.url }, async () => {
      const env = { LINEAR_API_KEY: TOKEN }
      assert.deepEqual(await remoteChecks(REMOTES.linear, { linear: { team: 'eng' } }, { env }), [
        { ok: true, text: 'Linear: Ana Pérez in Acme (key from LINEAR_API_KEY)' },
        { ok: true, text: 'Linear team "eng"' },
      ])
      assert.deepEqual((await remoteChecks(REMOTES.linear, { linear: { team: 'ENGG' } }, { env }))[1], { ok: false, text: 'Linear: no team "ENGG"; teams: ENG, WEB' })
      assert.equal((await remoteChecks(REMOTES.linear, { linear: {} }, { env: { LINEAR_API_KEY: 'wrong' } }))[0].ok, false)
    }))
  it('lists and reads through the shared remote interface', () =>
    withEnv({ HERDR_ISSUES_LINEAR_API: fake.url }, async () => {
      const remote = REMOTES.linear
      const config = { linear: { team: 'ENG', filter: {} } }
      const items = await remote.list(TOKEN, { config, closed: false, limit: 10, filter: { assignee: ME, creator: null } })
      assert.deepEqual(items.map(issue => issue.ref), ['ENG-123'])
      assert.equal((await remote.view(TOKEN, items[0])).comments.length, 3)
      assert.equal((await remote.fetch(TOKEN, parseLinearRef('https://linear.app/acme/issue/ENG-123/x'))).ref, 'ENG-123')
      assert.equal((await remote.whoami(TOKEN)).handle, 'ana')
    }))
})

describe('Linear API key', () => {
  it('prefers LINEAR_API_KEY, then secrets.json', () => {
    const file = path.join(tempDir(), 'secrets.json')
    assert.equal(linearToken({ env: {}, file }), null)
    saveSecret(SECRET_KEY, 'from-file', file)
    assert.deepEqual(linearToken({ env: {}, file }), { token: 'from-file', from: 'file' })
    assert.deepEqual(linearToken({ env: { LINEAR_API_KEY: ' from-env ' }, file }), { token: 'from-env', from: 'env' })
  })
})
