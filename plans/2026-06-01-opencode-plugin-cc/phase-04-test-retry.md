# Phase 04 — Test plan: retry loop

**Goal:** Unit tests cho `retry-loop.mjs` — orchestration với feedback injection, bail-out, trace log. Tests fail/red.

**TDD role:** test (red).

**blockedBy:** phase-03.

---

## Tasks

### 1. Create `tests/retry-loop.test.mjs`

```javascript
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../scripts/retry-loop.mjs'
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
  const bridge = makeBridge([{ session_id: 's1', status: 'completed', result: {} }])
  const result = await run({ prompt: 'x', cwd: '/tmp', invoke: bridge })
  assert.equal(result.session_id, 's1')
  assert.equal(bridge.mock.calls.length, 1)
})

test('run: fail then success — retry 1 + feedback injected', async () => {
  const bridge = makeBridge([
    new OpencodeProcessError('exit 1'),
    { session_id: 's2', status: 'completed', result: {} },
  ])
  const result = await run({ prompt: 'x', cwd: '/tmp', invoke: bridge })
  assert.equal(result.session_id, 's2')
  assert.equal(bridge.mock.calls.length, 2)
  // second call prompt phải chứa feedback từ error trước
  const secondCall = bridge.mock.calls[1].arguments[0]
  assert.match(secondCall.prompt, /previous attempt failed/i)
  assert.match(secondCall.prompt, /exit 1/)
})

test('run: fail 3 lần → RetryExhaustedError với history', async () => {
  const bridge = makeBridge([
    new OpencodeProcessError('err 1'),
    new OpencodeProcessError('err 2'),
    new OpencodeProcessError('err 3'),
  ])
  await assert.rejects(
    run({ prompt: 'x', cwd: '/tmp', invoke: bridge }),
    (err) => {
      assert.equal(err.name, 'RetryExhaustedError')
      assert.equal(err.history.length, 3)
      return true
    }
  )
})

test('run: OpencodeNotInstalledError → bail-out, no retry', async () => {
  const bridge = makeBridge([new OpencodeNotInstalledError('not installed')])
  await assert.rejects(
    run({ prompt: 'x', cwd: '/tmp', invoke: bridge }),
    /OpencodeNotInstalledError/
  )
  assert.equal(bridge.mock.calls.length, 1)
})

test('run: OpencodeTimeoutError → bail-out, no retry (configurable)', async () => {
  const bridge = makeBridge([new OpencodeTimeoutError('5min')])
  await assert.rejects(
    run({ prompt: 'x', cwd: '/tmp', invoke: bridge }),
    /OpencodeTimeoutError/
  )
  assert.equal(bridge.mock.calls.length, 1)
})

test('run: feedback prompt chứa previous diff + reviewer comment', async () => {
  const bridge = makeBridge([
    { session_id: 's1', status: 'completed', result: { diff: '--- old\n+++ new' } },
    { session_id: 's2', status: 'completed', result: { diff: '--- old2\n+++ new2' } },
  ])
  const reviewer = mock.fn(async (diff) =>
    diff.includes('new\n') ? { pass: false, comment: 'missing return statement' } : { pass: true }
  )
  const result = await run({ prompt: 'x', cwd: '/tmp', invoke: bridge, reviewer })
  assert.equal(result.session_id, 's2')
  const secondCall = bridge.mock.calls[1].arguments[0]
  assert.match(secondCall.prompt, /missing return statement/)
})

test('run: trace append mỗi attempt', async () => {
  const trace = []
  const bridge = makeBridge([
    new OpencodeProcessError('boom'),
    { session_id: 's1', status: 'completed', result: {} },
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
  assert.equal(trace[0].traceId, trace[1].traceId) // same trace across retries
})
```

### 2. Run

```bash
node --test tests/retry-loop.test.mjs
```

Expect: **7 fail** (no impl yet).

---

## Acceptance Criteria

- [x] `tests/retry-loop.test.mjs` tạo đúng path.
- [x] 7 test case cover đủ: happy / retry-success / retry-exhausted / bail-out-not-installed / bail-out-timeout / feedback-injection / trace-logging.
- [x] RED confirmed: file fail import vì `scripts/retry-loop.mjs` chưa exist.
- [x] Mock `invoke` qua dependency injection (`makeBridge()` helper).

**Status:** ✅ Done (2026-06-01) — ready for phase-05 review gate.

## Out of Scope

- Reviewer agent impl — phase-07 (test phase này mock reviewer là plain function).
- Real trace file write — test verify callback `onTrace`, không write file thật.

## Files Touched

| Path                              | Action |
| --------------------------------- | ------ |
| `tests/retry-loop.test.mjs`       | create |
