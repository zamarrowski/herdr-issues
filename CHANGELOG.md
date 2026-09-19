# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-09-19

First public release.

### Added

- Issues browser popup: open issues of the current repository with labels, assignees and age;
  read description and comments rendered as Markdown with syntax-highlighted code blocks (highlight.js,
  fetched by the manifest build step and optional at runtime; `m` shows the raw text); filter with `/`;
  include closed issues; open in the browser; per-repository cache so the popup paints instantly.
- Start flow: `herdr worktree create` on a branch named after the issue, `herdr agent start` of any
  agent kind herdr supports, `herdr agent prompt` with a configurable prompt, a toast and an `issue`
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
