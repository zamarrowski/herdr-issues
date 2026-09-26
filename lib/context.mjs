// The invocation context herdr hands to plugin commands (HERDR_PLUGIN_CONTEXT_JSON), and how the
// plugin decides which repository checkout to work on.
import path from 'node:path'
import { tildify } from './format.mjs'
import { paneList, workspaceList } from './herdr.mjs'
import { gitRepo, gitRoot } from './proc.mjs'

// Fields seen in herdr 0.9: workspace_id, workspace_label, workspace_cwd, tab_id, tab_label,
// focused_pane_id, focused_pane_cwd, focused_pane_agent, focused_pane_status, invocation_source,
// correlation_id, and for link handlers clicked_url and link_handler_id.
export const readContext = (env = process.env) => {
  try {
    const parsed = JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON || '{}')

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

// Checkout to use: --cwd flag > HERDR_ISSUES_CWD > focused pane cwd > workspace cwd > process cwd.
export const pickCwd = ({ flag = null, env = process.env, context = {}, fallback = process.cwd() } = {}) =>
  flag || env.HERDR_ISSUES_CWD || context.focused_pane_cwd || context.workspace_cwd || fallback

// Explicit "owner/name" override: --repo flag > HERDR_ISSUES_REPO > null (gh infers it from the checkout).
export const pickRepo = ({ flag = null, env = process.env } = {}) => flag || env.HERDR_ISSUES_REPO || null

// Git root of `cwd` plus, when the popup was opened from a herdr workspace of that same repository,
// the workspace id, so the new worktree is grouped under it in the sidebar.
export const resolveTarget = async ({ cwd, repo = null, context = {} }) => {
  const root = await gitRoot(cwd)
  let workspaceId = null
  if (root && context.workspace_id && context.workspace_cwd) {
    const workspaceRoot = context.workspace_cwd === cwd ? root : await gitRoot(context.workspace_cwd)
    if (workspaceRoot === root) workspaceId = context.workspace_id
  }

  return {
    cwd,
    root,
    repo,
    workspaceId,
    focusedAgent: context.focused_pane_agent || null,
    clickedUrl: context.clicked_url || null,
  }
}

// herdr sets `worktree` only on the workspaces it knows to be inside a git checkout, and misses some.
// For every workspace this records `cwd` (the directory of its active tab's pane) and, when herdr gave no
// `worktree` but git finds a checkout there, fills one in, in herdr's shape, with `detected: true`.
export const describeWorkspaces = async (workspaces = [], panes = [], detect = gitRepo) =>
  Promise.all(
    workspaces.map(async workspace => {
      const own = panes.filter(pane => pane.workspace_id === workspace.workspace_id)
      const pane = own.find(entry => entry.tab_id === workspace.active_tab_id && entry.focused) ?? own.find(entry => entry.tab_id === workspace.active_tab_id) ?? own[0]
      const cwd = pane?.foreground_cwd || pane?.cwd || workspace.worktree?.checkout_path || null
      if (workspace.worktree?.repo_root || !cwd) return { ...workspace, cwd }
      const repo = await detect(cwd).catch(() => null)
      if (!repo) return { ...workspace, cwd }
      const worktree = { checkout_path: repo.checkout, is_linked_worktree: repo.linked, repo_key: repo.key, repo_name: path.basename(repo.root), repo_root: repo.root }

      return { ...workspace, cwd, worktree, detected: true }
    }),
  )

// Where a story or a Linear issue can be started: one entry per repository open in herdr, where the
// flow creates a worktree, then one per workspace that is not a git checkout, where it opens a new tab
// instead; plus the pane's own checkout when no workspace covers it. Nothing ties a story to a
// repository, so the user picks; the workspace or checkout the popup came from is `preferred`.
// Entries: { id, note, root, workspaceId } for a repository, where workspaceId is its main checkout's
// workspace (null when only linked worktrees are open, or when herdr did not recognise the checkout: the
// flow then passes --cwd root); { id, note, cwd, workspaceId, tab: true } for a workspace without git.
export const repoCandidates = (workspaces = [], { workspaceId = null, root = null } = {}) => {
  const byKey = new Map()
  const tabs = []
  let preferred = null
  for (const workspace of workspaces) {
    const tree = workspace?.worktree
    if (!tree?.repo_root) {
      if (!workspace?.cwd) continue
      const entry = { id: workspace.label || workspace.workspace_id, note: `${tildify(workspace.cwd)} · new tab`, cwd: workspace.cwd, workspaceId: workspace.workspace_id, tab: true }
      tabs.push(entry)
      if (workspaceId && workspace.workspace_id === workspaceId) preferred = entry
      continue
    }
    const key = tree.repo_key || tree.repo_root
    if (!byKey.has(key)) byKey.set(key, { id: tree.repo_name || path.basename(tree.repo_root), note: tildify(tree.repo_root), root: tree.repo_root, workspaceId: null })
    const entry = byKey.get(key)
    if (!tree.is_linked_worktree && !workspace.detected && !entry.workspaceId) entry.workspaceId = workspace.workspace_id
    if (workspaceId && workspace.workspace_id === workspaceId) preferred = entry
    if (!preferred && root && (tree.checkout_path === root || tree.repo_root === root)) preferred = entry
  }
  if (root && !preferred) {
    preferred = { id: path.basename(root), note: tildify(root), root, workspaceId }
    byKey.set(root, preferred)
  }
  const byName = (a, b) => a.id.localeCompare(b.id)
  const items = [...[...byKey.values()].sort(byName), ...tabs.sort(byName)]

  return { items, preferred: preferred ? items.indexOf(preferred) : -1 }
}

// The candidates, from what herdr has open right now.
export const startTargets = async ({ workspaceId = null, root = null } = {}) => {
  const [workspaces, panes] = await Promise.all([workspaceList(), paneList().catch(() => [])])

  return repoCandidates(await describeWorkspaces(workspaces, panes), { workspaceId, root })
}
