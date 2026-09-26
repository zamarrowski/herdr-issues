import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { readSecret, removeSecret, saveSecret } from '../lib/secrets.mjs'
import {
  SECRET_KEY,
  ME,
  buildQuery,
  currentMember,
  filterText,
  normalizeFilter,
  resolveFilter,
  getStory,
  listStories,
  listTeams,
  loadLookups,
  normalizeStory,
  parseStoryRef,
  request,
  shortcutToken,
  workspaceOfUrl,
} from '../lib/shortcut.mjs'
import { TOKEN, startFakeShortcut, story482 } from './fixtures/fake-shortcut.mjs'
import { tempDir } from './helpers.mjs'

describe('parseStoryRef', () => {
  it('accepts sc-ids and story URLs', () => {
    assert.deepEqual(parseStoryRef('sc-482'), { number: 482, ref: 'sc-482', workspace: null })
    assert.deepEqual(parseStoryRef(' [SC-482] '), { number: 482, ref: 'sc-482', workspace: null })
    assert.deepEqual(parseStoryRef('https://app.shortcut.com/acme/story/482'), { number: 482, ref: 'sc-482', workspace: 'acme' })
    assert.deepEqual(parseStoryRef('https://app.shortcut.com/acme/story/482/returns-page?x=1'), { number: 482, ref: 'sc-482', workspace: 'acme' })
    assert.deepEqual(parseStoryRef('https://app.clubhouse.io/acme/story/7/old-host'), { number: 7, ref: 'sc-7', workspace: 'acme' })
  })
  it('rejects plain numbers, epics and GitHub URLs', () => {
    assert.equal(parseStoryRef('482'), null)
    assert.equal(parseStoryRef('#482'), null)
    assert.equal(parseStoryRef('https://app.shortcut.com/acme/epic/12'), null)
    assert.equal(parseStoryRef('https://github.com/acme/shop/issues/482'), null)
    assert.equal(parseStoryRef(''), null)
  })
  it('reads the workspace of a story URL', () => {
    assert.equal(workspaceOfUrl('https://app.shortcut.com/acme/story/1'), 'acme')
    assert.equal(workspaceOfUrl('nope'), null)
  })
})

describe('buildQuery', () => {
  it('adds the team and drops !is:done for closed stories', () => {
    assert.equal(buildQuery({}), '!is:done !is:archived')
    assert.equal(buildQuery({ team: 'Backend' }), '!is:done !is:archived team:"Backend"')
    assert.equal(buildQuery({ closed: true }), '!is:archived')
    assert.equal(buildQuery({ query: 'owner:ana !is:done', closed: true, team: 'A "B"' }), 'owner:ana team:"A B"')
    assert.equal(buildQuery({ query: '  ' }), '!is:done !is:archived')
  })
  it('adds the owner and requester filter by mention name', () => {
    assert.equal(buildQuery({ owner: 'ana', requester: '@bo' }), '!is:done !is:archived owner:ana requester:bo')
    assert.equal(buildQuery({ owner: 'a b"; x' }), '!is:done !is:archived owner:abx')
  })
})

describe('people filter', () => {
  it('keeps anyone, me and mention names, and drops anything else', () => {
    assert.deepEqual(normalizeFilter(undefined), { owner: null, requester: null })
    assert.deepEqual(normalizeFilter({ owner: ME, requester: '@bo' }), { owner: ME, requester: 'bo' })
    assert.deepEqual(normalizeFilter({ owner: 'a b', requester: 3 }), { owner: null, requester: null })
  })
  it('resolves me against the token owner and describes itself', () => {
    assert.deepEqual(resolveFilter({ owner: ME, requester: 'bo' }, { mention: 'ana' }), { owner: 'ana', requester: 'bo' })
    assert.deepEqual(resolveFilter({ owner: null, requester: null }, null), { owner: '', requester: '' })
    assert.equal(filterText({ owner: ME, requester: 'bo' }), 'owner me · requester @bo')
    assert.equal(filterText({ owner: null, requester: null }), '')
  })
})

describe('normalizeStory', () => {
  const lookups = { members: { 'm-ana': 'ana', 'm-bo': 'bo', 'm-cy': 'cy' }, states: { 501: { name: 'In Progress', type: 'started' } } }
  it('maps a full story to the shared record shape', () => {
    const record = normalizeStory(story482, lookups)
    assert.equal(record.source, 'shortcut')
    assert.equal(record.number, 482)
    assert.equal(record.ref, 'sc-482')
    assert.equal(record.title, 'Returns page crashes on empty address')
    assert.equal(record.closed, false)
    assert.equal(record.stateName, 'In Progress')
    assert.equal(record.type, 'bug')
    assert.equal(record.estimate, 3)
    assert.equal(record.workspace, 'acme')
    assert.deepEqual(record.labels, [{ name: 'returns' }, { name: 'p1' }])
    assert.deepEqual(record.assignees, [{ login: 'ana' }, { login: 'bo' }])
    assert.deepEqual(record.author, { login: 'cy' })
    assert.equal(record.body, 'The page **crashes** when the address is empty.\n\n**Tasks**\n\n- [x] Reproduce\n- [ ] Fix the validation')
    assert.deepEqual(
      record.comments.map(comment => [comment.author.login, comment.body]),
      [
        ['ana', 'First, see sc-12'],
        ['bo', 'Second'],
      ],
      'oldest first, deleted comments dropped',
    )
  })
  it('marks completed and archived stories closed, and slim stories have no body', () => {
    const { description, tasks, comments, ...slim } = story482
    const done = normalizeStory({ ...slim, completed: true, workflow_state_id: 999 }, lookups)
    assert.equal(done.closed, true)
    assert.equal(done.stateName, 'Done')
    assert.equal(done.body, undefined)
    assert.equal(normalizeStory({ ...slim, archived: true }, lookups).stateName, 'Archived')
    assert.deepEqual(normalizeStory({ ...slim, owner_ids: ['unknown'] }, lookups).assignees, [])
  })
})

describe('Shortcut API client', () => {
  let fake
  before(async () => {
    fake = await startFakeShortcut()
  })
  after(() => fake.close())

  it('reads the member and the lookups with the token header', async () => {
    fake.requests.length = 0
    assert.deepEqual(await currentMember(TOKEN, { base: fake.base }), { mention: 'ana', name: 'Ana Pérez', workspace: 'acme' })
    const lookups = await loadLookups(TOKEN, { base: fake.base })
    assert.equal(lookups.members['m-bo'], 'bo')
    assert.deepEqual(lookups.states[502], { name: 'Done', type: 'done' })
    assert.deepEqual(lookups.people.map(person => person.mention), ['ana', 'bo', 'cy'])
    assert.ok(fake.requests.every(entry => entry.token === TOKEN))
    assert.deepEqual((await listTeams(TOKEN, { base: fake.base })).map(team => team.name), ['Backend'])
  })
  it('follows next pages up to the limit, newest updated first', async () => {
    fake.requests.length = 0
    const stories = await listStories(TOKEN, { base: fake.base, limit: 27, team: 'Backend' })
    assert.equal(stories.length, 27)
    assert.equal(stories[0].ref, 'sc-482', 'sorted by updatedAt, not relevance')
    const searches = fake.requests.filter(entry => entry.path.endsWith('/search/stories'))
    assert.equal(searches.length, 2)
    assert.equal(searches[0].query.query, '!is:done !is:archived team:"Backend"')
    assert.equal(searches[0].query.detail, 'slim')
    assert.ok(stories.every(story => story.body === undefined))
  })
  it('sends the people filter in the search query', async () => {
    fake.requests.length = 0
    const stories = await listStories(TOKEN, { base: fake.base, owner: 'ana', requester: 'cy' })
    assert.equal(fake.requests[0].query.query, '!is:done !is:archived owner:ana requester:cy')
    assert.deepEqual(stories.map(story => story.ref), ['sc-482'])
  })
  it('stops when there is no next page, and includes done stories on request', async () => {
    const open = await listStories(TOKEN, { base: fake.base, limit: 100 })
    assert.equal(open.length, 30)
    const all = await listStories(TOKEN, { base: fake.base, limit: 100, closed: true })
    assert.equal(all.length, 31)
    assert.ok(all.some(story => story.closed && story.ref === 'sc-90'))
  })
  it('reads one story', async () => {
    const story = await getStory(TOKEN, 482, { base: fake.base, lookups: await loadLookups(TOKEN, { base: fake.base }) })
    assert.equal(story.stateName, 'In Progress')
    assert.equal(story.comments.length, 2)
  })
  it('maps errors to readable messages without the token', async () => {
    await assert.rejects(currentMember('wrong', { base: fake.base }), error => error.message === 'Shortcut rejected the token' && error.status === 401)
    await assert.rejects(getStory(TOKEN, 9999, { base: fake.base }), error => error.message === 'story sc-9999 not found' && error.status === 404)
    await assert.rejects(request('/member', { token: null, base: fake.base }), /not set up/)
    await assert.rejects(request('http://example.com/api/v3/member', { token: TOKEN, base: fake.base }), /refusing to send the Shortcut token/)
  })
  it('reports an unreachable server', async () => {
    await assert.rejects(currentMember(TOKEN, { base: 'http://127.0.0.1:9/api/v3', timeoutMs: 2000 }), /could not reach Shortcut|did not answer/)
  })
})

describe('Shortcut token', () => {
  it('prefers SHORTCUT_API_TOKEN, then secrets.json', () => {
    const file = path.join(tempDir(), 'secrets.json')
    assert.equal(shortcutToken({ env: {}, file }), null)
    saveSecret(SECRET_KEY, 'from-file', file)
    assert.deepEqual(shortcutToken({ env: {}, file }), { token: 'from-file', from: 'file' })
    assert.deepEqual(shortcutToken({ env: { SHORTCUT_API_TOKEN: ' from-env ' }, file }), { token: 'from-env', from: 'env' })
  })
  it('keeps secrets.json readable by the user only and removes it when empty', () => {
    const file = path.join(tempDir(), 'nested', 'secrets.json')
    saveSecret(SECRET_KEY, 'abc', file)
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    saveSecret('other', 'x', file)
    assert.equal(readSecret(SECRET_KEY, file), 'abc')
    assert.equal(removeSecret(SECRET_KEY, file), true)
    assert.equal(readSecret(SECRET_KEY, file), null)
    assert.equal(readSecret('other', file), 'x')
    removeSecret('other', file)
    assert.equal(fs.existsSync(file), false)
    assert.equal(removeSecret('other', file), false)
  })
})
