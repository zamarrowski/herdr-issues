# Notes for coding agents

Guidance for AI coding agents (and humans in a hurry) working on this repository.

- **Read first:** `README.md` for behaviour, `CONTRIBUTING.md` for layout, style and the design rules,
  `docs/configuration.md` for every config key. herdr's own CLI is the authority for its commands:
  run `herdr agent`, `herdr worktree`, `herdr plugin` (the bare group) to see their syntax.
- **One dependency, highlight.js, optional at runtime.** Do not add packages; if a change truly needs
  one, stop and ask. Everything else is the Node.js standard library, Node ≥ 20. `npm ci` before tests.
- **herdr only through its CLI**, via `lib/herdr.mjs` and `HERDR_BIN_PATH`. Do not talk to the socket
  or read herdr's internal files.
- **Stay agent-agnostic.** Never branch on an agent kind in code. Behaviour that differs per agent
  must be data in `config.json` (`agent_args`, `agent_modes`, `trust_prompt_pattern`) with a sensible default.
- **Tests:** `npm test` (node:test). They must run without herdr, `gh`, network or a TTY. herdr is
  scripted by `test/fixtures/fake-herdr.mjs`; extend its scenarios rather than mocking modules.
  `test/manifest.test.mjs` checks that `herdr-plugin.toml`, `package.json` and `config.example.json`
  agree; update all three when adding a config key or an action.
- **Do not touch the user's environment from tests or scripts:** no writes to `~/.config/herdr`
  except through `lib/setup.mjs` functions invoked by an explicit user action.
- **Style:** ESM, two spaces, no semicolons, single quotes, small pure functions in `lib/`, side
  effects in `scripts/`. Match the surrounding code.
- **Docs and changelog:** any behaviour or configuration change updates `README.md`/`docs/` and adds a
  line under *Unreleased* in `CHANGELOG.md`.
- **Versioning:** `version` in `herdr-plugin.toml` and `package.json` must match; bump both.
