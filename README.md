# dsh-web-tray

[中文](README.zh.md) | English

A DeepSeek Harness plugin for WSL deployments: **Windows tray + desktop shortcut**
for the DSH web server inside WSL, with **switchable auto start/stop** and **live
status**.

This repository is a fork of [liyu34/dsh-wsl-tray](https://github.com/liyu34/dsh-wsl-tray)
(upstream `ff03276`, v0.1.7, MIT). The upstream architecture — desktop shortcut,
hidden tray helper, watchdog — is kept intact; the tables below list what the fork
adds and fixes. See [README.zh.md](README.zh.md) for the full documentation
(the Chinese file is the primary one).

## Differences from upstream

| Area | Upstream | This fork |
| --- | --- | --- |
| Auto start/stop | Fixed behaviour: the tray starts DSH, exiting stops it | **Four switches**: start DSH with the tray, stop DSH on exit, idle auto-stop, watchdog |
| How a switch applies | Tuning is **baked into** the generated PS1; changing it needs a regenerate + tray restart | Switches live in `tray-config.json` and are **re-read every tick**; changing one never regenerates an artifact (verified: the PS1 hash stays identical) |
| Status | The settings card fetched once on mount | The card **polls every 2 s** (paused while hidden) and shows DSH PID / uptime / RSS, the token URL, idle seconds and connection count, the switch values, the config source and the last 10 actions |
| Idle detection | none | `netstat -ano`, counting `ESTABLISHED` connections to the web port whose owner is not excluded |
| Opening the page | Opens the bare URL, which lands on a 401 when the browser has no cookie | Reads this run's `?token=` URL from the start script's log and opens that |
| Environment | Assumes Windows directories are on PATH | Three real defects fixed — see "Environment fixes" |

## Features

- Double-click the **DSH Web** desktop shortcut: WSL boots if needed, DSH starts in
  the background (or is reused), and the browser opens once with a token URL.
- A tray icon appears (hidden launch through `wscript.exe` + VBS, no console
  window). Right-click menu:
  - status line: `状态: 运行中 | 连接 2，30 分钟后停服`
  - open the DSH page / start DSH / stop DSH / restart DSH
  - recreate the desktop shortcut
  - ☑ start DSH when the tray starts
  - ☑ stop DSH when the tray exits
  - ☑ watchdog (auto restart)
  - idle auto-stop ▸ off / 5 / 15 / 30 / 60 minutes
  - exit
- Double-clicking the tray icon also opens the DSH page.
- **Watchdog**: probes the DSH URL every `probeIntervalSec`; `downThreshold`
  consecutive failures trigger a restart; `maxRestartFailures` consecutive failed
  restarts pause it instead of looping; it resumes by itself once DSH answers.
- **Intentional stop**: stopping DSH from the menu (or the idle timer) enters the
  `stopped` phase, and the watchdog will not restart it until it answers again.

## Requirements

- DSH runs inside WSL (`WSL_DISTRO_NAME` set, or `/mnt/c` reachable).
- Windows can run `wscript.exe`, `powershell.exe`, `wsl.exe` (interop on).
- Verified against DSH web **0.2.0-rc.2**; the client `dsh.client.inject` list is
  updated for 0.2.0 (the upstream list names `@deepseek-ai/dsh-client-runtime`,
  which does not exist there).

## Install

```sh
# A. official plugin manager (needs pnpm on PATH)
cd /path/to/dsh-web-tray && dsh plugin --profile web add "$PWD"

# B. profile symlink — no pnpm, the path this fork was verified with:
P=~/.dsh/profiles/web
python3 - <<'PY'
import json, os
p = os.path.expanduser('~/.dsh/profiles/web/package.json')
d = json.load(open(p)); b = d['dsh']['profile']['bundles']
if 'dsh-web-tray' not in b: b.append('dsh-web-tray')
json.dump(d, open(p, 'w'), indent=2)
PY
mkdir -p "$P/node_modules" && ln -sfn /path/to/dsh-web-tray "$P/node_modules/dsh-web-tray"

# C. tarball
npm pack && dsh plugin --profile web add ./dsh-web-tray-0.1.0.tgz
```

All three need a **restart of `dsh web`**. On first mount, `ensure()` writes every
artifact and creates the desktop shortcut.

## Generated files

| File | Location |
| --- | --- |
| `dsh-web-tray.ico`, `dsh-web-tray.ps1`, `dsh-web-tray.vbs` | `%USERPROFILE%\.dsh\dsh-web-tray\` |
| `tray-config.json` (the switches; **single source of truth**) | same |
| `tray-status.json` (rewritten every tick by the tray) | same |
| `tray.log` (rotated at 512 KB) | same |
| `start.sh`, `stop.sh`, `start.log`, `dsh.pid` | `~/.dsh/dsh-web-tray/` |
| `DSH Web.lnk` | the Windows desktop |

The switches deliberately live on the **Windows** side: while `dsh web` is down the
settings card is unreachable, but "start DSH when the tray starts" must still hold.
The tray menu writes that file directly; the card writes it through the host.

## Switches (`tray-config.json`)

| Key | Default | Range | Meaning |
| --- | --- | --- | --- |
| `autoStart` | `true` | bool | Start DSH when the tray starts, if it is not running |
| `autoStopOnExit` | `true` | bool | Stop DSH when the tray exits |
| `autoStopIdleMinutes` | `0` | 0–1440 | Stop DSH after this many minutes with no browser connection; 0 = off |
| `watchdogEnabled` | `true` | bool | Master switch for probe + auto restart |
| `probeIntervalSec` | `10` | 2–300 | Seconds between probes |
| `probeTimeoutSec` | `3` | 1–30 | Probe timeout |
| `downThreshold` | `3` | 1–10 | Consecutive failures that mean DOWN |
| `restartWaitSec` | `180` | 30–1800 | How long a restart may take |
| `maxRestartFailures` | `3` | 1–10 | Consecutive failed restarts before pausing |
| `restartBackoffSec` | `60` | 0–600 | Cooldown between restart attempts |
| `idleProbeExcludeProcesses` | `powershell, pwsh, wscript, wsl, wslhost, wslrelay, conhost` | names | Owners whose connections never count as a browser |

Out-of-range values are clamped and the reason is reported to the card. A corrupt
file makes the tray keep its last good values (the card shows
`config source: last good values`); a missing file uses the defaults above.

## Idle detection (why `netstat`)

```
netstat -ano → rows whose port matches the web port → keep ESTABLISHED only
             → map PID to process name (60 s cache) → drop excluded owners → count
```

- **`Get-NetTCPConnection` is not used**: on the target machine (WSL 3.0.1,
  mirrored networking) it returns **zero rows** for `-LocalPort 3080` while
  `netstat -ano` lists 2 `ESTABLISHED` + 1 `CLOSE_WAIT` at the same moment.
  Measured, hence the deliberate choice.
- **The exclusion list matters**: the tray's own HTTP probe (owned by
  `powershell`) also connects to 3080; without the filter the idle timer would
  never reach its threshold.
- A count of zero for the configured minutes runs `stop.sh`, moves the phase to
  `stopped` and records an action.
- When `netstat` cannot be sampled, `idle.connections` becomes `null` and the idle
  stop is skipped, with a log line.

## HTTP API (`/dsh-web-tray`, loopback + same-origin fence)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/status` | Full status: platform, URLs, token URL, config, files, DSH process, tray state |
| GET | `/config` | Switches in force, their source, the file path, repair notes |
| POST | `/config` | Partial switch update; returns the effective values and repair notes |
| GET | `/watchdog` | The tray's last tick (`tray-status.json`) |
| GET | `/watchdog-log?lines=N` | Tail of `tray.log` |
| POST | `/regenerate` | Rewrite every artifact and recreate the desktop shortcut |
| GET/POST | `/project-path` | Source checkout path (empty = auto-detect) |

## Environment fixes

All three were exposed on the machine this fork targets (`.wslconfig` has
`appendWindowsPath = false`, DSH installed globally with npm). Upstream cannot work
there:

1. **`powershell.exe` is not on PATH** → `spawn('powershell.exe')` fails with
   ENOENT, so shortcut creation, desktop resolution and profile resolution all
   fail. Fix: `powershellPath()` tries PATH, then the absolute
   `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`.
2. **Profile resolution picked `Administrator`** → scanning `/mnt/c/Users` takes the
   first entry alphabetically, which is not writable (EACCES). Fix: ask PowerShell
   for `[Environment]::GetFolderPath('UserProfile')` first; the scan is a last
   resort.
3. **A PATH-installed `dsh` was rejected by the artifact guard** → upstream requires
   `process.argv[1]` to end in `.js` or a source checkout to exist; a global install
   has the extensionless shim `/usr/local/bin/dsh`, so it reported "cannot locate a
   DSH launcher" and generated **nothing**. Fix: a `dsh` on PATH counts as a usable
   launcher (the generated `start.sh` already prefers `command -v dsh`).

## Development and verification

```sh
npm install && npm run typecheck && npm test && npm run build && npm pack --dry-run
```

- The generated PS1 takes `-SelfTest`: it reads `netstat` text on stdin and prints
  the connection count plus idle-decision cases as JSON.
  `tests/tray-selftest.spec.ts` runs that shipped code through Windows interop
  (skipped automatically where interop is unavailable).
- **Verification log** (WSL2 + Windows 11, dsh 0.2.0-rc.2): typecheck, 41 tests,
  build and `npm pack --dry-run` all pass; the generated PS1 passes a PowerShell
  parse check; the parser returns the expected 3 (default excludes) and 2 (with
  `system` excluded) for a captured sample; all five idle-decision cases match;
  mounting the plugin in an isolated `DSH_HOME` (port 3099, the live 3080 session
  untouched) produced every artifact and the desktop shortcut, exposed
  `dsh.running/pid/uptimeSec/rssMb`, registered `dsh-web-tray/client.js` in the boot
  payload, and persisted a switch change to the Windows-side file while the PS1 hash
  stayed identical. Clamping, 400 on a bad body and 403 on a non-loopback Host were
  all observed.

## Known limitations

- The tray must be running: the watchdog and the idle stop live inside it.
- Native Windows (non-WSL) is not implemented; such a host reports
  `platform: 'unsupported'` and starts nothing.
- The idle stop can interrupt a background job whose tab was closed; the default is
  off (0 minutes).
- DSH instances started by other means have no PID file; `stop.sh` then falls back
  to bracketed `pkill` patterns covering `bin.js web` and `src/bin.ts web`.

## Syncing with upstream

```sh
git remote -v                                 # upstream = liyu34/dsh-wsl-tray
git fetch upstream && git log --oneline upstream/master ^master
```

## License

MIT — see [LICENSE](LICENSE). The original copyright notice is kept from upstream.
