#!/usr/bin/env bash
# Started by the tray — through `wsl.exe -d <distro> -- bash -lc "exec '<this file>'"` — and
# by `dsh-web-tray open`. Starts the DSH web instance the tray opens, unless one already
# answers, and leaves that instance's output in start.log beside this script.
#
# Configuration comes from tray.env in the same directory: WORKSPACE is the directory DSH
# runs in, DSH_COMMAND is the command line that starts it, WEB_URL is what "already
# running" is tested against.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$DIR/start.log"
ENV_FILE="$DIR/tray.env"

# tray.env is parsed, not sourced: one CR from a Windows editor would otherwise ride along
# in every value, and a path with one is not a path.
read_env() {
  sed -n "s/^$1='\(.*\)'$/\1/p" "$ENV_FILE" | head -n 1 | tr -d '\r'
}

URL="$(read_env WEB_URL)"
[ -n "$URL" ] || URL='http://127.0.0.1:3080'
DSH_COMMAND="$(read_env DSH_COMMAND)"
[ -n "$DSH_COMMAND" ] || DSH_COMMAND='dsh web --no-open'
WORKSPACE="$(read_env WORKSPACE)"
[ -n "$WORKSPACE" ] || WORKSPACE="$HOME"

# Liveness probe with a dependency chain: curl, then wget, then bash's own /dev/tcp, so a
# minimal distro without downloaders still detects a live instance. Any HTTP response counts
# as alive: DSH answers 401 without its cookie, and curl -f would call that a failure —
# which started a second instance on an occupied port and lost the running one's token.
is_ready() {
  if command -v curl >/dev/null 2>&1; then
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$URL" 2>/dev/null)"
    [ -n "$code" ] && [ "$code" != "000" ]
  elif command -v wget >/dev/null 2>&1; then
    wget -S -q -O /dev/null -T 2 "$URL" 2>&1 | grep -q 'HTTP/'
  else
    local host port
    host="${URL#http://}"; host="${host%%/*}"
    port="${host##*:}"; host="${host%%:*}"
    (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null
  fi
}

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG_FILE"
}

if is_ready; then
  exit 0
fi

# Secrets this machine wants the launched DSH to have (GITHUB_TOKEN for an MCP server, for
# instance). KEY=VALUE per line; this script only reads the file, it never creates it.
if [ -f "$HOME/.dsh/dsh-web-tray.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$HOME/.dsh/dsh-web-tray.env"
  set +a
fi

cd "$WORKSPACE" 2>/dev/null || { log "ERROR workspace does not exist: $WORKSPACE"; exit 1; }

# Only now that this instance is really going to start. Truncating any earlier threw away the
# running instance's token line when the launch then failed (occupied port, missing command).
: >"$LOG_FILE"
log "launching: $DSH_COMMAND (in $WORKSPACE)"
# exec keeps this shell's PID, so the process the tray started is the one stop.sh finds;
# the word splitting is intended — DSH_COMMAND is a command line, not a path.
# shellcheck disable=SC2086
set -- $DSH_COMMAND
exec "$@" >>"$LOG_FILE" 2>&1
