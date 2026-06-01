# Plan — `opencode-plugin-cc` MVP

**Date:** 2026-06-01
**Slug:** `opencode-plugin-cc`
**Brainstorm:** [brainstorm.md](brainstorm.md)
**Research:** [research/codex-opencode-arch.md](research/codex-opencode-arch.md), [research/anomalyco-opencode-variant.md](research/anomalyco-opencode-variant.md)
**Lane:** `normal` (intake.md missing — fallback per `harness-mindset` rule)
**Mode:** `--auto` → normal (no cross-service, no schema migration)

---

## Chosen Approach

**Option A — Subprocess + JSON Wrapper** (clone `codex-plugin-cc` pattern, target `anomalyco/opencode` ≥ v1.2).

- Plugin invoke `opencode run "<prompt>" --path <cwd> --format json` qua Node.js subprocess (bridge script).
- Output JSON validate qua Ajv với schema pin.
- Verify: Hybrid — reviewer agent (CC) đọc diff + test gate + retry max 2 lần.
- Mục đích: CC plan (đắt) → OpenCode execute với free model (rẻ) → CC verify (đắt nhưng cần).

## Scope

### In scope (MVP)

- Plugin Claude Code chuẩn (`.claude-plugin/plugin.json` + commands + agents + hooks + scripts).
- 3 slash command primary: `/oc-plan`, `/oc-exec`, `/oc-verify`.
- 2 slash command placeholder cho v2: `/oc-status`, `/oc-result` (background job — chưa wire).
- Bridge script + chunked stream reader + JSON schema validator + retry loop.
- Reviewer agent (CC subagent) đọc diff OpenCode trả về.
- Hook `SessionStart` preflight check `opencode --version` ≥ v1.2.
- README + basic docs.
- Pilot 5 task để validate cost saving claim.

### Out of scope (defer v2)

- **Non-code task** (write doc, generate diagram, design proposal) — assumption: code execution only. Reviewer prompt tối ưu cho code diff. User override → mở rộng v2.
- **Concurrent execution** — task sequential. Daemon mode (Option B từ brainstorm) defer.
- **MCP bridge** (Option C) — defer cho khi OpenCode MCP server stable.
- **Dry-run mode** (preview diff không apply) — defer; user dùng git stash workaround tạm.
- **Auto-fallback CC khi OpenCode fail toàn bộ** — assumption: **bail-out** (escalate user), KHÔNG silent fallback. User override → wire CC fallback ở v2.
- **Risk-tagging adaptive verify** (option D từ brainstorm) — defer.
- **Background job queue** — placeholder commands chỉ in `not implemented` message.

## Assumptions (chốt 3 unresolved từ brainstorm)

| #   | Question                                          | Assumption                                                                                       | Override path                                              |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | Plugin có execute non-code task không?            | **Code only** cho MVP. Reviewer prompt focus diff/test.                                          | User nói "có" → v2 mở rộng reviewer template               |
| 2   | OpenCode fail toàn bộ — CC fallback hay bail-out? | **Bail-out + escalate user**. Trace log lý do fail.                                              | User muốn fallback → wire `oc-exec` `--fallback-cc` flag   |
| 3   | Dry-run mode (preview diff không apply)?          | **Defer**. User dùng `git stash` workaround. OpenCode đã có `--mode plan` natively.              | User cần → wire `oc-exec --dry-run` v2                     |

## Lane Detection

`intake.md` không có → warning emit: `intake.md missing — falling back to lane=normal`. Plan vẫn proceed.

**Hard gates check (manual):**

- merchant_id / tenant isolation? — N/A (plugin không touch Mobio data).
- Auth/authz change? — N/A.
- Schema migration? — N/A.
- Kafka topic? — N/A.
- External SDK? — Có (OpenCode CLI). Mitigation: pin version + preflight check.
- ArgoCD/deploy? — N/A.
- Audit/PII? — Source code có thể chứa PII → cảnh báo README + opt-in per project.
- Public API contract? — Plugin slash command IS public surface → DevEx review recommended (xem cuối).

Kết luận: lane=normal phù hợp.

---

## Test Plan

### Test Strategy

- **Test type:** Unit (primary) — mock `child_process.spawn`, `fs`, `stream` boundary.
- **Coverage target:** 60% (realistic cho MVP; pilot phase đo coverage thực).
- **Test runner:** Node native `node:test` (zero dep, builtin từ Node 20+).
- **Assertion lib:** Node native `node:assert/strict`.
- **Mock strategy:** Node native `mock.method()` + dependency injection (constructor accepts spawn function).

### Test Cases (outline)

| #   | Function/File                       | Scenario                                              | Expected                                                 | Priority |
| --- | ----------------------------------- | ----------------------------------------------------- | -------------------------------------------------------- | -------- |
| 1   | `opencode-bridge.invoke()`          | Happy path — valid JSON stdout, exit 0                | Return parsed object, no error                           | P0       |
| 2   | `opencode-bridge.invoke()`          | Stdout không phải JSON                                 | Throw `OpencodeOutputError` với message rõ              | P0       |
| 3   | `opencode-bridge.invoke()`          | Exit code != 0                                        | Throw `OpencodeProcessError` kèm stderr                  | P0       |
| 4   | `opencode-bridge.invoke()`          | Subprocess timeout (>5 phút)                          | Kill child, throw `OpencodeTimeoutError`                 | P0       |
| 5   | `opencode-bridge.invoke()`          | spawn() throw ENOENT (binary missing)                 | Throw `OpencodeNotInstalledError` với link install       | P0       |
| 6   | `opencode-bridge.invoke()`          | Pass cwd / model / mode args đúng vị trí               | spawn called với args expected (no `--command` combo!)   | P0       |
| 7   | `stream-reader.readChunked()`       | Stdout 1MB (50 line JSON)                             | All lines parsed, no buffer overflow                     | P0       |
| 8   | `stream-reader.readChunked()`       | Stdout 10MB                                           | No deadlock, complete trong <30s                         | P0       |
| 9   | `stream-reader.readChunked()`       | Stdout partial line (truncated)                        | Wait next chunk, không emit partial                       | P1       |
| 10  | `schema-validator.validate()`       | Output match schema                                   | Return `{valid: true}`                                   | P0       |
| 11  | `schema-validator.validate()`       | Missing required field                                | Return `{valid: false, errors: [...]}`                   | P0       |
| 12  | `schema-validator.validate()`       | Extra field không trong schema                         | Pass (additionalProperties: true)                        | P1       |
| 13  | `retry-loop.run()`                  | First call success                                    | Return result, no retry                                  | P0       |
| 14  | `retry-loop.run()`                  | Fail then success retry 1                             | Return result, retry count=1, feedback injected          | P0       |
| 15  | `retry-loop.run()`                  | Fail 3 lần (max retry 2)                              | Throw `RetryExhaustedError` kèm history                  | P0       |
| 16  | `retry-loop.run()`                  | Bridge throw `OpencodeNotInstalledError`              | Bail-out ngay, KHÔNG retry                               | P0       |
| 17  | `retry-loop.run()`                  | Feedback injection — kèm reviewer comment + test log  | Subprocess prompt chứa previous diff + feedback         | P0       |
| 18  | `retry-loop.run()`                  | Trace log mỗi attempt                                  | trace.jsonl append với attempt#, duration, exit code     | P1       |

### Mock Dependencies

| Dependency                      | Mock strategy                                              |
| ------------------------------- | ---------------------------------------------------------- |
| `node:child_process.spawn`      | Constructor inject — pass fake spawn function trong test    |
| File system (trace.jsonl write) | `node:fs.promises` mock via `mock.method()`                 |
| Timer (timeout)                 | `node:test` fake timer (`mock.timers.enable()`)             |
| Subprocess stdout stream        | Use `node:stream.Readable.from([chunks])`                   |

### Test Data

- `tests/fixtures/opencode-output-success.json` — JSON output mẫu.
- `tests/fixtures/opencode-output-malformed.json` — broken JSON.
- `tests/fixtures/large-stdout.txt` — 10MB synthetic stdout.

### Prerequisites

- Node.js ≥ 20 (cho `node:test` builtin).
- Dev dep duy nhất: `ajv@^8` cho JSON schema validate. KHÔNG thêm jest/vitest/mocha.

---

## Evaluation Rubric

```
rubric: general-code
rubric_version: 1
notes: |
  Plugin scripts là Node.js standalone, không phải Mobio backend service.
  Tenant isolation / Kafka / Mongo criteria không applicable — skip.
  Focus criteria: error handling, mock isolation, no-leak (subprocess), schema strictness, observability (trace.jsonl).
```

---

## File Mapping

```
opencode-plugin-cc/                            # repo root
├── .claude-plugin/
│   └── plugin.json                            # plugin manifest
├── .gitignore                                 # node_modules, plans/local/
├── README.md                                  # install + usage + Mobio guide
├── package.json                               # name, version, deps: ajv
├── package-lock.json                          # locked
├── agents/
│   └── opencode-reviewer.md                   # CC reviewer subagent prompt
├── commands/
│   ├── oc-plan.md                             # CC plan task list
│   ├── oc-exec.md                             # forward → opencode-bridge.mjs
│   ├── oc-verify.md                           # spawn reviewer + run tests
│   ├── oc-status.md                           # v2 placeholder
│   └── oc-result.md                           # v2 placeholder
├── hooks/
│   ├── hooks.json                             # SessionStart preflight
│   └── ensure-opencode.mjs                    # check opencode binary + version
├── scripts/
│   ├── opencode-bridge.mjs                    # main subprocess invoker
│   ├── stream-reader.mjs                      # chunked stdout reader
│   ├── retry-loop.mjs                         # retry max 2 + feedback
│   └── schema-validator.mjs                   # Ajv wrapper
├── schemas/
│   └── opencode-output.json                   # JSON schema cho output
└── tests/
    ├── opencode-bridge.test.mjs
    ├── stream-reader.test.mjs
    ├── retry-loop.test.mjs
    ├── schema-validator.test.mjs
    └── fixtures/
        ├── opencode-output-success.json
        ├── opencode-output-malformed.json
        └── large-stdout.txt
```

**Total:** ~22 file (gồm test + fixture).

---

## Phase List

| Phase   | Title                                  | TDD role         | blockedBy | Est.  |
| ------- | -------------------------------------- | ---------------- | --------- | ----- |
| phase-00 | Scaffold plugin structure              | n/a (config)     | —         | 30m   |
| phase-01 | Test plan — bridge core                | test             | phase-00  | 1.5h  |
| phase-02 | User review tests — bridge core        | review gate      | phase-01  | 15m   |
| phase-03 | Impl bridge + stream + schema          | impl             | phase-02  | 2h    |
| phase-04 | Test plan — retry loop                 | test             | phase-03  | 1h    |
| phase-05 | User review tests — retry              | review gate      | phase-04  | 15m   |
| phase-06 | Impl retry loop                        | impl             | phase-05  | 1h    |
| phase-07 | Impl config surface (commands/agent/hooks) | n/a (markdown+JSON) | phase-06  | 1.5h  |
| phase-08 | Pilot 5 task + validation              | validation       | phase-07  | 2h    |

**Total est:** ~10 giờ thực dev.

---

## Risks & Mitigations

| Risk                                                       | Severity | Mitigation                                                                                       |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| OpenCode JSON schema bump phá plugin                       | High     | Pin version `engines.opencode` trong plugin.json + Ajv strict validate + README ghi version test |
| Subprocess stdout deadlock (output >1MB)                   | High     | `stream-reader.mjs` dùng `readline.createInterface` chunk, không buffer full output              |
| Bug #2923 `--format json` + `--command` drop output        | Medium   | Bridge code raise error nếu cả 2 flag truyền cùng. Linted in unit test #6                        |
| Free model OOM/timeout/refuse → loop infinite              | High     | Hard cap max retry = 2. Timeout 5 phút/attempt. Bail-out với `RetryExhaustedError`               |
| Source code leak qua OpenCode → privacy concern            | Medium   | README explicit warning + recommend opt-in per project. Hook log prompt content audit            |
| Reviewer agent CC token cost > 40% saving                  | Medium   | Pilot đo cost; nếu cost saving < 30% → simplify reviewer prompt hoặc switch test-only gate       |
| OpenCode binary not in PATH                                | Low      | `hooks/ensure-opencode.mjs` SessionStart fail rõ với link install                                |
| Node.js < 20 user → `node:test` không có                   | Low      | `engines.node` >= 20 trong package.json + README require                                         |

---

## Validation Criteria

Plan ship coi như thành công khi:

1. **Functional MVP** — Smoke test 1 task end-to-end: `/oc-plan "write hello fn"` → `/oc-exec` → diff hiện ra → `/oc-verify` pass (reviewer approve + test green).
2. **Test coverage** — `node --test tests/` 100% green; coverage ≥ 60% trên scripts/.
3. **Cost saving validation (phase-08)** — Pilot 5 task; token cost OpenCode-delegated ≤ 50% baseline (CC all-in-one). Reviewer catch wrong-output ≥ 80%.
4. **Reliability** — Pilot 20 task; OpenCode raw fail < 30%; retry recover > 70% fail case.
5. **Setup smoke** — Fresh machine, install plugin + opencode CLI + run 1 task < 10 phút.
6. **Observability** — `trace.jsonl` mỗi run đầy đủ field `traceId, command, model, duration_ms, exit_code, retry_count, error`.

---

## Mobio Repo Compatibility Note

Plugin chạy được trên mọi repo Claude Code support, nhưng khi user dùng trên **Mobio backend repo**:

- Reviewer agent prompt MUST include Mobio rules detection block (read `CLAUDE.md` / `AGENTS.md` of target repo, propagate rules `99-tenant-isolation` + `95-behavioral-constraints` + `93-be-logging` vào reviewer criteria).
- Trace log compatible với Mobio convention: `traceId` (camelCase), `Mobio-Trace-ID` header KHÔNG bắt buộc cho plugin (plugin không HTTP).
- KHÔNG được tự ý delegate Mobio backend task touch hard gate (merchant_id, schema migration, Kafka topic) → reviewer prompt phải reject + force CC handle direct. Wire trong `agents/opencode-reviewer.md` phase-07.

---

## DevEx Review Suggestion

Plugin slash command IS public surface (user-facing). Plan suggests `/be-plan --review=devex plans/2026-06-01-opencode-plugin-cc/plan.md` sau khi MVP ship + pilot xong — đánh giá Time-To-Hello-World, persona fit, friction log.

KHÔNG block ship MVP; pre-ship optional.

---

## Cross-references

- **Brainstorm:** `brainstorm.md` — Option A decision + Addendum target `anomalyco/opencode`.
- **Research:** `research/codex-opencode-arch.md` + `research/anomalyco-opencode-variant.md`.
- **Ship:** `/be-ship plans/2026-06-01-opencode-plugin-cc/` sau approve.
- **Codex pattern reference:** `https://github.com/openai/codex-plugin-cc` — adopt structure `scripts/<companion>.mjs` + `commands/*.md` + `agents/*.md` + `hooks/hooks.json`.
- **OpenCode target binary:** `https://github.com/anomalyco/opencode` ≥ v1.2.
- **Known bug to avoid:** opencode issue `#2923` (`--format json` + `--command` combo).
