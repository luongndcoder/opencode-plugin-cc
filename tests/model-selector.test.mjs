import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import {
  parseVerboseModels,
  pickFree,
  selectFreeModel,
  listFreeModels,
  listAllModels,
  NoFreeModelError,
} from '../scripts/model-selector.mjs'

function makeFakeChild({ stdout = '', stderr = '', exitCode = 0 } = {}) {
  const child = new EventEmitter()
  child.stdout = Readable.from([stdout])
  child.stderr = Readable.from([stderr])
  child.kill = mock.fn()
  queueMicrotask(() => child.emit('close', exitCode))
  return child
}

function fakeSpawn(opts = {}) {
  return mock.fn(() => makeFakeChild(opts))
}

// Mirrors real `opencode models --verbose`: header line `<provider>/<model>` then pretty JSON.
const VERBOSE_SAMPLE = `opencode/big-pickle
{
  "id": "big-pickle",
  "providerID": "opencode",
  "cost": { "input": 0, "output": 0, "cache": { "read": 0, "write": 0 } },
  "limit": { "context": 200000 },
  "capabilities": { "toolcall": true }
}
opencode-go/deepseek-v4-flash
{
  "id": "deepseek-v4-flash",
  "providerID": "opencode-go",
  "cost": { "input": 0, "output": 0.3 },
  "limit": { "context": 200000 },
  "capabilities": { "toolcall": true }
}
opencode/minimax-m3-free
{
  "id": "minimax-m3-free",
  "providerID": "opencode",
  "cost": { "input": 0, "output": 0 },
  "limit": { "context": 200000 },
  "capabilities": { "toolcall": true }
}`

test('parseVerboseModels: extracts id + cost + toolcall for each model', () => {
  const models = parseVerboseModels(VERBOSE_SAMPLE)
  assert.equal(models.length, 3)
  const byId = Object.fromEntries(models.map((m) => [m.id, m]))
  assert.equal(byId['opencode/big-pickle'].cost.input, 0)
  assert.equal(byId['opencode/big-pickle'].cost.output, 0)
  assert.equal(byId['opencode/big-pickle'].toolcall, true)
  assert.equal(byId['opencode-go/deepseek-v4-flash'].cost.output, 0.3)
})

test('parseVerboseModels: skips an unparseable block, keeps the rest', () => {
  const text = `opencode/broken
{ this is not json
opencode/ok-free
{
  "id": "ok-free",
  "cost": { "input": 0, "output": 0 },
  "capabilities": { "toolcall": true }
}`
  const models = parseVerboseModels(text)
  assert.equal(models.length, 1)
  assert.equal(models[0].id, 'opencode/ok-free')
})

test('pickFree: input==0 but output>0 is NOT free (input-only-free provider)', () => {
  const models = [
    { id: 'opencode-go/x', cost: { input: 0, output: 0.3 }, toolcall: true },
  ]
  assert.equal(pickFree(models), null)
})

test('pickFree: returns preferred model when several free ones exist', () => {
  const models = parseVerboseModels(VERBOSE_SAMPLE)
  // big-pickle is first in PREFERENCE → chosen over minimax-m3-free.
  assert.equal(pickFree(models), 'opencode/big-pickle')
})

test('pickFree: prefers a tool-capable free model when one exists', () => {
  const models = [
    { id: 'opencode/z-no-tool', cost: { input: 0, output: 0 }, toolcall: false },
    { id: 'opencode/a-tool', cost: { input: 0, output: 0 }, toolcall: true },
  ]
  // neither is in PREFERENCE → among tool-capable, alphabetical → a-tool
  assert.equal(pickFree(models), 'opencode/a-tool')
})

test('pickFree: returns null when no model is free', () => {
  const models = [
    { id: 'p/paid1', cost: { input: 1, output: 2 }, toolcall: true },
    { id: 'p/paid2', cost: { input: 0, output: 5 }, toolcall: true },
  ]
  assert.equal(pickFree(models), null)
})

test('selectFreeModel: concrete provider/model passes through, spawn NOT called', async () => {
  const spawn = mock.fn(() => {
    throw new Error('spawn must not be called for a concrete model')
  })
  const out = await selectFreeModel({ requested: 'opencode/custom-model', spawn })
  assert.equal(out, 'opencode/custom-model')
  assert.equal(spawn.mock.calls.length, 0)
})

test('selectFreeModel: "free" sentinel auto-picks from opencode models', async () => {
  const spawn = fakeSpawn({ stdout: VERBOSE_SAMPLE })
  const out = await selectFreeModel({ requested: 'free', spawn })
  assert.equal(out, 'opencode/big-pickle')
  // verifies it invoked `opencode models --verbose`
  const args = spawn.mock.calls[0].arguments[1]
  assert.deepEqual(args, ['models', '--verbose'])
})

test('selectFreeModel: undefined requested auto-picks too', async () => {
  const spawn = fakeSpawn({ stdout: VERBOSE_SAMPLE })
  const out = await selectFreeModel({ requested: undefined, spawn })
  assert.equal(out, 'opencode/big-pickle')
})

test('listFreeModels: returns only free models, preference-ordered, with metadata', async () => {
  const spawn = fakeSpawn({ stdout: VERBOSE_SAMPLE })
  const models = await listFreeModels({ spawn })
  // VERBOSE_SAMPLE: big-pickle (free), deepseek-v4-flash (input-free/output-paid → NOT free),
  // minimax-m3-free (free)
  assert.deepEqual(
    models.map((m) => m.id),
    ['opencode/big-pickle', 'opencode/minimax-m3-free'],
  )
  assert.equal(models[0].toolcall, true)
  assert.equal(models[0].context, 200000)
})

test('listAllModels: includes paid models with cost + free flag, free group first', async () => {
  const spawn = fakeSpawn({ stdout: VERBOSE_SAMPLE })
  const models = await listAllModels({ spawn })
  assert.equal(models.length, 3)
  // free first (big-pickle, minimax-m3-free), then paid (deepseek-v4-flash)
  assert.deepEqual(
    models.map((m) => m.id),
    ['opencode/big-pickle', 'opencode/minimax-m3-free', 'opencode-go/deepseek-v4-flash'],
  )
  assert.equal(models[0].free, true)
  assert.equal(models[2].free, false)
  assert.equal(models[2].output, 0.3)
})

test('listAllModels: paid models sorted cheapest first', async () => {
  // synthetic verbose output with two paid models of differing cost
  const verbose = `opencode-go/expensive
{ "id": "expensive", "cost": { "input": 1, "output": 2 }, "capabilities": { "toolcall": true } }
opencode-go/cheap
{ "id": "cheap", "cost": { "input": 0, "output": 0.3 }, "capabilities": { "toolcall": true } }`
  const spawn = fakeSpawn({ stdout: verbose })
  const models = await listAllModels({ spawn })
  assert.deepEqual(
    models.map((m) => m.id),
    ['opencode-go/cheap', 'opencode-go/expensive'],
  )
})

test('selectFreeModel: throws NoFreeModelError when no free model found', async () => {
  const paidOnly = `p/paid
{
  "id": "paid",
  "cost": { "input": 1, "output": 2 },
  "capabilities": { "toolcall": true }
}`
  const spawn = fakeSpawn({ stdout: paidOnly })
  await assert.rejects(
    () => selectFreeModel({ requested: 'auto', spawn }),
    (err) => err instanceof NoFreeModelError,
  )
})
