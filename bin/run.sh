#!/bin/sh
# Runs a plugin script with the first Node.js we can find.
#
# herdr may launch plugin commands with a reduced PATH, so the usual install locations are
# checked before PATH. Set HERDR_ISSUES_NODE to force a specific binary.
#
# Usage: run.sh <script relative to the plugin root> [args...]

script=$1
[ -n "$script" ] || exit 0
shift

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

node_bin=
if [ -n "${HERDR_ISSUES_NODE:-}" ] && [ -x "$HERDR_ISSUES_NODE" ]; then
  node_bin=$HERDR_ISSUES_NODE
else
  for candidate in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node \
    "$HOME/.local/bin/node" \
    "$HOME/.volta/bin/node" \
    "$HOME/.nvm/current/bin/node"
  do
    if [ -x "$candidate" ]; then
      node_bin=$candidate
      break
    fi
  done
fi

[ -n "$node_bin" ] || node_bin=$(command -v node 2>/dev/null)
if [ -z "$node_bin" ]; then
  echo "herdr-issues: Node.js 20 or newer is required but no 'node' was found (set HERDR_ISSUES_NODE=/path/to/node)" >&2
  # Keep the popup readable for a moment instead of vanishing instantly.
  [ -t 0 ] && sleep 4
  exit 1
fi

exec "$node_bin" "$root/$script" "$@"
