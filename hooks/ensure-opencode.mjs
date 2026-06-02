#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const result = spawnSync('opencode', ['--version'], { encoding: 'utf8' })

if (result.error?.code === 'ENOENT') {
  console.error(
    '[opencode-plugin-cc] WARN: `opencode` CLI not found in PATH.\n' +
      '  Run /opencode-plugin-cc:oc-install to install it (detects brew / curl / npm and asks before running).\n' +
      '  Or install manually: https://github.com/anomalyco/opencode  (required: >= 1.2.0)',
  )
  process.exit(0)
}

const version = (result.stdout || '').trim()
const m = version.match(/(\d+)\.(\d+)\.(\d+)/)
if (m) {
  const [major, minor] = m.slice(1).map(Number)
  if (major < 1 || (major === 1 && minor < 2)) {
    console.error(
      `[opencode-plugin-cc] WARN: opencode version ${version} < 1.2.0. Plugin may misbehave.\n` +
        '  Upgrade via /opencode-plugin-cc:oc-install (or `opencode upgrade`).',
    )
  }
}

process.exit(0)
