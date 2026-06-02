---
description: Use Claude Code to plan a task before delegating to OpenCode. Outputs an atomic task list with risk tags.
---

# /oc-plan - Plan a task

You are Claude Code. The user has a task they want OpenCode (the free-model executor) to implement.

## Job

1. Read the task the user sent: `$ARGUMENTS`
2. Read repo context when available:
   - `CLAUDE.md`, `AGENTS.md` (project & global level)
   - `docs/context/overview.md`, `docs/context/architecture.md` if present
   - Files relevant to the task (use `Grep`/`Glob` to locate)
3. Analyze: does this task hit a hard gate (auth, schema migration, Kafka topic, tenant isolation, public API contract)?
4. Break the task into **1-5 atomic sub-tasks**. Each sub-task <= 200 lines of expected diff scope.
5. For each sub-task output:
   - `id`: t1, t2, ...
   - `goal`: one sentence (imperative, measurable)
   - `files_likely_touched`: list of predicted paths (best-effort)
   - `acceptance`: how to verify it's done (test command / manual check)
   - `risk_tag`: `low` | `medium` | `high` (hard gate = high)
   - `skills`: (optional) which Claude Code skill(s) OpenCode should use for this sub-task. OpenCode (>=1.15) natively discovers global skills under `~/.claude/skills` (including the Mobio `be-*` set) -> it can invoke them via its skill tool while executing. Only tag **instruction-only** skills (e.g. `be-logging-convention`, `be-databases`, convention skills) - do NOT tag orchestration skills that need Claude-Code-only tools (AskUserQuestion / Task subagents / the Skill tool / `/opencode-plugin-cc:*` commands), because OpenCode runs headless and cannot use them. Leave empty if no skill fits.

## Output format

```markdown
## Plan: <task summary>

### Sub-tasks

- **t1**: <goal>
  - files: `src/foo.js`, `src/bar.js`
  - acceptance: `npm test src/foo.test.js` passes + `git diff` review
  - risk: low
  - skills: `be-logging-convention`  *(optional - OpenCode invokes it while executing)*

- **t2**: <goal>
  - ...

### Risk summary

- Low: t1, t3
- Medium: t2
- High: (none)  *or*  t4 - flagged for **user review before `/opencode-plugin-cc:oc-exec`**

### Next

- `/opencode-plugin-cc:oc-exec t1` to delegate task t1 to OpenCode
- `/opencode-plugin-cc:oc-exec all` to delegate all sequentially (auto-skips high risk, asks the user first)
```

> **IMPORTANT - command namespace.** Every command you suggest to the user MUST use the full form `/opencode-plugin-cc:oc-*` (e.g. `/opencode-plugin-cc:oc-exec t1`). The bare `/oc-*` is NOT a valid slash command in Claude Code - typing it returns "Unknown command". This applies to all suggested output below.

## Constraints

- DO NOT execute or edit files in `/oc-plan` - plan only.
- High-risk task -> add a note in the output: "REQUIRES USER APPROVAL before `/opencode-plugin-cc:oc-exec`".
- If the task is too large (predicted > 5 sub-tasks) -> suggest breaking it down with `/be-plan` first.
- If the repo has a detectable hard gate in CLAUDE.md -> mention it explicitly in the risk summary.
- `skills`: only tag genuinely relevant + instruction-only skills. Don't over-tag (each skill OpenCode loads costs context). Project-local skills (`<cwd>/.claude/skills/`) require `/opencode-plugin-cc:oc-skills sync` to become available - `/opencode-plugin-cc:oc-exec` auto-syncs them.
