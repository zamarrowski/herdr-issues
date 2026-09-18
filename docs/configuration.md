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

Changes apply the next time a popup opens.

## Precedence

Highest first:

1. Command-line flags of the scripts (`--agent`, `--no-focus`, `--repo`, `--cwd`).
2. Environment variables (below).
3. `config.json`.
4. The defaults in this document.

## Keys

### Agent

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `agent` | string | `"auto"` | herdr agent kind to start: `claude`, `codex`, `gemini`, `pi`, `opencode`, … (`herdr agent` prints the list your herdr supports). `"auto"` uses the agent running in the pane the popup was opened from, and asks when there is none. |
| `agent_args` | object | `{}` | Extra command-line arguments per agent kind, passed to the agent after `--`. Example: `{ "codex": ["--full-auto"], "claude": ["--add-dir", "../shared"] }`. Check each agent's `--help`; the plugin passes them through untouched. |
| `agent_name` | template | `"issue-{number}"` | Name herdr gives the agent. It must match `[a-z][a-z0-9_-]{0,31}`; the plugin lowercases and trims it, and appends a short suffix when the name is already taken by a live agent. Address it later with `herdr agent prompt issue-482 "…"`. |
| `auto_accept_trust_prompt` | boolean | `true` | When the agent starts blocked and its pane shows text matching `trust_prompt_pattern`, press Enter for it and wait again. Set to `false` to always answer startup dialogs yourself. |
| `trust_prompt_pattern` | regex | `"trust the files\|trust this (folder\|directory\|workspace\|repository)\|do you trust\|yes, proceed"` | Case-insensitive JavaScript regular expression tested against the agent's visible screen. Extend it when your agent asks something the default does not cover. |

### Worktree and workspace

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `branch` | template | `"issue-{number}-{slug}"` | Branch for the new worktree. Characters git refuses in ref names are replaced with `-`. If the branch already exists, its worktree is opened instead of created. |
| `base` | string | `""` | Base ref for the new branch, passed as `herdr worktree create --base`. Examples: `"main"`, `"origin/main"`. Empty means herdr's default, the source checkout's current HEAD. |
| `label` | template | `"#{number} {title}"` | Workspace label in the herdr sidebar, cut to `label_max` characters. |
| `label_max` | number | `40` | Maximum length of the label. |
| `slug_max` | number | `40` | Maximum length of `{slug}`, cut at a word boundary. |
| `focus` | boolean | `true` | Focus the new workspace when herdr opens it (`--focus` / `--no-focus`). |
| `trust_repository` | boolean | `false` | Pass `--trust-repository` to herdr's worktree commands. herdr's documentation asks to use it only for repositories you have verified. |
| `workspace_token` | boolean | `true` | Publish an `issue` metadata token (`#482`) on the new workspace. Show it with `$issue` in `[ui.sidebar.spaces].rows`; see the README. |

### Prompt and feedback

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `prompt` | template | see below | The text sent to the agent with `herdr agent prompt`. |
| `notify` | boolean | `true` | Show a herdr toast (`herdr notification show`) when the agent has the issue. |
| `limit` | number | `100` | Maximum number of issues listed (`gh issue list --limit`). |

Default prompt:

```
Work on GitHub issue #{number} ({url}): "{title}". Read the issue and its comments first with `gh issue view {number} --comments`, then implement it in this worktree (branch {branch}).
```

It deliberately tells the agent to read the issue with `gh` instead of pasting the body: the agent gets
the comments too, and long issues do not flood its input. Any agent with shell access can follow it.

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
| `{title}` | `Returns page crashes on empty address` |
| `{slug}` | `returns-page-crashes-on-empty-address` (lowercase ASCII, `slug_max` long) |
| `{url}` | `https://github.com/acme/shop/issues/482` |
| `{repo}` | `acme/shop` |
| `{owner}` | `acme` |
| `{name}` | `shop` |
| `{branch}` | the rendered `branch` (available in `label`, `agent_name` and `prompt`) |
| `{label}` | the rendered `label` (available in `agent_name` and `prompt`) |
| `{agent}` | `codex` |
| `{author}` | `zamarrowski` |
| `{labels}` | `bug, p1` |

## Environment variables

Handy for keybinding variants: bind a second key to an action whose command adds `--env`.

| Variable | Effect |
| --- | --- |
| `HERDR_ISSUES_AGENT` | Overrides `agent`. |
| `HERDR_ISSUES_BASE` | Overrides `base`. |
| `HERDR_ISSUES_CWD` | Checkout to work on (instead of the focused pane's directory). |
| `HERDR_ISSUES_REPO` | `owner/name` whose issues to read, when `gh` should not infer it from the checkout. |
| `HERDR_ISSUES_URL` | Issue URL or number for the start popup; the `start` action fills it from `HERDR_PLUGIN_CLICKED_URL` on Ctrl+click. |
| `HERDR_ISSUES_CONFIG` | Path of `config.json` (default: `$HERDR_PLUGIN_CONFIG_DIR/config.json`). |
| `HERDR_ISSUES_NODE` | Node.js binary for `bin/run.sh` when it is not in PATH or the usual places. |
| `GH_BIN` | Path of the `gh` binary. |
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

Short branch names, a prompt that asks for a plan first, and a longer worktree timeout for a big repo:

```json
{
  "branch": "gh-{number}",
  "slug_max": 20,
  "prompt": "Issue #{number}: {title} ({url}). Read it with `gh issue view {number} --comments`, write a short plan, wait for my OK, then implement it on branch {branch}.",
  "timeouts": { "worktree_ms": 600000 }
}
```

Never answer startup dialogs automatically:

```json
{ "auto_accept_trust_prompt": false }
```
