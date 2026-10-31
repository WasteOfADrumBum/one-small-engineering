// Handoff acceptance fixture (throwaway). Task H-1: a tiny slug helper in two parts.
// Part 1 (done by the first agent): slugify().
// Part 2 (remaining): uniqueSlugs(), see handoff-fixture/slug.test.mjs.

export function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function uniqueSlugs() {
  throw new Error('not implemented: task H-1 part 2')
}
