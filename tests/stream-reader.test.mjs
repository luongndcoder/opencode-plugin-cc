import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { readFileSync } from 'node:fs'
import { readChunked, readAll } from '../scripts/stream-reader.mjs'

test('readChunked: 2MB stdout fixture parses all 50K lines', async () => {
  const large = readFileSync(new URL('./fixtures/large-stdout.txt', import.meta.url), 'utf8')
  const lines = []
  await readChunked(Readable.from([large]), (line) => lines.push(line))
  assert.equal(lines.length, 50_000)
  const first = JSON.parse(lines[0])
  assert.equal(first.chunk, 0)
  const last = JSON.parse(lines[49_999])
  assert.equal(last.chunk, 49_999)
})

test('readChunked: handles partial line spanning chunks', async () => {
  const lines = []
  await readChunked(Readable.from(['{"a":1}\n{"b":', '2}\n{"c":3}\n']), (l) => lines.push(l))
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}'])
})

test('readChunked: 10MB synthetic no buffer overflow, completes <30s', async () => {
  const oneMb = ('{"i":0}\n'.repeat(125_000))
  const chunks = Array.from({ length: 10 }, () => oneMb)
  const lines = []
  const t0 = Date.now()
  await readChunked(Readable.from(chunks), (l) => lines.push(l))
  const elapsed = Date.now() - t0
  assert.ok(elapsed < 30_000, `expected <30s, got ${elapsed}ms`)
  assert.ok(lines.length >= 1_250_000)
})

test('readAll: joins all lines into single string', async () => {
  const s = await readAll(Readable.from(['a\nb\n', 'c\n']))
  assert.equal(s, 'a\nb\nc')
})
