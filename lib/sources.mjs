// The two sources the popups show side by side, GitHub issues and Shortcut stories, and the tabs
// that present them. Both are normalised to one record, the only shape the popups and the start flow see:
//
//   { source: 'github' | 'shortcut', number, ref: '#482' | 'sc-482', title, url, closed, state, stateName,
//     type?, labels: [{ name }], assignees: [{ login }], author: { login }, createdAt, updatedAt,
//     body?, comments?: [{ author: { login }, body, createdAt }] }
import { parseIssueRef } from './github.mjs'
import { parseStoryRef } from './shortcut.mjs'

export const SOURCES = Object.freeze(['github', 'shortcut'])
export const TABS = Object.freeze(['all', ...SOURCES])
export const TAB_NAMES = Object.freeze({ all: 'All', github: 'GitHub', shortcut: 'Shortcut' })

// The tabs to show, in the configured order; unknown names are dropped and nothing left means all of them.
export const visibleTabs = tabs => {
  const list = [...new Set((Array.isArray(tabs) ? tabs : []).map(tab => String(tab).toLowerCase()).filter(tab => TABS.includes(tab)))]

  return list.length ? list : [...TABS]
}

// Sources the given tabs need: "all" shows every source.
export const sourcesOf = tabs => SOURCES.filter(source => tabs.includes(source) || tabs.includes('all'))

export const noun = issue => (issue?.source === 'shortcut' ? 'story' : 'issue')
export const Noun = issue => (issue?.source === 'shortcut' ? 'Story' : 'Issue')

// "sc-482" or a story URL → Shortcut; "482", "#482" or an issue URL → GitHub. null when neither.
export const parseRef = text => {
  const story = parseStoryRef(text)
  if (story) return { source: 'shortcut', ...story }
  const issue = parseIssueRef(text)

  return issue ? { source: 'github', ...issue } : null
}

export const labelText = issue => (issue?.labels ?? []).map(label => label.name).join(', ')
export const assigneeText = issue => (issue?.assignees ?? []).map(user => `@${user.login}`).join(' ')
// What the list shows in its state column: the workflow state of a story, "closed" for a closed issue.
export const stateText = issue => (issue?.source === 'shortcut' ? (issue.stateName ?? '') : issue?.closed ? 'closed' : '')

export const byUpdatedDesc = (a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)
export const mergeByUpdated = lists => lists.flat().sort(byUpdatedDesc)

// What `/` matches: reference, title, labels, assignees, author, state and story type.
export const haystack = issue => [issue.ref, issue.title, labelText(issue), assigneeText(issue), issue.author?.login, issue.stateName, issue.type].filter(Boolean).join(' ').toLowerCase()
