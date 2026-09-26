// A stand-in for the Shortcut REST API v3 on a local node:http server, for the tests.
//
// startFakeShortcut() resolves to { base, requests, close }: point HERDR_ISSUES_SHORTCUT_API (or the
// `base` option) at `base`. Every request is recorded as { method, path, query, token }. Only the
// endpoints the plugin uses are implemented; the token must be TOKEN or the API answers 401.
import http from 'node:http'

export const TOKEN = 'sc-test-token'

export const members = [
  { id: 'm-ana', profile: { mention_name: 'ana', name: 'Ana Pérez' } },
  { id: 'm-bo', profile: { mention_name: 'bo', name: 'Bo Li' } },
  { id: 'm-cy', profile: { mention_name: 'cy', name: 'Cy Doe' } },
]
export const workflows = [
  {
    id: 1,
    states: [
      { id: 500, name: 'Ready for Dev', type: 'unstarted' },
      { id: 501, name: 'In Progress', type: 'started' },
      { id: 502, name: 'Done', type: 'done' },
    ],
  },
]
export const groups = [
  { id: 'g-1', name: 'Backend', mention_name: 'backend', archived: false },
  { id: 'g-2', name: 'Old', mention_name: 'old', archived: true },
]

const slim = (id, overrides = {}) => ({
  id,
  name: `Story ${id}`,
  app_url: `https://app.shortcut.com/acme/story/${id}/story-${id}`,
  story_type: 'feature',
  workflow_state_id: 500,
  owner_ids: [],
  requested_by_id: 'm-cy',
  labels: [],
  completed: false,
  archived: false,
  estimate: null,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: `2026-09-${String(10 + (id % 15)).padStart(2, '0')}T10:00:00Z`,
  ...overrides,
})

export const story482 = {
  ...slim(482, {
    name: 'Returns page crashes on empty address',
    app_url: 'https://app.shortcut.com/acme/story/482/returns-page-crashes-on-empty-address',
    story_type: 'bug',
    workflow_state_id: 501,
    owner_ids: ['m-ana', 'm-bo'],
    labels: [{ name: 'returns' }, { name: 'p1' }],
    estimate: 3,
    updated_at: '2026-09-25T10:00:00Z',
    formatted_vcs_branch_name: 'ana/sc-482/returns-page-crashes-on-empty-address',
  }),
  description: 'The page **crashes** when the address is empty.',
  tasks: [
    { description: 'Reproduce', complete: true },
    { description: 'Fix the\nvalidation', complete: false },
  ],
  comments: [
    { author_id: 'm-bo', text: 'Second', created_at: '2026-09-21T10:00:00Z', deleted: false },
    { author_id: 'm-ana', text: 'First, see sc-12', created_at: '2026-09-20T10:00:00Z', deleted: false },
    { author_id: 'm-cy', text: 'gone', created_at: '2026-09-22T10:00:00Z', deleted: true },
  ],
}

// 30 open stories (two pages of 25) plus one done story that only shows up without !is:done.
export const openStories = [story482, ...Array.from({ length: 29 }, (_, index) => slim(100 + index))]
export const doneStory = slim(90, { completed: true, workflow_state_id: 502, name: 'Old done story' })

export const startFakeShortcut = () =>
  new Promise(resolve => {
    const requests = []
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost')
      const token = req.headers['shortcut-token'] ?? null
      requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), token })
      const send = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (token !== TOKEN) return send(401, { message: 'Unauthorized' })
      const route = url.pathname.replace(/^\/api\/v3/, '')
      if (route === '/member') return send(200, { id: 'm-ana', mention_name: 'ana', name: 'Ana Pérez', workspace2: { url_slug: 'acme' } })
      if (route === '/members') return send(200, members)
      if (route === '/workflows') return send(200, workflows)
      if (route === '/groups') return send(200, groups)
      if (route === '/search/stories') {
        const query = url.searchParams.get('query') ?? ''
        const mentionId = name => members.find(member => member.profile.mention_name === name)?.id
        const owner = /owner:(\S+)/.exec(query)?.[1]
        const requester = /requester:(\S+)/.exec(query)?.[1]
        const all = (query.includes('!is:done') ? openStories : [...openStories, doneStory])
          .filter(story => !owner || story.owner_ids.includes(mentionId(owner)))
          .filter(story => !requester || story.requested_by_id === mentionId(requester))
        const offset = Number(url.searchParams.get('next') ?? 0)
        const size = Number(url.searchParams.get('page_size') ?? 25)
        const data = all.slice(offset, offset + size).map(({ description, tasks, comments, ...rest }) => rest)
        const nextParams = new URLSearchParams(url.searchParams)
        nextParams.set('next', String(offset + size))
        const next = offset + size < all.length ? `/api/v3/search/stories?${nextParams}` : null

        return send(200, { data, next, total: all.length })
      }
      const story = /^\/stories\/(\d+)$/.exec(route)
      if (story) {
        const found = Number(story[1]) === 482 ? story482 : null

        return found ? send(200, found) : send(404, { message: 'Resource not found' })
      }
      send(404, { message: 'no such route' })
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ base: `http://127.0.0.1:${port}/api/v3`, requests, close: () => new Promise(done => server.close(done)) })
    })
  })
