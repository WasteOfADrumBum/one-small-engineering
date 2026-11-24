// The canonical policy source (ai-standards/) and everything rendered from it.
// loadSource reads and checks the source; the render* functions are pure.

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { validateAgainstSchema, findSensitive } from '../validate-registry.mjs'
import {
  SOURCE_DIR, TARGET_DIR, PROJECT_FILE, SEMVER, coreRules, parseFrontMatter, readJsonFile,
  renderTemplate, sha256, wrapBlock, normalizeEol
} from './lib.mjs'

export class SourceError extends Error {
  constructor(problems) {
    super(`policy source is invalid:\n  - ${problems.join('\n  - ')}`)
    this.problems = problems
  }
}

// Reads the source. Returns { dir, manifest, policies, templates, problems }. Problems are
// integrity or format errors; callers that write to a target refuse to run when there are any.
export function loadSource(dir = SOURCE_DIR) {
  const problems = []
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) throw new SourceError([`missing ${manifestPath}`])
  const manifest = readJsonFile(manifestPath)
  const schemaPath = join(dir, 'schemas/manifest.schema.json')
  if (existsSync(schemaPath)) {
    for (const e of validateAgainstSchema(manifest, readJsonFile(schemaPath))) problems.push(`manifest.json ${e}`)
  } else problems.push('missing schemas/manifest.schema.json')
  if (problems.length) return { dir, manifest, policies: [], templates: {}, problems }

  const policies = []
  const seen = new Set()
  for (const entry of manifest.policies) {
    const path = resolve(dir, entry.file)
    if (!existsSync(path)) { problems.push(`policy ${entry.id}: missing source file ${entry.file}`); continue }
    const text = normalizeEol(readFileSync(path, 'utf8'))
    if (seen.has(entry.id)) problems.push(`policy ${entry.id}: duplicate id`)
    seen.add(entry.id)
    if (sha256(text) !== entry.sha256) problems.push(`policy ${entry.id}: ${entry.file} does not match its recorded checksum; policy text changed without a version bump (run: ose ai bump --level <patch|minor|major>)`)
    let fm
    try { fm = parseFrontMatter(text) } catch (e) { problems.push(`policy ${entry.id}: ${e.message}`); continue }
    if (fm.data.id !== entry.id) problems.push(`policy ${entry.id}: front matter id is "${fm.data.id ?? ''}"`)
    if (!fm.data.title) problems.push(`policy ${entry.id}: front matter has no title`)
    const rules = coreRules(fm.body)
    if (!rules.length) problems.push(`policy ${entry.id}: no "## Core rules" bullets`)
    const sensitive = findSensitive(text)
    if (sensitive.length) problems.push(`policy ${entry.id}: contains possible sensitive data (${sensitive.join(', ')})`)
    policies.push({ id: entry.id, file: entry.file, title: fm.data.title || entry.id, text, body: fm.body, rules, targetPath: `${TARGET_DIR}/shared/${entry.id}.md` })
  }

  const templates = {}
  for (const entry of manifest.templates) {
    const path = resolve(dir, entry.file)
    if (!existsSync(path)) { problems.push(`template ${entry.id}: missing source file ${entry.file}`); continue }
    const text = normalizeEol(readFileSync(path, 'utf8'))
    if (sha256(text) !== entry.sha256) problems.push(`template ${entry.id}: ${entry.file} does not match its recorded checksum (run: ose ai bump --level <patch|minor|major>)`)
    templates[entry.id] = text
  }
  for (const a of manifest.adapters) {
    if (!templates[a.template] && !manifest.templates.some(t => t.id === a.template)) problems.push(`adapter ${a.id}: unknown template ${a.template}`)
  }
  if (!manifest.templates.some(t => t.id === manifest.projectTemplate)) problems.push(`projectTemplate ${manifest.projectTemplate} is not a listed template`)
  for (const id of manifest.defaultAdapters) if (!manifest.adapters.some(a => a.id === id)) problems.push(`defaultAdapters: unknown adapter ${id}`)
  const ids = manifest.adapters.map(a => a.id)
  if (new Set(ids).size !== ids.length) problems.push('adapters: duplicate id')
  const paths = manifest.adapters.map(a => a.path.toLowerCase())
  if (new Set(paths).size !== paths.length) problems.push('adapters: two adapters write the same path')
  for (const a of manifest.adapters) {
    if (a.kind === 'file' && !a.path.startsWith(`${TARGET_DIR}/`)) problems.push(`adapter ${a.id}: whole-file adapters must write inside ${TARGET_DIR}/`)
    if (a.path.includes('..') || a.path.startsWith('/')) problems.push(`adapter ${a.id}: path must be relative inside the repository`)
  }
  return { dir, manifest, policies, templates, problems }
}

export function requireValidSource(dir) {
  const source = loadSource(dir)
  if (source.problems.length) throw new SourceError(source.problems)
  return source
}

export function adapterById(source, id) {
  return source.manifest.adapters.find(a => a.id === id)
}

// Every valid adapter selection is a subset of the manifest's adapters.
export function resolveAdapters(source, requested) {
  const list = requested && requested.length ? requested : source.manifest.defaultAdapters
  const unknown = list.filter(id => !adapterById(source, id))
  if (unknown.length) {
    throw new Error(`unsupported agent adapter(s): ${unknown.join(', ')}. Supported: ${source.manifest.adapters.map(a => a.id).join(', ')}`)
  }
  return [...new Set(list)]
}

export function renderCoreRules(source) {
  return source.policies.map(p => `### ${p.title} (\`.ai/shared/${p.id}.md\`)\n\n${p.rules.map(r => `- ${r}`).join('\n')}`).join('\n\n')
}

export const policyIndex = source => source.policies.map(p => `\`${p.id}.md\``).join(', ')

export function renderBlock(source, adapterId) {
  const a = adapterById(source, adapterId)
  if (!a || a.kind !== 'block') throw new Error(`adapter ${adapterId} is not a block adapter`)
  const body = renderTemplate(source.templates[a.template], {
    version: source.manifest.policyVersion,
    coreRules: renderCoreRules(source),
    policyIndex: policyIndex(source)
  }, a.template)
  return wrapBlock(body)
}

export function renderSharedFile(source, policy) {
  const header = `<!-- Managed by One Small Engineering (${source.manifest.id} ${source.manifest.policyVersion}). Do not edit: put project rules in ${PROJECT_FILE}. ose ai sync refreshes this file only while it is unmodified. -->\n\n`
  return header + policy.body.replace(/\n*$/, '\n')
}

// Project rules for the ChatGPT file: .ai/project.md without its top-level heading.
export function projectRulesText(projectMd) {
  if (!projectMd || !projectMd.trim()) return 'No project-specific rules are recorded yet.'
  return normalizeEol(projectMd).replace(/^# .*\n+/, '').replace(/^## /gm, '### ').trim()
}

export function renderChatgpt(source, { projectName, projectMd }) {
  const a = source.manifest.adapters.find(x => x.id === 'chatgpt')
  return renderTemplate(source.templates[a.template], {
    projectName,
    version: source.manifest.policyVersion,
    projectRules: projectRulesText(projectMd),
    coreRules: renderCoreRules(source)
  }, a.template).replace(/\n*$/, '\n')
}

export function renderGitignore() {
  return '# Managed by One Small Engineering ai-standards: transient files from ose ai.\n.lock\n*.ose-tmp\n'
}

// Seed for .ai/project.md, built from what the repository already contains.
export function renderProject(source, ctx) {
  const tpl = source.templates[source.manifest.projectTemplate]
  const list = (items, empty) => (items.length ? items.map(i => `- ${i}`).join('\n') : empty)
  return renderTemplate(tpl, {
    projectName: ctx.projectName,
    existingInstructions: list(ctx.existingInstructions.map(f => `\`${f}\`: project text outside the managed blocks. It stays authoritative for this project; read it.`), '- None recorded at install.'),
    stack: list(ctx.stack, '- Not detected at install. Describe the stack here.'),
    commands: list(ctx.commands.map(c => `\`${c.command}\`${c.purpose ? `: ${c.purpose}` : ''}`), '- No package scripts detected. List the commands that verify a change here.')
  }, source.manifest.projectTemplate).replace(/\n*$/, '\n')
}

// Detection for the project seed. Reads only package metadata, never source code.
const FRAMEWORKS = [
  ['next', 'Next.js'], ['astro', 'Astro'], ['@remix-run/react', 'Remix'], ['nuxt', 'Nuxt'], ['vue', 'Vue'],
  ['svelte', 'Svelte'], ['react', 'React'], ['vite', 'Vite'], ['express', 'Express'], ['fastify', 'Fastify'],
  ['tailwindcss', 'Tailwind CSS'], ['prisma', 'Prisma'], ['drizzle-orm', 'Drizzle ORM'], ['vitest', 'Vitest'],
  ['jest', 'Jest'], ['@playwright/test', 'Playwright'], ['typescript', 'TypeScript']
]
const SCRIPT_PURPOSE = {
  check: 'full local check', test: 'tests', lint: 'lint', typecheck: 'type check', build: 'production build',
  'format:check': 'formatting', 'test:e2e': 'end-to-end tests', 'test:a11y': 'accessibility tests', 'check:a11y': 'accessibility checks',
  verify: 'verification suite', validate: 'validation'
}
export function detectProject({ name, packageJson, lockfiles = [], instructionFiles = [] }) {
  const stack = []
  const commands = []
  let projectName = name
  if (packageJson) {
    const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) }
    for (const [dep, label] of FRAMEWORKS) if (deps[dep]) stack.push(label)
    if (packageJson.workspaces) stack.push('npm workspaces (monorepo)')
    const runner = lockfiles.includes('pnpm-lock.yaml') ? 'pnpm' : lockfiles.includes('yarn.lock') ? 'yarn' : 'npm'
    stack.unshift(`Node.js with ${runner}${packageJson.type === 'module' ? ' (ES modules)' : ''}`)
    for (const script of Object.keys(SCRIPT_PURPOSE)) {
      if (packageJson.scripts && packageJson.scripts[script]) commands.push({ command: runner === 'npm' ? (script === 'test' ? 'npm test' : `npm run ${script}`) : `${runner} ${script}`, purpose: SCRIPT_PURPOSE[script] })
    }
    if (typeof packageJson.name === 'string' && packageJson.name) projectName = name || packageJson.name
  }
  return { projectName, stack, commands, existingInstructions: instructionFiles }
}

export const SOURCE_PROJECT_FILE = PROJECT_FILE
