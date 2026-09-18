// The invocation context herdr hands to plugin commands (HERDR_PLUGIN_CONTEXT_JSON), and how the
// plugin decides which repository checkout to work on.
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
