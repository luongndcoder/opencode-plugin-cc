# Phase 05 — User review tests: retry

**Goal:** User review test cases retry trước impl.

**TDD role:** review gate.

**blockedBy:** phase-04.

---

## Review Checklist

- [ ] **Retry semantics đúng?**
  - Max 2 retry (3 attempt total) — đúng với plan, không phải vô hạn.
  - Bail-out với `OpencodeNotInstalledError` + `OpencodeTimeoutError` — vì retry không cứu được.
  - Retry chỉ với `OpencodeProcessError` + `OpencodeOutputError` (transient failure).

- [ ] **Feedback injection rõ?**
  - Test #2 verify prompt attempt 2 chứa lỗi attempt 1.
  - Test #6 verify reviewer comment fed back vào prompt attempt 2.

- [ ] **Trace propagation đúng?**
  - Test #7 verify cùng `traceId` cross attempt — đúng với rule `93-be-logging` (single trace_id per user request).
  - Field: `attempt`, `status`, `traceId`, `duration_ms`, `error` (nếu fail).

- [ ] **Missing scenario nào?**
  - Mid-retry user cancel — defer.
  - Different reviewer verdict (pass với comment vs fail) — covered test #6?
  - Reviewer throw error — chưa cover, có cần add?

- [ ] **Mock realistic?**
  - `reviewer` mock function nhận `diff`, return `{pass, comment}` — sát impl phase-07 chưa?
  - `onTrace` callback approach — clean (test isolation) hay nên test real file write?

- [ ] **History format đủ debug?**
  - `RetryExhaustedError.history` array — mỗi item nên có gì? Currently test check length=3. Có cần check schema từng entry?

---

## Recommendation Block

Approve → unlock phase-06.
Reject với change → revise phase-04 → re-review.

User commands:

- `Approve` → mark complete, proceed phase-06.
- `Add test: <scenario>` → append to phase-04.
- `Tighten test: <name>` → strengthen assertion.

---

## Acceptance Criteria

- [ ] User explicit reply `Approve`.

## Files Touched

Không — review gate.
