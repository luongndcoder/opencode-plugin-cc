---
description: Detect & help install anomalyco/opencode on this machine when it is missing. Asks for consent before running any install command.
---

# /oc-install - Install OpenCode

Install [anomalyco/opencode](https://github.com/anomalyco/opencode) (the plugin's executor) when the machine doesn't have it, or upgrade when the version is too old (< 1.2).

> **IMPORTANT - command namespace.** Every command you suggest to the user MUST use the form `/opencode-plugin-cc:oc-*`. The bare `/oc-*` is not a valid slash command.
>
> **SAFETY.** NEVER run an install command without asking first. Always show the exact command + AskUserQuestion for consent first. NEVER add `sudo` yourself. NEVER `curl | bash` silently.

## Flow

1. **Check whether it's installed** - Bash: `opencode --version`.
   - Success + version **>= 1.2.0** -> tell the user "opencode <version> is installed, ready for `/opencode-plugin-cc:oc-exec`." -> **STOP**.
   - Success but **< 1.2.0** -> report the old version, suggest `opencode upgrade` (if installed via script/brew) -> AskUserQuestion for approval before running -> re-verify -> STOP.
   - `command not found` / error -> continue to step 2 (not installed).

2. **Build an install plan** - Bash:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/install-opencode.mjs"
   ```
   Returns JSON: `{ platform, recommended, available[], unavailable[], manual }`.

3. **Present + get consent**:
   - `recommended != null` -> show `recommended.label` + `recommended.cmd` to the user.
   - `AskUserQuestion`:
     - Question: "opencode isn't installed. Install it with this command? `<recommended.cmd>`"
     - Options (built dynamically from the plan):
       - `Yes, run the recommended command` (run `recommended.cmd`)
       - `Pick another method` (if `available.length > 1` -> list `available[].label`/`cmd` for the user to choose)
       - `Show manual instructions` (print `manual.docs` + `manual.desktop_and_binaries` + `manual.install_script`, run NOTHING)
       - `Cancel`
   - `recommended == null` (no available package manager) -> DO NOT suggest running anything. Show `manual`:
     - "No suitable package manager found. Install manually:"
     - install script: `manual.install_script`
     - desktop/binaries: `manual.desktop_and_binaries`
     - docs: `manual.docs`
     - -> STOP (let the user decide).

4. **Run the chosen command** (only after the user approves) - Bash:
   - Run exactly the `cmd` the user chose. Use a generous timeout (network installs can be slow): `timeout` >= 300000ms.
   - DO NOT add `sudo`. If the command fails on a permission error (EACCES npm global, brew sudo, ...) -> DO NOT sudo yourself; report the error + suggest a fix (e.g. `npm config get prefix`, change the prefix; or use another method in `available`).
   - Stream / show the output to the user.

5. **Verify** - Bash: `opencode --version`.
   - Success >= 1.2.0 -> "Installed opencode <version>. Now run `/opencode-plugin-cc:oc-plan <task>` then `/opencode-plugin-cc:oc-exec`."
   - Still failing -> report clearly, suggest:
     - try another method in `available`,
     - or install manually (`manual`),
     - check PATH (the binary may have been installed to `~/.opencode/bin` or `~/.local/bin` not yet in PATH - tell the user to open a new terminal / source their profile).

## Constraints

- DO NOT install without explicit approval from AskUserQuestion.
- DO NOT use `sudo` automatically. DO NOT modify the user's shell profile automatically.
- DO NOT run anything if `recommended == null` - manual instructions only.
- After installing, suggest the next step in the correct namespaced form.
