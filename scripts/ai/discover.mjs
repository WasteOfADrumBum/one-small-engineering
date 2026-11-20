// Repository discovery: finds git repository roots under a workspace folder, without a
// hard-coded project list. It never descends into a repository it found (so nested
// repositories and submodules are not counted twice), skips dependency and build folders
// and symbolic links, and only reads .git/config to learn the remote.

import * as fs from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'
import { repoSlug, toPosix } from './lib.mjs'

export const DEFAULT_EXCLUDE = ['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.astro', '.vercel', 'coverage', '.cache', '.turbo', 'vendor', 'target', '.venv', '__pycache__']

function gitDir(dir) {
  const dotgit = join(dir, '.git')
  let st
  try { st = fs.lstatSync(dotgit) } catch { return null }
  if (st.isDirectory()) return dotgit
  if (st.isFile()) {
    // Worktrees and submodules: ".git" is a file holding "gitdir: <path>".
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotgit, 'utf8'))
    if (m) return isAbsolute(m[1].trim()) ? m[1].trim() : resolve(dir, m[1].trim())
  }
  return null
}

export function readRemote(dir) {
  const gd = gitDir(dir)
  if (!gd) return null
  for (const cfg of [join(gd, 'config'), join(gd, '..', '..', 'config')]) {
    let text
    try { text = fs.readFileSync(cfg, 'utf8') } catch { continue }
    const sections = text.split(/^\s*\[/m)
    const pick = name => sections.find(s => new RegExp(`^remote\\s+"${name}"\\s*\\]`).test(s))
    const sec = pick('origin') || sections.find(s => /^remote\s+"[^"]+"\s*\]/.test(s))
    const url = sec && /^\s*url\s*=\s*(.+)$/m.exec(sec)
    if (url) return url[1].trim()
  }
  return null
}

export function discoverRepos(workspace, { maxDepth = 3, exclude = [] } = {}) {
  const root = resolve(workspace)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`workspace is not a directory: ${root}`)
  const skipNames = new Set([...DEFAULT_EXCLUDE, ...exclude.filter(e => !/[\\/]/.test(e))].map(s => s.toLowerCase()))
  const skipPaths = exclude.filter(e => /[\\/]/.test(e)).map(e => toPosix(resolve(root, e)).toLowerCase())
  const found = []
  const walk = (dir, depth) => {
    if (skipPaths.includes(toPosix(dir).toLowerCase())) return
    if (gitDir(dir)) {
      const remote = readRemote(dir)
      found.push({ path: dir, name: dir.split(/[\\/]/).pop(), remote, slug: repoSlug(remote) })
      return
    }
    if (depth >= maxDepth) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue
      if (skipNames.has(e.name.toLowerCase())) continue
      walk(join(dir, e.name), depth + 1)
    }
  }
  walk(root, 0)
  return found
}
