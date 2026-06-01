import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { run, RetryExhaustedError } from '../scripts/retry-loop.mjs'
import {
  OpencodeProcessError,
  OpencodeNotInstalledError,
  OpencodeTimeoutError,
} from '../scripts/opencode-bridge.mjs'

function makeBridge(scenarios) {
  let i = 0
  return mock.fn(async () => {
    const s = scenarios[i++]
    if (s instanceof Error) throw s
    return s
  })
}

test('run: first call success — no retry', async () => {
  const bridge = makeBridge([{ session_id: 's1', status: 'completed', result: { diff: 'd' } }])
  const result = await run({ prompt: 'x', cwd: '/tmp', invoke: bridge })
  assert.equal(result.session_id, 's1')
  assert.equal(bridge.mock.calls.length, 1)
})

test('run: fail then success — retry 1 + feedback injected into prompt', async () => {
  const bridge = makeBridge([
    new OpencodeProcessError('exit 1: build error', 1, 'build error'),
    { session_id: 's2', status: 'completed', result: { diff: 'd' } },
  ])
  const result = await run({ prompt: 'do thing', cwd: '/tmp', invoke: bridge })
  assert.equal(result.session_id, 's2')
  assert.equal(bridge.mock.calls.length, 2)
  const secondCall = bridge.mock.calls[1].arguments[0]
  assert.match(secondCall.prompt, /previous attempt failed/i)
  assert.match(secondCall.prompt, /build error/)
})

test('run: fail 3 times → RetryExhaustedError with history of 3', async () => {
  const bridge = makeBridge([
    new OpencodeProcessError('err 1', 1, ''),
    new OpencodeProcessError('err 2', 1, ''),
    new OpencodeProcessError('err 3', 1, ''),
  ])
  await assert.rejects(
    () => run({ prompt: 'x', cwd: '/tmp', invoke: bridge }),
    (err) => {
      assert.equal(err.name, 'RetryExhaustedError')
      assert.equal(err.history.length, 3)
      return true
    },
  )
})

test('run: OpencodeNotInstalledError → bail-out, no retry', async () => {
  const bridge = makeBridge([new OpencodeNotInstalledError('not installed')])
  await assert.rejects(
    () => run({ prompt: 'x', cwd: '/tmp', invoke: bridge }),
    (err) => err.name === 'OpencodeNotInstalledError',
  )
  assert.equal(bridge.mock.calls.length, 1)
})

test('run: OpencodeTimeoutError → bail-out, no retry', async () => {
  const bridge = makeBridge([new OpencodeTimeoutError('5min')])
  await assert.rejects(
    () => run({ prompt: 'x', cwd: '/tmp', invoke: bridge }),
    (err) => err.name === 'OpencodeTimeoutError',
  )
  assert.equal(bridge.mock.calls.length, 1)
})

test('run: reviewer reject → retry with reviewer comment in feedback', async () => {
  const bridge = makeBridge([
    { session_id: 's1', status: 'completed', result: { diff: 'diff v1' } },
    { session_id: 's2', status: 'completed', result: { diff: 'diff v2' } },
  ])
  const reviewer = mock.fn(async (diff) =>
    diff === 'diff v1'
      ? { pass: false, comment: 'missing return statement' }
      : { pass: true, comment: 'looks good' },
  )
  const result = await run({ prompt: 'x', cwd: '/tmp', invoke: bridge, reviewer })
  assert.equal(result.session_id, 's2')
  assert.equal(bridge.mock.calls.length, 2)
  const secondCall = bridge.mock.calls[1].arguments[0]
  assert.match(secondCall.prompt, /missing return statement/)
})

test('run: trace callback fires per attempt with same traceId across retries', async () => {
  const trace = []
  const bridge = makeBridge([
    new OpencodeProcessError('boom', 1, 'stderr'),
    { session_id: 's1', status: 'completed', result: { diff: 'd' } },
  ])
  await run({
    prompt: 'x',
    cwd: '/tmp',
    invoke: bridge,
    onTrace: (entry) => trace.push(entry),
  })
  assert.equal(trace.length, 2)
  assert.equal(trace[0].attempt, 1)
  assert.equal(trace[0].status, 'failed')
  assert.equal(trace[1].attempt, 2)
  assert.equal(trace[1].status, 'completed')
  assert.ok(trace[0].traceId)
  assert.equal(trace[0].traceId, trace[1].traceId)
})
