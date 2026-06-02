---
description: Bridge Claude Code skills into opencode so the executor can use them. List what opencode sees, sync project-local skills, or remove the bridge.
---

# /oc-skills — Bridge Claude Code skills into OpenCode

OpenCode (≥ 1.15) auto-discovers skills from **three global roots**: `~/.claude/skills`, `~/.agents/skills`, `~/.config/opencode/skills`. That means your global skills (e.g. the Mobio `be-*` set) are **already usable in OpenCode with no action needed**.

What's missing: project-local skills under `<cwd>/.claude/skills/` are NOT discovered by opencode. This command symlinks them into opencode's skills dir so the executor (`/opencode-plugin-cc:oc-exec`) can invoke them, with a manifest so they can be removed cleanly.

> **IMPORTANT — command namespace.** Every command you suggest to the user MUST use the form `/opencode-plugin-cc:oc-*`. The bare `/oc-*` is not a valid slash command.

Args: `$ARGUMENTS` — `list` (default) | `sync` | `clean`.

## Flow

### `list` (default)

1. **Skills opencode currently sees** — Bash: `opencode debug skill` → parse JSON `[{name, description, location}]`.
   - opencode not installed (error) → suggest `/opencode-plugin-cc:oc-install`, STOP.
   - Summarize compactly by root: how many from `~/.claude/skills`, `~/.agents/skills`, `~/.config/opencode/skills`, `<built-in>`. List the `be-*` (Mobio) skills that are available.
2. **Project-local skills not yet bridged** — Bash: `node "${CLAUDE_PLUGIN_ROOT}/scripts/skill-sync.mjs" plan "${CWD}"` → JSON `{ toLink[], collisions[], already[] }`.
   - `toLink` non-empty → report "N project-local skills are NOT bridged yet — run `/opencode-plugin-cc:oc-skills sync`".
   - `collisions` non-empty → warn: these names already have a global skill of the same name → opencode ignores the project copy (dedups by name) → NOT synced.
   - `already` → already bridged.
   - No `<cwd>/.claude/skills/` → "This project has no local skills, nothing to bridge."

### `sync`

1. Bash: `node "${CLAUDE_PLUGIN_ROOT}/scripts/skill-sync.mjs" apply "${CWD}"` → JSON `{ linked[], already[], collisions[], failed[] }`.
2. Report to the user: symlinked `linked` into `~/.config/opencode/skills/`; `collisions` skipped (a same-named skill already exists); `failed` (if any).
3. Remind: synced skills live in opencode's **global** skills dir until `clean` — use `/opencode-plugin-cc:oc-skills clean` when done with the project to remove them.

### `clean`

1. Bash: `node "${CLAUDE_PLUGIN_ROOT}/scripts/skill-sync.mjs" clean "${CWD}"` → JSON `{ removed[], skipped[] }`.
2. Report: removed `removed`; `skipped` (with reason — e.g. `points-elsewhere` = not a link we created, left untouched for safety).

## Constraints

- Symlink only, never copy — the source stays in `<cwd>/.claude/skills/`.
- NEVER overwrite a same-named skill that already exists globally (collision → skip + report).
- `clean` only removes symlinks the plugin created (per the manifest `<cwd>/.opencode-plugin/synced-skills.json`, and the link must point into this project) — it NEVER deletes a real dir / foreign link.
- Global skills (`~/.claude/skills/be-*`) are already discovered — they do NOT need and should NOT be synced (it would be a no-op/collision).
