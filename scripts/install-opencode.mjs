// Detects the best way to install anomalyco/opencode on the current machine.
//
// This module ONLY produces an install *plan* (which commands are viable given
// the OS + available package managers). It deliberately does NOT run the
// install itself - the /oc-install skill shows the plan, asks the user for
// consent, then runs the chosen command via Bash. Keeping the side effect out
// of here makes the planner pure + unit-testable and avoids silently piping a
// remote script into a shell.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Canonical install methods (https://opencode.ai/docs / anomalyco/opencode README).
const CATALOG = [
  {
    id: 'brew-tap',
    requires: 'brew',
    platforms: ['darwin', 'linux'],
    cmd: 'brew install anomalyco/tap/opencode',
    label: 'Homebrew (anomalyco tap - most up-to-date)',
    needsSudo: false,
  },
  {
    id: 'curl',
    requires: 'curl',
    platforms: ['darwin', 'linux'],
    cmd: 'curl -fsSL https://opencode.ai/install | bash',
    label: 'Official install script (curl | bash) - no Node/Go needed',
    needsSudo: false,
  },
  {
    id: 'npm',
    requires: 'npm',
    platforms: ['darwin', 'linux', 'win32'],
    cmd: 'npm i -g opencode-ai@latest',
    label: 'npm global install',
    needsSudo: false,
  },
  {
    id: 'scoop',
    requires: 'scoop',
    platforms: ['win32'],
    cmd: 'scoop install opencode',
    label: 'Scoop (Windows)',
    needsSudo: false,
  },
  {
    id: 'choco',
    requires: 'choco',
    platforms: ['win32'],
    cmd: 'choco install opencode',
    label: 'Chocolatey (Windows - run shell as admin)',
    needsSudo: false,
  },
]

// Per-platform preference order (first viable = recommended).
const PREFERENCE = {
  darwin: ['brew-tap', 'curl', 'npm'],
  linux: ['curl', 'brew-tap', 'npm'],
  win32: ['scoop', 'choco', 'npm'],
}

const MANUAL = {
  desktop_and_binaries: 'https://github.com/anomalyco/opencode/releases',
  docs: 'https://opencode.ai/docs/',
  install_script: 'curl -fsSL https://opencode.ai/install | bash',
}

/**
 * Build an install plan for a given platform + available commands.
 *
 * @param {{platform: string, has?: Record<string, boolean>}} opts
 *   platform: Node `process.platform` value ('darwin' | 'linux' | 'win32' | ...).
 *   has: map of package-manager command name -> whether it exists on PATH.
 * @returns {{platform, recommended, available, unavailable, manual}}
 */
export function detectInstallPlan({ platform, has = {} }) {
  const order = PREFERENCE[platform] || ['curl', 'npm']
  const byId = Object.fromEntries(CATALOG.map((m) => [m.id, m]))

  const platformMethods = order
    .map((id) => byId[id])
    .filter((m) => m && m.platforms.includes(platform))

  const available = platformMethods.filter((m) => has[m.requires] === true)
  const unavailable = platformMethods.filter((m) => has[m.requires] !== true)

  return {
    platform,
    recommended: available[0] || null,
    available,
    unavailable,
    manual: MANUAL,
  }
}

/**
 * Whether `name` is an executable found on PATH (cross-platform best-effort).
 */
export function hasCommand(name, { platform = process.platform, env = process.env } = {}) {
  const rawPath = env.PATH || env.Path || ''
  const sep = platform === 'win32' ? ';' : ':'
  const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of rawPath.split(sep)) {
    if (!dir) continue
    for (const ext of exts) {
      try {
        if (existsSync(join(dir, name + ext))) return true
      } catch {
        // ignore unreadable PATH entry
      }
    }
  }
  return false
}

// CLI: print the install plan as JSON. Run by the /oc-install skill.
if (import.meta.url === `file://${process.argv[1]}`) {
  const platform = process.platform
  const has = {}
  for (const name of ['brew', 'curl', 'npm', 'scoop', 'choco']) {
    has[name] = hasCommand(name)
  }
  const plan = detectInstallPlan({ platform, has })
  process.stdout.write(JSON.stringify(plan, null, 2) + '\n')
}
