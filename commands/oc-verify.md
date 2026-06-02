---
description: Run test + lint gate after /oc-exec. Detects test runner from repo config.
---

# /oc-verify — Verify changes

> **QUAN TRỌNG — namespace lệnh.** Mọi lệnh gợi ý cho user PHẢI ở dạng đầy đủ `/opencode-plugin-cc:oc-*`. Bare `/oc-*` KHÔNG phải slash command hợp lệ trong Claude Code — user gõ sẽ bị "Unknown command".

## Flow

1. **Detect test runner** ở cwd:
   - `package.json` có `scripts.test` → `npm test`
   - `pyproject.toml` có `[tool.pytest]` hoặc `pytest.ini` exist → `pytest`
   - `go.mod` exist → `go test ./...`
   - `Cargo.toml` exist → `cargo test`
   - Else → AskUserQuestion: cách chạy test repo này?

2. **Detect lint runner**:
   - `.eslintrc*` / `eslint.config.*` → `npx eslint .`
   - `pyproject.toml` có `[tool.ruff]` → `ruff check .`
   - `.flake8` → `flake8`
   - `go.mod` → `go vet ./...`
   - Else skip (lint optional).

3. **Run** via Bash tool, capture exit code + output.

4. **Aggregate**:
   - All green → tell user "✅ All checks pass. Ready to commit."
   - Fail → show failures (last 50 lines output). AskUserQuestion:
     - `Re-delegate to OpenCode with failure context` → re-build prompt với test output, gợi ý user chạy `/opencode-plugin-cc:oc-exec <id>` cho task tương ứng
     - `Fix manually` → CC tự fix
     - `Stop` → leave as-is

## Out of scope (v2)

- Coverage threshold check
- E2E / integration test trigger
- Linter auto-fix mode
