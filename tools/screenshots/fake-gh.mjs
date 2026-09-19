// A scripted `gh` for the README screenshots: a fictional acme/shop repository with a dozen issues.
// Only the subcommands the plugin uses are implemented. Dates are relative to now so ages look real.
const args = process.argv.slice(2)
const hoursAgo = hours => new Date(Date.now() - hours * 3_600_000).toISOString()
const user = login => ({ id: `U_${login}`, is_bot: false, login, name: login })
const label = (name, color) => ({ id: `L_${name}`, name, color, description: '' })

const LABELS = {
  bug: label('bug', 'd73a4a'),
  p1: label('p1', 'b60205'),
  feature: label('feature', 'a2eeef'),
  tests: label('tests', 'fbca04'),
  docs: label('docs', '0075ca'),
  gfi: label('good first issue', '7057ff'),
  chore: label('chore', 'ededed'),
  security: label('security', 'e11d21'),
  ui: label('ui', 'c5def5'),
  perf: label('performance', 'bfd4f2'),
  i18n: label('i18n', '5319e7'),
  payments: label('payments', '006b75'),
}

const issue = (number, title, { labels = [], assignees = [], author = 'ana', updated, created }) => ({
  number,
  title,
  state: 'OPEN',
  url: `https://github.com/acme/shop/issues/${number}`,
  author: user(author),
  labels,
  assignees: assignees.map(user),
  createdAt: hoursAgo(created),
  updatedAt: hoursAgo(updated),
})

const ISSUES = [
  issue(482, 'Returns page crashes on empty address', { labels: [LABELS.bug, LABELS.p1], assignees: ['ana'], author: 'marta', updated: 2, created: 70 }),
  issue(479, 'Add CSV export to the refunds table', { labels: [LABELS.feature], author: 'luis', updated: 26, created: 120 }),
  issue(477, 'Checkout totals ignore the coupon when the cart has a gift card', { labels: [LABELS.bug, LABELS.payments], assignees: ['luis'], updated: 31, created: 200 }),
  issue(471, 'Flaky test: checkout totals with coupons', { labels: [LABELS.tests], author: 'ci-bot', updated: 3 * 24, created: 5 * 24 }),
  issue(468, 'Document the webhook retry policy', { labels: [LABELS.docs, LABELS.gfi], updated: 4 * 24, created: 9 * 24 }),
  issue(465, 'Order search should match SKUs', { labels: [LABELS.feature], assignees: ['ana'], author: 'marta', updated: 6 * 24, created: 12 * 24 }),
  issue(460, 'Upgrade CI to Node 22', { labels: [LABELS.chore], author: 'luis', updated: 8 * 24, created: 8 * 24 }),
  issue(452, 'Rate-limit password reset emails', { labels: [LABELS.security], assignees: ['luis'], updated: 12 * 24, created: 30 * 24 }),
  issue(448, 'Dark mode toggle flickers on first paint', { labels: [LABELS.bug, LABELS.ui], author: 'marta', updated: 15 * 24, created: 16 * 24 }),
  issue(441, 'Serve product images as WebP', { labels: [LABELS.feature, LABELS.perf], updated: 20 * 24, created: 40 * 24 }),
  issue(437, 'Add --json to the CLI export command', { labels: [LABELS.feature], author: 'luis', updated: 25 * 24, created: 26 * 24 }),
  issue(430, 'Localise currency formatting for CHF', { labels: [LABELS.bug, LABELS.i18n], author: 'marta', updated: 33 * 24, created: 60 * 24 }),
]

const BODY_482 = `<!-- Please fill in every section. -->
## What happens

Opening \`/returns/new\` for an order whose shipping address is empty throws inside \`AddressSummary\` and the whole page goes blank.

## Steps to reproduce

1. Create an order with \`shipping_address: null\` (the POS app does this for in-store pickups).
2. Open the returns page for that order.
3. The page renders nothing and the console shows:

\`\`\`js
TypeError: Cannot read properties of null (reading 'line1')
    at AddressSummary (src/returns/AddressSummary.jsx:12:31)
    at renderWithHooks (react-dom.development.js:16305:18)
\`\`\`

## Expected

The page renders and shows **"No shipping address"** where the summary goes, like the orders page does since #455.

## Notes

- [x] Reproduced on \`main\` (2f1c9d0)
- [ ] Check the invoice page, it uses the same component
- Related: #455, and @luis mentioned the POS change in #430

> The POS app started sending \`null\` instead of \`{}\` in 4.2.0.
`

const COMMENTS_482 = [
  {
    id: 'C1',
    author: user('luis'),
    createdAt: hoursAgo(20),
    body: `Confirmed, the POS change shipped in 4.2.0. Guarding inside \`AddressSummary\` is the quick fix, but the API layer should default the address too:

\`\`\`jsx
<AddressSummary address={order.shipping_address ?? EMPTY_ADDRESS} />
\`\`\``,
  },
]

const out = value => {
  process.stdout.write(`${JSON.stringify(value)}\n`)
  process.exit(0)
}
const [group, command] = args
if (group === '--version') {
  process.stdout.write('gh version 2.97.0 (2026-07-31)\n')
  process.exit(0)
}
if (group === 'auth' && command === 'status') {
  process.stdout.write('github.com\n  ✓ Logged in to github.com account ana (keyring)\n')
  process.exit(0)
}
if (group === 'repo' && command === 'view') out({ nameWithOwner: 'acme/shop', url: 'https://github.com/acme/shop' })
if (group === 'issue' && command === 'list') out(ISSUES)
if (group === 'issue' && command === 'view') {
  const number = Number(args[2])
  const found = ISSUES.find(entry => entry.number === number)
  if (!found) {
    process.stderr.write(`GraphQL: Could not resolve to an Issue with the number of ${number}. (repository.issue)\n`)
    process.exit(1)
  }
  out({ ...found, body: number === 482 ? BODY_482 : `Body of #${number}.`, comments: number === 482 ? COMMENTS_482 : [] })
}
process.stderr.write(`fake gh does not implement: ${args.join(' ')}\n`)
process.exit(1)
