---
description: [v2 placeholder] Fetch result of background OpenCode job.
---

# /oc-result — Not implemented in MVP

This command is reserved for v2 (background job queue).

Current MVP: `/oc-exec` returns its result **inline** in the session. To fetch a past result, read `<cwd>/.opencode-plugin/trace.jsonl`.

Args: `$ARGUMENTS` (will be `<job-id>` in v2).
