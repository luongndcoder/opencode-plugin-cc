#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { run, RetryExhaustedError } from './retry-loop.mjs'
import {
  OpencodeNotInstalledError,
  OpencodeTimeoutError,
  OpencodeProcessError,
  OpencodeOutputError,
  OpencodeAbortedError,
} from './opencode-bridge.mjs'
import { createCancelHandler } from './cancel-handler.mjs'

const { values } = parseArgs({
  options: {
    prompt: { type: 'string', short: 'p' },
    cwd: { type: 'string', short: 'd' },
    model: { type: 'string', short: 'm' },
    agent: { type: 'string', short: 'a' },
    'trace-file': { type: 'string' },
    'max-retry': { type: 'string' },
    timeout: { type: 'string', short: 't' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

if (values.help || !values.prompt || !values.cwd) {
  console.error(
    `Usage: node scripts/cli.mjs --prompt "<task>" --cwd <dir> [--model <m>] [--agent <a>] [--trace-file <path>] [--max-retry <n>] [--timeout <ms>]\n` +
      `\nExit codes:\n` +
      `  0   success\n` +
      `  1   retry exhausted (transient errors)\n` +
      `  2   other unhandled error\n` +
      `  3   bail-out (not installed / timeout / output schema mismatch)\n` +
      `  130 cancelled by SIGINT\n` +
      `  143 cancelled by SIGTERM\n`,
  )
  process.exit(values.help ? 0 : 2)
}

const cwd = resolvePath(values.cwd)
const traceFile = values['trace-file'] || `${cwd}/.opencode-plugin/trace.jsonl`
const pidFile = `${cwd}/.opencode-plugin/active.pid`

mkdirSync(dirname(traceFile), { recursive: true })
const onTrace = (entry) => appendFileSync(traceFile, JSON.stringify(entry) + '\n')

const maxRetry = values['max-retry'] ? Number.parseInt(values['max-retry'], 10) : undefined
const timeoutMs = values.timeout ? Number.parseInt(values.timeout, 10) : undefined

const abortController = new AbortController()
const cancelHandler = createCancelHandler({
  pidFile,
  abortController,
  onTrace,
})
cancelHandler.install()

try {
  const result = await run({
    prompt: values.prompt,
    cwd,
    model: values.model,
    agent: values.agent,
    signal: abortController.signal,
    onTrace,
    ...(Number.isFinite(maxRetry) ? { maxRetry } : {}),
    ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
  })
  cancelHandler.uninstall()
  process.stdout.write(JSON.stringify({ success: true, result }) + '\n')
  process.exit(0)
} catch (err) {
  cancelHandler.uninstall()
  const payload = {
    success: false,
    error_type: err.name,
    error_message: err.message,
  }
  if (err instanceof RetryExhaustedError) payload.history = err.history
  if (err instanceof OpencodeProcessError) {
    payload.exit_code = err.exitCode
    payload.stderr = err.stderr
  }
  process.stdout.write(JSON.stringify(payload) + '\n')

  if (err instanceof RetryExhaustedError) process.exit(1)
  if (err instanceof OpencodeNotInstalledError) process.exit(3)
  if (err instanceof OpencodeTimeoutError) process.exit(124) // GNU `timeout` convention
  if (err instanceof OpencodeAbortedError) process.exit(130) // treat external abort like SIGINT
  if (err instanceof OpencodeOutputError) process.exit(3)
  process.exit(2)
}
