# opencode-plugin-cc

Claude Code plugin to orchestrate [anomalyco/opencode](https://github.com/anomalyco/opencode) — let Claude Code plan + review, OpenCode execute tasks with free models.

Inspired by [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) (Claude Code ↔ Codex), this plugin wires CC ↔ OpenCode so Claude takes the architect / reviewer role (high quality, paid) while OpenCode does the implementation grunt-work with free models (Ollama / Groq / OpenRouter / DeepSeek free tier).

> **Status:** v0.1.0 MVP. Pilot validation pending. Not production-ready.

## Why

`/oc-plan` → `/oc-exec` → `/oc-verify` workflow:

- **Plan:** Claude Code reads task + repo context, breaks into atomic sub-tasks with risk tags.
- **Exec:** Each sub-task forwarded to OpenCode CLI via a subprocess bridge. OpenCode runs the chosen free model and returns a structured diff.
- **Verify:** A Claude Code reviewer subagent inspects the diff (correctness / scope / security / Mobio rules), then a test/lint gate runs. If reviewer rejects, CC re-delegates with feedback — bounded retry.

Net effect: pay Claude tokens only for planning + review, save Claude tokens on grunt edits.

## Requirements

- [Claude Code](https://www.anthropic.com/claude-code) CLI
- Node.js ≥ 20
- [anomalyco/opencode](https://github.com/anomalyco/opencode) ≥ v1.2 in `PATH`
- A configured free-model provider in OpenCode (see [opencode.ai/docs/cli](https://opencode.ai/docs/cli/))

## Install

```bash
# 1. Clone or download this repo
git clone https://github.com/luongnd/opencode-plugin-cc.git
cd opencode-plugin-cc

# 2. Install dependencies
npm install

# 3. Register with Claude Code (one-time)
#    Symlink/copy into ~/.claude/plugins/ or follow Claude Code plugin install docs.
```

Quick verify:

```bash
opencode --version          # should report >= 1.2.0
node scripts/cli.mjs --help # CLI usage
node --test tests/*.test.mjs # 22/22 unit tests should pass
```

## Commands

| Command       | Purpose                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `/oc-plan`    | Claude Code drafts an atomic task list from your prompt + repo context        |
| `/oc-exec`    | Delegate one or all planned tasks to OpenCode, with reviewer + retry gate     |
| `/oc-verify`  | Run repo's test + lint after `/oc-exec`; re-delegate on failure if you choose |
| `/oc-cancel`  | Cancel the currently-running `/oc-exec` via PID file in cwd                   |
| `/oc-status`  | (v2 placeholder) Background job polling                                       |
| `/oc-result`  | (v2 placeholder) Fetch background job result                                  |

Typical session:

```
/oc-plan add hello function with unit test in src/lib/

→ CC outputs t1: add hello fn, t2: add unit test

/oc-exec all

→ CC builds prompt → invokes scripts/cli.mjs subprocess
→ OpenCode executes t1 with free model, returns diff
→ Reviewer subagent verifies diff (passes)
→ Same for t2
→ Summary printed

/oc-verify

→ Detects `npm test` from package.json → runs → green
→ Tells you it's commit-ready
```

## Configuration

- **OpenCode model selection:** pass `--model <provider>/<name>` in `/oc-exec`, or default `--model free` (random free model). Set defaults in your project's `opencode.json`.
- **Trace log:** every `/oc-exec` appends to `<cwd>/.opencode-plugin/trace.jsonl` with `traceId`, attempt, status, duration, model, exit code, error. Use this to audit cost and reliability.
- **Retry budget:** default 2 retries inside the bridge (transient errors) + up to 2 reviewer-driven retries at CC level. Adjust via `--max-retry` to CLI.

## Privacy warning

Source code in your repo is sent verbatim to OpenCode's chosen model provider (Ollama is local; Groq / OpenRouter / DeepSeek are remote). If you handle PII, secrets, or proprietary IP, **opt-in per project** and prefer local providers (Ollama / llama.cpp / LM Studio).

The plugin logs prompt content into `trace.jsonl` for auditing — `.gitignore` already excludes it, but be mindful when sharing logs.

## Architecture

```
Claude Code (main loop)
    │
    ├── /oc-plan  ──→  CC reasons; outputs structured plan (Markdown)
    │
    ├── /oc-exec  ──→  Bash: node scripts/cli.mjs --prompt … --cwd …
    │                       │
    │                       └── retry-loop.mjs
    │                              │
    │                              └── opencode-bridge.mjs  ── subprocess ──→  opencode run --format json
    │                                       (validate JSON via Ajv, chunked stream reader)
    │                       returns JSON to CC
    │                  CC spawns Task(opencode-reviewer) ──→  agent emits JSON verdict
    │                  CC decides: approve / re-delegate with feedback / escalate user
    │
    └── /oc-verify ──→  Bash: npm test / pytest / go test (repo-detected)
```

Key constraints:

- Subprocess uses `node:readline` chunked reader to avoid stdout deadlock at high volume (lesson from `codex-plugin-cc` issues [#277](https://github.com/openai/codex-plugin-cc/issues/277), [#279](https://github.com/openai/codex-plugin-cc/issues/279)).
- Bridge refuses to combine `--format json` + `--command` (anomalyco bug [#2923](https://github.com/anomalyco/opencode/issues/2923)).
- Reviewer agent emits **strict JSON** only — no narrative, ensures CC can parse.
- `traceId` is shared across all retries of a single user task (matches Mobio rule [93-be-logging](https://docs/...)).

## Known limitations (v2 roadmap)

- No concurrent task execution (sequential only).
- No background job queue (`/oc-status` / `/oc-result` placeholder).
- No dry-run mode (use `git stash` before `/oc-exec` if you want preview).
- Free model quality varies; pilot phase measures actual reliability.
- If OpenCode fails completely (binary missing / timeout / schema error), plugin **bails out + escalates user** — no automatic Claude fallback.

## Troubleshooting

| Symptom                                           | Likely cause / fix                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `OpencodeNotInstalledError`                       | `opencode` not in PATH. Install: https://github.com/anomalyco/opencode            |
| `OpencodeOutputError: schema mismatch`            | OpenCode version bumped, schema changed. Update `schemas/opencode-output.json`.   |
| `OpencodeTimeoutError`                            | Task too slow (>5min default). Split task with `/oc-plan` or extend `--max-retry` |
| `RetryExhaustedError`                             | Free model couldn't satisfy reviewer. Check `trace.jsonl`. Switch model.          |
| `/oc-exec` stuck / too slow                       | Press Esc in CC (sends SIGINT → exit 130) OR run `/oc-cancel` in another CC session. Use `--timeout <ms>` to set hard cap. |
| `/oc-cancel` says "no active task"                | PID file `<cwd>/.opencode-plugin/active.pid` missing — nothing to cancel.        |
| Stale PID file                                    | `/oc-cancel` auto-cleans stale PIDs (verifies process alive first).               |
| Reviewer always fails with "uncertain"            | Add Mobio CLAUDE.md / better repo context. Or simplify task.                       |
| `node --test` says module not found               | Run `npm install`, ensure Node ≥ 20.                                              |

## Development

```bash
npm test                  # 30 unit tests (node:test)
npm run test:coverage     # coverage report (experimental)
```

## License

MIT
