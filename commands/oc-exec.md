---
description: Delegate a task to OpenCode (free-model executor) with retry loop + reviewer gate. Reads plan from previous /oc-plan output.
---

# /oc-exec — Execute via OpenCode

Args: `$ARGUMENTS` — task id (`t1`, `t2`) hoặc `all`.

## Flow

> **QUAN TRỌNG — namespace lệnh.** Mọi lệnh gợi ý cho user PHẢI ở dạng đầy đủ `/opencode-plugin-cc:oc-*` (vd `/opencode-plugin-cc:oc-exec t3`, `/opencode-plugin-cc:oc-verify`). Bare `/oc-*` KHÔNG phải slash command hợp lệ trong Claude Code — user gõ sẽ bị "Unknown command".

1. **Locate plan**: tìm output `/oc-plan` gần nhất trong conversation context. Nếu không có → ask user chạy `/opencode-plugin-cc:oc-plan` trước.

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
      `--model "free"` (or omitting `--model`) → plugin tự dò `opencode models` và chọn một free model khả dụng (`cost.input == 0 && cost.output == 0`). Truyền `--model "<provider>/<model>"` cụ thể để override. Model đã chọn ghi vào stderr + trace event `model_selected`.

   c. Parse stdout JSON `{ success, result }`:
      - `success: true` → `result` là object đã normalize: `result.session_id`, `result.status`, `result.result.diff` (tổng hợp từ tool_use write/edit/patch), `result.result.files_changed`, `result.result.message`, `result.result.model_used`, `result.result.tokens_used`. Proceed step d.
      - `success: false`:
        - `error_type: RetryExhaustedError` → report user, stop task (bridge retry already exhausted at low level)
        - `error_type: OpencodeNotInstalledError` → gợi ý user chạy `/opencode-plugin-cc:oc-install` để cài opencode, stop all
        - `error_type: OpencodeTimeoutError` → tell user task too slow, suggest split, stop task
        - Other → report + stop task

   d. **Reviewer gate** — spawn `opencode-reviewer` subagent via Task tool:
      ```
      Task tool input:
      - subagent_type: "opencode-reviewer"
      - prompt: "Review this diff... original_task=<goal>, diff=<result.result.diff>, files_changed=<result.result.files_changed>, target_repo=<cwd>"
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
   - **Next tasks**: chỉ liệt kê task CHƯA chạy (đã done thì bỏ), mỗi dòng dạng `/opencode-plugin-cc:oc-exec <id> — <goal>`. Nếu tất cả task đã done → nói rõ "tất cả task đã xong" và đừng gợi ý `... oc-exec all` (sẽ chạy lại từ đầu). Khuyến nghị chạy lần lượt từng id còn lại.
   - Suggest: `/opencode-plugin-cc:oc-verify` để chạy test/lint gate

## Constraints

- KHÔNG silently skip task fail. Mọi fail phải surface với user.
- Trace file path: `<cwd>/.opencode-plugin/trace.jsonl` — created if missing.
- KHÔNG dùng `--command` flag với CLI (bug #2923 — bridge đã guard, nhưng prompt cũng không nên ép).
- Sau mỗi task done → show diff (use Read on changed files) trước khi sang task kế.
