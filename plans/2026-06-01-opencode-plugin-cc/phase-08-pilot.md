# Phase 08 — Pilot 5 task + validation

**Goal:** Validate plugin chạy end-to-end + đo cost saving claim + reliability + setup smoke test.

**TDD role:** validation (acceptance test).

**blockedBy:** phase-07.

---

## Tasks

### 1. Setup test repo

Chọn 1 sandbox repo nhỏ (greenfield Node project hoặc small Python lib) — KHÔNG dùng repo Mobio production cho pilot lần đầu.

Verify:
- Claude Code installed
- `opencode` CLI ≥ 1.2 installed (`opencode --version`)
- Plugin `opencode-plugin-cc` registered

### 2. Pilot 5 task

Pick 5 task representative, complexity tăng dần:

| Task | Description                                                        | Expected scope |
| ---- | ------------------------------------------------------------------ | -------------- |
| T1   | Write 1 unit test cho hàm `add(a, b)` đã có sẵn                    | 1 file, ~20 LOC |
| T2   | Refactor: rename biến `foo` thành `userId` toàn module             | 2-3 file       |
| T3   | Fix lint warning (unused import, missing semicolon, etc.) toàn repo | 5-10 file      |
| T4   | Write 1 section README mô tả install steps                         | 1 file, ~50 LOC |
| T5   | Add CRUD endpoint stub (GET/POST `/items`) — không persist data    | 2-3 file       |

Workflow mỗi task:
1. Reset repo (`git stash` hoặc fresh branch)
2. Run `/oc-plan "<task description>"` → capture token cost CC
3. Run `/oc-exec all` → capture token cost OpenCode + reviewer CC
4. Run `/oc-verify` → record test/lint result
5. Log to `plans/2026-06-01-opencode-plugin-cc/pilot-results.md`:

```markdown
## T<N>: <description>

- CC plan tokens: X
- OpenCode raw tokens: Y (model: <model>)
- Reviewer CC tokens: Z
- Total: X+Y+Z
- Baseline (all-CC est): B (manually run cùng task all-CC để compare)
- Saving: (B - (X+Y+Z)) / B * 100%
- Reliability: success after 0/1/2 retry
- Time: wall-clock minutes
- Output quality (subjective 1-5): score
- Reviewer caught: <list issue> or "n/a"
- Notes: ...
```

### 3. Baseline comparison

Re-run mỗi task ALL trên Claude Code (không qua OpenCode) — đo token cost CC làm 100% task. Đây là baseline cho saving calculation.

### 4. Acceptance summary

Compute aggregate:

```markdown
## Pilot Summary (5 task)

| Metric                         | Target  | Actual | Pass/Fail |
| ------------------------------ | ------- | ------ | --------- |
| Average cost saving            | ≥ 50%   | ?      | ?         |
| Worst-case saving (any task)   | ≥ 20%   | ?      | ?         |
| Reliability (success ≤ 2 retry) | ≥ 70%   | ?      | ?         |
| Reviewer catch wrong-output    | ≥ 80%   | ?      | ?         |
| Setup time (fresh machine)     | < 10min | ?      | ?         |
| Output quality (avg subjective) | ≥ 3/5  | ?      | ?         |
```

### 5. Decision matrix

Based on pilot:

| Outcome                                        | Decision                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| Saving ≥ 50% + reliability ≥ 70% + reviewer ok | **Ship MVP** — tag v0.1.0, document usage                                |
| Saving 20-50%                                  | **Ship MVP marked beta** — limit scope (vd: only tests, not features)    |
| Saving < 20% OR reliability < 50%              | **Hold + diagnose** — reviewer too expensive? Model too weak? Retry too aggressive? Revise plan phase-2 |
| Reviewer catch < 50%                           | **Strengthen reviewer prompt** — phase 2 priority                        |

### 6. Capture lessons learned

Write `plans/2026-06-01-opencode-plugin-cc/lessons.md`:
- What worked
- What failed
- Surprises (good / bad)
- Phase 2 backlog candidates (ranked)

---

## Acceptance Criteria

- [~] 5 pilot task — **scaffold ready** (template `pilot-results.md` tạo sẵn 5 task), **execution pending user runtime** (cần provider auth + sandbox repo + manual workflow).
- [~] Baseline CC-only measurement — pending pilot run.
- [~] Pilot Summary table — pending pilot run.
- [~] Decision — pending pilot run.
- [~] `lessons.md` template ready — pending pilot run fill.

**Status:** ⏸️ Awaiting user runtime — implementation MVP complete; pilot validation requires user action. See `pilot-results.md` skeleton + `lessons.md` template.

## Files Touched

| Path                                                  | Action |
| ----------------------------------------------------- | ------ |
| `plans/2026-06-01-opencode-plugin-cc/pilot-results.md` | create |
| `plans/2026-06-01-opencode-plugin-cc/lessons.md`       | create |

## Out of Scope

- Production rollout playbook — sau MVP ship + phase 2.
- Marketplace distribution — defer.
- Multi-repo benchmark — defer (1 sandbox đủ cho MVP validation).

## Post-Pilot Next Steps

1. Nếu ship MVP: git tag v0.1.0, push, update README badge.
2. Document phase 2 backlog từ `lessons.md` thành issues/plan files mới.
3. Suggest DevEx review: `/be-plan --review=devex plans/2026-06-01-opencode-plugin-cc/plan.md` — đánh giá Time-To-Hello-World, persona fit.
