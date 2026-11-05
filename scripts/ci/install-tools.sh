#!/usr/bin/env bash
# Installs the pinned security scanners listed in ci/tools.lock into <dir>, verifying each
# download's SHA-256 before anything is unpacked or run. Bounded: 3 attempts per download with
# a 60-second limit each. No credentials are used or needed.
set -euo pipefail
dest="${1:?usage: install-tools.sh <dir>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$dest/dl"
fetch() {
  local url="$1" out="$2" sum="$3"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --retry 3 --retry-delay 5 --retry-all-errors --max-time 60 -o "$out" "$url"
  echo "$sum  $out" | sha256sum --check --status || { echo "::error title=install-tools::checksum mismatch for $url"; exit 1; }
}
while read -r name version sum url; do
  case "$name" in ''|'#'*) continue ;; esac
  case "$name" in
    actionlint|gitleaks)
      fetch "$url" "$dest/dl/$name.tar.gz" "$sum"
      tar -xzf "$dest/dl/$name.tar.gz" -C "$dest" "$name"
      ;;
    zizmor)
      whl="$dest/dl/$(basename "$url")"
      fetch "$url" "$whl" "$sum"
      python3 -m venv "$dest/venv"
      "$dest/venv/bin/pip" install --quiet --no-deps --no-index --disable-pip-version-check "$whl"
      ln -sf "$dest/venv/bin/zizmor" "$dest/zizmor"
      ;;
    *) echo "unknown tool $name in ci/tools.lock"; exit 1 ;;
  esac
  echo "installed $name $version"
done < "$root/ci/tools.lock"
"$dest/actionlint" -version | head -1
"$dest/gitleaks" version
"$dest/zizmor" --version
