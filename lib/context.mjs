// The invocation context herdr hands to plugin commands (HERDR_PLUGIN_CONTEXT_JSON), and how the
// plugin decides which repository checkout to work on.
import path from 'node:path'
import { tildify } from './format.mjs'
import { gitRoot } from './proc.mjs'

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

// Repositories a story can be started in: one entry per repository open in herdr (from `herdr workspace
// list`), plus the pane's own checkout when no workspace covers it. Nothing ties a Shortcut story to a
// repository, so the user picks one; the repository of the pane the popup came from is `preferred`.
// Entries: { id: repo name, note: path, root, workspaceId } where workspaceId is the repository's main
// checkout workspace (null when only linked worktrees are open: the flow then passes --cwd root).
export const repoCandidates = (workspaces = [], { workspaceId = null, root = null } = {}) => {
  const byKey = new Map()
  let preferredKey = null
  for (const workspace of workspaces) {
    const tree = workspace?.worktree
    if (!tree?.repo_root) continue
    const key = tree.repo_key || tree.repo_root
    if (!byKey.has(key)) byKey.set(key, { id: tree.repo_name || path.basename(tree.repo_root), note: tildify(tree.repo_root), root: tree.repo_root, workspaceId: null })
    const entry = byKey.get(key)
    if (!tree.is_linked_worktree && !entry.workspaceId) entry.workspaceId = workspace.workspace_id
    if (workspaceId && workspace.workspace_id === workspaceId) preferredKey = key
    if (!preferredKey && root && (tree.checkout_path === root || tree.repo_root === root)) preferredKey = key
  }
  if (root && !preferredKey) {
    byKey.set(root, { id: path.basename(root), note: tildify(root), root, workspaceId })
    preferredKey = root
  }
  const items = [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id))

  return { items, preferred: preferredKey ? items.indexOf(byKey.get(preferredKey)) : -1 }
}
