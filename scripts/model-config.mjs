// Per-project persistence of the chosen free model.
//
// Stored at <cwd>/.opencode-plugin/config.json as { "model": "<provider/model>" }.
// The /oc-model + /oc-exec skills write the user's choice here so subsequent
// runs reuse it without asking again. cli.mjs reads it as the default model.

import {
  readFileSync as defaultReadFileSync,
  writeFileSync as defaultWriteFileSync,
  mkdirSync as defaultMkdirSync,
} from 'node:fs'
import { join, dirname } from 'node:path'

const defaultFs = {
  readFileSync: defaultReadFileSync,
  writeFileSync: defaultWriteFileSync,
  mkdirSync: defaultMkdirSync,
}

export function modelConfigPath(cwd) {
  return join(cwd, '.opencode-plugin', 'config.json')
}

/**
 * @returns {string|null} saved model id, or null if unset/unreadable.
 */
export function readModel(cwd, { fs = defaultFs } = {}) {
  try {
    const cfg = JSON.parse(fs.readFileSync(modelConfigPath(cwd), 'utf8'))
    return typeof cfg.model === 'string' && cfg.model.length > 0 ? cfg.model : null
  } catch {
    return null
  }
}

/**
 * Persist the chosen model, preserving any other config keys.
 * @returns {string} the config file path written.
 */
export function writeModel(cwd, model, { fs = defaultFs } = {}) {
  if (!model || typeof model !== 'string') {
    throw new Error('writeModel: `model` must be a non-empty string')
  }
  const path = modelConfigPath(cwd)
  fs.mkdirSync(dirname(path), { recursive: true })

  let cfg = {}
  try {
    cfg = JSON.parse(fs.readFileSync(path, 'utf8'))
    if (!cfg || typeof cfg !== 'object') cfg = {}
  } catch {
    cfg = {}
  }
  cfg.model = model
  fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n')
  return path
}

// CLI: `node scripts/model-config.mjs get <cwd>` | `set <cwd> <model>`
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , action, cwdArg, modelArg] = process.argv
  const cwd = cwdArg || process.cwd()
  if (action === 'get') {
    process.stdout.write((readModel(cwd) || '') + '\n')
  } else if (action === 'set') {
    if (!modelArg) {
      process.stderr.write('usage: node scripts/model-config.mjs set <cwd> <provider/model>\n')
      process.exit(2)
    }
    const path = writeModel(cwd, modelArg)
    process.stdout.write(`saved model ${modelArg} → ${path}\n`)
  } else {
    process.stderr.write('usage: node scripts/model-config.mjs get <cwd> | set <cwd> <model>\n')
    process.exit(2)
  }
}
