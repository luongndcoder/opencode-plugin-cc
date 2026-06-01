# Phase 03 — Impl bridge + stream + schema

**Goal:** Implement 3 module để tất cả test phase-01 chuyển từ red → green.

**TDD role:** impl (green phase).

**blockedBy:** phase-02 (user approved).

---

## Tasks

### 1. `scripts/schema-validator.mjs`

```javascript
import Ajv from 'ajv'
import { readFileSync } from 'node:fs'

const schemaPath = new URL('../schemas/opencode-output.json', import.meta.url)
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
const ajv = new Ajv({ allErrors: true, strict: false })
const compiled = ajv.compile(schema)

export function validate(obj) {
  const valid = compiled(obj)
  return { valid, errors: valid ? null : compiled.errors }
}
```

### 2. `scripts/stream-reader.mjs`

```javascript
import { createInterface } from 'node:readline'

export async function readChunked(stream, onLine) {
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    onLine(line)
  }
}

export async function readAll(stream) {
  const lines = []
  await readChunked(stream, (l) => lines.push(l))
  return lines.join('\n')
}
```

`readline.createInterface` xử lý partial line cross-chunk natively → tránh deadlock với output lớn. Đây là mitigation cho codex-plugin-cc issue #277/#279.

### 3. `scripts/opencode-bridge.mjs`

```javascript
import { spawn as defaultSpawn } from 'node:child_process'
import { readAll } from './stream-reader.mjs'
import { validate } from './schema-validator.mjs'

export class OpencodeOutputError extends Error {}
export class OpencodeProcessError extends Error {}
export class OpencodeTimeoutError extends Error {}
export class OpencodeNotInstalledError extends Error {}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000 // 5 phút

export async function invoke({
  prompt,
  cwd,
  model = 'free',
  mode = 'build',
  command,
  spawn = defaultSpawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  // Bug #2923 guard
  if (command) {
    throw new Error('must not combine --format json and --command flags (opencode bug #2923)')
  }

  const args = ['run', prompt, '--path', cwd, '--format', 'json', '--model', model, '--mode', mode]

  let child
  try {
    child = spawn('opencode', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new OpencodeNotInstalledError(
        'opencode CLI not found in PATH. Install: https://github.com/anomalyco/opencode'
      )
    }
    throw e
  }

  const timeout = new Promise((_, reject) =>
    setTimeout(() => {
      child.kill('SIGTERM')
      reject(new OpencodeTimeoutError(`opencode timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  )

  const run = new Promise(async (resolve, reject) => {
    const stdoutP = readAll(child.stdout)
    const stderrP = readAll(child.stderr)
    child.on('close', async (exitCode) => {
      const stdout = await stdoutP
      const stderr = await stderrP
      if (exitCode !== 0) {
        return reject(new OpencodeProcessError(`opencode exit ${exitCode}: ${stderr}`))
      }
      try {
        const obj = JSON.parse(stdout)
        const v = validate(obj)
        if (!v.valid) {
          return reject(
            new OpencodeOutputError(`schema mismatch: ${JSON.stringify(v.errors)}`)
          )
        }
        resolve(obj)
      } catch (e) {
        if (e instanceof OpencodeOutputError) return reject(e)
        reject(new OpencodeOutputError(`stdout not valid JSON: ${e.message}`))
      }
    })
  })

  return Promise.race([run, timeout])
}
```

### 4. Verify OpenCode actual output schema

Trước khi finalize `schemas/opencode-output.json`, chạy 1 lần thực tế trong dev machine:

```bash
opencode run "say hello" --path . --format json --model free 2>/dev/null | head -c 4000
```

Capture output → so sánh với schema. Nếu sai → update `schemas/opencode-output.json` + update fixture `opencode-output-success.json`. Commit cả 2 update vào phase này.

Note: nếu user chưa có `opencode` CLI cài → ship-stage `be-ship` ASK user cài trước, hoặc accept schema-guess + flag risk-review trong pilot phase-08.

### 5. Run tests

```bash
node --test tests/opencode-bridge.test.mjs tests/stream-reader.test.mjs tests/schema-validator.test.mjs
```

Expect: **12 pass, 0 fail**.

### 6. Coverage check (optional)

```bash
node --test --experimental-test-coverage tests/
```

Target ≥ 60% line coverage trên `scripts/` (chưa tính retry-loop — phase-06).

---

## Acceptance Criteria

- [x] 3 script file tạo đúng path.
- [~] `schemas/opencode-output.json` — **chưa verify với output thực tế** (chưa chạy `opencode run` live). Flag risk-review trong pilot phase-08.
- [x] `node --test tests/*.test.mjs` → **15 pass, 0 fail** (15 thay vì 12 vì add 3 test extra ở phase-01).
- [~] Coverage không đo (skip optional — pilot phase-08 đo thực).
- [x] No unhandled promise rejection.
- [x] `OpencodeNotInstalledError` message include `https://github.com/anomalyco/opencode`.

**Adjustments:**
- Stream-reader phải dùng event-listener pattern thay vì `for await` (Node 24 + `Readable.from()` race condition gây `ERR_USE_AFTER_CLOSE`).
- Bridge `agent` arg default `'build'`, model default `'free'`.
- Bridge validates `prompt` + `cwd` required.

**Status:** ✅ Done (2026-06-01) — bridge core working, 15/15 tests green.

## Files Touched

| Path                                | Action |
| ----------------------------------- | ------ |
| `scripts/opencode-bridge.mjs`       | create |
| `scripts/stream-reader.mjs`         | create |
| `scripts/schema-validator.mjs`      | create |
| `schemas/opencode-output.json`      | update (if schema mismatch verified) |
| `tests/fixtures/opencode-output-success.json` | update (if schema mismatch verified) |

## Out of Scope

- Retry loop — phase-06.
- Slash command wiring — phase-07.
- Hook preflight — phase-07.
