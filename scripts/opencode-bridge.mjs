import { spawn as defaultSpawn } from 'node:child_process'
import { readAll } from './stream-reader.mjs'
import { validate } from './schema-validator.mjs'

export class OpencodeOutputError extends Error {
  constructor(message) {
    super(message)
    this.name = 'OpencodeOutputError'
  }
}

export class OpencodeProcessError extends Error {
  constructor(message, exitCode, stderr) {
    super(message)
    this.name = 'OpencodeProcessError'
    this.exitCode = exitCode
    this.stderr = stderr
  }
}

export class OpencodeTimeoutError extends Error {
  constructor(message) {
    super(message)
    this.name = 'OpencodeTimeoutError'
  }
}

export class OpencodeNotInstalledError extends Error {
  constructor(message) {
    super(message)
    this.name = 'OpencodeNotInstalledError'
  }
}

export class OpencodeAbortedError extends Error {
  constructor(message = 'opencode invocation aborted') {
    super(message)
    this.name = 'OpencodeAbortedError'
  }
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

const INSTALL_HINT =
  'opencode CLI not found in PATH. Install: https://github.com/anomalyco/opencode (>= v1.2 required).'

function buildArgs({ cwd, model, agent, prompt }) {
  const args = ['run', '--dir', cwd, '--format', 'json']
  if (model) args.push('--model', model)
  if (agent) args.push('--agent', agent)
  args.push(prompt)
  return args
}

export async function invoke({
  prompt,
  cwd,
  model = 'free',
  agent = 'build',
  command,
  spawn = defaultSpawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
}) {
  if (command !== undefined && command !== null) {
    throw new Error(
      'must not combine --format json and --command flags (anomalyco/opencode bug #2923)',
    )
  }
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('invoke: `prompt` is required (string)')
  }
  if (!cwd || typeof cwd !== 'string') {
    throw new Error('invoke: `cwd` is required (string)')
  }

  // Pre-check: signal already aborted → bail before spawn
  if (signal?.aborted) {
    throw new OpencodeAbortedError('aborted before spawn')
  }

  const args = buildArgs({ cwd, model, agent, prompt })

  let child
  try {
    child = spawn('opencode', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw new OpencodeNotInstalledError(INSTALL_HINT)
    }
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
      reject(new OpencodeTimeoutError(`opencode timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  let abortListener
  const abortPromise = signal
    ? new Promise((_, reject) => {
        abortListener = () => {
          try {
            child.kill('SIGTERM')
          } catch {
            // ignore
          }
          reject(new OpencodeAbortedError('aborted during run'))
        }
        signal.addEventListener('abort', abortListener, { once: true })
      })
    : new Promise(() => {}) // never resolves

  const runPromise = (async () => {
    const stdoutP = readAll(child.stdout)
    const stderrP = readAll(child.stderr)
    const closeP = new Promise((resolve) => child.once('close', (exitCode) => resolve(exitCode)))

    const exitCode = await closeP
    const stdout = await stdoutP
    const stderr = await stderrP

    if (exitCode !== 0) {
      throw new OpencodeProcessError(
        `opencode exit ${exitCode}: ${stderr || '(no stderr)'}`,
        exitCode,
        stderr,
      )
    }

    let parsed
    try {
      parsed = JSON.parse(stdout)
    } catch (e) {
      throw new OpencodeOutputError(`stdout is not valid JSON: ${e.message}`)
    }

    const v = validate(parsed)
    if (!v.valid) {
      throw new OpencodeOutputError(`schema mismatch: ${JSON.stringify(v.errors)}`)
    }

    return parsed
  })()

  try {
    return await Promise.race([runPromise, timeoutPromise, abortPromise])
  } finally {
    clearTimeout(timeoutHandle)
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener)
    }
  }
}
