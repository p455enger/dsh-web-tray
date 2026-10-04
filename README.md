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
- **The notification icon changed twice**: the inverted tile in 0.2.0, then the theme-aware
  favicon mark in 0.3.0 (see the next section).
- **Regenerate the artifacts once** after upgrading: mounting the plugin does it, or click
  "recreate desktop shortcut" in the settings card.

## Upgrading from 0.2.0

0.3.0 fixes the Windows side of 0.2.0 and makes two visible changes:

- **Tray icon**: the inverted tile gives way to the page's favicon mark — the bare whale, no
  tile, drawn at the size the desktop app's own tray icon uses, in **black or white depending
  on the taskbar theme** (one registry read every 5 s). `dsh-web-tray-inverted.ico` is deleted.
- **New stamp**: `tray-shortcut.json` records what the desktop shortcut should be — target,
  arguments, icon, and the `.lnk`'s own size and digest. A shortcut that was replaced,
  restored from a backup or edited by hand is rebuilt instead of being trusted for existing.
- **The 0.2.0 review fixes**: every value baked into a generated script is now shell-quoted,
  `-Uninstall` covers the files older versions left behind, an unhandled error leaves a line
  in `tray.log` instead of failing silently, artifacts are written atomically and
  `regenerate()` is single-flight, `ensure()` notices leftovers, and the `pkill` fallback also
  covers a globally installed `dsh`. No manual step: mounting regenerates.

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
npm pack && dsh plugin --profile web add ./dsh-web-tray-0.3.0.tgz
```

All three need a **restart of `dsh web`**. On first mount, `ensure()` writes every
artifact and creates the desktop shortcut. Installing and regenerating are
idempotent: `ensure()` compares the artifacts, the leftover files of older versions and
the shortcut's own stamp, so nothing is rewritten, no second tray starts and no
PowerShell runs — the only files that grow from normal use are `tray.log` and
`start.log`.

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
shortcut, the helper, the launcher, all three icons, `tray.log`, `tray-selftest.json` and
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
| `dsh-web-tray.ico` (shortcut icon), `dsh-web-tray-black.ico` / `dsh-web-tray-white.ico` (tray icon, one ink per taskbar theme) | same |
| `tray.log` (one line per open/exit/error, not rotated) | same |
| `tray-shortcut.json` (what the shortcut should be: target, arguments, icon, `.lnk` digest) | same |
| `start.sh`, `stop.sh`, `start.log`, `dsh.pid` | `~/.dsh/dsh-web-tray/` |
| `project-path.json` (only when a project path was saved) | `~/.dsh/dsh-web-tray/` |
| `DSH Web.lnk` (targets `wscript.exe //E:JScript //B …dsh-web-tray.js`) | the Windows desktop |

Running `dsh-web-tray.ps1 -SelfTest` writes `tray-selftest.json` (the menu contract,
UTF-8) next to the helper.

`~/.dsh/dsh-web-tray.env` (optional, `chmod 600`, one `KEY=VALUE` per line) is read by
`start.sh` and exported into DSH's environment — a token for an MCP server, say. The
script only reads it and never creates it; the older, personal
`~/.dsh/github-mcp-token` is still honoured.

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
- **No background sampling**: no `netstat`, no status file, no `/proc` scan. The UI
  thread probes the URL once (≤ 2 s) when it is asked to open, and the open flow's 2 s
  timer polls for up to 120 s while a DSH it started comes up. Nothing else runs in the
  background except one registry read every 5 s for the taskbar theme.
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
   resolution all failed. Every mounted drive's absolute
   `/mnt/<drive>/Windows/System32/WindowsPowerShell/v1.0/powershell.exe` is now tried
   first and the bare name last: a PATH that does carry Windows still works, and so
   does a Windows installed on another drive.
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
5. **A cmdlet was missing in the PowerShell the host spawns**: this machine also has
   PowerShell 7 installed, and a Windows process launched from WSL inherits the *user*
   environment, so 5.1 was handed a module path that starts with 7's module
   directories. `Get-FileHash` then reported "not recognized" while its module listed
   itself as loaded, the shortcut stamp was never written, and every mount regenerated
   the whole install. The helper now points its own `PSModulePath` at `$PSHOME\Modules`
   and computes the `.lnk` digest with .NET.
6. **Icons**: the shortcut gets the DSH app style (light tile, dark whale, 16–256). The
   tray gets the page's favicon mark instead — the bare whale, no tile, in the ink the
   taskbar theme needs — because a white tile is invisible on a white notification area
   and glaring on a dark one. It is drawn 7/8 of the frame wide, the size the desktop
   app's own `tray.ico` uses; the launcher asset draws the same whale at 3/4, which is
   why an icon taken from that one looked small next to the app's. Writing the shortcut
   invalidates the shell icon cache with `SHChangeNotify(SHCNE_ASSOCCHANGED)`, or
   Explorer keeps showing the old art.

## Development

```sh
npm install
npm run typecheck     # host and client halves
npm test              # 66 tests (30 generated scripts, 12 service lifecycle, 10 real tray menu via Windows interop, 6 icons, 8 wiring)
DSH_WEB_TRAY_REQUIRE_INTEROP=1 npm test   # fail instead of skipping when interop is missing
                                      # (10 of the 66 need Windows; the other 56 run anywhere)
npm run build         # tsc + tsdown + banner normalisation
npm pack --dry-run
```

`dsh-web-tray.ps1 -SelfTest` builds the real `NotifyIcon`, the real menu and the real
shortcut-target resolution without showing UI, and writes the resulting contract as
JSON. `tests/tray-menu.spec.ts` runs that through Windows interop and asserts the
entries, the palette and metrics (scaled by the real DPI), the target path, and the tray
icon it picked together with the theme it read; it is skipped where interop is
unavailable. `tests/icon-asset.spec.ts` pins all three `.ico` files: size tables, BMP/PNG
rules, the mark's share of its frame and the two inks. `tests/service.spec.ts` drives the
lifecycle itself — idempotence, an older install's leftovers, a replaced shortcut,
single-flight regenerate — against a temporary home directory and an injected host
bridge, so it needs neither Windows nor WSL.

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
- **The helper degrades instead of dying**: the dark menu, the window matcher and the
  console detach all come from one `Add-Type` source. If that does not compile, the tray
  still appears — a system-colour menu, no rounded corners — and writes the reason to
  `tray.log`. Any unhandled error leaves a line there too, because a hidden process
  that fails is otherwise indistinguishable from one that never started.
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
- DSH instances started by other means have no PID file; `stop.sh` then finds every
  `dsh web` process with `pgrep` and kills the ones whose command line really is DSH
  (read from `/proc`, so a `grep dsh web` of your own is never signalled).
- **Only browsers are driven**: the tray matches windows by class
  (`Chrome_WidgetWin_1`), and that class is not browser-only — QQ, Jitsi Meet and the DSH
  desktop app itself draw windows with it. A window only counts as the page if its process
  is a browser (a known executable name, or one started with `--user-data-dir` /
  `--profile-directory`, which is how a portable or scoop install identifies itself).
- **Any Chromium browser, not one of them**: Chrome, Edge, Brave, Vivaldi, Opera, Chromium,
  ungoogled-chromium, Thorium, Yandex and Arc all take `--app=<url>` and share the window
  class and the reload chord, so the same code serves all of them. The tray opens the page
  in the browser it has already seen the page in (that window's own browser and profile), or
  in the default browser when that one is Chromium-like, and only falls back to a plain open
  (a new tab) for a non-Chromium default.
- **A distro whose name contains a space cannot be launched from the tray**: `wsl.exe`
  reads the raw command line and keeps the quotes `WScript.Shell.Run` passes, so
  `-d "My Distro"` is read as a distro called `"My Distro"` and fails with
  `WSL_E_DISTRO_NOT_FOUND` (measured). The name is therefore passed bare, exactly as
  WSL expects it.

## Syncing with upstream

```sh
git remote -v                                 # upstream = liyu34/dsh-wsl-tray
git fetch upstream && git log --oneline upstream/master ^master
```

## License

MIT — see [LICENSE](LICENSE). The original copyright notice is kept from upstream.
