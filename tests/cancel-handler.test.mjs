import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createCancelHandler } from '../scripts/cancel-handler.mjs'

function makeFakeProc() {
  const proc = new EventEmitter()
  proc.pid = 12345
  proc.exit = mock.fn()
  return proc
}

function makeFakeFs() {
  const files = new Map()
  return {
    mkdirSync: mock.fn(),
    writeFileSync: mock.fn((p, c) => files.set(p, String(c))),
    unlinkSync: mock.fn((p) => {
      if (!files.has(p)) {
        const e = new Error('ENOENT')
        e.code = 'ENOENT'
        throw e
      }
      files.delete(p)
    }),
    _files: files,
  }
}

test('install: writes PID file and registers SIGINT + SIGTERM listeners', () => {
  const proc = makeFakeProc()
  const fs = makeFakeFs()
  const ac = new AbortController()
  const handler = createCancelHandler({
    pidFile: '/tmp/test/active.pid',
    abortController: ac,
    onTrace: () => {},
    proc,
    fs,
  })
  handler.install()
  assert.equal(fs.writeFileSync.mock.calls.length, 1)
  assert.equal(fs._files.get('/tmp/test/active.pid'), '12345')
  assert.equal(handler._isInstalled(), true)
  assert.equal(proc.listenerCount('SIGINT'), 1)
  assert.equal(proc.listenerCount('SIGTERM'), 1)
})

test('SIGINT triggers abort + cleanup + exit 130 + trace event', () => {
  const proc = makeFakeProc()
  const fs = makeFakeFs()
  const ac = new AbortController()
  const traces = []
  const handler = createCancelHandler({
    pidFile: '/tmp/test/active.pid',
    abortController: ac,
    onTrace: (e) => traces.push(e),
    proc,
    fs,
  })
  handler.install()
  handler._triggerForTest('SIGINT')
  assert.equal(ac.signal.aborted, true)
  assert.equal(fs.unlinkSync.mock.calls.length, 1)
  assert.deepEqual(proc.exit.mock.calls[0].arguments, [130])
  assert.equal(traces.length, 1)
  assert.equal(traces[0].event, 'cancel')
  assert.equal(traces[0].signal, 'SIGINT')
})

test('SIGTERM triggers abort + exit 143', () => {
  const proc = makeFakeProc()
  const fs = makeFakeFs()
  const ac = new AbortController()
  const handler = createCancelHandler({
    pidFile: '/tmp/test/active.pid',
    abortController: ac,
    onTrace: () => {},
    proc,
    fs,
  })
  handler.install()
  handler._triggerForTest('SIGTERM')
  assert.deepEqual(proc.exit.mock.calls[0].arguments, [143])
})

test('uninstall: removes listeners + unlinks PID file', () => {
  const proc = makeFakeProc()
  const fs = makeFakeFs()
  const ac = new AbortController()
  const handler = createCancelHandler({
    pidFile: '/tmp/test/active.pid',
    abortController: ac,
    onTrace: () => {},
    proc,
    fs,
  })
  handler.install()
  handler.uninstall()
  assert.equal(handler._isInstalled(), false)
  assert.equal(proc.listenerCount('SIGINT'), 0)
  assert.equal(proc.listenerCount('SIGTERM'), 0)
  assert.equal(fs.unlinkSync.mock.calls.length, 1)
  assert.equal(fs._files.size, 0)
})

test('uninstall: idempotent — second call is no-op', () => {
  const proc = makeFakeProc()
  const fs = makeFakeFs()
  const handler = createCancelHandler({
    pidFile: '/tmp/test/active.pid',
    abortController: new AbortController(),
    onTrace: () => {},
    proc,
    fs,
  })
  handler.install()
  handler.uninstall()
  handler.uninstall() // should not throw
  assert.equal(handler._isInstalled(), false)
})
