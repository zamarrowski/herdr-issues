# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Shortcut stories next to GitHub issues. The popup has three tabs, All, GitHub and Shortcut, and
  `tabs` in `config.json` chooses which ones appear and in what order. The Shortcut tab asks for an API
  token the first time, checks it and saves it in `secrets.json` (mode `0600`); `,` replaces or removes
  it, and `SHORTCUT_API_TOKEN` takes precedence. Stories show their workflow state, tasks and comments,
  start on an `sc-<id>-<slug>` branch after asking which open repository gets the worktree, and can be
  Ctrl+clicked (`app.shortcut.com/…/story/…`) or started with `start.mjs sc-482`. New `shortcut` config
  block (`team`, `query`, per-story templates), `{ref}` and `{source}` placeholders, `--source` for
  `issues.mjs`, and a Shortcut check in the setup popup.
- Owner / requester filter for Shortcut stories (`f`): anyone, me or any member of the workspace,
  applied in the Shortcut search and remembered between popups; `--owner` / `--requester` on the
  command line.
- Linear issues, in a fourth tab. It asks for a personal API key the first time, checks it and keeps it
  in `secrets.json` next to the Shortcut token (`LINEAR_API_KEY` takes precedence); `,` replaces or
  removes it. Issues show their state, priority, project, cycle, sub-issues and comments, start on an
  `ENG-123-<slug>` branch after asking which open repository gets the worktree, and can be Ctrl+clicked
  (`linear.app/…/issue/ENG-123`) or started with `start.mjs ENG-123`. `f` filters by assignee and creator
  (`--assignee` / `--creator` on the command line). New `linear` config block (`team`, `filter`,
  per-issue templates), `--source linear` for `issues.mjs`, and a Linear check in the setup popup.
- `{vcs_branch}` placeholder: the branch name Shortcut or Linear suggests for the story or issue.
- Starting a story or a Linear issue offers every workspace open in herdr: repositories get a worktree
  (including checkouts herdr does not flag as one, found with git from the workspace's pane), and a
  workspace that is not a git checkout gets a new tab with the agent instead.

### Changed

- The default `label` is `{ref} {title}`, which renders exactly as before for GitHub issues.
- `issues.mjs --source all` lists the sources of the configured tabs.
- The setup popup checks `gh` only when a GitHub tab is shown. The keybinding descriptions say
  "issues and stories".
- The issue cache moved to a new format; old cache files are ignored.

## [0.1.0] - 2026-09-19

First public release.

### Added

- Issues browser popup: open issues of the current repository with labels, assignees and age;
  read description and comments rendered as Markdown with syntax-highlighted code blocks (highlight.js,
  fetched by the manifest build step and optional at runtime; `m` shows the raw text); filter with `/`;
  include closed issues; open in the browser; per-repository cache so the popup paints instantly.
- Start flow: `herdr worktree create` on a branch named after the issue, `herdr agent start` of any
  agent kind herdr supports, the issue URL typed into the agent's input for you to complete and send
  (`"submit": true` sends a configurable prompt with `herdr agent prompt`), a toast and an `issue`
  workspace token for the sidebar. Falls back to opening the worktree when the branch exists and leaves
  the pane alone when the worktree is already open.
- Agent selection: the agent in the focused pane by default, a picker otherwise, `d` to save a default;
  per-agent extra arguments (`agent_args`); trust-prompt handling with a configurable pattern.
- Ctrl+click link handler for GitHub issue URLs, and a `start` action that asks for a number or URL.
- Setup popup: environment checks (herdr, Node, `gh` and its login, config), keybinding block for
  `config.toml` with a one-time backup and reload, starter `config.json`.
- Command-line faces of every popup for scripts and agents, with `--json` where it makes sense.
- `config.json` with templates for branch, label, agent name and prompt, base ref, timeouts and
  environment overrides; documented in `docs/configuration.md` and `docs/agents.md`.
- Test suite on `node:test` with a scripted stand-in for the herdr CLI; CI on macOS and Linux.
- README screenshots generated from the real popups (`tools/screenshots/make.sh`).

[Unreleased]: https://github.com/zamarrowski/herdr-issues/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/zamarrowski/herdr-issues/releases/tag/v0.1.0
