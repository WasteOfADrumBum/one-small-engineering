#!/usr/bin/env node
// `ose`: One Small Engineering command line. `ose ai <command>` manages the shared AI
// engineering standards (docs/ai-standards.md). Install the command with `npm link` in
// this repository, or run it as `node scripts/ose.mjs ai <command>`.
import { run } from './ai/cli.mjs'

const r = run(process.argv.slice(2))
if (r.stdout) console.log(r.stdout)
if (r.stderr) console.error(r.stderr)
process.exitCode = r.code
