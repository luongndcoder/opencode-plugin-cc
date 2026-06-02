import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readModel, writeModel, modelConfigPath } from '../scripts/model-config.mjs'

function memFs() {
  const store = new Map()
  return {
    store,
    mkdirSync() {},
    readFileSync(p) {
      if (!store.has(p)) {
        const e = new Error(`ENOENT: ${p}`)
        e.code = 'ENOENT'
        throw e
      }
      return store.get(p)
    },
    writeFileSync(p, data) {
      store.set(p, data)
    },
  }
}

test('modelConfigPath: lives under <cwd>/.opencode-plugin/config.json', () => {
  assert.equal(modelConfigPath('/repo'), '/repo/.opencode-plugin/config.json')
})

test('readModel: returns null when no config exists', () => {
  const fs = memFs()
  assert.equal(readModel('/repo', { fs }), null)
})

test('writeModel → readModel round-trips the chosen model', () => {
  const fs = memFs()
  writeModel('/repo', 'opencode/minimax-m3-free', { fs })
  assert.equal(readModel('/repo', { fs }), 'opencode/minimax-m3-free')
})

test('writeModel preserves other config keys', () => {
  const fs = memFs()
  fs.store.set('/repo/.opencode-plugin/config.json', JSON.stringify({ foo: 1 }))
  writeModel('/repo', 'opencode/big-pickle', { fs })
  const cfg = JSON.parse(fs.store.get('/repo/.opencode-plugin/config.json'))
  assert.equal(cfg.foo, 1)
  assert.equal(cfg.model, 'opencode/big-pickle')
})

test('readModel: null when config has no model key', () => {
  const fs = memFs()
  fs.store.set('/repo/.opencode-plugin/config.json', JSON.stringify({ foo: 1 }))
  assert.equal(readModel('/repo', { fs }), null)
})

test('writeModel: throws on empty model', () => {
  const fs = memFs()
  assert.throws(() => writeModel('/repo', '', { fs }), /non-empty string/)
})
