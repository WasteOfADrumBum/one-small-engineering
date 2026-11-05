#!/usr/bin/env bash
# Prepares the sandbox that project code runs in (docs/ci-cd.md#project-code-isolation).
# Creates an unprivileged user with no sudo, no docker group and its own home, closes the
# runner user's home (workspace, temp files, runner configuration) to other users, and makes a
# shared work directory outside it. Exports ONE_SMALL_SANDBOX_USER and ONE_SMALL_WORK.
set -euo pipefail
user=osrun
work=/tmp/one-small-work
if ! id "$user" >/dev/null 2>&1; then
  sudo useradd --create-home --shell /usr/sbin/nologin --user-group "$user"
fi
# Nothing grants the sandbox user sudo or the docker socket.
if sudo -l -U "$user" 2>/dev/null | grep -q 'may run'; then echo "::error::$user can use sudo"; exit 1; fi
if id -nG "$user" | tr ' ' '\n' | grep -qx docker; then echo "::error::$user is in the docker group"; exit 1; fi
sudo chmod 700 "$HOME"
sudo install -d -m 1777 "$work"
if [ -n "${GITHUB_ENV:-}" ]; then
  { echo "ONE_SMALL_SANDBOX_USER=$user"; echo "ONE_SMALL_WORK=$work"; } >> "$GITHUB_ENV"
fi
echo "sandbox: user $user, work $work, $HOME closed to other users"
