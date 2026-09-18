// Tiny argv parser: `--flag`, `--key value`, `--key=value` and positionals. No dependencies.
export const parseArgs = (argv, { flags = [], values = [] } = {}) => {
  const out = { flags: new Set(), values: {}, positional: [], unknown: [] }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--') {
      out.positional.push(...argv.slice(index + 1))
      break
    }
    if (!arg.startsWith('--')) {
      out.positional.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2)
    if (flags.includes(name)) {
      out.flags.add(name)
      continue
    }
    if (values.includes(name)) {
      out.values[name] = eq >= 0 ? arg.slice(eq + 1) : argv[++index]
      continue
    }
    out.unknown.push(arg)
  }

  return out
}
