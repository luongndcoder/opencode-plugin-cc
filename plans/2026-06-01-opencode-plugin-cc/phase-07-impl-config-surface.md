# Phase 07 — Impl config surface (commands / agent / hooks / manifest)

**Goal:** Wire toàn bộ surface user-facing (slash commands, reviewer agent, preflight hook, plugin manifest) để plugin chạy được end-to-end.

**TDD role:** N/A (markdown + JSON config, không có logic test được).

**blockedBy:** phase-06.

---

## Tasks

### 1. `agents/opencode-reviewer.md`

CC subagent prompt — đọc diff OpenCode trả về, verify correctness/scope/security.

```markdown
---
name: opencode-reviewer
description: Review diff returned by OpenCode execution. Verify correctness, scope, security, test compatibility. Output structured verdict.
tools: Read, Grep, Glob, Bash
---

# OpenCode Diff Reviewer

You review diffs produced by OpenCode (free-model executor). Your job is to catch wrong output before it lands.

## Input

You receive:
- `diff`: unified diff format from OpenCode
- `original_task`: the user's task description from `/oc-plan`
- `target_repo`: working directory path

## Verification Criteria

### 1. Correctness
- Does diff actually accomplish `original_task`?
- Logic errors, off-by-one, wrong operator, missing return?
- Import statements added correctly?

### 2. Scope creep
- Does diff touch ONLY files relevant to task?
- Any unrelated refactor, formatting, comment cleanup?
- New dependency added without justification?

### 3. Security
- SQL/command injection (string concat into queries/exec)?
- Hard-coded secrets / API keys / tokens?
- Unsafe deserialization (pickle, eval, exec)?
- XSS in template render?

### 4. Mobio rules (auto-detect)
If `target_repo` has `CLAUDE.md` or `AGENTS.md` mentioning Mobio:
- Tenant isolation: every Mongo query MUST include `merchant_id` filter
- Logging: trace_id propagation, header `Mobio-Trace-ID`, field `traceId` camelCase
- No `merchant_id` filter removal, no tenant boundary bypass
- Reject if diff hits hard gate (auth change / schema migration / Kafka topic change) — escalate user

### 5. Test compatibility
- Existing tests still pass conceptually (no breaking change to tested behavior)?
- New code path has corresponding test in diff (if `pytest`/`vitest`/`go test` exists)?

## Output Format

Strictly emit JSON only:

```json
{
  "pass": true | false,
  "comment": "single sentence summary",
  "issues": [
    { "category": "correctness | scope | security | mobio | test", "severity": "critical | high | medium | low", "detail": "..." }
  ],
  "should_escalate_user": true | false
}
```

`pass: false` → retry loop feeds `comment` into next OpenCode attempt.
`should_escalate_user: true` → retry loop bails out + flags for user review (hard gates hit).

## Constraints

- DO NOT modify files.
- DO NOT run tests yourself (test gate is separate step in `/oc-verify`).
- Be honest, brutal, concise.
- If unsure → mark `pass: false` with comment "uncertain — manual review needed".
```

### 2. `commands/oc-plan.md`

```markdown
---
description: Use Claude Code to plan a task. Outputs structured task list for OpenCode execution.
---

# /oc-plan — Plan a task

You are Claude Code. The user has a task they want OpenCode (free model executor) to execute.

Your job:
1. Read user's task: `$ARGUMENTS`
2. Read repo context (CLAUDE.md, AGENTS.md, docs/context/ if exists)
3. Break task into 1-5 atomic sub-tasks (each ≤ 200 lines diff scope)
4. For each sub-task, output:
   - `id`: t1, t2, ...
   - `goal`: one sentence
   - `files_likely_touched`: list
   - `acceptance`: how to verify done
   - `risk_tag`: low | medium | high (hard gate = high)

Output structured markdown to stdout:

\`\`\`
## Plan

- t1: <goal>
  - files: ...
  - acceptance: ...
  - risk: low
- t2: ...

\`\`\`

After plan output, prompt user:
- `/oc-exec t1` to delegate task t1 to OpenCode
- `/oc-exec all` to delegate all (sequential)
```

### 3. `commands/oc-exec.md`

```markdown
---
description: Delegate a task to OpenCode, with retry loop + reviewer gate.
---

# /oc-exec — Execute via OpenCode

Args: `$ARGUMENTS` — task id (`t1`) or `all`.

Steps:

1. Look up most recent plan from `/oc-plan` output in context.
2. For each task id:
   a. Construct prompt = task.goal + acceptance criteria + files list
   b. Spawn reviewer subagent (`opencode-reviewer`) ready
   c. Run: `node ${PLUGIN_DIR}/scripts/retry-loop.mjs --prompt "<prompt>" --cwd "${CWD}"` (subprocess wrapper)
   d. Wait result; parse JSON
   e. If `RetryExhaustedError` → report to user + stop
   f. If success → show diff, append to summary

3. After all tasks done, output summary:
   - Tasks completed: N
   - Files changed: list
   - Token cost: from trace.jsonl
   - Suggest: `/oc-verify` to run tests

Reviewer integration:
- The retry-loop invokes `opencode-reviewer` agent between attempts (CC subagent call).
- Reviewer JSON verdict goes into trace.jsonl + feedback prompt.

Bail-out cases (escalate user, no retry):
- `OpencodeNotInstalledError`
- `OpencodeTimeoutError`
- `should_escalate_user: true` từ reviewer
- `RetryExhaustedError`

Note: scripts/retry-loop.mjs hiện là library module — phase-07 thêm thin CLI wrapper (top-level invocation parsing argv) hoặc dùng `node -e "import('./retry-loop.mjs').then(...)"`. Pick whichever simpler — defer to be-ship judgement.
```

### 4. `commands/oc-verify.md`

```markdown
---
description: Run test/lint gate after /oc-exec. Optional second-pass reviewer.
---

# /oc-verify — Verify changes

Steps:

1. Detect test runner in cwd:
   - `package.json` + `scripts.test` → `npm test`
   - `pyproject.toml` + `[tool.pytest]` → `pytest`
   - `go.mod` → `go test ./...`
   - Else → ask user how to run tests

2. Run lint if config present:
   - `.eslintrc*` → `npx eslint .`
   - `pyproject.toml` + ruff → `ruff check .`
   - `go.mod` → `go vet ./...`

3. Aggregate result:
   - Pass → tell user "All checks green. Ready to commit."
   - Fail → show failures, ask user: retry via `/oc-exec` (with feedback) or fix manually?

Out of scope:
- Coverage check — defer v2.
- E2E/integration — manual user trigger.
```

### 5. `commands/oc-status.md` + `commands/oc-result.md` (v2 placeholders)

```markdown
---
description: [v2 placeholder] Poll background OpenCode job status.
---

# /oc-status — [Not implemented in MVP]

This command is reserved for v2 (background job queue).

In MVP, all `/oc-exec` runs are synchronous. If you want async/background execution, see roadmap.
```

Same pattern cho `oc-result.md`.

### 6. `hooks/hooks.json` + `hooks/ensure-opencode.mjs`

`hooks.json` (CORRECTED — `hooks` is a **record** keyed by event name, NOT an array; matches Claude Code settings.json hook schema. Initial array form failed plugin load with `expected record, received array`):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/ensure-opencode.mjs\"",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

`ensure-opencode.mjs`:

```javascript
#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const result = spawnSync('opencode', ['--version'], { encoding: 'utf8' })
if (result.error?.code === 'ENOENT') {
  console.error(
    '[opencode-plugin-cc] WARN: `opencode` CLI not found in PATH.\n' +
    '  Install: https://github.com/anomalyco/opencode\n' +
    '  Required version: >= 1.2.0'
  )
  process.exit(0) // non-blocking
}
const version = (result.stdout || '').trim()
const m = version.match(/(\d+)\.(\d+)\.(\d+)/)
if (m) {
  const [major, minor] = m.slice(1).map(Number)
  if (major < 1 || (major === 1 && minor < 2)) {
    console.error(
      `[opencode-plugin-cc] WARN: opencode version ${version} < 1.2.0 required. Plugin may misbehave.`
    )
  }
}
```

KHÔNG block session start — chỉ warn. Lý do: user có thể chỉ dùng `/oc-plan` mà chưa cần execute.

### 7. Update `.claude-plugin/plugin.json`

Wire toàn bộ commands + agents:

```json
{
  "name": "opencode-plugin-cc",
  "version": "0.1.0",
  "description": "Claude Code orchestrates anomalyco/opencode for free-model code execution",
  "engines": {
    "node": ">=20.0.0",
    "opencode": ">=1.2.0"
  },
  "author": "luongnd@mobio.io",
  "license": "MIT",
  "commands": [
    { "name": "oc-plan", "file": "commands/oc-plan.md" },
    { "name": "oc-exec", "file": "commands/oc-exec.md" },
    { "name": "oc-verify", "file": "commands/oc-verify.md" },
    { "name": "oc-status", "file": "commands/oc-status.md" },
    { "name": "oc-result", "file": "commands/oc-result.md" }
  ],
  "agents": [
    { "name": "opencode-reviewer", "file": "agents/opencode-reviewer.md" }
  ],
  "hooks": "hooks/hooks.json"
}
```

Note: `commands[].name` / `agents[].name` schema dựa theo Claude Code plugin spec hiện tại. Verify spec chính thức trước implement (be-ship task).

### 8. Flesh out `README.md`

Sections:
- What & why (cost saving, free model)
- Requirements (Node 20+, opencode 1.2+, Claude Code)
- Install (clone repo, `npm install`, register plugin trong Claude Code)
- Usage (3 command example)
- Configuration (`opencode.json` per project)
- Privacy warning (source code sent to OpenCode model — opt-in per project)
- Known limitations (v2 roadmap)
- Troubleshooting (opencode not in PATH, schema mismatch, retry exhausted)
- License

### 9. Manual smoke test (no auto-test cho markdown surface)

Procedure:
1. Register plugin trong Claude Code (`/plugin install ./opencode-plugin-cc`)
2. Verify SessionStart hook chạy (xem warning hoặc clean)
3. Verify 5 command appear trong `/help`
4. Run `/oc-plan "add hello function"` — verify plan output structured
5. (Pre-pilot) Run `/oc-exec t1` — verify subprocess invoke + trace.jsonl append

Smoke test failure → blocker, fix trước phase-08.

---

## Acceptance Criteria

- [x] 5 command markdown file tạo đúng path: `oc-plan`, `oc-exec`, `oc-verify`, `oc-status`, `oc-result`.
- [x] `agents/opencode-reviewer.md` strict JSON output spec + 5 verification criteria (correctness/scope/security/Mobio/test) + decision matrix.
- [x] `hooks/hooks.json` valid + `node hooks/ensure-opencode.mjs` exit 0 (opencode 1.15 found).
- [x] `.claude-plugin/plugin.json` valid — metadata-only (Claude Code auto-discovers `commands/` + `agents/` từ directory; `hooks` pointer trong `hooks/hooks.json`).
- [x] README full: 10+ section (why / requirements / install / commands / config / privacy / architecture / limitations / troubleshooting / dev / license).
- [~] Manual smoke test 5 step — **deferred to user runtime** (cần register plugin trong CC, invoke `/oc-plan`, không thể auto-test từ session này). Plugin code ready, CLI standalone verified.

**Adjustments:**
- Thêm `scripts/cli.mjs` (không trong plan gốc) — thin CLI wrapper cho slash command. Lý do: retry-loop là library module, không runnable trực tiếp; slash command markdown gọi qua `node scripts/cli.mjs`.
- Hook command path dùng `${CLAUDE_PLUGIN_ROOT}` (env var Claude Code inject) thay vì `${PLUGIN_DIR}` placeholder cũ.

**Status:** ✅ Done (2026-06-01) — surface ready. Pilot run remains (phase-08, user runtime).

## Files Touched

| Path                                    | Action |
| --------------------------------------- | ------ |
| `agents/opencode-reviewer.md`           | create |
| `commands/oc-plan.md`                   | create |
| `commands/oc-exec.md`                   | create |
| `commands/oc-verify.md`                 | create |
| `commands/oc-status.md`                 | create |
| `commands/oc-result.md`                 | create |
| `hooks/hooks.json`                      | update (from empty placeholder) |
| `hooks/ensure-opencode.mjs`             | create |
| `.claude-plugin/plugin.json`            | update (wire commands/agents) |
| `README.md`                             | update (flesh out from skeleton) |

## Out of Scope

- Background job (`oc-status`, `oc-result` real impl) — v2.
- CC fallback when OpenCode totally fails — v2.
- Risk-tagging adaptive verify — v2.
