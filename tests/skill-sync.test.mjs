import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  lstatSync,
  realpathSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  opencodeSkillsDir,
  globalSkillRoots,
  projectSkillsDir,
  listProjectSkills,
  planSync,
  applySync,
  cleanSync,
} from '../scripts/skill-sync.mjs'

// --- pure path tests (no fs) -----------------------------------------------

test('opencodeSkillsDir: honors XDG_CONFIG_HOME', () => {
  assert.equal(opencodeSkillsDir({ env: { XDG_CONFIG_HOME: '/x/cfg' } }), '/x/cfg/opencode/skills')
})

test('opencodeSkillsDir: falls back to $HOME/.config', () => {
  assert.equal(opencodeSkillsDir({ env: { HOME: '/home/u' } }), '/home/u/.config/opencode/skills')
})

test('globalSkillRoots: scans the three opencode roots', () => {
  const roots = globalSkillRoots({ env: { HOME: '/home/u' } })
  assert.deepEqual(roots, [
    '/home/u/.claude/skills',
    '/home/u/.agents/skills',
    '/home/u/.config/opencode/skills',
  ])
})

// --- integration tests (real fs in tmpdir) ---------------------------------

function scaffold() {
  const root = mkdtempSync(join(tmpdir(), 'oc-skillsync-'))
  const cwd = join(root, 'proj')
  const cfg = join(root, 'cfg') // -> XDG_CONFIG_HOME, so target = cfg/opencode/skills
  const home = join(root, 'home') // empty global roots
  mkdirSync(cwd, { recursive: true })
  mkdirSync(cfg, { recursive: true })
  mkdirSync(home, { recursive: true })
  const env = { XDG_CONFIG_HOME: cfg, HOME: home }
  return { root, cwd, cfg, home, env, target: join(cfg, 'opencode', 'skills') }
}

function addProjectSkill(cwd, name, body = '# x') {
  const dir = join(projectSkillsDir(cwd), name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: test skill ${name}\n---\n${body}\n`)
  return dir
}

test('listProjectSkills: finds SKILL.md dirs, ignores dotfiles + non-skill dirs', () => {
  const s = scaffold()
  try {
    addProjectSkill(s.cwd, 'proj-a')
    mkdirSync(join(projectSkillsDir(s.cwd), 'not-a-skill'), { recursive: true }) // no SKILL.md
    mkdirSync(join(projectSkillsDir(s.cwd), '.hidden'), { recursive: true })
    const names = listProjectSkills(s.cwd).map((x) => x.name).sort()
    assert.deepEqual(names, ['proj-a'])
  } finally {
    rmSync(s.root, { recursive: true, force: true })
  }
})

test('planSync: no project skills -> empty plan (no-op)', () => {
  const s = scaffold()
  try {
    const plan = planSync(s.cwd, { env: s.env })
    assert.deepEqual(plan.toLink, [])
    assert.deepEqual(plan.collisions, [])
  } finally {
    rmSync(s.root, { recursive: true, force: true })
  }
})

test('applySync: symlinks project skill into opencode target + writes manifest', () => {
  const s = scaffold()
  try {
    const src = addProjectSkill(s.cwd, 'proj-a')
    const res = applySync(s.cwd, { env: s.env })
    assert.deepEqual(
      res.linked.map((l) => l.name),
      ['proj-a'],
    )
    const dest = join(s.target, 'proj-a')
    assert.ok(lstatSync(dest).isSymbolicLink(), 'dest is a symlink')
    assert.equal(realpathSync(dest), realpathSync(src), 'symlink resolves to project skill')
    // manifest persisted
    const manifest = JSON.parse(
      readFileSync(join(s.cwd, '.opencode-plugin', 'synced-skills.json'), 'utf8'),
    )
    assert.equal(manifest.links.length, 1)
    assert.equal(manifest.links[0].name, 'proj-a')
  } finally {
    rmSync(s.root, { recursive: true, force: true })
  }
})

test('applySync: idempotent - re-apply reports already, no duplicate', () => {
  const s = scaffold()
  try {
    addProjectSkill(s.cwd, 'proj-a')
    applySync(s.cwd, { env: s.env })
    const second = applySync(s.cwd, { env: s.env })
    assert.deepEqual(second.linked, [])
    assert.deepEqual(second.already, ['proj-a'])
  } finally {
    rmSync(s.root, { recursive: true, force: true })
  }
})

test('planSync: collision - a foreign skill already owns the name -> skipped, not clobbered', () => {
  const s = scaffold()
  try {
    addProjectSkill(s.cwd, 'dup')
    // pre-existing foreign skill of the same name in the opencode target
    const foreign = join(s.target, 'dup')
    mkdirSync(foreign, { recursive: true })
    writeFileSync(join(foreign, 'SKILL.md'), '---\nname: dup\ndescription: foreign\n---\n# foreign\n')
    const plan = planSync(s.cwd, { env: s.env })
    assert.deepEqual(plan.toLink, [])
    assert.deepEqual(plan.collisions, ['dup'])
    // foreign skill untouched (still a real dir, not replaced by a symlink)
    assert.ok(lstatSync(foreign).isDirectory())
  } finally {
    rmSync(s.root, { recursive: true, force: true })
  }
})

test('cleanSync: removes our symlinks + manifest, leaves foreign entries', () => {
  const s = scaffold()
  try {
    addProjectSkill(s.cwd, 'proj-a')
    applySync(s.cwd, { env: s.env })
    // also inject a manifest entry pointing elsewhere -> must be skipped
    mkdirSync(join(s.root, 'elsewhere'), { recursive: true })
    const foreignLink = join(s.target, 'foreign')
    symlinkSync(join(s.root, 'elsewhere'), foreignLink)
    // hand-craft manifest containing both
    writeFileSync(
      join(s.cwd, '.opencode-plugin', 'synced-skills.json'),
      JSON.stringify({
        target: s.target,
        links: [
          { name: 'proj-a', dest: join(s.target, 'proj-a') },
          { name: 'foreign', dest: foreignLink },
        ],
      }),
    )
    const res = cleanSync(s.cwd)
    assert.deepEqual(res.removed, ['proj-a'])
    assert.equal(res.skipped[0].name, 'foreign')
    assert.equal(res.skipped[0].reason, 'points-elsewhere')
    // our link gone, foreign link still there
    assert.throws(() => lstatSync(join(s.target, 'proj-a')))
    assert.ok(lstatSync(foreignLink).isSymbolicLink())
  } finally {
    rmSync(s.root, { recursive: true, force: true })
  }
})
