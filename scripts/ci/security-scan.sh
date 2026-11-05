#!/usr/bin/env bash
# Security scans for the hub (docs/ci-cd.md#security-validation). Every scanner must run and pass;
# the names of the scanners that ran are reported to the merge gate, which refuses a green job that
# skipped one. TOOLS points at a directory prepared by scripts/ci/install-tools.sh.
set -euo pipefail
tools="${TOOLS:?set TOOLS to the directory from scripts/ci/install-tools.sh}"
ran=()
report() { if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "scanners=$(IFS=,; echo "${ran[*]}")" >> "$GITHUB_OUTPUT"; fi; }
trap report EXIT

echo "::group::actionlint (workflow syntax, expressions, shellcheck where installed)"
"$tools/actionlint" -color=false
ran+=(actionlint)
echo "::endgroup::"

echo "::group::zizmor (dangerous workflow patterns, offline and deterministic)"
"$tools/zizmor" --offline --no-progress --format plain .github/workflows
ran+=(zizmor)
echo "::endgroup::"

echo "::group::gitleaks allowlist self-check (a real-looking token in an evidence file is still found)"
probe="$(mktemp -d)"
mkdir -p "$probe/verification/evidence"
# The token is assembled at run time so this repository never contains one.
printf '{\n  "cacheKey": "956e72481038fd0e",\n  "note": "%s"\n}\n' "ghp_$(printf 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8')" > "$probe/verification/evidence/demo.json"
git -C "$probe" init -q && git -C "$probe" add -A && git -C "$probe" -c user.email=ci@invalid -c user.name=ci commit -qm probe
"$tools/gitleaks" git --no-banner --redact --config "$PWD/.gitleaks.toml" --report-format json --report-path "$probe/report.json" "$probe" >/dev/null 2>&1 || true
found="$(node -e 'const r=require(process.argv[1]); console.log(r.map(f=>f.RuleID+":"+f.StartLine).sort().join(","))' "$probe/report.json")"
rm -rf "$probe"
if [ "$found" != "github-pat:3" ]; then echo "::error title=gitleaks::allowlist self-check expected only github-pat:3, got '${found}'"; exit 1; fi
echo "::endgroup::"

echo "::group::gitleaks (secrets in the full git history)"
# --redact keeps any finding's value out of the log.
"$tools/gitleaks" git --no-banner --redact --config .gitleaks.toml --log-opts="--all" .
ran+=(gitleaks)
echo "::endgroup::"

echo "::group::repository policy (pins, permissions, credentials, untrusted input, dependencies, dangerous APIs)"
node scripts/ci/workflow-policy.mjs
ran+=(policy)
echo "::endgroup::"
echo "security: all scanners passed (${ran[*]})"
