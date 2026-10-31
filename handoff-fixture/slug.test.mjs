import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slugify, uniqueSlugs } from './slug.mjs'

test('slugify strips accents, punctuation and edge dashes', () => {
  assert.equal(slugify('  Café Münster! '), 'cafe-munster')
  assert.equal(slugify('A  --  B'), 'a-b')
})

// Part 2 (remaining). uniqueSlugs(titles) returns slugify of each title; a repeat gets -2, -3, ...
// in order of appearance. Titles that slugify to '' become 'untitled' (also numbered when repeated).
test('uniqueSlugs numbers repeats in order', () => {
  assert.deepEqual(uniqueSlugs(['Hello', 'hello', 'HELLO!', 'World']), ['hello', 'hello-2', 'hello-3', 'world'])
})
test('uniqueSlugs names empty slugs untitled', () => {
  assert.deepEqual(uniqueSlugs(['!!!', '', 'x']), ['untitled', 'untitled-2', 'x'])
})
