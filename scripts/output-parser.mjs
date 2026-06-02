// Normalizes `opencode run --format json` output into a single result object.
//
// opencode >= 1.15 emits an NDJSON *event stream* (one JSON object per line:
// step_start / tool_use / step_finish / text / error), NOT a single result
// object. This module aggregates that stream into the shape the bridge schema
// expects: { session_id, status, result: { diff, files_changed, message, ... } }.
//
// A single non-event JSON object (e.g. test fixtures or a future opencode
// format) is passed through unchanged so the contract stays backward-compatible.

const WRITE_TOOLS = new Set(['write', 'edit', 'multiedit', 'patch'])

function fileOf(input) {
  if (!input || typeof input !== 'object') return null
  return input.filePath || input.path || input.file || null
}

function collectFiles(toolUses) {
  const set = new Set()
  for (const t of toolUses) {
    if (t.status && t.status !== 'completed') continue
    if (!WRITE_TOOLS.has(t.tool)) continue
    const f = fileOf(t.input)
    if (f) set.add(f)
  }
  return [...set]
}

function synthesizeDiff(toolUses) {
  const parts = []
  for (const t of toolUses) {
    if (t.status && t.status !== 'completed') continue
    if (!WRITE_TOOLS.has(t.tool)) continue
    const f = fileOf(t.input) || '(unknown file)'
    if (t.tool === 'write') {
      parts.push(`# write ${f}\n${t.input?.content ?? ''}`)
    } else if (t.tool === 'edit') {
      parts.push(`# edit ${f}\n- ${t.input?.oldString ?? ''}\n+ ${t.input?.newString ?? ''}`)
    } else if (t.tool === 'multiedit') {
      parts.push(`# multiedit ${f}`)
    } else if (t.tool === 'patch') {
      parts.push(`# patch ${f}\n${t.input?.patch ?? t.input?.content ?? ''}`)
    }
  }
  return parts.length ? parts.join('\n\n') : null
}

function normalizeEvents(events, { model }) {
  let sessionID = null
  const toolUses = []
  const texts = []
  let tokensUsed = null
  let cost = null

  for (const e of events) {
    if (!e || typeof e !== 'object') continue
    if (e.sessionID && !sessionID) sessionID = e.sessionID

    switch (e.type) {
      case 'tool_use': {
        const p = e.part || {}
        const st = p.state || {}
        toolUses.push({
          tool: p.tool,
          status: st.status ?? null,
          input: st.input ?? null,
          output: st.output ?? null,
        })
        break
      }
      case 'text': {
        const t = e.part?.text
        if (t) texts.push(t)
        break
      }
      case 'step_finish': {
        const p = e.part || {}
        if (p.tokens && typeof p.tokens.total === 'number') tokensUsed = p.tokens.total
        if (typeof p.cost === 'number') cost = p.cost
        break
      }
      case 'error': {
        const detail = e.part || e.error || e
        throw new Error(`opencode error event: ${JSON.stringify(detail)}`)
      }
      default:
        break
    }
  }

  return {
    session_id: sessionID || 'unknown',
    status: 'completed',
    result: {
      diff: synthesizeDiff(toolUses),
      files_changed: collectFiles(toolUses),
      message: texts.join('\n') || null,
      model_used: model,
      tokens_used: tokensUsed,
      tool_uses: toolUses,
    },
    cost,
  }
}

/**
 * Parse raw stdout from `opencode run --format json`.
 *
 * @param {string} stdout Raw process stdout.
 * @param {{model?: string|null}} opts
 * @returns {object} Normalized result conforming to schemas/opencode-output.json.
 * @throws {Error} on empty / unparseable output, or an opencode `error` event.
 *                 (The bridge wraps these into OpencodeOutputError.)
 */
export function normalizeOutput(stdout, { model = null } = {}) {
  const lines = String(stdout)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    throw new Error('empty stdout from opencode')
  }

  // Single line: either a pre-normalized result object (test fixtures / legacy)
  // or one lone event. JSON.parse may throw - the bridge wraps that.
  if (lines.length === 1) {
    const obj = JSON.parse(lines[0])
    if (obj && typeof obj === 'object' && obj.type === undefined) {
      return obj
    }
    return normalizeEvents([obj], { model })
  }

  // NDJSON event stream.
  const events = []
  for (const line of lines) {
    try {
      events.push(JSON.parse(line))
    } catch {
      // Tolerate stray non-JSON noise lines (banner, warnings).
    }
  }
  if (events.length === 0) {
    throw new Error('no parseable JSON lines in opencode output')
  }
  return normalizeEvents(events, { model })
}
