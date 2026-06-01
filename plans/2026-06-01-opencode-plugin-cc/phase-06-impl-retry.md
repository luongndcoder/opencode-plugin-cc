# Phase 06 — Impl retry loop

**Goal:** Implement `scripts/retry-loop.mjs` để pass tất cả test phase-04.

**TDD role:** impl (green).

**blockedBy:** phase-05.

---

## Tasks

### 1. Create `scripts/retry-loop.mjs`

```javascript
import { randomUUID } from 'node:crypto'
import {
  invoke as defaultInvoke,
  OpencodeNotInstalledError,
  OpencodeTimeoutError,
} from './opencode-bridge.mjs'

export class RetryExhaustedError extends Error {
  constructor(message, history) {
    super(message)
    this.name = 'RetryExhaustedError'
    this.history = history
  }
}

const MAX_RETRY = 2 // 2 retry → 3 attempt total

const FATAL_ERRORS = [OpencodeNotInstalledError, OpencodeTimeoutError]

function isFatal(err) {
  return FATAL_ERRORS.some((cls) => err instanceof cls)
}

function buildFeedbackPrompt(originalPrompt, history) {
  const last = history[history.length - 1]
  let feedback = `previous attempt failed: ${last.error}`
  if (last.reviewer_comment) {
    feedback += `\nreviewer feedback: ${last.reviewer_comment}`
  }
  if (last.diff) {
    feedback += `\nprevious diff:\n${last.diff}`
  }
  return `${originalPrompt}\n\n--- retry context ---\n${feedback}`
}

export async function run({
  prompt,
  cwd,
  model,
  mode,
  invoke = defaultInvoke,
  reviewer = null,
  onTrace = () => {},
  maxRetry = MAX_RETRY,
}) {
  const traceId = randomUUID()
  const history = []
  let currentPrompt = prompt

  for (let attempt = 1; attempt <= maxRetry + 1; attempt++) {
    const t0 = Date.now()
    try {
      const result = await invoke({ prompt: currentPrompt, cwd, model, mode })

      // Reviewer gate
      let reviewerVerdict = null
      if (reviewer && result.result?.diff) {
        reviewerVerdict = await reviewer(result.result.diff)
        if (!reviewerVerdict.pass) {
          throw Object.assign(new Error(`reviewer rejected: ${reviewerVerdict.comment}`), {
            name: 'ReviewerRejectError',
            reviewerComment: reviewerVerdict.comment,
            diff: result.result.diff,
          })
        }
      }

      onTrace({
        traceId,
        attempt,
        status: 'completed',
        duration_ms: Date.now() - t0,
        session_id: result.session_id,
      })
      return result
    } catch (err) {
      const entry = {
        traceId,
        attempt,
        status: 'failed',
        duration_ms: Date.now() - t0,
        error: err.message,
        reviewer_comment: err.reviewerComment || null,
        diff: err.diff || null,
      }
      onTrace(entry)
      history.push(entry)

      if (isFatal(err)) throw err
      if (attempt > maxRetry) {
        throw new RetryExhaustedError(`exhausted after ${attempt} attempts`, history)
      }

      // Inject feedback for next attempt
      currentPrompt = buildFeedbackPrompt(prompt, history)
    }
  }
}
```

### 2. Notes về thiết kế

- **`traceId` propagation** — generate 1 lần đầu vào, dùng cho mọi attempt. Match rule `93-be-logging` § "single trace_id per user request".
- **`maxRetry` configurable** — default 2 (3 attempt) match plan. Test có thể pass `maxRetry: 0` cho no-retry case.
- **`reviewer` optional** — phase-04 test có case không dùng reviewer (chỉ subprocess). Phase-07 wire reviewer thật.
- **`onTrace` callback pattern** — test inject array push, production wire file append `plans/{date}-{slug}/trace.jsonl`.
- **Feedback prompt format** — string concat đơn giản. KHÔNG dùng template engine. Đủ cho MVP.
- **`ReviewerRejectError`** — không phải class formal, dùng `Object.assign` patch error tiện hơn. Retry treat như non-fatal error.

### 3. Run tests

```bash
node --test tests/retry-loop.test.mjs tests/opencode-bridge.test.mjs tests/stream-reader.test.mjs tests/schema-validator.test.mjs
```

Expect: **19 pass, 0 fail** (12 bridge + 7 retry).

### 4. Coverage

```bash
node --test --experimental-test-coverage tests/
```

Target ≥ 60% line coverage trên tất cả `scripts/`.

---

## Acceptance Criteria

- [x] `scripts/retry-loop.mjs` tạo đúng path.
- [x] Tất cả **22 test** pass (15 bridge slice + 7 retry).
- [~] Coverage không đo (skip optional).
- [x] `traceId` cùng giá trị cross attempt — test #7 pass.
- [x] Feedback prompt format consistent — test #2 + #6 pass.

**Status:** ✅ Done (2026-06-01) — 22/22 tests green, ready for phase-07 config surface.

## Out of Scope

- Real trace file write — phase-07 wire `onTrace` → file append.
- Real reviewer agent — phase-07.

## Files Touched

| Path                            | Action |
| ------------------------------- | ------ |
| `scripts/retry-loop.mjs`        | create |
