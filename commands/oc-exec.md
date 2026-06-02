---
description: Delegate a task to OpenCode (free-model executor) with retry loop + reviewer gate. Reads plan from previous /oc-plan output.
---

# /oc-exec — Execute via OpenCode

Args: `$ARGUMENTS` — task id (`t1`, `t2`) or `all`.

## Flow

> **IMPORTANT — command namespace.** Every command you suggest to the user MUST use the full form `/opencode-plugin-cc:oc-*` (e.g. `/opencode-plugin-cc:oc-exec t3`, `/opencode-plugin-cc:oc-verify`). The bare `/oc-*` is NOT a valid slash command in Claude Code — typing it returns "Unknown command".

0. **Choose model — free / paid Zen (first time per project only)**:
   - Get the saved model: Bash `node "${CLAUDE_PLUGIN_ROOT}/scripts/model-config.mjs" get "${CWD}"`.
     - Non-empty output → already chosen → use it, DO NOT ask again. (Change it: `/opencode-plugin-cc:oc-model`.)
     - Empty output → not chosen → run the full `/opencode-plugin-cc:oc-model` flow right here: `model-selector.mjs --list --all` (free + paid Zen, with cost) → show the list → `AskUserQuestion` for the user to choose (max 4 options + Other; paid must state cost) → `model-config.mjs set "${CWD}" "<chosen>"`.
     - If opencode isn't installed (exit 3) → suggest `/opencode-plugin-cc:oc-install`, STOP.
   - Call `<model>` = the saved/chosen value, used in step b.

0.5. **Bridge project-local skills (once per project, idempotent)**:
   - OpenCode (≥1.15) auto-discovers global skills `~/.claude/skills` (including `be-*`) → already invokable, NO sync needed.
   - Project-local skills `<cwd>/.claude/skills/` are NOT seen by opencode → Bash `node "${CLAUDE_PLUGIN_ROOT}/scripts/skill-sync.mjs" apply "${CWD}"`.
     - `linked` non-empty → briefly report "bridged N project-local skills for OpenCode". `collisions` → warn that they were skipped (same name as a global skill). `<cwd>/.claude/skills/` absent → no-op, skip silently.
   - The command is idempotent — re-running just returns `already`. Remove after finishing the project: `/opencode-plugin-cc:oc-skills clean`.

1. **Locate plan**: find the most recent `/oc-plan` output in the conversation context. If none → ask the user to run `/opencode-plugin-cc:oc-plan` first.

2. **Iterate tasks**:
   - If arg = a task id (e.g. `t1`) → only that task.
   - If arg = `all` → all tasks in order. **High-risk task → STOP, AskUserQuestion to approve before proceeding**.

3. **Per task** — run the CC-level retry loop (max 2 reviewer-retries):

   a. Build the prompt for OpenCode:
      ```
      Task: <goal>
      Files likely touched: <list>
      Acceptance: <criteria>
      Available skills (invoke via the skill tool when relevant): <skills>
      Constraints:
      - Touch ONLY listed files (or those imported transitively).
      - Follow existing code conventions (read 2-3 nearby files first).
      - Output diff via standard tool calls.
      ```
      `<skills>` = the sub-task's `skills` field from the plan (e.g. `be-logging-convention, be-databases`). Drop this line if the task tagged no skill. **Only list skills OpenCode can actually see** — global `be-*` (auto) or project-local ones bridged in step 0.5. If unsure whether a skill is available → check with `/opencode-plugin-cc:oc-skills list`. DO NOT list orchestration skills that need Claude-Code-only tools.

   b. Invoke the CLI (Bash tool):
      ```bash
      node ${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs \
        --prompt "<built prompt>" \
        --cwd "${CWD}" \
        --model "<model>" \
        --agent "build" \
        --trace-file "${CWD}/.opencode-plugin/trace.jsonl"
      ```
      `<model>` = the model the user chose in step 0 (the CLI persists it to `config.json`). If you omit `--model`, the CLI reads the saved model from `config.json`; if there is none either, it auto-picks a free model. The model actually used is written to stderr + the `model_selected` trace event (with `source`: flag/config/auto).

   c. Parse the stdout JSON `{ success, result }`:
      - `success: true` → `result` is the normalized object: `result.session_id`, `result.status`, `result.result.diff` (aggregated from write/edit/patch tool_use events), `result.result.files_changed`, `result.result.message`, `result.result.model_used`, `result.result.tokens_used`. Proceed to step d.
      - `success: false`:
        - `error_type: RetryExhaustedError` → report to the user, stop the task (bridge retry already exhausted at the low level)
        - `error_type: OpencodeNotInstalledError` → suggest the user run `/opencode-plugin-cc:oc-install` to install opencode, stop all
        - `error_type: OpencodeTimeoutError` → tell the user the task is too slow, suggest splitting it, stop the task
        - Other → report + stop the task

   d. **Reviewer gate** — spawn the `opencode-reviewer` subagent via the Task tool:
      ```
      Task tool input:
      - subagent_type: "opencode-reviewer"
      - prompt: "Review this diff... original_task=<goal>, diff=<result.result.diff>, files_changed=<result.result.files_changed>, target_repo=<cwd>"
      ```

   e. Parse the reviewer JSON verdict:
      - `pass: true` → record success, show the diff to the user, move to the next task
      - `pass: false`:
        - `should_escalate_user: true` → STOP, AskUserQuestion showing the comment + ask for manual review/abort
        - Else → CC-retry: re-build the prompt with the reviewer feedback embedded, go back to step b. Max 2 CC-retries per task.

   f. After 2 CC-retries without a pass → STOP, report to the user with the last reviewer comment + last diff.

4. **Summary** after all tasks are done:
   - Tasks completed: N
   - Files changed: list (union)
   - Token cost (CC + OpenCode): from trace.jsonl `tokens_used` + an estimate of CC reviewer tokens
   - **Next tasks**: list only tasks NOT yet run (drop the done ones), one line each as `/opencode-plugin-cc:oc-exec <id> — <goal>`. If all tasks are done → state clearly "all tasks complete" and DON'T suggest `... oc-exec all` (it would re-run from the start). Recommend running the remaining ids one at a time.
   - Suggest: `/opencode-plugin-cc:oc-verify` to run the test/lint gate

## Constraints

- DO NOT silently skip a failed task. Every failure must surface to the user.
- Trace file path: `<cwd>/.opencode-plugin/trace.jsonl` — created if missing.
- DO NOT use the `--command` flag with the CLI (bug #2923 — the bridge guards it, but the prompt should not force it either).
- After each task is done → show the diff (use Read on the changed files) before moving to the next task.
