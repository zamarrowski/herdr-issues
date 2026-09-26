// Setup: environment checks, keybindings for config.toml and a starter config.json.
//
//   • popup (TTY, via the `setup` action): shows the checks and the snippet;
//     k adds the keybindings (backup + reload), u removes them, c creates config.json, q quits.
//   • CLI (no TTY): setup.mjs [--print] [--write-keys] [--remove-keys] [--init-config] [--check]
import { parseArgs } from '../lib/args.mjs'
import { c, paint, truncate } from '../lib/format.mjs'
import { reloadConfig } from '../lib/herdr.mjs'
import { PLUGIN_ID, REPO_URL, configPath, herdrConfigPath, pluginVersion } from '../lib/paths.mjs'
import { initConfig, keyBlock, removeKeys, runChecks, writeKeys } from '../lib/setup.mjs'
import { createScreen, header, hint, isCtrlC, isEsc, layout, notice, rule } from '../lib/tui.mjs'

const USAGE = 'usage: setup.mjs [--print] [--write-keys] [--remove-keys] [--init-config] [--check]'
const args = parseArgs(process.argv.slice(2), { flags: ['print', 'write-keys', 'remove-keys', 'init-config', 'check', 'help'] })
if (args.flags.has('help')) {
  console.log(USAGE)
  process.exit(0)
}

const ICON = { true: paint(c.green, '✓'), false: paint(c.red, '✗'), null: paint(c.dim, '·') }
const checkLines = checks => checks.map(check => `  ${ICON[String(check.ok)]} ${check.text}`)

const reload = async () => {
  try {
    await reloadConfig()

    return 'herdr config reloaded'
  } catch (error) {
    return `edit saved, but reload failed: ${error.message} (run \`herdr server reload-config\`)`
  }
}

const doWriteKeys = async () => {
  const result = writeKeys()
  if (!result.changed) return 'keybindings already up to date'

  return `keybindings written to ${result.file}${result.backup ? ` (backup: ${result.backup})` : ''} · ${await reload()}`
}

const doRemoveKeys = async () => {
  const result = removeKeys()

  return result.changed ? `keybindings removed from ${result.file} · ${await reload()}` : 'no keybinding block to remove'
}

const doInitConfig = () => {
  const result = initConfig()

  return result.created ? `created ${result.file}` : `${result.file} already exists`
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  const wants = flag => args.flags.has(flag)
  const nothing = !wants('write-keys') && !wants('remove-keys') && !wants('init-config') && !wants('check')
  if (wants('write-keys')) console.log(await doWriteKeys())
  if (wants('remove-keys')) console.log(await doRemoveKeys())
  if (wants('init-config')) console.log(doInitConfig())
  if (wants('check') || nothing) {
    const checks = await runChecks()
    console.log(checks.map(check => `${check.ok === true ? '✓' : check.ok === false ? '✗' : '·'} ${check.text}`).join('\n'))
    if (checks.some(check => check.ok === false)) process.exitCode = 1
  }
  if (wants('print') || nothing) {
    console.log(`\nKeybindings for ${herdrConfigPath()} (then: herdr server reload-config):\n\n${keyBlock()}\n`)
    console.log(`Config: ${configPath()}  (create it with --init-config; every key is documented in docs/configuration.md)`)
    console.log(`Ctrl+click a GitHub issue, Shortcut story or Linear issue URL in any pane to start it; no keybinding needed.`)
  }
  process.exit()
}

// ── popup ───────────────────────────────────────────────────────────────────

const state = { checks: [], message: 'checking…', busy: false }

const refresh = async () => {
  state.checks = await runChecks()
  if (state.message === 'checking…') state.message = ''
  screen.draw()
}

const render = (width, height) => {
  const body = [
    header('Issues setup', { subtitle: PLUGIN_ID, right: `v${pluginVersion()}` }, width),
    rule(width),
    paint(c.bold, ' Checks'),
    ...checkLines(state.checks).map(line => truncate(line, width)),
    '',
    paint(c.bold, ' Keybindings'),
    ...keyBlock().split('\n').map(line => paint(line.startsWith('#') ? c.dim : c.reset, `  ${line}`)),
    '',
    paint(c.dim, ' Ctrl+click a GitHub issue, Shortcut story or Linear issue URL in any pane to start it; no keybinding needed.'),
    paint(c.dim, ` Docs: ${REPO_URL}`),
  ]
  const footer = [notice(state.message), hint('k add keybindings to config.toml · u remove them · c create config.json · q quit')]

  return layout(body, footer, height)
}

const act = async fn => {
  if (state.busy) return
  state.busy = true
  state.message = 'working…'
  screen.draw()
  try {
    state.message = await fn()
  } catch (error) {
    state.message = error.message
  }
  state.busy = false
  await refresh()
}

const onKey = key => {
  if (key === 'q' || key === 'Q' || isEsc(key) || isCtrlC(key)) return screen.exit(0)
  if (key === 'k' || key === 'K') return act(doWriteKeys)
  if (key === 'u' || key === 'U') return act(doRemoveKeys)
  if (key === 'c' || key === 'C') return act(async () => doInitConfig())
  if (key === 'r' || key === 'R') return refresh()
}

const screen = createScreen({ render, onKey })
screen.draw()
refresh()
