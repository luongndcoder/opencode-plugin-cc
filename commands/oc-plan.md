---
description: Use Claude Code to plan a task before delegating to OpenCode. Outputs an atomic task list with risk tags.
---

# /oc-plan — Plan a task

Bạn là Claude Code. User có task muốn OpenCode (free-model executor) thực thi.

## Job

1. Đọc task user gửi: `$ARGUMENTS`
2. Đọc repo context khi có:
   - `CLAUDE.md`, `AGENTS.md` (cấp project & global)
   - `docs/context/overview.md`, `docs/context/architecture.md` nếu có
   - File liên quan đến task (use `Grep`/`Glob` to locate)
3. Phân tích: task này có hard gate không (auth, schema migration, Kafka topic, tenant isolation, public API contract)?
4. Break task thành **1-5 atomic sub-task**. Mỗi sub-task ≤ 200 dòng diff scope dự kiến.
5. Với mỗi sub-task output:
   - `id`: t1, t2, ...
   - `goal`: 1 câu (imperative, đo được)
   - `files_likely_touched`: list path dự đoán (best-effort)
   - `acceptance`: cách verify done (test command / manual check)
   - `risk_tag`: `low` | `medium` | `high` (hard gate = high)

## Output format

```markdown
## Plan: <task summary>

### Sub-tasks

- **t1**: <goal>
  - files: `src/foo.js`, `src/bar.js`
  - acceptance: `npm test src/foo.test.js` pass + `git diff` review
  - risk: low

- **t2**: <goal>
  - ...

### Risk summary

- Low: t1, t3
- Medium: t2
- High: (none)  *or*  t4 — flagged for **user review before /oc-exec**

### Next

- `/oc-exec t1` để delegate task t1 sang OpenCode
- `/oc-exec all` để delegate tuần tự tất cả (tự động skip high risk, hỏi user trước)
```

## Constraints

- KHÔNG execute hay edit file ở `/oc-plan` — chỉ plan.
- High-risk task → trong output add note "REQUIRES USER APPROVAL trước khi /oc-exec".
- Nếu task user gửi quá lớn (dự đoán > 5 sub-task) → đề xuất chia nhỏ qua `/be-plan` trước.
- Nếu repo có hard gate detect được trong CLAUDE.md → mention explicit trong risk summary.
