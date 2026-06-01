# Phase 02 — User review tests: bridge core

**Goal:** User review test cases trước khi viết impl. Hard gate — block impl phase cho đến khi user approve.

**TDD role:** review gate.

**blockedBy:** phase-01.

---

## Review Checklist

User đọc 3 file test + 3 fixture, verify:

- [ ] **Coverage** — 12 test case cover đủ happy/error/edge?
  - Happy path: success JSON parse ✓
  - Error paths: malformed stdout, exit != 0, ENOENT, timeout ✓
  - Edge: large stdout 1MB, partial line, 10MB stress, schema additional properties ✓
  - Bug guard: combo `--format json` + `--command` reject (issue #2923) ✓

- [ ] **Mock isolation** — Không gọi `child_process.spawn` thật, không write file thật. Đúng pattern dependency injection (test pass `spawn` factory).

- [ ] **Naming descriptive** — Mỗi test name kể được scenario (`invoke: malformed stdout throws OpencodeOutputError` rõ hơn `test invoke 2`).

- [ ] **Fixture chuẩn** — `opencode-output-success.json` match schema thực tế của OpenCode (cần verify bằng `opencode run "hello" --format json` 1 lần trước impl).

- [ ] **Assertion strict** — `assert.equal` cho equality, `assert.rejects` cho async throw, `assert.match` cho regex. Không có `assert.ok` mơ hồ.

- [ ] **Timer mock đúng** — Test timeout case dùng `mock.timers` không real wait.

- [ ] **Schema test enough** — Match / missing required / additional properties đủ chưa? Có cần thêm: enum mismatch, type mismatch? (P1 — có thể add sau).

- [ ] **Test data realistic** — `large-stdout.txt` 1MB là threshold thực tế cho OpenCode output không? Hoặc cần 10MB?

- [ ] **Missing scenario nào không?** — Đặc biệt: SIGTERM mid-run, network error, model unavailable.

---

## Recommendation Block

Nếu user reject một criterion → revise phase-01 test file → re-review.

Nếu user approve → unlock phase-03 impl.

User commands:

- `Approve` → mark phase-02 complete, proceed phase-03.
- `Add test: <scenario>` → append test case to phase-01, re-run phase-02.
- `Remove test: <name>` → drop test, re-run phase-02.

---

## Acceptance Criteria

- [ ] User explicit reply `Approve` (qua `AskUserQuestion` hoặc text).
- [ ] Nếu có change request, phase-01 file đã update + tests re-run red status confirmed.

## Files Touched

Không — chỉ review gate.
