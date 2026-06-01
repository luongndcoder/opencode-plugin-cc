#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { run, RetryExhaustedError } from './retry-loop.mjs'
import {
  OpencodeNotInstalledError,
  OpencodeTimeoutError,
  OpencodeProcessError,
  OpencodeOutputError,
} from './opencode-bridge.mjs'

const { values } = parseArgs({
  options: {
    prompt: { type: 'string', short: 'p' },
    cwd: { type: 'string', short: 'd' },
    model: { type: 'string', short: 'm' },
    agent: { type: 'string', short: 'a' },
    'trace-file': { type: 'string' },
    'max-retry': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

if (values.help || !values.prompt || !values.cwd) {
  console.error(`Usage: node scripts/cli.mjs --prompt "<task>" --cwd <dir> [--model <m>] [--agent <a>] [--trace-file <path>] [--max-retry <n>]`)
  process.exit(values.help ? 0 : 2)
}

const traceFile = values['trace-file']
let onTrace = () => {}
if (traceFile) {
  mkdirSync(dirname(traceFile), { recursive: true })
  onTrace = (entry) => appendFileSync(traceFile, JSON.stringify(entry) + '\n')
}

const maxRetry = values['max-retry'] ? Number.parseInt(values['max-retry'], 10) : undefined

try {
  const result = await run({
    prompt: values.prompt,
    cwd: values.cwd,
    model: values.model,
    agent: values.agent,
    onTrace,
    ...(Number.isFinite(maxRetry) ? { maxRetry } : {}),
  })
  process.stdout.write(JSON.stringify({ success: true, result }) + '\n')
  process.exit(0)
} catch (err) {
  const payload = {
    success: false,
    error_type: err.name,
    error_message: err.message,
  }
  if (err instanceof RetryExhaustedError) {
    payload.history = err.history
  }
  if (err instanceof OpencodeProcessError) {
    payload.exit_code = err.exitCode
    payload.stderr = err.stderr
  }
  process.stdout.write(JSON.stringify(payload) + '\n')
  // Exit codes: 1 = retry-exhausted; 2 = transient unhandled; 3 = bail-out (not-installed / timeout / output-error)
  if (err instanceof RetryExhaustedError) process.exit(1)
  if (err instanceof OpencodeNotInstalledError) process.exit(3)
  if (err instanceof OpencodeTimeoutError) process.exit(3)
  if (err instanceof OpencodeOutputError) process.exit(3)
  process.exit(2)
}
