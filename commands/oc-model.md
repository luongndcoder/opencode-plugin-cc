---
description: List opencode models (free + paid OpenCode Zen) and let the user pick which one /oc-exec uses. Saves the choice per project.
---

# /oc-model — Choose the executor model

OpenCode has **free models** (quality varies) and **paid models (OpenCode Zen)** that are cheap and higher quality. This command lists the models + cost so the user can pick; the choice is saved to `<cwd>/.opencode-plugin/config.json` and used for every later `/opencode-plugin-cc:oc-exec`.

> Positioning: **Claude (Pro) plans → OpenCode (Zen) executes**. Because Zen is very cheap, you can use a paid model to execute and total cost is still far lower than having Claude write all the code.
>
> **IMPORTANT — command namespace.** Every command you suggest to the user MUST use the form `/opencode-plugin-cc:oc-*`.

## Flow

1. **List models** — Bash:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/model-selector.mjs" --list --all
   ```
   Returns JSON `{ includes_paid: true, models: [{ id, input, output, free, context, toolcall }] }`.
   Sort: free first (best first), then paid (cheapest first). `input`/`output` = opencode price (USD per 1M tokens).
   - exit 3 / `OpencodeNotInstalledError` → suggest `/opencode-plugin-cc:oc-install`, STOP.
   - `models` empty → "No models available. Log in to opencode / configure a provider." STOP.

2. **Show the list** to the user, split into two groups:
   - **Free** — each line: `<id>` — context `<context>` — `FREE`.
   - **Paid (OpenCode Zen)** — each line: `<id>` — context `<context>` — in `$<input>` / out `$<output>` per 1M tokens.

3. **Ask to choose** — `AskUserQuestion` (single-select):
   - question: "Pick a model for OpenCode to execute with. Free = $0. Paid (Zen) = higher quality, billed at the cost above (very cheap)."
   - header: "Model"
   - options: up to **4** representative models (a mix of a few free + a few notable paid; label = id, description = FREE or `in $x / out $y`). State clearly in the question: pick **Other** to type any exact `<provider>/<model>` listed in step 2 (free or paid).
   - If the user picks **paid** → restate the cost in the confirmation so they know they will be billed.
   - DO NOT pick on their behalf.

4. **Validate + save**:
   - `<chosen-id>` must be in the `models` list from step 1 (free or paid). No match → warn + ask again.
   - Bash: `node "${CLAUDE_PLUGIN_ROOT}/scripts/model-config.mjs" set "${CWD}" "<chosen-id>"`.

5. **Confirm**: "✅ Saved model `<chosen-id>`" + (if paid) "— billed ~in $<input>/out $<output> per 1M tokens". "Run `/opencode-plugin-cc:oc-exec <task>` to use it. Change it later: `/opencode-plugin-cc:oc-model`."

## Constraints

- DO NOT run exec here — only choose + save the model.
- Allow choosing **free or paid Zen**, but `<chosen-id>` MUST exist in the `--list --all` output (a real model on this account). DO NOT invent an id.
- When the user picks paid → you MUST show the cost clearly before saving (informed consent on cost).
- Save per-project at `<cwd>/.opencode-plugin/config.json` (key `model`).
- Note: auto-pick (when the user hasn't chosen anything) always selects **free** only — paid is used only when the user explicitly chooses here or passes `--model` directly.
