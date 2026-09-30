# Configuration

herdr-issues works without any configuration. When you want to change something, create a
`config.json` in the plugin config directory:

```sh
herdr plugin config-dir zamarrowski.issues
# → ~/.config/herdr/plugins/config/zamarrowski.issues   (macOS and Linux)
```

Copy [`config.example.json`](../config.example.json) there as `config.json`, or press `c` in the setup
popup (`herdr plugin action invoke zamarrowski.issues.setup`), which does the same. Every key is optional:
what you leave out keeps its default. Keys starting with `$` (such as `$comment`) are ignored, so you can
annotate the file. Unknown keys and wrong types are reported by the setup popup and shown once in the
issues popup; they never stop the plugin.

Changes apply the next time a popup opens. The settings screen (`,` in the issues popup, `s` in the
setup popup) edits `tabs`, `agent` and `agent_args` for you, writes them to `config.json` straight away
and applies them in the open popup; the rest of the file is left as it is.

## Precedence

Highest first:

1. Command-line flags of the scripts (`--agent`, `--no-focus`, `--repo`, `--cwd`).
2. Environment variables (below).
3. `config.json`.
4. The defaults in this document.

## Keys

### Tabs

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `tabs` | array | `["all", "github", "shortcut", "linear"]` | Tabs of the issues popup, in this order; the settings screen shows, hides and moves them. `"all"` shows GitHub issues, Shortcut stories and Linear issues together, newest updated first. Leave a tab out to hide it, configured or not: `["github"]` is the GitHub-only popup of earlier versions. Unknown names are ignored; an empty list shows every tab. |

### Agent

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `agent` | string | `"auto"` | herdr agent kind to start: `claude`, `codex`, `gemini`, `pi`, `opencode`, … (`herdr agent` prints the list your herdr supports). `"auto"` uses the agent running in the pane the popup was opened from, and asks when there is none. |
| `agent_args` | object | `{}` | Extra command-line arguments per agent kind, passed to the agent after `--`. Example: `{ "codex": ["--full-auto"], "claude": ["--add-dir", "../shared"] }`. Check each agent's `--help`; the plugin passes them through untouched. The settings screen writes it: a mode, then the extra arguments. |
| `agent_modes` | object | Claude Code, Codex and Gemini CLI modes | Named argument sets per agent kind, offered by the settings screen as the ways that agent can start: `{ "claude": { "plan": ["--permission-mode", "plan"] } }`. Picking one puts its arguments in `agent_args` in place of the other modes of that kind. Yours are merged with the defaults; `[]` hides a default one. A name containing "dangerous" is shown in red. See [agents.md](agents.md#modes). |
| `agent_name` | template | `"issue-{number}"` | Name herdr gives the agent. It must match `[a-z][a-z0-9_-]{0,31}`; the plugin lowercases and trims it, and appends a short suffix when the name is already taken by a live agent. Address it later with `herdr agent prompt issue-482 "…"`. |
| `auto_accept_trust_prompt` | boolean | `true` | When the agent starts blocked and its pane shows text matching `trust_prompt_pattern`, press Enter for it and wait again. Set to `false` to always answer startup dialogs yourself. |
| `trust_prompt_pattern` | regex | `"trust the files\|trust this (folder\|directory\|workspace\|repository)\|do you trust\|yes, proceed"` | Case-insensitive JavaScript regular expression tested against the agent's visible screen. Extend it when your agent asks something the default does not cover. |

### Worktree and workspace

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `branch` | template | `"issue-{number}-{slug}"` | Branch for the new worktree. Characters git refuses in ref names are replaced with `-`. If the branch already exists, its worktree is opened instead of created. |
| `base` | string | `""` | Base ref for the new branch, passed as `herdr worktree create --base`. Examples: `"main"`, `"origin/main"`. Empty means herdr's default, the source checkout's current HEAD. |
| `label` | template | `"{ref} {title}"` | Workspace label in the herdr sidebar, cut to `label_max` characters. `{ref}` is `#482` for an issue, `sc-482` for a story and `ENG-123` for a Linear issue. |
| `label_max` | number | `40` | Maximum length of the label. |
| `slug_max` | number | `40` | Maximum length of `{slug}`, cut at a word boundary. |
| `focus` | boolean | `true` | Focus the new workspace when herdr opens it (`--focus` / `--no-focus`). |
| `trust_repository` | boolean | `false` | Pass `--trust-repository` to herdr's worktree commands. herdr's documentation asks to use it only for repositories you have verified. |
| `workspace_token` | boolean | `true` | Publish an `issue` metadata token (`#482`, `sc-482`, `ENG-123`) on the new workspace. Show it with `$issue` in `[ui.sidebar.spaces].rows`; see the README. |

### Prompt and feedback

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `prompt` | template | `"{url}"` | The text typed into the agent. See below. |
| `submit` | boolean | `false` | Press Enter after typing the prompt (`herdr agent prompt`). `false` types it with `herdr pane send-text` and leaves it in the agent's input, so you can add context before sending. |
| `notify` | boolean | `true` | Show a herdr toast (`herdr notification show`) when the agent has the issue. |
| `limit` | number | `100` | Maximum number of issues listed (`gh issue list --limit`), and of stories and of Linear issues. |

The default prompt is the issue URL and nothing else. Every agent knows what to do with a GitHub
issue URL, and since it is typed but not sent you can complete the sentence before pressing Enter:
"…, read the comments first", "…, just write a plan". Issue bodies are never pasted: the agent reads
the issue itself, which keeps long issues out of its input.

With `"submit": false` (the default) the prompt is typed as a single line, because a newline would send
it: line breaks in the template become spaces, and the setup popup warns about them. A prompt that
should be sent as written, line breaks included, needs `"submit": true`.

If the agent you use cannot open URLs (no web tool, or a private repository), tell it to use `gh`:

```json
{ "prompt": "Work on {url}. Read it with `gh issue view {number} --comments` first.", "submit": true }
```

### Shortcut

Everything about Shortcut stories lives in the `shortcut` object. The API token does not: the
Shortcut tab of the popup asks for it and saves it in `secrets.json`, next to `config.json`, with mode
`0600`. `SHORTCUT_API_TOKEN` takes precedence when it is set. A `token` key here is ignored with a
warning, so a token never ends up in a file you might share.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `shortcut.team` | string | `""` | Team name, added to the search as `team:"…"`. Empty lists the stories of the whole workspace. |
| `shortcut.query` | string | `"!is:done !is:archived"` | [Shortcut search](https://help.shortcut.com/hc/en-us/articles/360000046646-Searching-in-Shortcut-Using-Search-Operators) query for the list. `c` in the popup drops `!is:done` to include done stories. Example: `"owner:ana !is:done !is:archived"`. |
| `shortcut.branch` | template | `"sc-{number}-{slug}"` | Branch for a story. Shortcut's VCS integration attaches every branch containing `sc-<id>` to the story. |
| `shortcut.agent_name` | template | `"sc-{number}"` | herdr agent name for a story. |
| `shortcut.label`, `shortcut.prompt` | template | the global ones | Set them to give stories their own label or prompt. |

The global `branch`, `label`, `agent_name` and `prompt` apply to GitHub issues, and to stories for the
keys the `shortcut` object does not set.

The owner / requester filter is not configuration: pick it with `f` in the popup, and it is remembered
in the plugin state directory (`ui.json`). From the command line, pass `--owner NAME|me` and
`--requester NAME|me` to `issues.mjs --source shortcut`.

Shortcut's search returns stories by relevance, not by date. The plugin takes the first `limit` results
and sorts them by last update, so in a workspace with more open stories than `limit`, narrow the list
with `shortcut.team` or `shortcut.query` (`owner:ana`, `iteration:"Sprint 12"`, `type:bug`) rather than
raising `limit`.

Starting a story asks where to work, among the workspaces open in herdr, with the one the popup came
from preselected. A repository gets a worktree (the `branch`, `label` and `agent_name` templates); a
workspace that is not a git checkout gets a new tab labelled with `label`, and the agent in it. From the
command line, `start.mjs sc-482` uses the checkout of `--cwd` (or of the focused pane), and opens a tab
in the current workspace when that is not a git checkout.

The default prompt is the story URL. An agent can open it only if it has access to Shortcut (for
example through Shortcut's MCP server). Otherwise say what to do in the prompt:

```json
{ "shortcut": { "prompt": "Work on Shortcut story {ref}: {title}. Read it with the Shortcut MCP first ({url}).", "label": "{ref} {title}" } }
```

### Linear

Linear issues are set in the `linear` object. The API key is not: the Linear tab of the popup asks for
a personal API key and saves it in `secrets.json`, like the Shortcut token. `LINEAR_API_KEY` takes
precedence when it is set. A `token` or `api_key` key here is ignored with a warning.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `linear.team` | string | `""` | Team key (`"ENG"`) or name. Empty lists the issues of every team in the workspace. The setup popup checks it and lists the team keys when it matches none. |
| `linear.filter` | object | `{}` | Extra conditions in the format of the `IssueFilter` of Linear's GraphQL API, combined with the team, the state (not completed or canceled, unless `c` is on) and the people filter. Examples: `{ "priority": { "lte": 2 } }` (urgent and high), `{ "project": { "name": { "eq": "Returns" } } }`, `{ "cycle": { "isActive": { "eq": true } } }`. |
| `linear.branch` | template | `"{ref}-{slug}"` | Branch for a Linear issue (`ENG-123-returns-page-crashes`). Linear's git integration links every branch containing the identifier, in any case. `"{vcs_branch}"` uses the branch name Linear suggests (`ana/eng-123-returns-page-crashes`), which contains a slash: herdr nests the worktree directory accordingly. |
| `linear.agent_name` | template | `"{ref}"` | herdr agent name for a Linear issue (`eng-123` once lowercased). |
| `linear.label`, `linear.prompt` | template | the global ones | Set them to give Linear issues their own label or prompt. |

The assignee / creator filter is picked with `f` in the popup and remembered in `ui.json`, like the
Shortcut one. From the command line, pass `--assignee NAME|me` and `--creator NAME|me` (display
names) to `issues.mjs --source linear`.

The list is ordered by last update on Linear's side, so `limit` keeps the most recently updated
issues. Starting one asks where to work, as for a story; `start.mjs ENG-123` uses the checkout of
`--cwd` (or of the focused pane). A bare number such as `123` is always a GitHub
issue; `sc-123` is a Shortcut story unless the Shortcut tab is hidden and the Linear one is shown.

The default prompt is the issue URL, which an agent can open only with access to Linear (for example
Linear's MCP server). Otherwise say what to do in the prompt:

```json
{ "linear": { "prompt": "Work on Linear issue {ref}: {title}. Read it with the Linear MCP first ({url})." } }
```

### Timeouts

All values are milliseconds, under the `timeouts` object.

| Key | Default | Description |
| --- | --- | --- |
| `worktree_ms` | `180000` | `herdr worktree create` / `open`. Creating a worktree of a large repository can take a while, and your `worktree.created` hooks run inside this window. |
| `agent_start_ms` | `90000` | `herdr agent start --timeout`. herdr accepts values between 3 001 and 300 000. |
| `agent_ready_ms` | `20000` | Each wait for the agent to become idle after a blocked start (up to four waits). |
| `prompt_ms` | `30000` | `herdr agent prompt`. |
| `submit_check_ms` | `6000` | How long to wait for the agent to react to the prompt before re-sending Enter once. |
| `retry_ms` | `1000` | Pause between attempts while the new pane's shell or the agent settles. |

## Templates

`agent_name`, `branch`, `label` and `prompt` are templates. Placeholders are written `{name}`; unknown
placeholders are left as written so typos stay visible.

| Placeholder | Example |
| --- | --- |
| `{number}` | `482` |
| `{ref}` | `#482`, `sc-482` for a Shortcut story, `ENG-123` for a Linear issue |
| `{source}` | `github`, `shortcut` or `linear` |
| `{title}` | `Returns page crashes on empty address` |
| `{slug}` | `returns-page-crashes-on-empty-address` (lowercase ASCII, `slug_max` long) |
| `{url}` | `https://github.com/acme/shop/issues/482`, or the story or Linear issue URL |
| `{repo}` | `acme/shop`; for a story or a Linear issue, the name of the repository or workspace you picked (`shop`) |
| `{owner}` | `acme` (empty for a story or a Linear issue) |
| `{name}` | `shop` |
| `{branch}` | the rendered `branch` (available in `label`, `agent_name` and `prompt`) |
| `{label}` | the rendered `label` (available in `agent_name` and `prompt`) |
| `{agent}` | `codex` |
| `{author}` | `zamarrowski` |
| `{labels}` | `bug, p1` |
| `{vcs_branch}` | the branch name the tracker suggests: Shortcut's `ana/sc-482/returns-page-…`, Linear's `ana/eng-123-returns-page-…`; empty for a GitHub issue, so use it in the `shortcut` or `linear` block |

## Environment variables

Handy for keybinding variants: bind a second key to an action whose command adds `--env`.

| Variable | Effect |
| --- | --- |
| `HERDR_ISSUES_AGENT` | Overrides `agent`. |
| `HERDR_ISSUES_BASE` | Overrides `base`. |
| `HERDR_ISSUES_CWD` | Checkout to work on (instead of the focused pane's directory). |
| `HERDR_ISSUES_REPO` | `owner/name` whose issues to read, when `gh` should not infer it from the checkout. |
| `HERDR_ISSUES_URL` | Issue URL or number, `sc-<id>`, story URL, Linear key (`ENG-123`) or Linear issue URL for the start popup; the `start` action fills it from `HERDR_PLUGIN_CLICKED_URL` on Ctrl+click. |
| `HERDR_ISSUES_CONFIG` | Path of `config.json` (default: `$HERDR_PLUGIN_CONFIG_DIR/config.json`). |
| `HERDR_ISSUES_NODE` | Node.js binary for `bin/run.sh` when it is not in PATH or the usual places. |
| `GH_BIN` | Path of the `gh` binary. |
| `SHORTCUT_API_TOKEN` | Shortcut API token. Takes precedence over the one saved from the Shortcut tab, and is never written anywhere. |
| `HERDR_ISSUES_SECRETS` | Path of `secrets.json` (default: `$HERDR_PLUGIN_CONFIG_DIR/secrets.json`). |
| `HERDR_ISSUES_SHORTCUT_API` | Base URL of the Shortcut API (default `https://api.app.shortcut.com/api/v3`); the tests point it at a local server. |
| `LINEAR_API_KEY` | Linear personal API key. Takes precedence over the one saved from the Linear tab, and is never written anywhere. |
| `HERDR_ISSUES_LINEAR_API` | URL of the Linear GraphQL endpoint (default `https://api.linear.app/graphql`); the tests point it at a local server. |
| `NO_COLOR` | Disables colours in the popups. |

For example, a binding that always starts issues with Codex, whatever is in your pane:

```toml
[[keys.command]]
key = "prefix+alt+i"
type = "plugin_action"
command = "zamarrowski.issues.open"
description = "github issues (codex)"
```

is not possible directly, because herdr keybindings invoke actions without arguments; instead set
`"agent": "codex"` in `config.json`, or run the script from a pane:

```sh
HERDR_ISSUES_AGENT=codex sh bin/run.sh scripts/start.mjs 482
```

## Examples

Always branch from the remote default branch and hand issues to Codex in full-auto mode, quietly:

```json
{
  "agent": "codex",
  "agent_args": { "codex": ["--full-auto"] },
  "base": "origin/main",
  "notify": false
}
```

Short branch names, a prompt that asks for a plan first and is sent straight away, and a longer
worktree timeout for a big repo:

```json
{
  "branch": "gh-{number}",
  "slug_max": 20,
  "prompt": "Issue #{number}: {title} ({url}). Read it with `gh issue view {number} --comments`, write a short plan, wait for my OK, then implement it on branch {branch}.",
  "submit": true,
  "timeouts": { "worktree_ms": 600000 }
}
```

Shortcut only, one team's stories, on `feature/` branches:

```json
{
  "tabs": ["shortcut"],
  "shortcut": { "team": "Backend", "branch": "feature/sc-{number}-{slug}" }
}
```

GitHub and Linear, one team's high-priority issues, on the branch Linear suggests:

```json
{
  "tabs": ["all", "github", "linear"],
  "linear": { "team": "ENG", "filter": { "priority": { "lte": 2 } }, "branch": "{vcs_branch}" }
}
```

Claude Code without permission prompts, and a Codex mode of your own (the settings screen writes the
`agent_args` part when you pick the mode):

```json
{
  "agent_args": { "claude": ["--dangerously-skip-permissions"] },
  "agent_modes": { "codex": { "on request": ["--ask-for-approval", "on-request"] } }
}
```

Never answer startup dialogs automatically:

```json
{ "auto_accept_trust_prompt": false }
```
