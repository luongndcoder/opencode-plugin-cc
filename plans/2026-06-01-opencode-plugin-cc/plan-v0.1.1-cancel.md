# Plan — v0.1.1 cancel + timeout UX

**Patch sprint:** ~2-3h dev. 1 slice "cancellation infra".

## Scope

In:
- Bridge accept `AbortSignal` (optional) → propagate child.kill() khi signal abort
- New error class `OpencodeAbortedError`
- CLI install SIGINT + SIGTERM handler → graceful cancel (kill child opencode + write trace + exit code 130 cho SIGINT, 143 cho SIGTERM)
- CLI write PID file `<cwd>/.opencode-plugin/active.pid` ở start, unlink ở end
- CLI accept `--timeout <ms>` flag (default 5 phút, configurable)
- New command `commands/oc-cancel.md` — CC read PID file → Bash `kill -TERM <pid>` → confirm exit
- Update README troubleshoot section

Out (defer v0.2.0+):
- Background jobs (jobId state machine)
- `/oc-status` / `/oc-result` real impl

## TDD slice

1. **phase-v0.1.1-01** — Write tests RED:
   - Bridge: 3 test (signal-already-aborted, abort-during-run, abort-listener-cleanup)
   - CLI handler unit: 3 test (createCancelHandler factory — pid-file lifecycle, signal triggers abort, exit code map)
2. **phase-v0.1.1-02** — User review gate (HARD STOP)
3. **phase-v0.1.1-03** — Impl: bridge AbortSignal + CLI handler + oc-cancel.md + README update
4. **phase-v0.1.1-04** — bump version 0.1.0→0.1.1 + tag + push

## File mapping

| File | Action |
|---|---|
| `scripts/opencode-bridge.mjs` | +AbortSignal support, +`OpencodeAbortedError` |
| `scripts/cli.mjs` | +SIGINT/SIGTERM handler, +PID file, +`--timeout` flag |
| `scripts/cancel-handler.mjs` | **new** — extract testable factory `createCancelHandler({ pidFile, abortController, onTrace })` |
| `commands/oc-cancel.md` | **new** |
| `tests/opencode-bridge.test.mjs` | +3 test cho AbortSignal |
| `tests/cancel-handler.test.mjs` | **new** — 3 test cho factory |
| `package.json` + `.claude-plugin/plugin.json` | bump 0.1.0 → 0.1.1 |
| `README.md` | +troubleshoot row "stuck task → /oc-cancel hoặc Ctrl-C" |

## Acceptance

- All existing 22 tests vẫn green (no regression)
- +6 test mới = 28 total
- Manual smoke: `node scripts/cli.mjs --prompt "long" --cwd /tmp --timeout 3000` → 3s sau auto-cancel với exit 124 (timeout) hoặc trigger SIGINT exit 130
- `/oc-cancel` invocation: CC reads PID, kills, confirms

## Risk

- SIGINT handler conflict với existing process listeners → mitigation: register once, use `process.once` cho cleanup
- PID file stale (process crash without cleanup) → mitigation: check PID alive trước khi trust, document trong README
- Cross-platform signal (Windows) → SIGTERM ok, SIGINT cũng ok với Node — verify trên test
