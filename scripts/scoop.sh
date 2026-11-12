#!/usr/bin/env bash
# Start Scoop on this machine and open the dashboard.
# Also starts configured local services, and any remoteStart line in the stack file.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCOOP="$ROOT/scoop"
URL="http://127.0.0.1:3847"
PORT=3847

port_open() {
  local port="$1"
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return
  fi
  (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1
}

# Docker and node.exe bind Windows localhost. WSL often cannot see that address.
windows_port_open() {
  local port="$1"
  local ps=/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe
  [[ -x "$ps" ]] || return 1
  "$ps" -NoProfile -Command "\$c = New-Object System.Net.Sockets.TcpClient; try { \$iar = \$c.BeginConnect('127.0.0.1', ${port}, \$null, \$null); if (\$iar.AsyncWaitHandle.WaitOne(400, \$false)) { exit 0 } else { exit 1 } } catch { exit 1 } finally { \$c.Close() }" >/dev/null 2>&1
}

open_url() {
  local ps=/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe
  if [[ -x "$ps" ]]; then
    "$ps" -NoProfile -Command "Start-Process '${URL}'" >/dev/null 2>&1 && return 0
  fi
  if command -v open >/dev/null 2>&1; then open "$URL"; return 0; fi
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true; fi
}

# A login shell sees the Windows Node directory. A stripped PATH does not.
# The npm file beside npm.cmd is a shell script that launches node.exe.
pick_runner() {
  runner_works() { "$1" -v >/dev/null 2>&1; }
  if command -v pnpm >/dev/null 2>&1 && runner_works pnpm; then
    printf '%s\n' pnpm
    return 0
  fi
  if command -v npm >/dev/null 2>&1 && runner_works npm; then
    printf '%s\n' npm
    return 0
  fi
  local cmd win unix dir
  if [[ -x /mnt/c/Windows/System32/cmd.exe ]]; then
    cmd=/mnt/c/Windows/System32/cmd.exe
  elif command -v cmd.exe >/dev/null 2>&1; then
    cmd="$(command -v cmd.exe)"
  else
    return 1
  fi
  win="$("$cmd" /d /c "where npm.cmd" 2>/dev/null | head -n 1 | tr -d '\r' || true)"
  [[ -z "$win" ]] && return 1
  unix="$(wslpath -u "$win")"
  dir="$(dirname "$unix")"
  if [[ -f "$dir/npm" ]] && runner_works "$dir/npm"; then
    printf '%s\n' "$dir/npm"
    return 0
  fi
  return 1
}

# The WSL docker shim can exist and still fail when integration is off.
# docker.exe talks to Docker Desktop on Windows.
pick_docker() {
  if docker info >/dev/null 2>&1; then
    printf '%s\n' docker
    return 0
  fi
  if command -v docker.exe >/dev/null 2>&1 && docker.exe info >/dev/null 2>&1; then
    printf '%s\n' docker.exe
    return 0
  fi
  return 1
}

if port_open "$PORT" || windows_port_open "$PORT"; then
  echo "Scoop is already running at $URL"
  open_url
  exit 0
fi

if ! port_open 5432 && ! windows_port_open 5432; then
  compose_file="$ROOT/docker-compose.scoop.yml"
  if [[ -f "$compose_file" ]] && DOCKER="$(pick_docker)"; then
    if [[ "$DOCKER" == "docker.exe" ]]; then
      compose_file="$(wslpath -w "$compose_file")"
    fi
    echo "Starting Scoop's Postgres on 127.0.0.1:5432"
    "$DOCKER" compose -f "$compose_file" --profile scoop up -d postgres-scoop \
      || echo "Postgres did not start. Scoop will still open."
  else
    echo "Postgres is not listening on 127.0.0.1:5432. From WSL, turn on Docker Desktop's WSL integration for this distro. Scoop will still start."
  fi
fi

if ! RUNNER="$(pick_runner)"; then
  echo "npm was not found in this shell or on the Windows PATH. Install Node in WSL, or run scoop.cmd from PowerShell."
  exit 1
fi

if [[ ! -d "$SCOOP/node_modules" ]]; then
  echo "Installing Scoop dependencies."
  (cd "$SCOOP" && "$RUNNER" install)
fi

echo "Starting configured local services, and any remote start commands in the stack file"
(cd "$SCOOP" && "$RUNNER" run stack:up) || echo "A stack service did not start. Scoop will still open."

if [[ "$RUNNER" == /mnt/* && -x /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe ]]; then
  # Windows node.exe listens on Windows localhost, which this distro may not see.
  /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command "
    \$deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt \$deadline) {
      \$client = New-Object System.Net.Sockets.TcpClient
      try {
        \$iar = \$client.BeginConnect('127.0.0.1', ${PORT}, \$null, \$null)
        if (\$iar.AsyncWaitHandle.WaitOne(400, \$false)) {
          \$client.EndConnect(\$iar)
          Start-Process '${URL}'
          exit 0
        }
      } catch {
      } finally {
        \$client.Close()
      }
      Start-Sleep -Milliseconds 400
    }
  " >/dev/null 2>&1 &
  disown || true
else
  (
    for _ in $(seq 1 450); do
      if port_open "$PORT"; then
        if command -v open >/dev/null 2>&1; then open "$URL"
        elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
        elif [[ -x /mnt/c/Windows/System32/cmd.exe ]]; then /mnt/c/Windows/System32/cmd.exe /d /c "start \"\" ${URL}" >/dev/null 2>&1 || true
        fi
        exit 0
      fi
      sleep 0.4
    done
  ) &
fi

echo "Starting Scoop at $URL"
cd "$SCOOP"
exec "$RUNNER" run dev
