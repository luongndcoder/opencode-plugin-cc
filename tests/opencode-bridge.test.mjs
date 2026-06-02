import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { invoke } from '../scripts/opencode-bridge.mjs'

function makeFakeChild({ stdout = '', stderr = '', exitCode = 0, signal = null, neverEmits = false } = {}) {
  const child = new EventEmitter()
  child.stdout = neverEmits ? new Readable({ read() {} }) : Readable.from([stdout])
  child.stderr = neverEmits ? new Readable({ read() {} }) : Readable.from([stderr])
  child.kill = mock.fn()
  if (!neverEmits) {
    queueMicrotask(() => child.emit('close', exitCode, signal))
  }
  return child
}

function fakeSpawn(opts = {}) {
  return mock.fn(() => makeFakeChild(opts))
}

test('invoke: happy path returns parsed JSON', async () => {
  const stdout = JSON.stringify({ session_id: 's1', status: 'completed', result: { diff: 'd' } })
  const spawn = fakeSpawn({ stdout })
  const out = await invoke({ prompt: 'hello', cwd: '/tmp', spawn })
  assert.equal(out.session_id, 's1')
  assert.equal(out.status, 'completed')
  assert.equal(out.result.diff, 'd')
})

test('invoke: malformed stdout throws OpencodeOutputError', async () => {
  const spawn = fakeSpawn({ stdout: 'this is not json' })
  await assert.rejects(
    () => invoke({ prompt: 'x', cwd: '/tmp', spawn }),
    (err) => err.name === 'OpencodeOutputError',
  )
})

test('invoke: exit != 0 throws OpencodeProcessError with stderr', async () => {
  const spawn = fakeSpawn({ exitCode: 1, stderr: 'boom from opencode' })
  await assert.rejects(
    () => invoke({ prompt: 'x', cwd: '/tmp', spawn }),
    (err) => err.name === 'OpencodeProcessError' && /boom from opencode/.test(err.message),
  )
})

test('invoke: timeout kills child + throws OpencodeTimeoutError', async () => {
  const child = makeFakeChild({ neverEmits: true })
  const spawn = mock.fn(() => child)
  const p = invoke({ prompt: 'x', cwd: '/tmp', spawn, timeoutMs: 50 })
  await assert.rejects(p, (err) => err.name === 'OpencodeTimeoutError')
  assert.equal(child.kill.mock.calls.length, 1)
})

test('invoke: spawn ENOENT throws OpencodeNotInstalledError with install link', async () => {
  const spawn = mock.fn(() => {
    const e = new Error('spawn opencode ENOENT')
    e.code = 'ENOENT'
    throw e
  })
  await assert.rejects(
    () => invoke({ prompt: 'x', cwd: '/tmp', spawn }),
    (err) => err.name === 'OpencodeNotInstalledError' && /anomalyco\/opencode/.test(err.message),
  )
})

test('invoke: forbids --format json + --command combo (anomalyco bug #2923)', async () => {
  const spawn = fakeSpawn()
  await assert.rejects(
    () => invoke({ prompt: 'x', cwd: '/tmp', spawn, command: 'foo' }),
    /must not combine --format json and --command/,
  )
})

test('invoke: pre-aborted signal throws OpencodeAbortedError, spawn NOT called', async () => {
  const spawn = mock.fn()
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(
    () => invoke({ prompt: 'x', cwd: '/tmp', spawn, signal: ac.signal }),
    (err) => err.name === 'OpencodeAbortedError',
  )
  assert.equal(spawn.mock.calls.length, 0)
})

test('invoke: abort during run kills child + throws OpencodeAbortedError', async () => {
  const child = makeFakeChild({ neverEmits: true })
  const spawn = mock.fn(() => child)
  const ac = new AbortController()
  const p = invoke({ prompt: 'x', cwd: '/tmp', spawn, signal: ac.signal, timeoutMs: 500 })
  setTimeout(() => ac.abort(), 30)
  await assert.rejects(p, (err) => err.name === 'OpencodeAbortedError')
  assert.equal(child.kill.mock.calls.length, 1)
})

test('invoke: completion cleans abort listener (no leak after success)', async () => {
  const stdout = JSON.stringify({ session_id: 's1', status: 'completed' })
  const spawn = fakeSpawn({ stdout })
  const ac = new AbortController()
  await invoke({ prompt: 'x', cwd: '/tmp', spawn, signal: ac.signal })
  // Aborting after completion must not throw or interfere
  ac.abort()
  assert.equal(ac.signal.aborted, true)
})

test('invoke: builds CLI args correctly (--dir, --agent, --format json, prompt positional)', async () => {
  const stdout = JSON.stringify({ session_id: 's1', status: 'completed' })
  const spawn = fakeSpawn({ stdout })
  await invoke({ prompt: 'do thing', cwd: '/repo', model: 'opencode/big-pickle', agent: 'build', spawn })
  const call = spawn.mock.calls[0]
  assert.equal(call.arguments[0], 'opencode')
  const args = call.arguments[1]
  assert.equal(args[0], 'run')
  assert.ok(args.includes('--dir'))
  assert.ok(args.includes('/repo'))
  assert.ok(args.includes('--format'))
  assert.ok(args.includes('json'))
  assert.ok(args.includes('--model'))
  assert.ok(args.includes('opencode/big-pickle'))
  assert.ok(args.includes('--agent'))
  assert.ok(args.includes('build'))
  assert.equal(args[args.length - 1], 'do thing', 'prompt must be positional at end')
})

test('invoke: omits --model entirely when model is falsy (never passes literal "free")', async () => {
  const stdout = JSON.stringify({ session_id: 's1', status: 'completed' })
  const spawn = fakeSpawn({ stdout })
  await invoke({ prompt: 'do thing', cwd: '/repo', agent: 'build', spawn })
  const args = spawn.mock.calls[0].arguments[1]
  assert.ok(!args.includes('--model'), '--model must be absent when no model resolved')
})
