#!/usr/bin/env bash
# Started by the tray's exit entry — through `wsl.exe -d <distro> -- bash -lc "exec '<this
# file>'"` — and by `dsh-web-tray stop`. Stops the DSH web instance(s) this install is
# responsible for; DSH's own files are left alone.
#
# Instances are found by inspecting /proc rather than by a PID file: a PID file goes stale
# and its PID can be reused, and it is also the one piece of state that would have to cross
# the WSL/Windows boundary to be useful.
set -u

# Whether a PID is really a DSH web process. A reused PID is not ours to kill.
is_dsh_web() {
  local cmdline
  [ -r "/proc/$1/cmdline" ] || return 1
  cmdline="$(tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null)"
  case "$cmdline" in
    *"bin.js web"*|*"src/bin.ts web"*|*"dsh web"*) return 0 ;;
  esac
  return 1
}

if command -v pgrep >/dev/null 2>&1; then
  for pid in $(pgrep -f '[d]sh web' 2>/dev/null || true); do
    [ "$pid" = "$$" ] && continue
    if is_dsh_web "$pid"; then
      kill "$pid" 2>/dev/null || true
    fi
  done
else
  # No procps: bracket the first character so the pattern does not match itself.
  pkill -f '[b]in\.js web' 2>/dev/null || true
  pkill -f '[s]rc/bin\.ts web' 2>/dev/null || true
  pkill -f '[d]sh web' 2>/dev/null || true
fi
exit 0
