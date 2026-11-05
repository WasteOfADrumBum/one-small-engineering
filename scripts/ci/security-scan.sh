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
