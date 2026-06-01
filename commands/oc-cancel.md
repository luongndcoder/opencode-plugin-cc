---
description: Cancel the currently-running /oc-exec by signaling the active PID. Reads <cwd>/.opencode-plugin/active.pid.
---

# /oc-cancel — Cancel running OpenCode task

Use this when an `/oc-exec` task is stuck, too slow, or you changed your mind.

## How it works

`scripts/cli.mjs` writes its own PID to `<cwd>/.opencode-plugin/active.pid` when an `/oc-exec` task starts. This command reads that PID and sends `SIGTERM` so the CLI graceful-shuts (kills opencode child, writes a trace `cancel` event, exits 143).

## Flow

1. **Locate PID file**:
   ```bash
   PID_FILE="${CWD}/.opencode-plugin/active.pid"
   ```
   If file missing → tell user "No active /oc-exec task found in this directory." and stop.

2. **Read PID**:
   ```bash
   PID=$(cat "$PID_FILE" 2>/dev/null)
   ```
   If empty or non-numeric → tell user "PID file corrupt; manual cleanup may be needed." and stop.

3. **Verify alive** (avoid stale-PID kill of wrong process):
   ```bash
   kill -0 "$PID" 2>/dev/null && echo "alive" || echo "stale"
   ```
   - `stale` → unlink PID file (`rm "$PID_FILE"`), tell user "Stale PID cleaned." and stop.
   - `alive` → proceed step 4.

4. **Send SIGTERM**:
   ```bash
   kill -TERM "$PID"
   ```
   CLI handler will: trace cancel event, abort retry loop, kill child opencode, exit 143.

5. **Confirm exit**:
   ```bash
   sleep 1 && kill -0 "$PID" 2>/dev/null && echo "still alive" || echo "exited"
   ```
   - `exited` → tell user "✅ /oc-exec cancelled. Trace logged."
   - `still alive` after 1s → escalate user: "Process did not exit; consider SIGKILL: `kill -9 $PID`". Do NOT auto-SIGKILL.

## Constraints

- DO NOT auto-SIGKILL — leave to user (SIGKILL bypasses cleanup, leaves opencode subprocess orphan).
- DO NOT cancel processes outside this cwd (each `/oc-exec` instance uses its own PID file per cwd).
- DO NOT touch other cwds' PID files.
- If multiple `/oc-exec` ran in parallel from same cwd → PID file overwritten; only newest task tracked. (Sequential is MVP design.)

## Alternative: Ctrl-C in Claude Code

If `/oc-exec` is running in foreground, pressing `Esc` (interrupt) in Claude Code propagates SIGINT to the subprocess child (Node CLI), which triggers the same cleanup handler as `/oc-cancel` (exit code 130 instead of 143). `/oc-cancel` is useful when:

- The `/oc-exec` is in another CC session
- You can't interrupt CC easily
- You want explicit confirmation logged in trace

## Args

`$ARGUMENTS` ignored in MVP. (Future v0.3.0: `<jobId>` selector for background jobs.)
