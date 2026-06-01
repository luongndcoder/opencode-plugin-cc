# Phase 00 — Scaffold plugin structure

**Goal:** Tạo cấu trúc thư mục + manifest + package.json + README skeleton. Plugin load được trong Claude Code (chưa có chức năng).

**TDD role:** N/A (config scaffold, không có logic test được).

**blockedBy:** —

---

## Tasks

1. **Create directory tree** ở repo root `/Users/luongcoder/Documents/AI/opencode-plugin-cc/`:

   ```
   .claude-plugin/
   agents/
   commands/
   hooks/
   scripts/
   schemas/
   tests/
   tests/fixtures/
   ```

2. **Create `.claude-plugin/plugin.json`** — Claude Code plugin manifest:

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
     "commands": [],
     "agents": [],
     "hooks": "hooks/hooks.json"
   }
   ```

   Commands/agents arrays để trống — wire ở phase-07.

3. **Create `package.json`**:

   ```json
   {
     "name": "opencode-plugin-cc",
     "version": "0.1.0",
     "type": "module",
     "engines": { "node": ">=20.0.0" },
     "scripts": {
       "test": "node --test tests/",
       "test:coverage": "node --test --experimental-test-coverage tests/"
     },
     "dependencies": {
       "ajv": "^8.12.0"
     }
   }
   ```

   KHÔNG thêm dev dep test runner — dùng `node:test` builtin.

4. **Create `.gitignore`**:

   ```
   node_modules/
   .DS_Store
   plans/*/trace.jsonl
   plans/*/pilot-results.md
   coverage/
   ```

5. **Create `README.md` skeleton** (sẽ flesh out phase-07):

   ```markdown
   # opencode-plugin-cc

   Claude Code plugin to orchestrate [anomalyco/opencode](https://github.com/anomalyco/opencode) — let CC plan + review, OpenCode execute with free models.

   > **Status:** WIP — MVP scaffold. Not ready for use.

   ## Requirements

   - Claude Code
   - Node.js >= 20
   - `opencode` CLI >= 1.2 ([install](https://github.com/anomalyco/opencode))

   ## Install

   _(TODO phase-07)_

   ## Commands

   _(TODO phase-07)_
   ```

6. **Empty placeholder file** `hooks/hooks.json`:

   ```json
   { "hooks": [] }
   ```

   Sẽ fill phase-07.

7. **Run `npm install`** — verify package.json valid, generate package-lock.json.

---

## Acceptance Criteria

- [x] All 7 directories tồn tại.
- [x] `plugin.json` valid JSON, parse được qua `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json'))"`.
- [x] `package.json` valid, `npm install` không lỗi, `package-lock.json` generated.
- [x] `node_modules/ajv` tồn tại.
- [~] `node --test tests/` chạy: exits non-zero với empty tests dir (Node behavior). Sẽ pass sau phase-01 khi có test file.
- [x] README skeleton tồn tại.

**Status:** ✅ Done (2026-06-01) — scaffold complete, ready for phase-01.

## Out of Scope

- Plugin chưa register command/agent/hook nào — phase-07 wire.
- Chưa có logic — chỉ scaffold.

## Files Touched

| Path                                   | Action |
| -------------------------------------- | ------ |
| `.claude-plugin/plugin.json`           | create |
| `package.json`                         | create |
| `package-lock.json`                    | create (npm install gen) |
| `.gitignore`                           | create |
| `README.md`                            | create |
| `hooks/hooks.json`                     | create (empty) |
| 6 empty dirs                           | create |
