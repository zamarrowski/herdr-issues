#!/bin/sh
# Regenerates assets/screenshots/*.svg.
#
# Runs the real popups in a pseudo-terminal with a scripted `gh` (fake-gh.mjs: the fictional acme/shop
# repository) and, for the start flow, the scripted herdr from the test suite. Needs `expect`
# (preinstalled on macOS, `apt install expect` on Debian/Ubuntu), Node.js and git.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
tools=$root/tools/screenshots
out=$root/assets/screenshots
work=$(mktemp -d)
if [ -z "${KEEP_WORK:-}" ]; then trap 'rm -rf "$work"' EXIT; else echo "keeping work dir: $work"; fi

# A checkout for the fictional repository: the popup needs a git root to work on.
mkdir -p "$work/shop" && git -C "$work/shop" init -q

export GH_BIN=$tools/fake-gh
export FAKE_GH_NODE=$(command -v node)
export FAKE_HERDR_NODE=$FAKE_GH_NODE
export NO_COLOR=
unset HERDR_ISSUES_CONFIG HERDR_ISSUES_AGENT
export HERDR_ISSUES_CONFIG=$work/config.json           # defaults only, whatever the local config says
export HERDR_PLUGIN_STATE_DIR=$work/state                # fresh cache
export HERDR_PLUGIN_CONTEXT_JSON="{\"workspace_id\":\"w3\",\"workspace_label\":\"shop\",\"workspace_cwd\":\"$work/shop\",\"focused_pane_id\":\"w3:p1\",\"focused_pane_cwd\":\"$work/shop\",\"focused_pane_agent\":\"codex\",\"focused_pane_status\":\"idle\"}"

browser="sh $root/bin/run.sh scripts/issues.mjs --cwd $work/shop"

capture() { # scene cols rows title [env...]
  scene=$1; cols=$2; rows=$3; title=$4; shift 4
  env "$@" "$tools/capture.exp" "$scene" "$cols" "$rows" "$work/$scene.log" $browser
  node "$tools/ansi-to-svg.mjs" "$work/$scene.log" "$out/$scene.svg" "$cols" "$rows" "$title"
}

capture browser  100 30 "Issues · acme/shop"
capture detail   100 30 "Issues · acme/shop · #482"
capture confirm   96 24 "Start issue · acme/shop"           HERDR_BIN_PATH="$root/test/fixtures/fake-herdr" FAKE_HERDR_SCENARIO=happy FAKE_HERDR_LOG="$work/herdr.log"
capture progress  96 24 "Starting #482 · acme/shop"         HERDR_BIN_PATH="$root/test/fixtures/fake-herdr" FAKE_HERDR_SCENARIO=happy FAKE_HERDR_LOG="$work/herdr.log"
# The picker lists the kinds the installed herdr supports; no agent in the pane, nothing in the config.
HERDR_PLUGIN_CONTEXT_JSON="{\"workspace_id\":\"w3\",\"workspace_cwd\":\"$work/shop\",\"focused_pane_cwd\":\"$work/shop\"}" \
  capture picker  96 24 "Start issue · acme/shop"

ls -la "$out"
