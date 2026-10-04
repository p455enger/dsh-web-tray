import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GENERATED_TRAY_FILE_NAMES,
  LAUNCHER_SCRIPT_NAME,
  LEGACY_CONFIG_NAME,
  LEGACY_STATUS_NAME,
  LEGACY_TRAY_FILE_NAMES,
  TRAY_ICON_BLACK_NAME,
  TRAY_ICON_WHITE_NAME,
  buildLauncherScript,
  buildStartScript,
  buildStopScript,
  buildTrayScript,
} from '../src/artifacts.ts'
import { configuredPathProblem, wslPathToWindowsPath, webUrlFor } from '../src/service.ts'

const LAUNCH = {
  distro: 'Ubuntu',
  webUrl: 'http://127.0.0.1:3080',
  shortcutName: 'DeepSeek Harness',
  wslStartScript: '~/.dsh/dsh-web-tray/start.sh',
  wslStopScript: '~/.dsh/dsh-web-tray/stop.sh',
  wslStartLogPath: '/home/me/.dsh/dsh-web-tray/start.log',
}

function trayScript(): string {
  return buildTrayScript(LAUNCH)
}

describe('generated scripts', () => {
  it('bakes the launch facts into the WSL start script', () => {
    const script = buildStartScript({
      nodeBin: '/usr/bin/node',
      sourceCli: '/home/me/deepseek-harness/apps/cli/lib/bin.js',
      sourceCwd: '/home/me/deepseek-harness',
      bakedCli: null,
      webUrl: 'http://127.0.0.1:3080',
    })
    // Single-quoted, not JSON: a value carrying a quote, a `$(...)` or a newline has
    // to survive bash untouched (the injection test below pins that).
    expect(script).toContain("URL='http://127.0.0.1:3080'")
    expect(script).toContain("SOURCE_CLI='/home/me/deepseek-harness/apps/cli/lib/bin.js'")
    expect(script).toContain('exec "$NODE" "$SOURCE_CLI" web --no-open')
    expect(script).toContain('command -v dsh')
    expect(script).toContain('npx --yes dsh web --no-open')
  })

  it('tracks the launched PID and probes without curl when it is absent', () => {
    const script = buildStartScript({
      nodeBin: '/usr/bin/node',
      sourceCli: null,
      sourceCwd: null,
      bakedCli: null,
      webUrl: 'http://127.0.0.1:3080',
    })
    // PID file written before exec: exec keeps the shell PID, so the manual
    // stop.sh can stop exactly the instance this script launched.
    expect(script).toContain('PID_FILE="$HOME/.dsh/dsh-web-tray/dsh.pid"')
    expect(script).toContain('echo $$ > "$PID_FILE"')
    // Dependency chain so a minimal distro still detects a live DSH.
    expect(script).toContain('command -v curl')
    expect(script).toContain('command -v wget')
    expect(script).toContain('/dev/tcp/$host/$port')
  })

  it('generates a stop script whose pkill cannot match its own wrapper', () => {
    const stop = buildStopScript()
    expect(stop).toContain('PID_FILE="$HOME/.dsh/dsh-web-tray/dsh.pid"')
    expect(stop).toContain('kill -0 "$pid"')
    // A stale PID file plus a reused PID must not kill an unrelated process: the
    // command line is verified before anything is signalled.
    expect(stop).toContain('is_dsh_web')
    expect(stop).toContain('/proc/$1/cmdline')
    expect(stop).toContain('is not a DSH web process; leaving it alone')
    // The bracketed class means the literal pattern text in the wsl.exe/bash
    // command line never matches the regex.
    expect(stop).toContain("pkill -f '[b]in\\.js web'")
    // The fallback enumerates candidates and applies the same predicate to each: a
    // global install's command line is `node /usr/local/bin/dsh web`, which none of
    // the bin.js patterns match, while a `grep dsh web` of your own is never
    // signalled because the predicate reads /proc instead of trusting the pattern.
    expect(stop).toContain("pgrep -f '[d]sh web'")
    expect(stop).toContain('is_dsh_web "$pid"')
    expect(stop).toContain('*"dsh web"*')
    expect(new RegExp('[b]in\\.js web').test('[b]in\\.js web')).toBe(false)
    expect(new RegExp('[b]in\\.js web').test('node /x/apps/cli/lib/bin.js web --no-open')).toBe(true)
    expect(new RegExp('[b]in\\.js web').test('node /x/.npm-global/lib/node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open')).toBe(true)
  })

  it('builds a JScript launcher that does not depend on the .vbs engine mapping', () => {
    const launcher = buildLauncherScript()
    expect(LAUNCHER_SCRIPT_NAME.endsWith('.js')).toBe(true)
    // wscript.exe is the GUI-subsystem host that keeps the console away. The
    // launcher must not be a plain .vbs: a machine with no engine mapped to
    // .vbs (VBScript is a Feature-on-Demand since Windows 11 24H2) cannot run
    // one at all, and that is what killed the desktop shortcut.
    expect(launcher).toContain("new ActiveXObject('WScript.Shell')")
    expect(launcher).toContain('dsh-web-tray.ps1')
    expect(launcher).toContain(', 0, false)')
    expect(launcher).toContain('-WindowStyle Hidden')
    expect(launcher).toContain('WindowsPowerShell')
    expect(launcher).not.toContain('WScript.Echo')
  })
})

describe('generated tray helper', () => {
  it('offers exactly the two desktop-app menu entries and nothing else', () => {
    const script = trayScript()
    expect(script).toContain("$openLabel = '打开 DeepSeek Harness'")
    expect(script).toContain("$exitLabel = '退出 DeepSeek Harness'")
    expect(script).toContain('$menu.Items.Add($openLabel)')
    expect(script).toContain('$menu.Items.Add($exitLabel)')
    expect(script).toContain('New-Object System.Windows.Forms.ToolStripSeparator')
    expect(script).toContain('$openItem.Add_Click({ Start-OpenFlow })')
    // The exit entry says "exit DeepSeek Harness", so it also stops the WSL
    // instance — hidden and never awaited; the self test calls Close-Tray
    // without the switch so a test run can never stop a real DSH.
    expect(script).toContain('$exitItem.Add_Click({ Close-Tray -StopDsh })')
    expect(script).toContain('function Stop-Dsh')
    // Both parsers get a quoted argument: a distro name with a space (legal for
    // `wsl --import`) or a script path with a space used to split into the wrong
    // arguments and silently do nothing.
    // The distro goes in bare: wsl.exe reads the raw command line and would keep the
    // quotes ("Debian" is not a distro name), while the inner command needs them.
    expect(script).toContain("'wsl.exe -d ' + $distro + ' -- bash -lc ' + (ConvertTo-WindowsArg $inner)")
    expect(script).toContain('function ConvertTo-WindowsArg')
    expect(script).toContain('function ConvertTo-BashSingleQuoted')
    expect(script).toContain('function Close-Tray([switch]$StopDsh)')
    expect(script).toContain("Close-Tray\n  return")
    // Left click shows DSH, right click opens the menu — the desktop app's tray
    // reacts to the same two gestures.
    expect(script).toContain('$tray.Add_MouseUp({')
    expect(script).toContain('[System.Windows.Forms.MouseButtons]::Left')
    expect(script).toContain('[System.Windows.Forms.MouseButtons]::Right')
    expect(script).toContain('function Show-TrayMenu')
    // Anchored at the cursor like the app: bottom-left on the pointer, growing up
    // and right (the app's own menu puts its panel bottom-left exactly on the
    // click point), not parked above the taskbar inside the working area.
    expect(script).toContain('$menu.Show($cursor.X, $cursor.Y - $script:trayMenu.Height)')
    // Opening reuses what is already on screen before it opens anything: a browser
    // window that already shows the page — an installed web app window first, then a
    // tab window — and only then the web page with this run's token.
    expect(script).toContain('function Open-DshSurface')
    expect(script).toContain('function Find-DshWindow')
    expect(script).toContain("$dshAppProcessName = 'DeepSeek Harness.exe'")
    expect(script).toContain("$process.CommandLine -match '--app(-id)?='")
    expect(script).toContain("$dshWindowClass = 'Chrome_WidgetWin_1'")
    expect(script).toContain('[DshTrayTarget]::FindTitledWindows($dshPageTitleNeedle, $dshWindowClass)')
    expect(script).toContain('[DshTrayTarget]::Focus')
    expect(script).toContain('AttachThreadInput')
    expect(script).toContain('keybd_event(VkMenu, 0, 0, UIntPtr.Zero)')
    // The Electron desktop app is a different program with its own backend: the tray
    // must not look it up, launch it, or focus its window.
    expect(script).not.toContain('com.deepseek.dsh')
    expect(script).not.toContain('TargetParsingPath')
    expect(script).not.toContain('shell:AppsFolder')
    // Both open paths try reuse first (the menu/left click and the second instance), and
    // the second instance then waits for a DSH it had to start before reloading the
    // window it found — never opening a second copy of the page.
    expect(script.split('if (Open-DshSurface) {').length - 1).toBe(2)
    expect(script).toContain('if ($script:reloadHandle -ne [IntPtr]::Zero) { Wait-ForDsh }')
    expect(script).toContain('reloaded the DSH window that was already open')
    // A reused window is only useful if the instance behind it is up: a page left on an
    // error page must not become a dead end (the probe is a local request).
    expect(script).toContain('was not answering behind that window; started DSH through')
    // WinForms would also open a ContextMenuStrip on a single left click, so the
    // menu is shown by hand instead of through the NotifyIcon property.
    expect(script).not.toContain('$tray.ContextMenuStrip')
    expect(script).not.toContain('Add_DoubleClick')
  })

  it('drops the watchdog, the idle stop and the switch file entirely', () => {
    const script = trayScript()
    for (const gone of [
      'netstat',
      'Get-NetTCPConnection',
      'watchdog',
      'Update-Watchdog',
    ]) {
      expect(script).not.toContain(gone)
    }
    // The 0.1.0 state files are named exactly once each: in the baked -Uninstall list
    // that deletes them. Nothing reads or writes them any more.
    for (const legacy of [LEGACY_CONFIG_NAME, LEGACY_STATUS_NAME]) {
      expect(script.split(`'${legacy}'`)).toHaveLength(2)
    }
    // No awaited wsl.exe call anywhere: waiting for it on the UI thread is what
    // used to freeze the tray solid. Both the start and the stop path run it
    // hidden and non-blocking.
    expect(script).toContain('$shell.Run((Get-WslCommand $wslStartScript), 0, $false)')
    expect(script.split(', 0, $true)')).toHaveLength(1)
    expect(script).toContain('function Close-Tray([switch]$StopDsh)')
    expect(script).toContain("Write-TrayLog 'INFO' 'tray exit requested; DSH keeps running'")
  })

  it('reproduces the desktop app menu, whose colours and metrics were measured', () => {
    const script = trayScript()
    // The app's menu is Chromium's, so it cannot be asked for: it is drawn from
    // the palette and metrics measured off the app's own tray icon.
    expect(script).toContain('Color.FromArgb(0x1F, 0x1F, 0x1F)') // panel
    expect(script).toContain('Color.FromArgb(0x36, 0x36, 0x36)') // hovered item
    expect(script).toContain('Color.FromArgb(0x5E, 0x5E, 0x5E)') // separator
    expect(script).toContain('Color.FromArgb(0xE3, 0xE3, 0xE3)') // item text
    expect(script).toContain('DshTrayMenuColors')
    expect(script).toContain('DshTrayMenuRenderer')
    // Corners come from the window manager, which anti-aliases them and brings
    // its own shadow; a Region clip cannot do either.
    expect(script).toContain('DshTrayCorners')
    expect(script).toContain('DwmSetWindowAttribute')
    expect(script).toContain('private const int CornerPreference = 33')
    // Windows would otherwise draw its 1 px window border around the rounded
    // popup, which the app's borderless menu does not have.
    expect(script).toContain('private const int BorderColor = 34')
    expect(script).toContain('$menu.Add_Opened({ Update-MenuCorners })')
    for (const gone of ['DshTrayMenuShape', '$cornerRadiusPx', '.Region =']) {
      expect(script.split(gone)).toHaveLength(1)
    }
    // The frame the default renderer draws is what the app does not have, and
    // the app's separator runs the full panel width where WinForms insets it.
    expect(script).toContain('protected override void OnRenderToolStripBorder')
    expect(script).toContain('protected override void OnRenderSeparator')
    // The app centres item text in its 28 px box, insets it 20 px, and paints it
    // heavy; the label is drawn here with GDI+ ClearType twice (GDI ClearType is
    // measurably thinner) and placed by the ink box DshTrayText measures, which is
    // also what sizes the panel.
    expect(script).toContain('protected override void OnRenderItemText')
    expect(script).toContain('TextRenderingHint.ClearTypeGridFit')
    expect(script).toContain('DshTrayText.InkBox(e.Text, font)')
    expect(script).toContain('float left = e.Item.Bounds.Left + TextInsetPx - ink.Left')
    expect(script).toContain('(e.Item.Bounds.Height - ink.Height) / 2f - ink.Top + TextDropPx')
    // The app's labels sit ~1 px below their box centre, which is what keeps the
    // space under the last line at 18 px instead of 19-20.
    expect(script).toContain('$itemTextDropPx = 1')
    expect(script).toContain('[DshTrayMenuRenderer]::TextDropPx = (Get-Scaled $itemTextDropPx)')
    // WinForms' own sizing reserves the image margin (214 px of content for a
    // 175 px label) and the drop-down width varied with it, which left a long
    // blank strip on the right: the panel is sized from the measured ink instead.
    expect(script).toContain('$panelWidth = $inkWidth + 2 * $itemInset')
    expect(script).toContain('$openItem.AutoSize = $false')
    expect(script).toContain('$menu.AutoSize = $false')
    expect(script).toContain('$menu.Size = New-Object System.Drawing.Size($panelWidth, $panelHeight)')
    // Removing the bundle runs no plugin code, so the helper carries the cleanup:
    // every path it wrote, the shortcut, and any tray started from that directory.
    expect(script).toContain('[switch]$Uninstall')
    expect(script).toContain('function Remove-DshArtifacts')
    expect(script).toContain("Remove-Item -LiteralPath $lnkPath -Force")
    expect(script).toContain('$wslStartScript -replace \'/[^/]+$\', \'\'')
    // Quoted, and the exit code is checked: an unquoted path with a space deleted the
    // wrong directory, and an unchecked call reported success anyway.
    expect(script).toContain("('rm -rf -- ' + (ConvertTo-BashQuotedPath $wslDir))")
    expect(script).toContain('if ($LASTEXITCODE -eq 0) {')
    expect(script).toContain("Write-Output ('kept ' + $scriptDir + ': '")
    expect(script).toContain('if ($Uninstall) {')
    // The app's own font family, not the Windows menu font (YaHei UI 12pt here),
    // and not a hard-coded Segoe either: the resolved family is the system UI one.
    expect(script).toContain('$menuFont = [DshTrayFont]::MenuFont(9)')
    expect(script).toContain('"Microsoft YaHei UI"')
    expect(script).toContain('"Segoe UI"')
    // Metrics, in 96-DPI pixels.
    expect(script).toContain('$panelPaddingPx = 12')
    expect(script).toContain('$itemHeightPx = 28')
    expect(script).toContain('$itemTextInsetPx = 20')
    expect(script).toContain('$separatorGapPx = 17')
    expect(script).toContain('ShowImageMargin = $false')
    expect(script).toContain('ShowCheckMargin = $false')
    expect(script).toContain('$menu.Add_Opened({ Update-MenuCorners })')
    // DPI awareness and visual styles, or Windows bitmap-scales the menu and
    // the renderer falls back to system colours (accent-blue hover).
    expect(script).toContain('[DshTraySetup]::Enable()')
    expect(script).toContain('SetProcessDPIAware')
    expect(script).toContain('Application.EnableVisualStyles')
    // A console-hosted PowerShell owns a console window, and Windows names an
    // unowned top-level window after its process — that is what listed the menu as
    // "Windows PowerShell". Tray mode drops the console and the popup is a tool
    // window, so it never gets a taskbar button or an Alt-Tab entry.
    expect(script).toContain('[DshTraySetup]::DetachConsole()')
    expect(script).toContain('FreeConsole')
    expect(script).toContain('[DshTrayWindow]::MarkToolWindow')
    expect(script).toContain("$menu.Add_Opening({ try { [DshTrayWindow]::MarkToolWindow($script:trayMenu.Handle) } catch {} })")
    expect(script).toContain('private const long WsExToolWindow = 0x00000080L')
    // Detached only in tray mode: the flags that print keep their console.
    const detachIndex = script.indexOf('[DshTraySetup]::DetachConsole()')
    expect(script.indexOf("if ($SelfTest)")).toBeLessThan(detachIndex)
    // No Win32 popup menu any more: the Windows 11 menu (acrylic #2C2C2C, white
    // text, its own paddings) is a different look from the app's.
    for (const gone of ['CreatePopupMenu', 'TrackPopupMenuEx']) {
      expect(script.split(gone)).toHaveLength(1)
    }
    // The tray wears the page's favicon mark, one ink per taskbar theme, loaded at
    // the notification area's own frame size.
    expect(script).toContain(`Join-Path $scriptDir '${TRAY_ICON_BLACK_NAME}'`)
    expect(script).toContain(`Join-Path $scriptDir '${TRAY_ICON_WHITE_NAME}'`)
    // The theme key needs its backslashes at runtime: this script is generated from
    // a template literal, which drops a lone `\S` and friends and left the key as
    // 'HKCU:SoftwareMicrosoftWindows...' — a path that throws, and a throwing theme
    // read is the light fallback, i.e. a black icon on a dark taskbar.
    expect(script).toContain('SystemUsesLightTheme')
    expect(script).toContain("'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'")
    expect(script).toContain('[System.Windows.Forms.SystemInformation]::SmallIconSize')
    expect(script).toContain("Join-Path $scriptDir 'dsh-web-tray.ico'")
  })

  it('opens DSH when asked, reusing or starting it, and reports the token URL', () => {
    const script = trayScript()
    expect(script).toContain('function Test-DshAlive')
    expect(script).toContain('Invoke-WebRequest -Uri $webUrl -UseBasicParsing -TimeoutSec $probeTimeoutSec')
    expect(script).toContain('function Start-OpenFlow')
    expect(script).toContain('function Invoke-OpenFlowAndWait')
    expect(script).toContain('function Start-DshWsl')
    expect(script).toContain("function Get-WslCommand([string]$scriptPath)")
    // A path quoter, not the plain string one: a tilde has to stay expandable.
    expect(script).toContain("$inner = 'exec ' + (ConvertTo-BashQuotedPath $scriptPath)")
    expect(script).toContain("function ConvertTo-BashQuotedPath([string]$path)")
    expect(script).toContain('wslStartCommand = (Get-WslCommand $wslStartScript)')
    expect(script).toContain('function Get-WebAuthUrl')
    expect(script).toContain('?token=')
    expect(script).toContain('wslStartLogUnc')
    // A fresh tray opens DSH right away: that is what the shortcut is for.
    expect(script).toContain('Start-OpenFlow')
    expect(script).toContain('[System.Windows.Forms.Application]::Run()')
  })

  it('keeps the shortcut plumbing: engine probe, self test and -Regenerate', () => {
    const script = trayScript()
    expect(script).toContain('function Test-ScriptEngine([string]$name)')
    expect(script).toContain("Test-ScriptEngine 'JScript'")
    expect(script).toContain('function Get-ShortcutTarget')
    expect(script).toContain("'//E:JScript //B \"' + $launcherPath + '\"'")
    expect(script).toContain('-WindowStyle Hidden -File')
    expect(script).toContain('$shortcut.TargetPath = $target.Path')
    expect(script).toContain("$shortcut.IconLocation = $iconPath + ',0'")
    // Explorer caches a shortcut's icon by path, so a restyled .ico only shows up
    // after the shell cache is dropped.
    expect(script).toContain('function Update-ShellIconCache')
    expect(script).toContain('SHChangeNotify(0x08000000, 0x1000')
    expect(script).toContain('Update-ShellIconCache')
    // The tray helper is exercisable without a UI.
    expect(script).toContain('[switch]$SelfTest')
    expect(script).toContain('ConvertTo-Json -Compress -Depth 4')
    expect(script).toContain('if ($Regenerate) {')
  })

  it('escapes single quotes in baked PowerShell values', () => {
    const script = buildTrayScript({ ...LAUNCH, shortcutName: "Tray's Harness" })
    // '' doubling is the PowerShell single-quote escape; without it a quote
    // in a value would terminate the baked string.
    expect(script).toContain("$shortcutName = 'Tray''s Harness'")
  })

  it('carries non-ASCII labels, so the host must write it with a UTF-8 BOM', () => {
    const script = trayScript()
    // Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI: the Chinese menu
    // labels get mis-decoded, quotes get swallowed and the script fails to
    // parse. `regenerate()` writes the BOM; this pins down why it must.
    expect(/[^\u0000-\u007f]/.test(script)).toBe(true)
    expect(script).toContain('打开 DeepSeek Harness')
  })
})

describe('source-checkout launches', () => {
  const DSH_ON_PATH = 'command -v dsh >/dev/null 2>&1'
  const CONFIGURED_BRANCH = 'if [ "$SOURCE_CONFIGURED" = "1" ]; then'
  // The two call sites differ only by indentation, which is what makes the
  // launcher order assertable: 4 spaces inside the configured branch (first),
  // 2 spaces in the plain fallback chain (after the PATH check).
  const CONFIGURED_CALL = '    if source_build_ready; then\n      start_from_source_build'
  const FALLBACK_CALL = '  if source_build_ready; then\n    start_from_source_build'

  function startScript(sourceConfigured: boolean): string {
    return buildStartScript({
      nodeBin: '/usr/bin/node',
      sourceCli: '/home/me/deepseek-harness/apps/cli/lib/bin.js',
      sourceCwd: '/home/me/deepseek-harness',
      bakedCli: null,
      sourceConfigured,
      webUrl: 'http://127.0.0.1:3080',
    })
  }

  /** The launch_dsh body, where the launcher order actually lives. */
  function launchBody(script: string): string {
    return script.slice(script.indexOf('launch_dsh() {'), script.indexOf('\nlaunch_dsh\n'))
  }

  it('runs a configured checkout from its build output before the PATH dsh', () => {
    const body = launchBody(startScript(true))
    expect(body).toContain(CONFIGURED_BRANCH)
    expect(body.indexOf(CONFIGURED_CALL)).toBeGreaterThan(-1)
    expect(body.indexOf(CONFIGURED_CALL)).toBeLessThan(body.indexOf(DSH_ON_PATH))
  })

  it('keeps the PATH-first fallback order when no project path is configured', () => {
    const body = launchBody(startScript(false))
    expect(body.indexOf(DSH_ON_PATH)).toBeGreaterThan(-1)
    expect(body.indexOf(DSH_ON_PATH)).toBeLessThan(body.indexOf(FALLBACK_CALL))
  })

  it('never launches src, which would mix a src and a lib instance', () => {
    const script = startScript(true)
    expect(script).not.toContain('tsx')
    expect(script).not.toContain('src/bin.ts')
    expect(script).toContain('exec "$NODE" "$SOURCE_CLI" web --no-open')
  })

  it('fails loudly with the fix when the configured checkout was never built', () => {
    const script = startScript(true)
    expect(script).toContain('ERROR source build output is missing')
    expect(script).toContain('pnpm run build')
    expect(script).toContain('exit 1')
  })

  it('warns when the cli sources are newer than the build output', () => {
    const script = startScript(true)
    expect(script).toContain('source_build_stale')
    expect(script).toContain('newer than the build output')
    expect(script).toContain('find "$src_dir" -name \'*.ts\' -newer "$SOURCE_CLI"')
  })

  it('never builds a checkout behind the user\'s back', () => {
    const script = startScript(true)
    // A missing build output is reported, not silently repaired with a
    // multi-minute `pnpm run build` inside a launcher: the two mentions are the
    // WARN and the ERROR line, and both only write to the log.
    expect(script).not.toContain('AUTO_BUILD')
    expect(script).not.toContain('auto_build')
    expect(script.split('pnpm run build').length - 1).toBe(2)
    expect(script).toContain('log "WARN cli sources are newer than the build output; run \'pnpm run build\' to refresh $SOURCE_CLI"')
    expect(script).toContain('log "ERROR build the checkout before launching it:')
  })

  it('drives any Chromium browser, and only a browser', () => {
    const script = trayScript()
    // The window class is shared by every Chromium *application*: QQ, Jitsi Meet and the
    // DSH desktop app itself all draw Chrome_WidgetWin_1 windows. A matched window must
    // belong to a real browser before the tray reloads or drives it.
    expect(script).toContain('$browserProcessNames = @(')
    for (const name of ['chrome.exe', 'msedge.exe', 'brave.exe', 'vivaldi.exe', 'opera.exe', 'chromium.exe', 'yandex.exe', 'thorium.exe']) {
      expect(script).toContain(`'${name}'`)
    }
    expect(script).toContain('function Test-BrowserProcess($process)')
    expect(script).toContain('if (-not (Test-BrowserProcess $process)) { $none.SkippedOther = $none.SkippedOther + 1; continue }')
    // Opening the page prefers an app window (--app), in the browser the user was already
    // working in or in the default one when that is Chromium-like; a non-Chromium default
    // still gets a plain open, and --single-argument keeps the flags out of the way.
    expect(script).toContain("$appArgument = '--app=' + $url")
    expect(script).toContain('function Get-OpenPageCommand([string]$url)')
    expect(script).toContain('Start-Process -FilePath $open.Exe -ArgumentList $open.Args')
    expect(script).toContain('Start-Process $target')
    expect(script).toContain("if ($command -notmatch '--single-argument')")
    // No install path is baked in: the browser comes from the window or the registry.
    expect(script).not.toContain('Google\\Chrome')
  })
  it('stops a dev instance that was launched from source', () => {
    expect(buildStopScript()).toContain("pkill -f '[s]rc/bin\\.ts web'")
  })

  it('rejects a configured project path that does not exist', () => {
    expect(configuredPathProblem('/definitely/not/here')).toContain('does not exist')
    expect(configuredPathProblem('')).toBeNull()
    expect(configuredPathProblem('   ')).toBeNull()
  })
})

describe('path and URL helpers', () => {
  it('maps /mnt/c paths to Windows drive-letter paths', () => {
    expect(wslPathToWindowsPath('/mnt/c/Users/A/.dsh/x.ps1')).toBe('C:\\Users\\A\\.dsh\\x.ps1')
  })

  it('uses loopback for a webserver bound to all interfaces', () => {
    expect(webUrlFor({ host: '0.0.0.0', port: 3080 })).toBe('http://127.0.0.1:3080')
    expect(webUrlFor({ host: '127.0.0.1', port: 9090 })).toBe('http://127.0.0.1:9090')
  })
})

describe('quoting, cleanup and the upgrade path', () => {
  it('never executes a value baked into start.sh', () => {
    // JSON.stringify is not shell quoting: inside double quotes bash expanded
    // `$(...)` and turned a newline into a literal backslash-n. A path like this is
    // settable through the settings card, so the generator has to quote it.
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tray-quote-'))
    const marker = join(dir, 'PWNED')
    const nasty = `${dir}/x$(touch ${marker})/it's/a b/apps/cli/lib/bin.js`
    try {
      const script = buildStartScript({
        nodeBin: '/usr/bin/node',
        sourceCli: nasty,
        sourceCwd: dir,
        bakedCli: null,
        webUrl: 'http://127.0.0.1:3080',
        sourceConfigured: true,
      })
      // Only the assignment header, so nothing is launched.
      const header = script.slice(0, script.indexOf('# Forward machine-local secrets'))
      const value = execFileSync('bash', ['-c', `${header}\nprintf '%s' "$SOURCE_CLI"`], { encoding: 'utf8' })
      expect(value).toBe(nasty)
      expect(existsSync(marker)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps a tab and a newline in a baked value byte-exact', () => {
    const weird = '/tmp/a\tb/c\nd/apps/cli/lib/bin.js'
    const script = buildStartScript({
      nodeBin: '/usr/bin/node',
      sourceCli: weird,
      sourceCwd: '/tmp/a\tb',
      bakedCli: null,
      webUrl: 'http://127.0.0.1:3080',
    })
    const header = script.slice(0, script.indexOf('# Forward machine-local secrets'))
    const value = execFileSync('bash', ['-c', `${header}\nprintf '%s' "$SOURCE_CLI"`], { encoding: 'utf8' })
    expect(value).toBe(weird)
  })

  it('reads the token URL for the configured host and port, not for a hardcoded 127.0.0.1', () => {
    const script = trayScript()
    expect(script).toContain("[regex]::Escape($webUrl) + '/\\?token=")
    expect(script).not.toContain('127\\.0\\.0\\.1:\\d+')
  })

  it('honours a generic secrets file and still reads the old personal one', () => {
    const script = buildStartScript({
      nodeBin: '/usr/bin/node',
      sourceCli: null,
      sourceCwd: null,
      bakedCli: null,
      webUrl: 'http://127.0.0.1:3080',
    })
    expect(script).toContain('for env_file in "$HOME/.dsh/dsh-web-tray.env" "$HOME/.dsh/github-mcp-token"; do')
    expect(script).toContain('. "$env_file"')
    // The script only reads it: creating a secrets file is the user's job.
    expect(script).not.toContain('touch "$HOME/.dsh/dsh-web-tray.env"')
  })

  it('bakes the uninstall list from the same names the host writes', () => {
    const script = trayScript()
    for (const name of [...GENERATED_TRAY_FILE_NAMES, ...LEGACY_TRAY_FILE_NAMES]) {
      expect(script).toContain(`'${name}'`)
    }
    // One list drives the removal loop, and anything left over is reported instead
    // of being passed off as a clean uninstall.
    expect(script).toContain('$ownFiles = @(')
    expect(script).toContain('foreach ($name in $ownFiles) {')
    expect(script).toContain("Write-Output ('kept ' + $scriptDir + ': '")
  })

  it('leaves a trace and degrades when the menu style cannot be compiled', () => {
    const script = trayScript()
    // The tray is started hidden by wscript.exe: an unhandled terminating error used
    // to mean "the shortcut does nothing" with an empty log.
    expect(script).toContain('trap {')
    expect(script).toContain("Write-TrayLog 'ERROR' ('unhandled: {0}' -f $_)")
    expect(script).toContain('exit 1')
    // Every type that comes from the styled C# is behind the flag, so a style that
    // failed to compile still leaves a working menu.
    expect(script).toContain('$script:styledMenu = $false')
    // Both contexts the helper runs in get a sane module path: the host spawns it from
    // WSL, where the Windows user environment can point PowerShell 5.1 at PowerShell 7
    // modules and cmdlets like Get-FileHash stop resolving.
    expect(script).toContain("$env:PSModulePath = $PSHOME + '\\Modules'")
    expect(script).toContain('if ($script:styledMenu) {')
    expect(script).toContain('$menuFont = [System.Drawing.SystemFonts]::DefaultFont')
  })

  it('records what the shortcut is supposed to be, so a stale one is rebuilt', () => {
    const script = trayScript()
    expect(script).toContain("Join-Path $scriptDir 'tray-shortcut.json'")
    expect(script).toContain('lnkBytes = $lnk.Length')
    // The digest is computed with .NET on purpose: Get-FileHash does not resolve in the
    // PowerShell the host spawns through WSL interop.
    expect(script).toContain('lnkSha256 = $digest')
    expect(script).toContain('[System.Security.Cryptography.SHA256]::Create()')
    expect(script).not.toContain('= (Get-FileHash')
  })

  it('never steals the foreground from a plain self test', () => {
    const script = trayScript()
    expect(script).toContain('if ($SelfTestFocus) { $focusReturned = [DshTrayTarget]::Focus($matcherProbe.Handle) }')
    // The probe window is off-screen as well: a test run must not flash one either.
    expect(script).toContain('$matcherProbe.Location = New-Object System.Drawing.Point(-32000, -32000)')
    expect(script).toContain('$matcherPlacement = [DshTrayTarget]::PlacementSummary($matcherProbe.Handle)')
  })
})