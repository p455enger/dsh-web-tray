# dsh-web-tray

[中文](README.zh.md) | English

A DeepSeek Harness (DSH) plugin for WSL deployments: a **Windows desktop shortcut
plus a minimal tray icon** with exactly two entries — **打开 DeepSeek Harness** and
**退出 DeepSeek Harness** (which also stops DSH). No watchdog, no idle stop, no
configuration file, no status file.

Fork of [liyu34/dsh-wsl-tray](https://github.com/liyu34/dsh-wsl-tray) (upstream
`ff03276`, v0.1.7, MIT). The upstream architecture — desktop shortcut, hidden tray
helper — is kept; the watchdog, the menu switches and the status monitoring were
removed, and the platform defects below were fixed.

## What it does

- **Double-click `DSH Web` on the desktop**: DSH inside WSL is started through
  `start.sh` when it is not running (hidden, asynchronous) or reused when it is, and
  the browser opens once with this run's `?token=` URL.
- **Tray icon**, started hidden through `wscript.exe` + JScript (no console window):
  - left click or double click: show DSH
  - right click: **打开 DeepSeek Harness** / separator / **退出 DeepSeek Harness**
  - **退出 DeepSeek Harness stops DSH** by asking the generated
    `~/.dsh/dsh-web-tray/stop.sh` (hidden, never awaited) and then closes the tray.
    `stop.sh` checks the command line behind the PID file first, so a stale PID file
    plus a reused PID cannot kill an unrelated process.
- **The menu is drawn to match the desktop app's own tray menu.** That menu is
  Chromium's, not the Windows `CreatePopupMenu` look, so the colours and metrics were
  measured off both tray icons on the same screen and are reproduced here: dark
  `#1F1F1F` panel 175×97 px, `#E3E3E3` labels, `#363636` hover, a full-width
  `#5E5E5E` separator, system UI font at 9pt, and DPI-aware scaling. Corners are
  Windows 11's own rounding (8 px) instead of the app's 12 px. The constants live in
  `src/tray-script.ts` and `tests/tray-menu.spec.ts` asserts them through Windows
  interop.
- **Settings card** (**Settings → WSL Desktop & Tray**): runtime facts, the generated
  files, the project path and "recreate desktop shortcut". Fetched on demand.

## Upgrading from 0.1.0 (breaking)

0.2.0 reduces the tray to *Open* / *Exit* and rebuilds the Windows side. Compared with 0.1.0:

- **Removed**: the four tray switches, the watchdog, idle auto-stop, the polling status
  card, the `netstat` sampling and the DSH process facts in `/status`.
- **Removed the two state files**: `tray-config.json` and `tray-status.json` — both are
  deleted when the artifacts are regenerated.
- **New launcher**: the desktop shortcut runs `wscript.exe //E:JScript //B dsh-web-tray.js`
  instead of a `.vbs` (VBScript is an on-demand feature since Windows 11 24H2); the old
  `.vbs` is deleted.
- **The notification icon is now the inverted mark** (`dsh-web-tray-inverted.ico`), so it
  can be told apart from the desktop app's own tray icon.
- **Regenerate the artifacts once** after upgrading: mounting the plugin does it, or click
  "recreate desktop shortcut" in the settings card.

## Requirements

- DSH runs inside WSL (`WSL_DISTRO_NAME` set, or `/mnt/c` reachable).
- Windows can run `wscript.exe` (JScript), `powershell.exe` and `wsl.exe`.
- Verified against DSH web **0.2.0-rc.2**.

## Install

```sh
# A. official plugin manager — DSH's plugin manager drives pnpm, so pnpm has to be
#    on PATH; this plugin never calls pnpm itself
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
npm pack && dsh plugin --profile web add ./dsh-web-tray-0.2.0.tgz
```

All three need a **restart of `dsh web`**. On first mount, `ensure()` writes every
artifact and creates the desktop shortcut. Installing and regenerating are
idempotent: the same bytes are written every time (only `tray.log` grows, by design)
and a second mount starts no second tray.

## Uninstall

Removing a bundle runs no plugin code — DSH has no uninstall hook — so the generated
helper carries the cleanup:

```powershell
# on Windows, before or after removing the bundle:
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.dsh\dsh-web-tray\dsh-web-tray.ps1" -Uninstall
```

```sh
# then, in the profile that has it:
dsh plugin --profile web remove dsh-web-tray
```

`-Uninstall` stops any tray started from that directory and deletes the desktop
shortcut, the helper, the launcher, both icons, `tray.log`, `tray-selftest.json` and
the WSL directory (`start.sh`, `stop.sh`, `start.log`, `dsh.pid`,
`project-path.json`). It leaves DSH itself running, and running it twice is harmless.
Without it, all of the above stays behind — and keeps working, because the shortcut
and the generated scripts are self-contained.

Installing through DSH's plugin manager adds profile-side files it owns, not the
plugin: `dsh-web-tray-<version>.published/` (a packed copy), `pnpm-lock.yaml` and
`pnpm-workspace.yaml`. Nothing reads them — the profile resolves the plugin through
its `node_modules` entry — and `dsh plugin remove` is what manages that side; delete
them by hand if the profile is to be spotless.

## Generated files

| File | Location |
| --- | --- |
| `dsh-web-tray.ps1` (tray helper), `dsh-web-tray.js` (hidden launcher) | `%USERPROFILE%\.dsh\dsh-web-tray\` |
| `dsh-web-tray.ico` (shortcut icon), `dsh-web-tray-inverted.ico` (tray icon) | same |
| `tray.log` (one line per open/exit/error, not rotated) | same |
| `start.sh`, `stop.sh`, `start.log`, `dsh.pid` | `~/.dsh/dsh-web-tray/` |
| `project-path.json` (only when a project path was saved) | `~/.dsh/dsh-web-tray/` |
| `DSH Web.lnk` (targets `wscript.exe //E:JScript //B …dsh-web-tray.js`) | the Windows desktop |

Running `dsh-web-tray.ps1 -SelfTest` writes `tray-selftest.json` (the menu contract,
UTF-8) next to the helper.

## How it works

```
desktop .lnk
  └─ wscript.exe //E:JScript //B dsh-web-tray.js
       └─ powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File dsh-web-tray.ps1
            ├─ tray icon + dark rounded context menu (open / exit)
            └─ open flow:
                 probe http://127.0.0.1:3080 (2 s timeout; a 401 counts as alive —
                 without a cookie DSH answers 401 by design)
                 alive → open the page (preferring the ?token= URL from start.log)
                 not alive → wsl.exe -d <distro> -- bash -lc "start.sh" (hidden,
                 asynchronous, never awaited), then probe every 2 s for up to
                 120 s and open the page as soon as it answers
```

- **Exit stops DSH and closes the tray**: the exit entry fires `wsl.exe … stop.sh`
  hidden and **never awaits it** (`bWaitOnReturn = $false`), then leaves the message
  loop. Waiting for `wsl.exe` on the UI thread is what froze the tray in the old
  design. `-SelfTest` runs the exit handler without the stop switch, so a test run
  can never stop a real DSH.
- **No console, and the popup is a tool window**: the helper gives up the console its
  hidden launcher handed it (`FreeConsole`) as soon as it enters tray mode, and marks
  its menu `WS_EX_TOOLWINDOW` before the first show. Without those, the process owns a
  hidden PowerShell console and its menu is an ordinary unowned top-level window,
  which is what makes Windows list the menu as "Windows PowerShell" in the taskbar and
  Alt-Tab (and what can surface that console). The command-line flags keep their
  console, because they print.
- **Opening reuses the page's own window.** A browser window that already shows DSH is
  brought forward instead of a second tab being opened: an installed web app window (a
  browser started with `--app`/`--app-id`) is preferred, otherwise a normal browser
  window whose active tab is DSH. Matching is by title *and* window class
  (`Chrome_WidgetWin_1`), because a File Explorer window showing the app's folder
  carries the same words in its title. A minimized window is restored first — its
  resting size comes from `GetWindowPlacement`, since `GetWindowRect` reports a 160×28
  placeholder for a minimized window — and then brought forward with
  `SetForegroundWindow`, falling back to an attached input queue and then to a synthetic
  ALT press, which is what Windows accepts from a process the user is not typing into.
  Only when no such window exists does the tray start the WSL instance and open the page
  with this run's token. **The Electron desktop app is never a candidate**: it is a
  different program with its own backend, so its window is skipped by process name.
  `-SelfTest` reports what was found, and how many windows were skipped for that reason
  (`dshWindow`, `dshWindowIsWebApp`, `dshWindowsSkippedAsApp`, `focusReturned`).
- **No background sampling**: no `netstat`, no polling loop, no status file, no
  `/proc` scan. The UI thread probes once (≤ 2 s) when asked to open.
- **Single instance**: the `Local\dsh-web-tray-single` mutex. A second double-click
  while the tray runs creates no second tray; that process just opens DSH.

## HTTP API (`/dsh-web-tray`, loopback + same-origin fence)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/status` | platform, the two URLs (web + token), generated files |
| POST | `/regenerate` | rewrite every artifact and recreate the desktop shortcut |
| GET/POST | `/project-path` | source checkout path (empty = auto-detect) |

## Platform fixes

1. **`powershell.exe` missing from PATH** (`.wslconfig` with
   `appendWindowsPath = false`) → shortcut creation, desktop resolution and profile
   resolution all failed. It is now resolved from PATH first, then from
   `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`.
2. **Profile resolution picked `Administrator`** (the first entry in `/mnt/c/Users`,
   not writable) → ask PowerShell for `[Environment]::GetFolderPath('UserProfile')`
   first; the directory scan is a last resort.
3. **A PATH-installed `dsh` was rejected** by the launcher guard, so nothing was
   generated → a `dsh` on PATH now counts as a usable launcher.
4. **The desktop shortcut was dead on Windows 11 24H2**: it ran a `.vbs`, and VBScript
   is a Feature-on-Demand now. The launcher is JScript, started as
   `wscript.exe //E:JScript //B …`, which names the engine explicitly. The shortcut
   creation probes the engine and only falls back to a hidden `powershell.exe` when
   JScript is missing too; the old `.vbs` is deleted on regeneration.
5. **Icons**: the shortcut gets the DSH app style (light tile, dark whale, 16–256) and
   the tray the inverted twin (dark tile, light whale, 16–64), so the two are
   distinguishable. Writing the shortcut invalidates the shell icon cache with
   `SHChangeNotify(SHCNE_ASSOCCHANGED)`, or Explorer keeps showing the old art.

## Development

```sh
npm install
npm run typecheck     # host and client halves
npm test              # 39 tests (6 drive the real tray menu through Windows interop, 4 cover the icons)
npm run build         # tsc + tsdown + banner normalisation
npm pack --dry-run
```

`dsh-web-tray.ps1 -SelfTest` builds the real `NotifyIcon`, the real menu and the real
shortcut-target resolution without showing UI, and writes the resulting contract as
JSON. `tests/tray-menu.spec.ts` runs that through Windows interop and asserts the
entries, the palette and metrics (scaled by the real DPI), the target path and both
icon names; it is skipped where interop is unavailable. `tests/icon-asset.spec.ts`
pins both `.ico` files: size tables, BMP/PNG rules and the colour direction.

Verified on WSL2 + Windows 11, 2560×1440 at 100% DPI, dsh 0.2.0-rc.2: typecheck,
tests, build and pack green; the real menu opened, measured and closed again through
the live tray process; double-clicking the real `.lnk` starts the tray with no console
window; `/status` returns `platform: wsl` with every artifact present.

## Known limitations

- **Nothing to do with the desktop app**: the plugin only ever touches the WSL web
  instance and the browser windows showing it. The Electron app runs its own backend
  (`127.0.0.1:19387` on this machine) beside the WSL instance's `:3080`; the tray
  neither focuses nor launches it, and its window is excluded from the reuse match by
  process name.
- **Exiting stops DSH, fire-and-forget**: the stop is requested and the tray closes
  immediately; WSL finishes a moment later, because nothing waits on it
  (deliberately). `bash ~/.dsh/dsh-web-tray/stop.sh` does the same by hand.
- **The tray is not a supervisor**: a crashed DSH is not restarted.
- **The menu is a copy, not the system menu**, and its corners cannot be copied at all
  (Windows rounds a popup by 8 px where the app uses 12; the trade is anti-aliasing and
  a real shadow). A future restyle of the desktop app does not propagate by itself:
  update the constants in `src/tray-script.ts`. Reproducing Chromium's drawing verbatim
  would mean bundling Electron (~90 MB instead of ~125 kB) — the installed desktop app
  refuses to host a foreign app path, so there is no free route to it.
- **Opening depends on `start.sh` launching the CLI**: a source checkout must already
  be built (`start.sh` never runs `src`; when the build output is missing it writes the
  reason to `start.log`). Nothing rebuilds a checkout behind your back.
- **Native Windows (non-WSL) is not implemented**: such a host reports
  `platform: 'unsupported'` and starts nothing.
- DSH instances started by other means have no PID file; `stop.sh` then falls back to
  bracketed `pkill` patterns.

## Syncing with upstream

```sh
git remote -v                                 # upstream = liyu34/dsh-wsl-tray
git fetch upstream && git log --oneline upstream/master ^master
```

## License

MIT — see [LICENSE](LICENSE). The original copyright notice is kept from upstream.
