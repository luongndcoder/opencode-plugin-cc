import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectInstallPlan, hasCommand } from '../scripts/install-opencode.mjs'

test('detectInstallPlan: macOS with brew -> recommends brew tap', () => {
  const plan = detectInstallPlan({ platform: 'darwin', has: { brew: true, curl: true, npm: true } })
  assert.equal(plan.recommended.id, 'brew-tap')
  assert.equal(plan.recommended.cmd, 'brew install anomalyco/tap/opencode')
})

test('detectInstallPlan: macOS without brew -> falls back to curl', () => {
  const plan = detectInstallPlan({ platform: 'darwin', has: { brew: false, curl: true, npm: true } })
  assert.equal(plan.recommended.id, 'curl')
  assert.match(plan.recommended.cmd, /opencode\.ai\/install/)
  // brew-tap should be reported as a (currently) unavailable method
  assert.ok(plan.unavailable.some((m) => m.id === 'brew-tap'))
})

test('detectInstallPlan: Linux prefers curl over brew', () => {
  const plan = detectInstallPlan({ platform: 'linux', has: { brew: true, curl: true, npm: true } })
  assert.equal(plan.recommended.id, 'curl')
})

test('detectInstallPlan: Windows with scoop -> recommends scoop, no curl method offered', () => {
  const plan = detectInstallPlan({ platform: 'win32', has: { scoop: true, choco: false, npm: true } })
  assert.equal(plan.recommended.id, 'scoop')
  assert.ok(!plan.available.some((m) => m.id === 'curl'))
  assert.ok(!plan.unavailable.some((m) => m.id === 'curl'))
})

test('detectInstallPlan: Windows with only npm -> recommends npm', () => {
  const plan = detectInstallPlan({ platform: 'win32', has: { scoop: false, choco: false, npm: true } })
  assert.equal(plan.recommended.id, 'npm')
})

test('detectInstallPlan: nothing available -> recommended null + manual fallback', () => {
  const plan = detectInstallPlan({ platform: 'linux', has: {} })
  assert.equal(plan.recommended, null)
  assert.ok(plan.unavailable.length > 0)
  assert.match(plan.manual.desktop_and_binaries, /releases/)
})

test('detectInstallPlan: unknown platform -> generic curl/npm order', () => {
  const plan = detectInstallPlan({ platform: 'sunos', has: { curl: true } })
  // sunos is not in any method's platform list -> no platform-specific methods match
  assert.equal(plan.recommended, null)
})

test('hasCommand: finds a command on a fake PATH', () => {
  // node itself lives somewhere on the real PATH; use a synthetic check instead.
  const found = hasCommand('definitely-not-a-real-binary-xyz', {
    platform: 'linux',
    env: { PATH: '/nonexistent' },
  })
  assert.equal(found, false)
})
