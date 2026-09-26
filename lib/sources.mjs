// The sources the popups show side by side, GitHub issues, Shortcut stories and Linear issues, and the
// tabs that present them. All are normalised to one record, the only shape the popups and the start flow see:
//
//   { source: 'github' | 'shortcut' | 'linear', number, ref: '#482' | 'sc-482' | 'ENG-123', title, url, closed,
//     state, stateName, type?, priority?, labels: [{ name }], assignees: [{ login }], author: { login },
//     createdAt, updatedAt, body?, comments?: [{ author: { login }, body, createdAt }] }
import { parseIssueRef } from './github.mjs'
import { byUpdatedDesc } from './integration.mjs'
import { REMOTES } from './remotes.mjs'

// The sources reached with an API token of their own (see lib/remotes.mjs); GitHub goes through gh.
export const REMOTE_SOURCES = Object.freeze(Object.keys(REMOTES))
export const SOURCES = Object.freeze(['github', ...REMOTE_SOURCES])
export const TABS = Object.freeze(['all', ...SOURCES])
export const TAB_NAMES = Object.freeze({ all: 'All', github: 'GitHub', ...Object.fromEntries(Object.values(REMOTES).map(remote => [remote.id, remote.name])) })

// The tabs to show, in the configured order; unknown names are dropped and nothing left means all of them.
export const visibleTabs = tabs => {
  const list = [...new Set((Array.isArray(tabs) ? tabs : []).map(tab => String(tab).toLowerCase()).filter(tab => TABS.includes(tab)))]

  return list.length ? list : [...TABS]
}

// Sources the given tabs need: "all" shows every source.
export const sourcesOf = tabs => SOURCES.filter(source => tabs.includes(source) || tabs.includes('all'))

export const isRemote = issue => REMOTE_SOURCES.includes(issue?.source)

export const noun = issue => REMOTES[issue?.source]?.noun ?? 'issue'
export const Noun = issue => noun(issue).replace(/^./, letter => letter.toUpperCase())

// "sc-482" or a story URL → Shortcut; "ENG-123" or a Linear URL → Linear; "482", "#482" or an issue URL →
// GitHub. null when none. A URL names its integration; a bare key several integrations accept ("sc-482" is
// also a Linear key of a team "SC") goes to the first one `sources` shows, else to the first that parses it.
export const parseRef = (text, sources = SOURCES) => {
  const matches = Object.values(REMOTES)
    .map(remote => ({ source: remote.id, parsed: remote.parseRef(text) }))
    .filter(match => match.parsed)
  const match = matches.find(entry => entry.parsed.workspace) ?? matches.find(entry => sources.includes(entry.source)) ?? matches[0]
  if (match) return { source: match.source, ...match.parsed }
  const issue = parseIssueRef(text)

  return issue ? { source: 'github', ...issue } : null
}

export const labelText = issue => (issue?.labels ?? []).map(label => label.name).join(', ')
export const assigneeText = issue => (issue?.assignees ?? []).map(user => `@${user.login}`).join(' ')
// What the list shows in its state column: the workflow state of a story or a Linear issue, "closed" for a
// closed GitHub issue.
export const stateText = issue => (isRemote(issue) ? (issue.stateName ?? '') : issue?.closed ? 'closed' : '')

export { byUpdatedDesc }
export const mergeByUpdated = lists => lists.flat().sort(byUpdatedDesc)

// What `/` matches: reference, title, labels, assignees, author, state, story type and priority.
export const haystack = issue =>
  [issue.ref, issue.title, labelText(issue), assigneeText(issue), issue.author?.login, issue.stateName, issue.type, issue.priority].filter(Boolean).join(' ').toLowerCase()
