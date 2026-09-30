// The integrations reached with an API token of their own, in tab order. GitHub goes through gh and is
// not one of them. Each module exports its adapter as `remote`; adding one here gives it a tab, the
// token form, the account screen, the people filter, Ctrl+click and the setup check (see CONTRIBUTING.md).
//
// Adapter:
//   id, name                        'linear', 'Linear': the tab, the config block and the ui.json key
//   noun, plural                    'story' / 'stories': titles, messages, toasts
//   refExample                      'ENG-123': how the start popup says what it accepts
//   tokenName, tokenWord, tokenEnv  'API key', 'key', 'LINEAR_API_KEY'; secretKey: its key in secrets.json
//   tokenHelp                       where to create a token, for the token form
//   link                            { id, pattern } of its [[link_handlers]] entry in herdr-plugin.toml
//   filter                          peopleFilter(…) from lib/integration.mjs: fields, normalize, text
//   assigneeLabel                   'owners' / 'assignee': the label of the assignees in the detail view
//   parseRef(text)                  key or URL → { number, ref, workspace | null } | null
//   auth(options)                   → { token, from: 'env' | 'file' } | null
//   whoami(token)                   → { handle, name, workspace, … }: the token's owner, and the token check
//   describe(me)                    '@ana in acme': the account, for the setup check
//   lookups(token)                  → data cached next to the list; people(lookups) → [{ handle, name }]
//   teams(token)                    → [{ names: [key or name, …] }], to check the configured team
//   team(config)                    the configured team, '' for the whole workspace
//   list(token, { config, closed, limit, lookups, filter, me }) → records, newest updated first
//   view(token, item, { lookups })  → one record with body and comments; `item` is a record
//   fetch(token, ref)               → the same from a parsed ref, loading whatever it needs (start popup)
//   meta(issue)                     the detail view's meta line, before the dates
//   settingsRows(config)            [[name, text, placeholder?]] for the account screen
import { remote as linear } from './linear.mjs'
import { remote as shortcut } from './shortcut.mjs'

export { ME } from './integration.mjs'

export const REMOTES = Object.freeze(Object.fromEntries([shortcut, linear].map(remote => [remote.id, remote])))
