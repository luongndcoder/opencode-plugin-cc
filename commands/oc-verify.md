---
description: Run test + lint gate after /oc-exec. Detects the test runner from repo config.
---

# /oc-verify — Verify changes

> **IMPORTANT — command namespace.** Every command you suggest to the user MUST use the full form `/opencode-plugin-cc:oc-*`. The bare `/oc-*` is NOT a valid slash command in Claude Code — typing it returns "Unknown command".

## Flow

1. **Detect the test runner** in the cwd:
   - `package.json` has `scripts.test` → `npm test`
   - `pyproject.toml` has `[tool.pytest]` or `pytest.ini` exists → `pytest`
   - `go.mod` exists → `go test ./...`
   - `Cargo.toml` exists → `cargo test`
   - Else → AskUserQuestion: how to run tests in this repo?

2. **Detect the lint runner**:
   - `.eslintrc*` / `eslint.config.*` → `npx eslint .`
   - `pyproject.toml` has `[tool.ruff]` → `ruff check .`
   - `.flake8` → `flake8`
   - `go.mod` → `go vet ./...`
   - Else skip (lint is optional).

3. **Run** via the Bash tool, capturing exit code + output.

4. **Aggregate**:
   - All green → tell the user "✅ All checks pass. Ready to commit."
   - Failure → show the failures (last 50 lines of output). AskUserQuestion:
     - `Re-delegate to OpenCode with failure context` → re-build the prompt with the test output, suggest the user run `/opencode-plugin-cc:oc-exec <id>` for the matching task
     - `Fix manually` → CC fixes it
     - `Stop` → leave as-is

## Out of scope (v2)

- Coverage threshold check
- E2E / integration test trigger
- Linter auto-fix mode
