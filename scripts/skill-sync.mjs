// Bridge project-local Claude Code skills into opencode's skill discovery.
//
// opencode (>= 1.15) auto-discovers skills from three GLOBAL roots only:
//   ~/.claude/skills, ~/.agents/skills, ~/.config/opencode/skills
// It does NOT discover project-local <cwd>/.claude/skills. The global Mobio
// be-* skills therefore already work in opencode with no action. This module
// makes a project's LOCAL skills available too, by symlinking each
// <cwd>/.claude/skills/<name> into ~/.config/opencode/skills/<name>, and records
// a manifest so the links can be removed cleanly later (`clean`).
//
// Safety properties:
//   - never clobber a name that already exists in ANY global root
//     (opencode would dedup-ignore it anyway) -> reported as a collision, skipped.
//   - `clean` removes ONLY symlinks we created (must be a symlink that resolves
//     into this project's .claude/skills) -> never deletes real dirs or foreign links.
//   - no-op when <cwd>/.claude/skills is absent or empty (the common case).

import {
  existsSync as defaultExistsSync,
  readdirSync as defaultReaddirSync,
  lstatSync as defaultLstatSync,
  realpathSync as defaultRealpathSync,
  symlinkSync as defaultSymlinkSync,
  unlinkSync as defaultUnlinkSync,
  mkdirSync as defaultMkdirSync,
  readFileSync as defaultReadFileSync,
  writeFileSync as defaultWriteFileSync,
  rmSync as defaultRmSync,
} from 'node:fs'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'

const defaultFs = {
  existsSync: defaultExistsSync,
  readdirSync: defaultReaddirSync,
  lstatSync: defaultLstatSync,
  realpathSync: defaultRealpathSync,
  symlinkSync: defaultSymlinkSync,
  unlinkSync: defaultUnlinkSync,
  mkdirSync: defaultMkdirSync,
  readFileSync: defaultReadFileSync,
  writeFileSync: defaultWriteFileSync,
  rmSync: defaultRmSync,
}

/** opencode's global skills directory (XDG-aware, matches `opencode debug paths`). */
export function opencodeSkillsDir({ env = process.env } = {}) {
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length ? env.XDG_CONFIG_HOME : null
  const cfg = xdg || join(env.HOME || homedir(), '.config')
  return join(cfg, 'opencode', 'skills')
}

/** The three global roots opencode scans for skills. */
export function globalSkillRoots({ env = process.env } = {}) {
  const home = env.HOME || homedir()
  return [join(home, '.claude', 'skills'), join(home, '.agents', 'skills'), opencodeSkillsDir({ env })]
}

export function projectSkillsDir(cwd) {
  return join(cwd, '.claude', 'skills')
}

function manifestPath(cwd) {
  return join(cwd, '.opencode-plugin', 'synced-skills.json')
}

// --- internal helpers -------------------------------------------------------

function tryReal(p, fs) {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

/** Resolved final target if `p` is a symlink, else null. */
function linkTarget(p, fs) {
  try {
    const st = fs.lstatSync(p)
    if (!st.isSymbolicLink()) return null
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

/** Names of skill dirs (containing SKILL.md) directly under `root`. */
function listSkillDirs(root, fs) {
  if (!fs.existsSync(root)) return []
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const e of entries) {
    const name = e.name
    if (name.startsWith('.')) continue
    const dir = join(root, name)
    if (fs.existsSync(join(dir, 'SKILL.md'))) out.push({ name, dir })
  }
  return out
}

function readManifest(cwd, { fs = defaultFs } = {}) {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath(cwd), 'utf8'))
    if (m && Array.isArray(m.links)) return m
  } catch {
    // missing/corrupt -> empty
  }
  return { links: [] }
}

function writeManifest(cwd, data, { fs = defaultFs } = {}) {
  const p = manifestPath(cwd)
  fs.mkdirSync(dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n')
  return p
}

// --- public API -------------------------------------------------------------

/** Skill names already present in any global root (opencode dedups by name). */
export function existingGlobalNames({ fs = defaultFs, env = process.env } = {}) {
  const names = new Set()
  for (const root of globalSkillRoots({ env })) {
    for (const s of listSkillDirs(root, fs)) names.add(s.name)
  }
  return names
}

/** Project-local Claude Code skills under <cwd>/.claude/skills. */
export function listProjectSkills(cwd, { fs = defaultFs } = {}) {
  return listSkillDirs(projectSkillsDir(cwd), fs).map((s) => ({ name: s.name, src: s.dir }))
}

/**
 * Compute what a sync would do — pure inspection, no writes.
 * @returns {{ target, projectDir, toLink: {name,src,dest}[], collisions: string[], already: string[] }}
 */
export function planSync(cwd, { fs = defaultFs, env = process.env } = {}) {
  const target = opencodeSkillsDir({ env })
  const project = listProjectSkills(cwd, { fs })
  const globalNames = existingGlobalNames({ fs, env })
  const toLink = []
  const collisions = []
  const already = []
  for (const s of project) {
    const dest = join(target, s.name)
    const lt = linkTarget(dest, fs)
    const srcReal = tryReal(s.src, fs)
    if (lt && srcReal && lt === srcReal) {
      already.push(s.name) // our own link to the same source -> idempotent
      continue
    }
    if (globalNames.has(s.name)) {
      collisions.push(s.name) // a different skill owns this name -> skip, don't clobber
      continue
    }
    toLink.push({ name: s.name, src: s.src, dest })
  }
  return { target, projectDir: projectSkillsDir(cwd), toLink, collisions, already }
}

/** Create the symlinks from planSync and record a manifest. */
export function applySync(cwd, { fs = defaultFs, env = process.env } = {}) {
  const plan = planSync(cwd, { fs, env })
  const linked = []
  const failed = []
  if (plan.toLink.length > 0) fs.mkdirSync(plan.target, { recursive: true })
  for (const item of plan.toLink) {
    try {
      fs.symlinkSync(item.src, item.dest)
      linked.push({ name: item.name, dest: item.dest, src: item.src })
    } catch (e) {
      failed.push({ name: item.name, reason: e.message })
    }
  }
  // Merge into manifest (newly linked + ones already linked by us).
  const byName = new Map(readManifest(cwd, { fs }).links.map((l) => [l.name, l]))
  for (const l of linked) byName.set(l.name, l)
  for (const name of plan.already) {
    if (!byName.has(name)) byName.set(name, { name, dest: join(plan.target, name), src: join(plan.projectDir, name) })
  }
  if (byName.size > 0 || existsManifest(cwd, fs)) {
    writeManifest(cwd, { target: plan.target, links: [...byName.values()] }, { fs })
  }
  return { target: plan.target, linked, already: plan.already, collisions: plan.collisions, failed }
}

function existsManifest(cwd, fs) {
  try {
    return fs.existsSync(manifestPath(cwd))
  } catch {
    return false
  }
}

/** Remove only the symlinks we created (per manifest), then drop the manifest. */
export function cleanSync(cwd, { fs = defaultFs } = {}) {
  const manifest = readManifest(cwd, { fs })
  const projReal = tryReal(projectSkillsDir(cwd), fs)
  const removed = []
  const skipped = []
  for (const l of manifest.links) {
    let st
    try {
      st = fs.lstatSync(l.dest)
    } catch {
      continue // already gone
    }
    if (!st.isSymbolicLink()) {
      skipped.push({ name: l.name, reason: 'not-a-symlink' })
      continue
    }
    const lt = linkTarget(l.dest, fs)
    if (lt && projReal && lt.startsWith(projReal)) {
      try {
        fs.unlinkSync(l.dest)
        removed.push(l.name)
      } catch (e) {
        skipped.push({ name: l.name, reason: e.message })
      }
    } else {
      skipped.push({ name: l.name, reason: 'points-elsewhere' })
    }
  }
  try {
    fs.rmSync(manifestPath(cwd))
  } catch {
    // no manifest to remove
  }
  return { removed, skipped }
}

// CLI: node scripts/skill-sync.mjs <plan|apply|clean|list-project> [cwd]
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , action, cwdArg] = process.argv
  const cwd = cwdArg ? resolvePath(cwdArg) : process.cwd()
  const out = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n')
  if (action === 'plan') out(planSync(cwd))
  else if (action === 'apply') out(applySync(cwd))
  else if (action === 'clean') out(cleanSync(cwd))
  else if (action === 'list-project') out({ skills: listProjectSkills(cwd) })
  else {
    process.stderr.write('usage: node scripts/skill-sync.mjs <plan|apply|clean|list-project> [cwd]\n')
    process.exit(2)
  }
}
