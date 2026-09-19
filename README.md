# herdr-issues

[![CI](https://github.com/zamarrowski/herdr-issues/actions/workflows/ci.yml/badge.svg)](https://github.com/zamarrowski/herdr-issues/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![herdr ≥ 0.9.0](https://img.shields.io/badge/herdr-%E2%89%A5%200.9.0-black)](https://herdr.dev)
[![Dependencies: highlight.js](https://img.shields.io/badge/dependencies-highlight.js-brightgreen)](package.json)

A [herdr](https://herdr.dev) plugin that shows the GitHub issues of the repository you are in and hands
any of them to a coding agent in its own git worktree. Claude Code, Codex, Gemini CLI, Pi, OpenCode,
Cursor, Copilot, Droid, Amp… whatever herdr can start, this plugin can hand an issue to.

<p align="center">
  <img src="assets/screenshots/browser.svg" alt="The Issues popup: the open issues of acme/shop with labels, assignees and age, one selected" width="100%">
</p>

Press `s` on an issue, confirm, and watch it happen:

<table>
  <tr>
    <td width="50%"><img src="assets/screenshots/confirm.svg" alt="Confirmation screen: agent codex (running in your pane), branch issue-482-returns-page-crashes-on-empty-address, workspace label, agent name and prompt" width="100%"></td>
    <td width="50%"><img src="assets/screenshots/progress.svg" alt="Progress screen: creating the worktree, starting codex, sending issue #482, done" width="100%"></td>
  </tr>
</table>

herdr creates a worktree on a branch named after the issue, opens it as a workspace, starts your agent
in it and sends it the issue. The popup closes and you land in the new workspace with the agent already
reading the issue.

## What it does

- **Browse.** Open issues newest first, with labels, assignees and age. `/` filters as you type, `c`
  includes closed issues, `Enter` shows the description and the comments rendered as Markdown
  (headings, lists, task lists, syntax-highlighted code blocks, quotes, links, `#123` and
  `@mentions`), `o` opens the issue in the browser. The last list is cached per repository so the popup paints instantly and
  refreshes behind.
- **Start.** One key turns an issue into a worktree, a herdr workspace, a running agent and a prompt.
  A confirmation screen shows exactly what is about to happen: agent, branch, workspace label, prompt.
- **Any agent.** By default the plugin uses the agent already running in the pane you opened the popup
  from. Otherwise it asks, with the list herdr supports. Set a default once, or pass extra arguments
  per agent kind (`--full-auto`, `--add-dir …`).
- **Ctrl+click.** Any GitHub issue URL in any pane becomes a "start this issue" link.
- **Scriptable.** The same flow runs from a shell, a script or another agent: `start.mjs 482 --agent
  codex`, JSON output included.
- **Sidebar label.** The new workspace carries an `issue` token (`#482`) you can show in the herdr sidebar.
- **One dependency.** [highlight.js](https://highlightjs.org) colours the code blocks; herdr fetches it
  when you install the plugin, and without it everything still works with plain code blocks. The rest is
  the Node.js standard library. GitHub through the `gh` CLI you already have, herdr through its own CLI.

## Requirements

- [herdr](https://herdr.dev) **0.9.0 or newer** (developed and tested on 0.9.1)
- **Node.js 20 or newer**, with `npm` (bundled) and network access at install time: herdr runs
  `npm ci` to fetch highlight.js
- **`gh`**, the [GitHub CLI](https://cli.github.com), logged in (`gh auth login`)
- **git**, and a local checkout of the repository (starting an issue creates a worktree of it)
- macOS or Linux

## Install

```sh
herdr plugin install zamarrowski/herdr-issues
```

herdr shows the source and the build command it is about to run (`npm ci`, which fetches highlight.js
for the code blocks) and asks before running it. Declining is fine: the plugin works the same, with
code blocks in plain text.

Then open the setup popup. It checks herdr, Node, `gh` and its login, and offers to add the
keybindings to your `config.toml` (with a backup) and to create a starter `config.json`:

```sh
herdr plugin action invoke zamarrowski.issues.setup
```

Prefer to edit the config yourself? Add this to `~/.config/herdr/config.toml` and run
`herdr server reload-config`. The default herdr prefix is `ctrl+b`:

```toml
[[keys.command]]
key = "prefix+i"
type = "plugin_action"
command = "zamarrowski.issues.open"
description = "github issues"

[[keys.command]]
key = "prefix+shift+i"
type = "plugin_action"
command = "zamarrowski.issues.start"
description = "start a github issue"
```

To update, reinstall. Your `config.json` lives outside the plugin directory and survives:

```sh
herdr plugin uninstall zamarrowski.issues && herdr plugin install zamarrowski/herdr-issues
```

For local development clone the repository and link it instead of installing:

```sh
git clone https://github.com/zamarrowski/herdr-issues.git
cd herdr-issues && npm ci && cd ..      # `plugin link` does not run the build step
herdr plugin link "$PWD/herdr-issues"
```

## Use

Open the popup from a pane inside a GitHub repository, with `ctrl+b` `i` or
`herdr plugin action invoke zamarrowski.issues.open`. The repository is inferred from the focused
pane's directory (through `gh`, so forks and `gh repo set-default` are honoured).

### Browsing

| Key | Action |
| --- | --- |
| `j` `k` / arrows, `g` `G` | move |
| `Enter` / `l` | read the issue: description and comments (`j` `k` / `space` scroll, `m` raw text instead of rendered Markdown, `Esc` back) |
| `s` | **start** the issue (confirmation first) |
| `o` | open the issue in the browser |
| `/` | filter by number, title, label, assignee or author; `Esc` clears |
| `c` | include closed issues |
| `r` | refresh from GitHub |
| `q` / `Esc` | quit |

Reading an issue renders its Markdown, code blocks included:

<p align="center">
  <img src="assets/screenshots/detail.svg" alt="Issue #482 rendered in the popup: headings, a numbered list, a syntax-highlighted JavaScript stack trace, bold text and an issue reference" width="100%">
</p>

### Starting

The confirmation screen shows the agent, the branch, the workspace label and the prompt:

| Key | Action |
| --- | --- |
| `y` | start |
| `d` | start and save this agent as the default in `config.json` |
| `a` | choose another agent (arrows move, letters filter, `Enter` picks) |
| `Esc` | cancel |

When it finishes the popup closes and the new workspace is focused. If something fails, the failing
step is shown in red and any key takes you back.

### Ctrl+click an issue URL

Any `https://github.com/<owner>/<repo>/issues/<n>` link printed in a pane (a `gh` listing, an agent's
answer, a commit message) can be Ctrl+clicked: the start popup opens with the issue loaded. It has to
be an issue of the repository the pane is in; otherwise the popup says so.

The same popup opens from the `zamarrowski.issues.start` action (bound above to `prefix+shift+i`) and
asks for a number or URL.

### From a terminal or from an agent

Every popup has a plain command-line face when there is no TTY. `bin/run.sh` finds Node for you:

```sh
cd /path/to/herdr-issues        # or the directory `herdr plugin list` prints as plugin_root

sh bin/run.sh scripts/issues.mjs --cwd ~/code/shop                 # list open issues
sh bin/run.sh scripts/issues.mjs --cwd ~/code/shop --closed --json # everything, as JSON
sh bin/run.sh scripts/start.mjs 482 --cwd ~/code/shop --agent codex
sh bin/run.sh scripts/start.mjs https://github.com/acme/shop/issues/482 --cwd ~/code/shop --no-agent   # worktree only
sh bin/run.sh scripts/setup.mjs --check                             # environment checks, exit 1 on failure
```

`--repo owner/name` (or `HERDR_ISSUES_REPO`) reads the issues of another repository; starting one still
needs a local checkout. Run any script with `--help` for its options.

## Choosing the agent

herdr knows how to start a fixed set of agents (`herdr agent` lists them: `claude`, `codex`, `gemini`,
`pi`, `opencode`, `cursor`, `copilot`, `droid`, `amp`, …). The plugin decides which one takes the issue in
this order:

1. `--agent <kind>` on the command line, or the agent you pick in the popup.
2. `agent` in `config.json`, or the `HERDR_ISSUES_AGENT` environment variable.
3. The agent running in the pane you opened the popup from.
4. Otherwise the popup asks (the command line refuses and tells you the options).

The default `"agent": "auto"` means "the agent I am already using". Press `d` on the confirmation
screen to make the chosen agent the default. Per-agent extra arguments go in `agent_args`:

```json
{
  "agent": "codex",
  "agent_args": {
    "codex": ["--full-auto"],
    "claude": ["--add-dir", "../shared"]
  }
}
```

[docs/agents.md](docs/agents.md) has the details, including how startup dialogs are handled.

## Configuration

Optional. `config.json` lives in the plugin config directory, which
`herdr plugin config-dir zamarrowski.issues` prints (`~/.config/herdr/plugins/config/zamarrowski.issues/config.json`
on macOS and Linux). Create it from [`config.example.json`](config.example.json) with the setup popup
(`c`) or by hand. Every key is optional; these are the defaults:

| Key | Default | What it does |
| --- | --- | --- |
| `agent` | `"auto"` | agent kind, or `auto` for the one in your pane |
| `agent_args` | `{}` | extra argv per agent kind, passed after `--` |
| `agent_name` | `"issue-{number}"` | herdr agent name, so `herdr agent prompt issue-482 "…"` works later |
| `branch` | `"issue-{number}-{slug}"` | branch of the new worktree |
| `base` | `""` | base ref for the branch, e.g. `"origin/main"` (empty: herdr's default, the current HEAD) |
| `label` | `"#{number} {title}"` | workspace label, cut to `label_max` |
| `prompt` | see example | what the agent receives |
| `focus` | `true` | focus the new workspace |
| `notify` | `true` | herdr toast when the agent has the issue |
| `workspace_token` | `true` | publish `$issue` for the sidebar |
| `auto_accept_trust_prompt` | `true` | answer "trust this folder?" dialogs with Enter |
| `limit` | `100` | issues to list |

Templates accept `{number}` `{title}` `{slug}` `{url}` `{repo}` `{owner}` `{name}` `{branch}` `{label}`
`{agent}` `{author}` `{labels}`. The full reference, with the timeouts and the environment variables, is
in [docs/configuration.md](docs/configuration.md).

## How starting works

Everything goes through the herdr CLI, so anything you could do by hand happens exactly the same way:

1. `herdr worktree create` on the current repository with branch `issue-<n>-<slug>` and label
   `#<n> <title>`. The checkout lands under herdr's `worktrees.directory` (default
   `~/.herdr/worktrees/<repo>/<branch>`) and opens as a workspace grouped under the repository's
   workspace. If the branch already exists, its worktree is opened instead. Your `worktree.created`
   hooks and plugins run as usual, so `.env` copying and dependency setup keep working.
2. `herdr agent start issue-<n> --kind <agent> --pane <new pane>`. If the agent shows a first-run
   dialog such as "do you trust the files in this folder?", the plugin accepts it and waits until the
   agent is idle.
3. `herdr agent prompt` with the rendered prompt. herdr reports the keystrokes, not the turn, so the
   plugin checks that the agent actually started working and re-sends Enter once if it did not.
4. A toast, and an `issue` token on the workspace.

The agent is named `issue-<n>`, so you can talk to it later from any pane:

```sh
herdr agent read issue-482 --lines 80
herdr agent prompt issue-482 "Also add a regression test."
```

If a worktree for the issue is already open, the plugin focuses it and leaves its pane alone.

## Sidebar label

Each workspace created by the plugin carries an `issue` token (`#482`). Show it by adding `$issue` to
your space rows in `config.toml` (this is herdr's default layout with the token appended; merge it into
your own rows if you have customised them), then `herdr server reload-config`:

```toml
[ui.sidebar.spaces]
rows = [
  ["state_icon", "workspace"],
  ["branch", "git_status", "$issue"],
]
```

## Data and privacy

- Nothing leaves your machine except the `gh` calls that list and read issues and, when you press `o`,
  opening the issue in your browser. No tokens are read or stored: `gh` uses its own login.
- Installing runs `npm ci`, which downloads highlight.js (and nothing else) from the npm registry,
  pinned by `package-lock.json`. The plugin never talks to the registry afterwards.
- The issue list is cached per repository in the plugin state directory
  (`~/.local/state/herdr/plugins/zamarrowski.issues/issues/`). Delete it whenever you like.
- The plugin never edits your herdr `config.toml` unless you press `k` in the setup popup or run
  `setup.mjs --write-keys`; it then keeps a one-time backup next to it.

## Troubleshooting

`herdr plugin log list --plugin zamarrowski.issues` shows the output of every action the plugin ran, and
the setup popup (`herdr plugin action invoke zamarrowski.issues.setup`) runs the environment checks.

- **"… is not inside a git repository"** — the popup uses the focused pane's directory. Open it from a
  pane inside the checkout, or pass `--cwd`.
- **"gh: not logged in" / "could not resolve to a Repository"** — run `gh auth login`, and check that
  `gh repo view` works in that directory. For forks, `gh repo set-default` decides which repository's
  issues you see.
- **"Node.js 20 or newer is required"** — `bin/run.sh` looks in PATH and the usual install locations.
  Point `HERDR_ISSUES_NODE` at your `node` binary if it lives somewhere unusual (nvm, asdf, mise).
- **The agent never became ready** — herdr detected the agent but it stayed blocked on a dialog the
  plugin does not recognise. Look at its pane, answer the dialog, then send the prompt yourself with
  `herdr agent prompt issue-<n> "…"`. Extend `trust_prompt_pattern` in `config.json` so it is accepted
  next time, and please [open an issue](https://github.com/zamarrowski/herdr-issues/issues) with the
  agent and the text of the dialog.
- **Code blocks have no colours** — highlight.js is not installed: the build step was declined, or the
  plugin was linked from a checkout without `npm ci`. Run `npm ci` in the plugin directory
  (`herdr plugin list` prints it as `plugin_root`) or reinstall. The setup popup shows which it is.
- **"ui_busy"** — herdr cannot open a popup while Settings, copy mode or another modal is active.
- **Keybinding does nothing** — `herdr server reload-config` after editing `config.toml`; `prefix+?`
  lists the active bindings.

## Uninstall

```sh
herdr plugin uninstall zamarrowski.issues            # or `herdr plugin unlink zamarrowski.issues` for a linked checkout
```

Remove the `# >>> zamarrowski.issues` block from `config.toml` (the setup popup's `u` does it), and
delete `~/.config/herdr/plugins/config/zamarrowski.issues` and
`~/.local/state/herdr/plugins/zamarrowski.issues` if you want no trace left.

## Contributing

Bug reports, agent quirks and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for
the development setup (`herdr plugin link .`, `npm test`), the code style and how to add support for an
agent's startup dialog. This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © Sergio Zamarro
