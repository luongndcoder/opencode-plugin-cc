# Phase 01 — Test plan: bridge core

**Goal:** Write unit tests cho 3 module bridge — `opencode-bridge`, `stream-reader`, `schema-validator`. All tests phải fail/red (chưa có impl).

**TDD role:** test (red phase).

**blockedBy:** phase-00.

---

## Tasks

1. **Create `schemas/opencode-output.json`** — JSON schema cho OpenCode output (dùng `tests/fixtures/opencode-output-success.json` làm reference):

   ```json
   {
     "$schema": "http://json-schema.org/draft-07/schema#",
     "type": "object",
     "required": ["session_id", "status", "result"],
     "properties": {
       "session_id": { "type": "string" },
       "status": { "enum": ["completed", "failed", "aborted"] },
       "result": {
         "type": "object",
         "properties": {
           "diff": { "type": "string" },
           "files_changed": { "type": "array", "items": { "type": "string" } },
           "model_used": { "type": "string" },
           "tokens_used": { "type": "integer" }
         }
       },
       "error": { "type": ["string", "null"] }
     },
     "additionalProperties": true
   }
   ```

   Note: schema dựa theo research; xác minh thực tế trong phase-03 bằng `opencode run "hello" --format json` capture output.

2. **Create fixtures**:

   - `tests/fixtures/opencode-output-success.json` — example output success match schema.
   - `tests/fixtures/opencode-output-malformed.json` — JSON nhưng missing required field `session_id`.
   - `tests/fixtures/large-stdout.txt` — 1MB synthetic stdout (loop 50K dòng `{"chunk": <n>}\n`).

3. **Create `tests/opencode-bridge.test.mjs`** — cover test case #1-6 từ plan.md Test Plan:

   ```javascript
   import { test, mock } from 'node:test'
   import assert from 'node:assert/strict'
   import { invoke } from '../scripts/opencode-bridge.mjs'
   import { Readable } from 'node:stream'

   // Helper: fake spawn factory
   function fakeSpawn({ stdout = '', stderr = '', exitCode = 0, signal = null } = {}) {
     return mock.fn(() => ({
       stdout: Readable.from([stdout]),
       stderr: Readable.from([stderr]),
       on: (event, cb) => {
         if (event === 'close') queueMicrotask(() => cb(exitCode, signal))
       },
       kill: mock.fn(),
     }))
   }

   test('invoke: happy path returns parsed JSON', async () => {
     const spawn = fakeSpawn({ stdout: '{"session_id":"s1","status":"completed","result":{}}' })
     const out = await invoke({ prompt: 'hello', cwd: '/tmp', spawn })
     assert.equal(out.session_id, 's1')
     assert.equal(out.status, 'completed')
   })

   test('invoke: malformed stdout throws OpencodeOutputError', async () => {
     const spawn = fakeSpawn({ stdout: 'not json' })
     await assert.rejects(
       invoke({ prompt: 'hello', cwd: '/tmp', spawn }),
       /OpencodeOutputError/
     )
   })

   test('invoke: exit != 0 throws OpencodeProcessError with stderr', async () => {
     const spawn = fakeSpawn({ exitCode: 1, stderr: 'boom' })
     await assert.rejects(
       invoke({ prompt: 'hello', cwd: '/tmp', spawn }),
       /OpencodeProcessError.*boom/s
     )
   })

   test('invoke: timeout kills child + throws OpencodeTimeoutError', async () => {
     // Use mock timers
     mock.timers.enable({ apis: ['setTimeout'] })
     const killSpy = mock.fn()
     const spawn = mock.fn(() => ({
       stdout: new Readable({ read() {} }), // never emits
       stderr: new Readable({ read() {} }),
       on: () => {},
       kill: killSpy,
     }))
     const p = invoke({ prompt: 'x', cwd: '/tmp', spawn, timeoutMs: 100 })
     mock.timers.tick(101)
     await assert.rejects(p, /OpencodeTimeoutError/)
     assert.equal(killSpy.mock.calls.length, 1)
     mock.timers.reset()
   })

   test('invoke: spawn ENOENT throws OpencodeNotInstalledError', async () => {
     const spawn = mock.fn(() => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e })
     await assert.rejects(
       invoke({ prompt: 'hello', cwd: '/tmp', spawn }),
       /OpencodeNotInstalledError/
     )
   })

   test('invoke: forbids --format json + --command combo (bug #2923)', async () => {
     const spawn = fakeSpawn()
     await assert.rejects(
       invoke({ prompt: 'x', cwd: '/tmp', spawn, command: 'foo' }),
       /must not combine --format json and --command/
     )
   })
   ```

4. **Create `tests/stream-reader.test.mjs`** — cover test case #7-9:

   ```javascript
   import { test } from 'node:test'
   import assert from 'node:assert/strict'
   import { readChunked } from '../scripts/stream-reader.mjs'
   import { Readable } from 'node:stream'
   import { readFileSync } from 'node:fs'

   test('readChunked: 1MB stdout parses 50K lines', async () => {
     const large = readFileSync(new URL('./fixtures/large-stdout.txt', import.meta.url), 'utf8')
     const lines = []
     await readChunked(Readable.from([large]), (line) => lines.push(line))
     assert.ok(lines.length >= 50_000)
   })

   test('readChunked: handles partial line across chunks', async () => {
     const lines = []
     await readChunked(Readable.from(['{"a":1}\n{"b":', '2}\n']), (l) => lines.push(l))
     assert.deepEqual(lines, ['{"a":1}', '{"b":2}'])
   })

   test('readChunked: no buffer overflow with 10MB synthetic', async () => {
     const chunks = Array.from({ length: 10 }, (_, i) => `{"i":${i}}\n`.repeat(100_000))
     const lines = []
     const t0 = Date.now()
     await readChunked(Readable.from(chunks), (l) => lines.push(l))
     assert.ok(Date.now() - t0 < 30_000, 'must complete in <30s')
   })
   ```

5. **Create `tests/schema-validator.test.mjs`** — cover test case #10-12:

   ```javascript
   import { test } from 'node:test'
   import assert from 'node:assert/strict'
   import { validate } from '../scripts/schema-validator.mjs'

   test('validate: matching object passes', () => {
     const result = validate({
       session_id: 's1',
       status: 'completed',
       result: { diff: '...' },
     })
     assert.equal(result.valid, true)
   })

   test('validate: missing required field fails', () => {
     const result = validate({ status: 'completed', result: {} })
     assert.equal(result.valid, false)
     assert.match(JSON.stringify(result.errors), /session_id/)
   })

   test('validate: additional properties allowed', () => {
     const result = validate({
       session_id: 's1',
       status: 'completed',
       result: {},
       extra_field: 'ok',
     })
     assert.equal(result.valid, true)
   })
   ```

6. **Run** `node --test tests/opencode-bridge.test.mjs tests/stream-reader.test.mjs tests/schema-validator.test.mjs` — expect **all fail** (no impl yet). Capture output for review phase.

---

## Acceptance Criteria

- [x] 3 test files tạo đúng path: `opencode-bridge.test.mjs`, `stream-reader.test.mjs`, `schema-validator.test.mjs`.
- [x] 3 fixture files: `opencode-output-success.json`, `opencode-output-malformed.json`, `large-stdout.txt` (2.09 MB > 1MB target).
- [x] `schemas/opencode-output.json` valid JSON schema.
- [x] `node --test tests/*.test.mjs` red: 3 file fail với `ERR_MODULE_NOT_FOUND` (scripts/ chưa exist) — đúng kỳ vọng RED phase.
- [x] Test names descriptive (mỗi test 1 scenario rõ, format `<fn>: <scenario>`).

**Adjustments từ plan:**
- Số test case = 15 (7 bridge + 4 stream + 4 schema) — over plan estimate 12, add `args construction verify`, `readAll`, `enum validation`.
- CLI flags real-world (từ `opencode run --help`):
  - `--path` → **`--dir`**
  - `--mode build` → **`--agent build`** (build/plan là agents, không phải modes)
  - prompt là **positional** (cuối args), không phải `--prompt` flag.

**Status:** ✅ Done (2026-06-01) — ready for phase-02 review gate.

## Files Touched

| Path                                          | Action |
| --------------------------------------------- | ------ |
| `tests/opencode-bridge.test.mjs`              | create |
| `tests/stream-reader.test.mjs`                | create |
| `tests/schema-validator.test.mjs`             | create |
| `tests/fixtures/opencode-output-success.json` | create |
| `tests/fixtures/opencode-output-malformed.json` | create |
| `tests/fixtures/large-stdout.txt`             | create (script-gen) |
| `schemas/opencode-output.json`                | create |
