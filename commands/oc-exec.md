---
description: Delegate a task to OpenCode (free-model executor) with retry loop + reviewer gate. Reads plan from previous /oc-plan output.
---

# /oc-exec — Execute via OpenCode

Args: `$ARGUMENTS` — task id (`t1`, `t2`) hoặc `all`.

## Flow

1. **Locate plan**: tìm output `/oc-plan` gần nhất trong conversation context. Nếu không có → ask user chạy `/oc-plan` trước.

2. **Iterate tasks**:
   - Nếu arg = task id (vd `t1`) → chỉ task đó.
   - Nếu arg = `all` → tất cả task theo thứ tự. **High-risk task → STOP, AskUserQuestion approve trước khi proceed**.

3. **Per task** — chạy CC-level retry loop (max 2 reviewer-retry):

   a. Build prompt cho OpenCode:
      ```
      Task: <goal>
      Files likely touched: <list>
      Acceptance: <criteria>
      Constraints:
      - Touch ONLY listed files (or those imported transitively).
      - Follow existing code conventions (read 2-3 nearby files first).
      - Output diff via standard tool calls.
      ```

   b. Invoke CLI (Bash tool):
      ```bash
      node ${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs \
        --prompt "<built prompt>" \
        --cwd "${CWD}" \
        --model "free" \
        --agent "build" \
        --trace-file "${CWD}/.opencode-plugin/trace.jsonl"
      ```

   c. Parse stdout JSON:
      - `success: true` → proceed step d
      - `success: false`:
        - `error_type: RetryExhaustedError` → report user, stop task (bridge retry already exhausted at low level)
        - `error_type: OpencodeNotInstalledError` → tell user install opencode, stop all
        - `error_type: OpencodeTimeoutError` → tell user task too slow, suggest split, stop task
        - Other → report + stop task

   d. **Reviewer gate** — spawn `opencode-reviewer` subagent via Task tool:
      ```
      Task tool input:
      - subagent_type: "opencode-reviewer"
      - prompt: "Review this diff... original_task=<goal>, diff=<result.diff>, files_changed=<list>, target_repo=<cwd>"
      ```

   e. Parse reviewer JSON verdict:
      - `pass: true` → record success, show diff to user, move to next task
      - `pass: false`:
        - `should_escalate_user: true` → STOP, AskUserQuestion show comment + ask manual review/abort
        - Else → CC-retry: re-build prompt with reviewer feedback embedded, go back to step b. Max 2 CC-retry per task.

   f. After 2 CC-retry without pass → STOP, report user with last reviewer comment + last diff.

4. **Summary** sau khi xong tất cả task:
   - Tasks completed: N
   - Files changed: list (union)
   - Token cost (CC + OpenCode): from trace.jsonl `tokens_used` + estimate CC reviewer tokens
   - Suggest: `/oc-verify` để chạy test/lint gate

## Constraints

- KHÔNG silently skip task fail. Mọi fail phải surface với user.
- Trace file path: `<cwd>/.opencode-plugin/trace.jsonl` — created if missing.
- KHÔNG dùng `--command` flag với CLI (bug #2923 — bridge đã guard, nhưng prompt cũng không nên ép).
- Sau mỗi task done → show diff (use Read on changed files) trước khi sang task kế.
