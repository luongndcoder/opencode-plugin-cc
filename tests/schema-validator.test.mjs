import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validate } from '../scripts/schema-validator.mjs'

const successFixture = JSON.parse(
  readFileSync(new URL('./fixtures/opencode-output-success.json', import.meta.url), 'utf8'),
)
const malformedFixture = JSON.parse(
  readFileSync(new URL('./fixtures/opencode-output-malformed.json', import.meta.url), 'utf8'),
)

test('validate: success fixture passes schema', () => {
  const result = validate(successFixture)
  assert.equal(result.valid, true)
  assert.equal(result.errors, null)
})

test('validate: missing required field session_id fails', () => {
  const result = validate(malformedFixture)
  assert.equal(result.valid, false)
  assert.ok(Array.isArray(result.errors))
  assert.match(JSON.stringify(result.errors), /session_id/)
})

test('validate: additional properties allowed (forward-compat)', () => {
  const result = validate({
    session_id: 's1',
    status: 'completed',
    result: { diff: 'x' },
    new_anomalyco_field: 'whatever',
  })
  assert.equal(result.valid, true)
})

test('validate: invalid status enum fails', () => {
  const result = validate({ session_id: 's1', status: 'wat' })
  assert.equal(result.valid, false)
  assert.match(JSON.stringify(result.errors), /status|enum/)
})
