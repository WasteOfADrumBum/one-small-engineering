// TEMPORARY probe (removed before review): read-only identity check of the registry's
// active repositories and the names in the Phase 2 brief, with the job GITHUB_TOKEN.
const names = ['one-small-mods-pack','one-small-modspack','one-small-ui','joshsmall-site','one-small-portfolio','one-small-studio','one-small-photography','TaskForge','cortex-brain-task','cortex-v2','one-small-ai-workforce']
const h = { accept: 'application/vnd.github+json', authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'x-github-api-version': '2022-11-28' }
for (const n of names) {
  const r = await fetch(`https://api.github.com/repos/WasteOfADrumBum/${n}`, { headers: h })
  const j = await r.json().catch(() => ({}))
  const perm = r.headers.get('x-accepted-github-permissions')
  console.log(JSON.stringify({ name: n, status: r.status, id: j.id ?? null, fullName: j.full_name ?? null, private: j.private ?? null, archived: j.archived ?? null, defaultBranch: j.default_branch ?? null, pushedAt: j.pushed_at ?? null, acceptedPermissions: perm }))
}
