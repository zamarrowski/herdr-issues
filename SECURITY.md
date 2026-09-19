# Security

## What this plugin does on your machine

herdr plugins are ordinary code that runs as your user, with your environment and the full herdr CLI.
herdr-issues keeps its footprint small and inspectable:

- **Processes it runs:** `herdr` (through `HERDR_BIN_PATH`), `gh`, `git rev-parse` and `node`. Nothing
  else, and no shell strings built from issue content: every subprocess gets an argument array. At
  install time herdr runs the manifest's build step, `npm ci`, after showing it to you.
- **Dependencies:** one, [highlight.js](https://github.com/highlightjs/highlight.js) (BSD-3-Clause),
  pinned by `package-lock.json` and loaded only to colour code blocks. It is optional at runtime: when
  it is missing the plugin renders code blocks plain.
- **Network:** `npm ci` at install time, and afterwards only what `gh` does to list and read issues
  (`gh issue list`, `gh issue view`, `gh repo view`) and, when you press `o`, `gh issue view --web`.
  The plugin makes no HTTP requests of its own and never reads or stores GitHub tokens; `gh` uses its
  own login.
- **Files it writes:** an issue cache under `HERDR_PLUGIN_STATE_DIR`, `config.json` under
  `HERDR_PLUGIN_CONFIG_DIR` when you save a default agent or create it from the setup popup, and your
  herdr `config.toml` only when you explicitly press `k`/`u` in the setup popup or run
  `setup.mjs --write-keys` / `--remove-keys` (a one-time backup is kept next to it).
- **What it sends to agents:** the rendered `prompt` template, by default just the issue URL, typed
  into the agent's input and left there for you to send (`"submit": true` sends it). Issue bodies and
  comments are never pasted into the agent. The only key ever pressed on an agent's behalf is Enter:
  when `submit` is on, to send the prompt; and while the agent is blocked on a screen matching
  `trust_prompt_pattern` (see [docs/agents.md](docs/agents.md)), unless `auto_accept_trust_prompt` is
  `false`.

Issue titles flow into branch names, workspace labels and agent names after sanitisation
(`lib/config.mjs`), and into the prompt verbatim. Treat issues from repositories you do not control
like any other untrusted text you would show an agent.

## Supported versions

Only the latest release on the default branch receives fixes.

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private vulnerability reporting
on this repository (**Security → Report a vulnerability**), or contact the maintainer privately through
[github.com/zamarrowski](https://github.com/zamarrowski). You should hear back within a week. Once a fix
is out the report will be credited in the changelog unless you prefer otherwise.
