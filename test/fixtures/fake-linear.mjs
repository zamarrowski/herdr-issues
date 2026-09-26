// A stand-in for Linear's GraphQL API on a local node:http server, for the tests.
//
// startFakeLinear() resolves to { url, requests, rateLimitOnce, close }: point HERDR_ISSUES_LINEAR_API (or
// the `url` option) at `url`. Every request is recorded as { operation, variables, token }. It answers by
// operation name (Viewer, Teams, Users, Issues, Issue) and understands the parts of IssueFilter the
// plugin sends; the key must be TOKEN or the API answers with an authentication error.
import http from 'node:http'

export const TOKEN = 'lin_api_test'

export const users = [
  { displayName: 'ana', name: 'Ana Pérez', active: true },
  { displayName: 'bo', name: 'Bo Li', active: true },
  { displayName: 'cy', name: 'Cy Doe', active: true },
  { displayName: 'gone', name: 'Old Member', active: false },
]
export const teams = [
  { key: 'ENG', name: 'Engineering' },
  { key: 'WEB', name: 'Web' },
]

const node = (number, overrides = {}) => ({
  id: `uuid-${number}`,
  identifier: `ENG-${number}`,
  number,
  title: `Issue ${number}`,
  url: `https://linear.app/acme/issue/ENG-${number}/issue-${number}`,
  branchName: `ana/eng-${number}-issue-${number}`,
  priority: 0,
  priorityLabel: 'No priority',
  estimate: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: `2026-09-${String(1 + (number % 20)).padStart(2, '0')}T10:00:00.000Z`,
  state: { name: 'Todo', type: 'unstarted' },
  assignee: null,
  creator: { displayName: 'cy' },
  labels: { nodes: [] },
  team: 'ENG',
  ...overrides,
})

export const issue123 = node(123, {
  title: 'Returns page crashes on empty address',
  url: 'https://linear.app/acme/issue/ENG-123/returns-page-crashes-on-empty-address',
  branchName: 'ana/eng-123-returns-page-crashes-on-empty-address',
  priority: 2,
  priorityLabel: 'High',
  estimate: 3,
  updatedAt: '2026-09-25T10:00:00.000Z',
  state: { name: 'In Progress', type: 'started' },
  assignee: { displayName: 'ana' },
  creator: { displayName: 'cy' },
  labels: { nodes: [{ name: 'Bug' }, { name: 'returns' }] },
  description: 'The page **crashes** when the address is empty. See WEB-7.',
  project: { name: 'Returns' },
  cycle: { number: 12, name: null },
  parent: { identifier: 'ENG-100', title: 'Returns v2' },
  children: {
    nodes: [
      { identifier: 'ENG-124', title: 'Reproduce', state: { type: 'completed' } },
      { identifier: 'ENG-125', title: 'Fix the\nvalidation', state: { type: 'started' } },
    ],
  },
  comments: {
    nodes: [
      { body: 'Second', createdAt: '2026-09-21T10:00:00.000Z', user: { displayName: 'bo' }, botActor: null },
      { body: 'Linked a pull request', createdAt: '2026-09-22T10:00:00.000Z', user: null, botActor: { name: 'GitHub' } },
      { body: 'First', createdAt: '2026-09-20T10:00:00.000Z', user: { displayName: 'ana' }, botActor: null },
    ],
  },
})

// 60 open issues in ENG (two pages of 50 would be needed for all of them), one in WEB, and one completed.
export const openIssues = [issue123, ...Array.from({ length: 59 }, (_, index) => node(200 + index)), node(7, { identifier: 'WEB-7', team: 'WEB', url: 'https://linear.app/acme/issue/WEB-7/x' })]
export const doneIssue = node(90, { title: 'Old done issue', state: { name: 'Done', type: 'completed' } })

const text = value => String(value ?? '').toLowerCase()
const matchesUser = (user, filter, me = 'ana') =>
  filter.isMe ? user?.displayName === me : filter.displayName ? user?.displayName === filter.displayName.eq : true
const matches = (issue, filter = {}) => {
  if (filter.and) return filter.and.every(part => matches(issue, part))
  if (filter.team) return filter.team.or.some(part => (part.key ? text(issue.team) === text(part.key.eqIgnoreCase) : text(teams.find(t => t.key === issue.team)?.name) === text(part.name.eqIgnoreCase)))
  if (filter.state) return !filter.state.type.nin.includes(issue.state.type)
  if (filter.assignee) return matchesUser(issue.assignee, filter.assignee)
  if (filter.creator) return matchesUser(issue.creator, filter.creator)
  if (filter.priority) return issue.priority > 0 && issue.priority <= filter.priority.lte

  return true
}
// What the API returns for a list node: no description, comments or relations.
const slim = ({ description, comments, children, parent, project, cycle, team, ...rest }) => rest
const full = ({ team, ...rest }) => ({ description: '', comments: { nodes: [] }, children: { nodes: [] }, parent: null, project: null, cycle: null, ...rest })

export const startFakeLinear = () =>
  new Promise(resolve => {
    const requests = []
    let rateLimited = false
    const server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', chunk => (raw += chunk))
      req.on('end', () => {
        const send = (status, body) => {
          res.writeHead(status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(body))
        }
        const { query = '', variables = {} } = JSON.parse(raw || '{}')
        const operation = /^\s*query\s+(\w+)/.exec(query)?.[1] ?? null
        const token = req.headers.authorization ?? null
        requests.push({ operation, variables, token })
        if (rateLimited) {
          rateLimited = false

          return send(429, { errors: [{ message: 'Rate limit exceeded', extensions: { code: 'RATELIMITED' } }] })
        }
        if (token !== TOKEN) return send(400, { errors: [{ message: 'Authentication required, not authenticated', extensions: { code: 'AUTHENTICATION_ERROR' } }] })
        if (operation === 'Viewer') return send(200, { data: { viewer: { id: 'u-ana', name: 'Ana Pérez', displayName: 'ana', organization: { name: 'Acme', urlKey: 'acme' } } } })
        if (operation === 'Teams') return send(200, { data: { teams: { nodes: teams } } })
        if (operation === 'Users') return send(200, { data: { users: { nodes: users } } })
        if (operation === 'Issues') {
          const all = [...openIssues, doneIssue].filter(issue => matches(issue, variables.filter)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
          const offset = Number(variables.after ?? 0)
          const page = all.slice(offset, offset + variables.first)
          const more = offset + variables.first < all.length

          return send(200, { data: { issues: { nodes: page.map(slim), pageInfo: { hasNextPage: more, endCursor: more ? String(offset + variables.first) : null } } } })
        }
        if (operation === 'Issue') {
          const found = [...openIssues, doneIssue].find(issue => issue.identifier === String(variables.id).toUpperCase() || issue.id === variables.id)

          return found ? send(200, { data: { issue: full(found) } }) : send(200, { data: null, errors: [{ message: 'Entity not found: Issue', extensions: { code: 'INVALID_INPUT' } }] })
        }
        send(400, { errors: [{ message: `unknown operation ${operation}` }] })
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        url: `http://127.0.0.1:${port}/graphql`,
        requests,
        rateLimitOnce: () => {
          rateLimited = true
        },
        close: () => new Promise(done => server.close(done)),
      })
    })
  })
