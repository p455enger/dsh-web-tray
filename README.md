# dsh-web-tray

[中文](README.zh.md) | English

A Windows Start menu entry and a minimal tray icon for **`dsh web` running inside WSL**,
with exactly two entries — **打开 DeepSeek Harness** and **退出 DeepSeek Harness** — and
nothing else. No watchdog, no idle stop, no status file, and **no DSH plugin**: DSH never
loads this package, and this package does not care how DSH was installed. It needs a `dsh`
command and a WSL instance to run it in.

Fork of [liyu34/dsh-wsl-tray](https://github.com/liyu34/dsh-wsl-tray) (upstream `ff03276`,
v0.1.7, MIT). The upstream architecture — desktop shortcut, hidden tray helper — is kept;
the watchdog, the menu switches and the status monitoring are gone.

## What it does

- **Pick `DeepSeek Harness (Web)` from the Start menu.** The tray starts hidden. If nothing answers on
  the configured URL, `start.sh` starts the instance (hidden, never awaited) and the page
  is opened once with that run's `?token=` URL. A window that already shows the page is
  reused, and if the instance behind it was down, that window is **reloaded** instead of a
  second copy being opened somewhere else.
- **Tray icon**, started through `wscript.exe` + JScript so no console window ever appears:
  - left click: show DSH
  - right click: **打开 DeepSeek Harness** / separator / **退出 DeepSeek Harness**
  - **退出** asks `stop.sh` to stop the instance, closes every window showing the page
    (Ctrl+W: the tab in a browser window, the window in an app window — other tabs are
    never touched), and the tray exits.
  - Closing a window by hand does nothing to DSH and nothing to the tray.
- **The menu is drawn to match the desktop app's own tray menu.** That menu is Chromium's,
  not the Windows `CreatePopupMenu` look, so the colours and metrics were measured off both
  tray icons on the same screen and are reproduced here: dark `#1F1F1F` panel 175×97 px,
  `#E3E3E3` labels, `#363636` hover, a full-width `#5E5E5E` separator, the system UI font at
  9pt, and DPI-aware scaling. Corners are Windows 11's own rounding. The constants live in
  [`windows/dsh-web-tray.ps1`](windows/dsh-web-tray.ps1) and
  [`tests/tray.spec.ts`](tests/tray.spec.ts) asserts them through Windows interop.
- **The tray icon is the page's own favicon whale** in the two inks the notification area
  can need (black on a light taskbar, white on a dark one), at the size the desktop app's
  tray icon uses; the shortcut wears the same favicon, the mark alone on transparency, which
  is what a Chromium "install as app" shortcut carries. The taskbar theme is re-read every
  five seconds.
- **Any Chromium browser** can host the page: Chrome, Edge, Brave, Vivaldi, Opera, Chromium,
  ungoogled-chromium, Thorium, Yandex and Arc all take `--app=<url>` and share the window
  class, so the page opens as an app window in the browser it was already seen in, or in the
  default browser when that one is Chromium-like. A non-Chromium default gets a plain tab.

## Requirements

- Windows 10/11 with WSL2, and the Windows PowerShell 5.1 that ships with it. PowerShell 7
  is neither needed nor used.
- Node.js ≥20 **to install and to run the `dsh-web-tray` commands**. The tray itself needs no
  Node: it is one hidden PowerShell process, and WSL runs two shell scripts on demand.
- A `dsh` command that starts the web UI. Anything that starts one works — see
  `DSH_COMMAND` below.

## Install

```sh
npm i -g dsh-web-tray
dsh-web-tray install --distro Debian --workspace ~/work
```

Or without installing: `npx dsh-web-tray install`.

| Option | Meaning | Default |
| --- | --- | --- |
| `--distro <name>` | WSL distribution the tray addresses | `$WSL_DISTRO_NAME`, else `Ubuntu` |
| `--workspace <path>` | Directory DSH runs in (its workspace root) | the current directory |
| `--command <line>` | Command line that starts DSH | `dsh web --no-open` |
| `--port <number>` | Port the web UI listens on | `3080` |
| `--windows-user <u>` | Windows user to install into, when it cannot be found | detected |

Installing writes one Windows directory and one Start menu shortcut:

| Path | Contents |
| --- | --- |
| `%USERPROFILE%\.dsh\dsh-web-tray\` | `dsh-web-tray.ps1` (the tray), `dsh-web-tray.js` (the hidden-console launcher), `start.sh`, `stop.sh`, three `.ico` files, `tray.env`, and at run time `start.log`, `tray.log`, `tray-shortcut.json`, `tray-selftest.json` and the `tray-exit.flag` handshake |
| Start menu | `DeepSeek Harness (Web).lnk` → `wscript.exe //E:JScript //B "<dir>\dsh-web-tray.js"` |

Nothing is written into the WSL file system, and nothing is written into DSH's home
directory beyond that one `.dsh\dsh-web-tray` directory.

**Coming from 0.3.0** (the DSH plugin): install 1.0, then drop the plugin and its old
directory — 1.0 keeps no compatibility with either.

```sh
dsh plugin --profile web remove dsh-web-tray
rm -rf ~/.dsh/dsh-web-tray
```

## Commands

| Command | What it does |
| --- | --- |
| `install` | Copy the tray into the install directory, write `tray.env`, create the Start menu shortcut (one Windows process, no install scripts) |
| `uninstall` | Ask the running tray to exit, then remove the shortcut and every installed file. DSH itself is left running |
| `status` | The install directory, the configured keys, whether the shortcut exists, whether the URL answers, and the last log lines |
| `open` | Start DSH if it is not answering, then print its authorised URL |
| `stop` | Stop the DSH web instance(s) — the same thing the tray's exit entry does |

`uninstall` talks to the tray through a marker file (`tray-exit.flag`): the tray's
five-second tick consumes it and exits, so the icon is gone before its files are. If the
tray does not answer within ten seconds, one PowerShell call stops it.

## Configuration

`tray.env` is the whole configuration, and both the tray and `start.sh` read it:

```
DISTRO='Debian'
WSL_DIR='/mnt/c/Users/me/.dsh/dsh-web-tray'
WEB_URL='http://127.0.0.1:3080'
WORKSPACE='/home/me/work'
DSH_COMMAND='dsh web --no-open'
SHORTCUT_NAME='DSH Web'
```

Values are single-quoted and taken verbatim, so a value containing a quote or a newline is
rejected at install time rather than silently mangled. Edit the file and re-run
`dsh-web-tray status` to check it; keep LF endings if you edit it on Windows.

Running DSH from a source checkout is just a different command line:

```
WORKSPACE='/home/me/harness'
DSH_COMMAND='pnpm --dir /home/me/harness run dsh:web'
```

`start.sh` `exec`s that command in `WORKSPACE` with its output appended to `start.log` beside
it. It refuses, loudly, when the workspace does not exist. A file at
`~/.dsh/dsh-web-tray.env` (`KEY=VALUE` per line) is sourced first, which is how a token for
an MCP server gets to the launched DSH.

## How it works

```
DSH Web.lnk
 └─ wscript.exe //E:JScript //B dsh-web-tray.js        GUI host: no console is allocated
     └─ powershell.exe -WindowStyle Hidden -File dsh-web-tray.ps1
         ├─ read tray.env → distro, /mnt path, URL, shortcut name
         ├─ build the styled menu, pick the tray ink, repair the Start menu entry
         ├─ start failing open: reuse a window already showing the page, otherwise start
         │  DSH through  wsl.exe -d <distro> -- bash -lc "exec '<dir>/start.sh'"
         │  and finish with a reload or an --app window when the URL answers
         └─ Application.Run(): left click / menu, and one five-second tick that owns the
            tray ink and the uninstall marker
```

The exit entry asks `stop.sh` to stop the instance and closes the windows showing the page;
both calls are hidden and never awaited, because awaiting `wsl.exe` on the UI thread is what
used to wedge the tray. The single-instance mutex is per install directory, so a second
double-click of the same shortcut only shows DSH.

## The only things it asks of DSH

1. Start with the configured command (`dsh web --no-open` by default).
2. Print the launch URL — `http://<host>:<port>/?token=…` — on stdout; the tray reads it from
   `start.log` to open an already-authorised page. If no token is known (an instance someone
   else started), the page is opened without one and may ask you to sign in.
3. `stop.sh` finds the instance by inspecting `/proc/<pid>/cmdline` for `dsh web`, so a stale
   PID file cannot kill an unrelated process. It stops *every* `dsh web` instance it finds.

## Known limitations

- A WSL distribution whose name contains a space cannot be addressed: `wsl.exe` reads the raw
  command line, so no quoting survives.
- `/mnt/<drive>` has to be mounted at run time, because the two shell scripts live on the
  Windows side and are executed from there. A distro with `automount = false` can still show
  and reload an open window, but the tray cannot start DSH.
- The shell scripts and `tray.env` are used from bash, so they must keep LF endings. An
  editor that "fixes" them to CRLF breaks `start.sh`; `dsh-web-tray status` warns about it.
- `start.log` and `tray.log` grow without rotation.
- One install per Windows user; the shortcut's name comes from `SHORTCUT_NAME`.

## Development

```sh
npm test                                  # 34 tests: installer rules, icon assets, tray interop
npm run typecheck
DSH_WEB_TRAY_REQUIRE_INTEROP=1 npm test   # fail instead of skip when Windows is unreachable
```

`tests/tray.spec.ts` runs the real helper with `-SelfTest`, which builds the actual
NotifyIcon and ContextMenuStrip and prints the contract as JSON without showing any UI — that
is where the measured palette, the menu metrics and the two keyboard chords are pinned.
`tests/installer.spec.ts` covers the path, environment and file rules hermetically, and
`tests/icons.spec.ts` parses the bundled `.ico` files and pins their frames and geometry.

## Syncing with upstream

```sh
git remote -v                                 # upstream = liyu34/dsh-wsl-tray
git fetch upstream && git log --oneline upstream/master ^master
```

## License

MIT — see [LICENSE](LICENSE). The original copyright notice is kept from upstream.
