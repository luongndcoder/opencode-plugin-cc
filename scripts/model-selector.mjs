import { spawn as defaultSpawn } from 'node:child_process'
import { readAll } from './stream-reader.mjs'
import { OpencodeNotInstalledError, OpencodeTimeoutError } from './opencode-bridge.mjs'

export class NoFreeModelError extends Error {
  constructor(
    message = 'no free model available from opencode (need cost.input === 0 && cost.output === 0). ' +
      'Run `opencode models --verbose` or configure a provider, then pass --model <provider/model>.',
  ) {
    super(message)
    this.name = 'NoFreeModelError'
  }
}

const INSTALL_HINT =
  'opencode CLI not found in PATH. Install: https://github.com/anomalyco/opencode (>= v1.2 required).'

// A header line in `opencode models --verbose` is exactly `<provider>/<model>` at column 0.
// JSON detail lines are indented (col > 0) or are bare braces — none match this anchored regex.
const HEADER_RE = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/

// Sentinels meaning "auto-pick a free model" rather than a concrete provider/model id.
const AUTO_SENTINELS = new Set(['free', 'auto', ''])

const DEFAULT_LIST_TIMEOUT_MS = 30 * 1000

// Preference order among free models (known-good coding models first).
// Any free model not listed falls back to deterministic alphabetical order.
const PREFERENCE = [
  'opencode/big-pickle',
  'opencode/minimax-m3-free',
  'opencode/deepseek-v4-flash-free',
  'opencode/mimo-v2.5-free',
  'opencode/nemotron-3-super-free',
]

/**
 * Parse the interleaved header-line + pretty-JSON output of `opencode models --verbose`.
 *
 * @param {string} text Raw stdout from `opencode models --verbose`.
 * @returns {Array<{id: string, cost: object|null, toolcall: boolean|null, context: number|null}>}
 */
export function parseVerboseModels(text) {
  const lines = String(text).split('\n')
  const models = []
  let currentId = null
  let buffer = []

  const flush = () => {
    if (currentId === null) return
    try {
      const obj = JSON.parse(buffer.join('\n'))
      models.push({
        id: currentId,
        cost: obj.cost ?? null,
        toolcall: obj.capabilities?.toolcall ?? null,
        context: obj.limit?.context ?? null,
      })
    } catch {
      // Skip an unparseable block — never let one bad model poison the whole list.
    }
  }

  for (const line of lines) {
    if (HEADER_RE.test(line)) {
      flush()
      currentId = line
      buffer = []
    } else if (currentId !== null) {
      buffer.push(line)
    }
  }
  flush()
  return models
}

/**
 * Choose a free model from a parsed model list.
 * Free = cost.input === 0 AND cost.output === 0 (input-only-free providers are NOT free).
 *
 * @param {Array} models Output of parseVerboseModels.
 * @param {{requireToolcall?: boolean}} opts
 * @returns {string|null} `<provider>/<model>` id, or null if none qualify.
 */
export function pickFree(models, { requireToolcall = true } = {}) {
  let free = models.filter((m) => m.cost && m.cost.input === 0 && m.cost.output === 0)

  if (requireToolcall) {
    const withTool = free.filter((m) => m.toolcall === true)
    // Only narrow to tool-capable models if at least one exists; otherwise keep the full
    // free set so we still return *something* rather than failing hard.
    if (withTool.length > 0) free = withTool
  }

  if (free.length === 0) return null

  const ids = free.map((m) => m.id)
  for (const pref of PREFERENCE) {
    if (ids.includes(pref)) return pref
  }
  return [...ids].sort()[0]
}

async function listVerbose({ spawn, timeoutMs }) {
  let child
  try {
    child = spawn('opencode', ['models', '--verbose'], { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    if (e && e.code === 'ENOENT') throw new OpencodeNotInstalledError(INSTALL_HINT)
    throw e
  }

  let timeoutHandle
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore — child may already be dead
      }
      reject(new OpencodeTimeoutError(`opencode models timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  // spawn may surface ENOENT asynchronously via the 'error' event (not a sync throw).
  const errorPromise = new Promise((_, reject) => {
    child.once('error', (e) => {
      if (e && e.code === 'ENOENT') reject(new OpencodeNotInstalledError(INSTALL_HINT))
      else reject(e)
    })
  })

  const runPromise = (async () => {
    const stdoutP = readAll(child.stdout)
    const stderrP = readAll(child.stderr)
    const exitCode = await new Promise((resolve) => child.once('close', (code) => resolve(code)))
    const stdout = await stdoutP
    const stderr = await stderrP
    if (exitCode !== 0) {
      throw new Error(`opencode models exit ${exitCode}: ${stderr || '(no stderr)'}`)
    }
    return stdout
  })()

  try {
    return await Promise.race([runPromise, timeoutPromise, errorPromise])
  } finally {
    clearTimeout(timeoutHandle)
  }
}

/**
 * Resolve the model string to pass to `opencode run`.
 * - Concrete `provider/model` (anything not in AUTO_SENTINELS) → returned as-is.
 * - `free` / `auto` / empty / undefined → query opencode and auto-pick a free model.
 *
 * @param {{requested?: string, spawn?: Function, timeoutMs?: number}} opts
 * @returns {Promise<string>} Concrete `<provider>/<model>` id.
 * @throws {NoFreeModelError} when auto-pick finds no free model.
 */
export async function selectFreeModel({
  requested,
  spawn = defaultSpawn,
  timeoutMs = DEFAULT_LIST_TIMEOUT_MS,
} = {}) {
  if (requested && !AUTO_SENTINELS.has(requested)) {
    return requested
  }
  const text = await listVerbose({ spawn, timeoutMs })
  const models = parseVerboseModels(text)
  const picked = pickFree(models)
  if (!picked) throw new NoFreeModelError()
  return picked
}

/**
 * List ALL free models (cost.input === 0 && cost.output === 0) for the user to
 * choose from. Preference-ordered first, then by context size desc.
 *
 * @returns {Promise<Array<{id: string, context: number|null, toolcall: boolean}>>}
 */
export async function listFreeModels({
  spawn = defaultSpawn,
  timeoutMs = DEFAULT_LIST_TIMEOUT_MS,
} = {}) {
  const text = await listVerbose({ spawn, timeoutMs })
  const free = parseVerboseModels(text)
    .filter((m) => m.cost && m.cost.input === 0 && m.cost.output === 0)
    .map((m) => ({ id: m.id, context: m.context, toolcall: m.toolcall === true }))

  const rank = (id) => {
    const i = PREFERENCE.indexOf(id)
    return i === -1 ? PREFERENCE.length : i
  }
  return free.sort((a, b) => rank(a.id) - rank(b.id) || (b.context || 0) - (a.context || 0))
}

// CLI: `node scripts/model-selector.mjs --list` → prints free models as JSON.
// Used by the /oc-model and /oc-exec skills to build an AskUserQuestion.
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === '--list') {
    listFreeModels()
      .then((models) => process.stdout.write(JSON.stringify({ models }, null, 2) + '\n'))
      .catch((e) => {
        process.stderr.write(`${e.name}: ${e.message}\n`)
        process.exit(e.name === 'OpencodeNotInstalledError' ? 3 : 2)
      })
  } else {
    process.stderr.write('usage: node scripts/model-selector.mjs --list\n')
    process.exit(2)
  }
}
