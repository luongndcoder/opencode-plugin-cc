import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOutput } from '../scripts/output-parser.mjs'

// Real-shape NDJSON event stream from `opencode run --format json` (v1.15.x).
const NDJSON_STREAM = [
  JSON.stringify({
    type: 'step_start',
    sessionID: 'ses_abc',
    part: { type: 'step-start' },
  }),
  JSON.stringify({
    type: 'tool_use',
    sessionID: 'ses_abc',
    part: {
      type: 'tool',
      tool: 'write',
      state: {
        status: 'completed',
        input: { filePath: '/repo/hello.txt', content: 'hi' },
        output: 'Wrote file successfully.',
      },
    },
  }),
  JSON.stringify({
    type: 'step_finish',
    sessionID: 'ses_abc',
    part: { type: 'step-finish', tokens: { total: 41502, input: 41382, output: 101 }, cost: 0 },
  }),
  JSON.stringify({
    type: 'text',
    sessionID: 'ses_abc',
    part: { type: 'text', text: 'Done.' },
  }),
].join('\n')

test('normalizeOutput: aggregates NDJSON event stream into a result object', () => {
  const out = normalizeOutput(NDJSON_STREAM, { model: 'opencode/big-pickle' })
  assert.equal(out.session_id, 'ses_abc')
  assert.equal(out.status, 'completed')
  assert.equal(out.result.model_used, 'opencode/big-pickle')
  assert.equal(out.result.tokens_used, 41502)
  assert.deepEqual(out.result.files_changed, ['/repo/hello.txt'])
  assert.match(out.result.diff, /write \/repo\/hello\.txt/)
  assert.match(out.result.diff, /hi/)
  assert.equal(out.result.message, 'Done.')
})

test('normalizeOutput: edit tool produces old/new diff + files_changed', () => {
  const stream = [
    JSON.stringify({ type: 'step_start', sessionID: 'ses_x', part: {} }),
    JSON.stringify({
      type: 'tool_use',
      sessionID: 'ses_x',
      part: {
        tool: 'edit',
        state: {
          status: 'completed',
          input: { filePath: '/repo/a.py', oldString: 'foo', newString: 'bar' },
        },
      },
    }),
  ].join('\n')
  const out = normalizeOutput(stream)
  assert.deepEqual(out.result.files_changed, ['/repo/a.py'])
  assert.match(out.result.diff, /- foo/)
  assert.match(out.result.diff, /\+ bar/)
})

test('normalizeOutput: text-only run (no tool) -> diff null, message set', () => {
  const stream = [
    JSON.stringify({ type: 'step_start', sessionID: 'ses_t', part: {} }),
    JSON.stringify({ type: 'text', sessionID: 'ses_t', part: { text: 'No changes needed.' } }),
  ].join('\n')
  const out = normalizeOutput(stream)
  assert.equal(out.result.diff, null)
  assert.deepEqual(out.result.files_changed, [])
  assert.equal(out.result.message, 'No changes needed.')
})

test('normalizeOutput: skips incomplete tool_use (status != completed)', () => {
  const stream = [
    JSON.stringify({ type: 'step_start', sessionID: 'ses_p', part: {} }),
    JSON.stringify({
      type: 'tool_use',
      sessionID: 'ses_p',
      part: { tool: 'write', state: { status: 'error', input: { filePath: '/repo/x', content: 'y' } } },
    }),
  ].join('\n')
  const out = normalizeOutput(stream)
  assert.deepEqual(out.result.files_changed, [])
  assert.equal(out.result.diff, null)
})

test('normalizeOutput: pre-normalized single object passes through unchanged', () => {
  const obj = { session_id: 's1', status: 'completed', result: { diff: 'd' } }
  const out = normalizeOutput(JSON.stringify(obj))
  assert.deepEqual(out, obj)
})

test('normalizeOutput: an opencode error event throws', () => {
  const stream = [
    JSON.stringify({ type: 'step_start', sessionID: 'ses_e', part: {} }),
    JSON.stringify({ type: 'error', sessionID: 'ses_e', part: { message: 'model exploded' } }),
  ].join('\n')
  assert.throws(() => normalizeOutput(stream), /opencode error event/)
})

test('normalizeOutput: empty stdout throws', () => {
  assert.throws(() => normalizeOutput('   \n  \n'), /empty stdout/)
})

test('normalizeOutput: dedupes files written multiple times', () => {
  const stream = [
    JSON.stringify({
      type: 'tool_use',
      sessionID: 'ses_d',
      part: { tool: 'write', state: { status: 'completed', input: { filePath: '/repo/dup', content: 'a' } } },
    }),
    JSON.stringify({
      type: 'tool_use',
      sessionID: 'ses_d',
      part: { tool: 'write', state: { status: 'completed', input: { filePath: '/repo/dup', content: 'b' } } },
    }),
  ].join('\n')
  const out = normalizeOutput(stream)
  assert.deepEqual(out.result.files_changed, ['/repo/dup'])
})
