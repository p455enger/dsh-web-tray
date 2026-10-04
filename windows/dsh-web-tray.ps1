# dsh-web-tray 1.0 — the Windows tray for a `dsh web` instance running inside WSL.
#
# Started by the Start menu shortcut (wscript -> hidden powershell) or by the installer with
# -ShortcutOnly. Everything it needs is in tray.env next to this file. It never reads the
# WSL file system: the only things it asks of WSL are the two shell scripts beside it
# (start.sh / stop.sh), which it runs through wsl.exe.
param(
  # Build the real menu and print the contract as JSON, then exit without showing any UI.
  [switch]$SelfTest,
  # Also exercise the focus call in -SelfTest, which takes the foreground for a moment.
  [switch]$SelfTestFocus,
  # Write the Start menu shortcut and its stamp, then exit. Used by the installer and by this
  # script's own start-up repair.
  [switch]$ShortcutOnly
)

$ErrorActionPreference = 'Stop'
# This script also runs as a child of the installer, which hands it the *user* environment:
# on a machine that also has PowerShell 7, that environment lists 7's module directories
# first and 5.1 then fails to autoload its own cmdlets. $PSHOME's tree is all it needs, and
# the assignment cannot leak into the parent process.
$env:PSModulePath = $PSHOME + '\Modules'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# An exception escaping a timer or menu handler would raise a modal error dialog inside a
# process nobody can see: the tray would look frozen and need Task Manager, and the global
# trap never sees exceptions raised inside the message loop. Log them and keep running.
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)
[System.Windows.Forms.Application]::add_ThreadException({
  param($sender, $eventArgs)
  Write-TrayLog 'ERROR' ('unhandled on the UI thread: {0}' -f $eventArgs.Exception.Message)
})

$scriptDir = Split-Path -Parent $PSCommandPath

# ---- configuration: tray.env, written by `dsh-web-tray install` ----
# One `KEY='value'` per line, shell-quoted. Parsed rather than sourced: the values are read
# here, so a stray CR from an editor on Windows cannot ride along in every path.
function Read-TrayEnv([string]$path) {
  $values = @{}
  foreach ($line in @(Get-Content -LiteralPath $path -Encoding UTF8 -ErrorAction Stop)) {
    $text = $line.TrimEnd([char]13)
    if ($text -eq '' -or $text.StartsWith('#')) { continue }
    $split = $text.IndexOf('=')
    if ($split -lt 1) { continue }
    $name = $text.Substring(0, $split).Trim()
    $value = $text.Substring($split + 1).Trim()
    if ($value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")) {
      $value = $value.Substring(1, $value.Length - 2).Replace("'\''", "'")
    }
    $values[$name] = $value
  }
  return $values
}

$trayEnvPath = Join-Path $scriptDir 'tray.env'
if (-not (Test-Path -LiteralPath $trayEnvPath)) {
  Write-Output ('dsh-web-tray: no tray.env beside ' + $PSCommandPath + ' — run: dsh-web-tray install')
  exit 1
}
$config = Read-TrayEnv $trayEnvPath
$distro = [string]$config['DISTRO']
$wslDir = [string]$config['WSL_DIR']
if ($distro -eq '' -or $wslDir -eq '') {
  Write-Output ('dsh-web-tray: tray.env needs DISTRO and WSL_DIR: ' + $trayEnvPath)
  exit 1
}
$webUrl = [string]$config['WEB_URL']
if ($webUrl -eq '') { $webUrl = 'http://127.0.0.1:3080' }
# The shortcut's file name and the tray's tooltip. Configurable so an install can be
# exercised without rewriting the shortcut someone already has.
$shortcutName = [string]$config['SHORTCUT_NAME']
if ($shortcutName -eq '') { $shortcutName = 'DeepSeek Harness (Web)' }

# The shell scripts sit beside this file, and WSL reaches that same directory through
# /mnt/<drive>; WSL_DIR is that path, computed by the installer.
$wslStartScript = $wslDir + '/start.sh'
$wslStopScript = $wslDir + '/stop.sh'
$startLogPath = Join-Path $scriptDir 'start.log'
$trayLogPath = Join-Path $scriptDir 'tray.log'
$exitFlagPath = Join-Path $scriptDir 'tray-exit.flag'
$iconPath = Join-Path $scriptDir 'dsh-web-tray.ico'
$trayIconBlackPath = Join-Path $scriptDir 'dsh-web-tray-black.ico'
$trayIconWhitePath = Join-Path $scriptDir 'dsh-web-tray-white.ico'
$launcherPath = Join-Path $scriptDir 'dsh-web-tray.js'
$stampPath = Join-Path $scriptDir 'tray-shortcut.json'

# Menu labels, in the desktop app's wording and order.
$openLabel = '打开 DeepSeek Harness'
$exitLabel = '退出 DeepSeek Harness'
# How long a started DSH gets to answer before the tray gives up opening a page.
$openTimeoutSec = 120
# The liveness probe runs on the UI thread, so it gets a bound a local connect cannot
# exceed; a slow answer only costs a redundant start.sh run, which exits at once when DSH
# is already up.
$probeTimeoutMs = 500

# Menu metrics, in 96-DPI pixels. The palette lives in the C# below; both were measured off
# the desktop app's own tray menu on the same screen at the same DPI, and tests/tray.spec.ts
# pins every number. Windows 11 rounds the popup itself, so no corner radius lives here.
$panelPaddingPx = 12
$itemHeightPx = 28
$itemTextInsetPx = 20
$separatorGapPx = 17
$itemTextDropPx = 1
# ---- log ----
# One line per event; the tray writes a handful per run.
function Write-TrayLog([string]$Level, [string]$Message) {
  try {
    Add-Content -Path $trayLogPath -Value ('{0} | {1,-5} | {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message) -Encoding UTF8
  } catch {}
}

# The tray starts hidden, so an error that escaped would look exactly like a shortcut
# that does nothing, and the log is the only place a user can look.
trap {
  try { Write-TrayLog 'ERROR' ('unhandled: {0}' -f $_) } catch {}
  Write-Output ('dsh-web-tray: ' + $_)
  exit 1
}

# Quoting for the two parsers a wsl.exe command line passes through: CreateProcess, which
# keeps the raw line, and bash, which receives what -lc was given. wsl.exe wants the distro
# name bare — a quoted name is looked up literally — and wants the inner command as one
# argument, which is exactly what these two build.
function ConvertTo-WindowsArg([string]$value) { return '"' + $value.Replace('"', '\"') + '"' }
function ConvertTo-BashSingleQuoted([string]$value) { return "'" + $value.Replace("'", "'\''") + "'" }

# ---- shortcut ----
# The Start menu entry point: a .lnk to the hidden-console launcher, carrying the app icon.
function Test-ScriptEngine([string]$name) {
  try {
    $clsid = (Get-ItemProperty -LiteralPath ('HKLM:\SOFTWARE\Classes\' + $name + '\CLSID') -ErrorAction Stop).'(default)'
    if (-not $clsid) { return $false }
    $dll = (Get-ItemProperty -LiteralPath ('HKLM:\SOFTWARE\Classes\CLSID\' + $clsid + '\InprocServer32') -ErrorAction Stop).'(default)'
    if (-not $dll) { return $false }
    return (Test-Path -LiteralPath ([Environment]::ExpandEnvironmentVariables($dll)))
  } catch {
    return $false
  }
}

function Get-ShortcutTarget {
  $system = [Environment]::SystemDirectory
  if (Test-ScriptEngine 'JScript') {
    return [pscustomobject]@{
      Path = (Join-Path $system 'wscript.exe')
      Arguments = '//E:JScript //B "' + $launcherPath + '"'
    }
  }
  return [pscustomobject]@{
    Path = (Join-Path $system 'WindowsPowerShell\v1.0\powershell.exe')
    Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $scriptDir 'dsh-web-tray.ps1') + '"'
  }
}

# Explorer caches a shortcut's icon by path, so a restyled .ico keeps showing the
# old art — a stale icon is what made the shortcut look wrong after a regenerate.
# SHCNE_ASSOCCHANGED + SHCNF_FLUSH is the documented way to drop that cache.
function Update-ShellIconCache {
  try {
    if (-not ('DshWebTray.Shell32' -as [type])) {
      Add-Type -Namespace DshWebTray -Name Shell32 -MemberDefinition @'
[DllImport("shell32.dll", CharSet=CharSet.Auto)]
public static extern void SHChangeNotify(int eventId, uint flags, System.IntPtr item1, System.IntPtr item2);
'@
    }
    [DshWebTray.Shell32]::SHChangeNotify(0x08000000, 0x1000, [System.IntPtr]::Zero, [System.IntPtr]::Zero)
  } catch {
    Write-TrayLog 'WARN' ('could not refresh the shell icon cache: {0}' -f $_.Exception.Message)
  }
}

function New-DshShortcut {
  # The Start menu, not the desktop — one entry per user, where an installer would put it.
  $programs = [Environment]::GetFolderPath('Programs')
  $lnkPath = Join-Path $programs ($shortcutName + '.lnk')
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($lnkPath)
  $target = Get-ShortcutTarget
  $shortcut.TargetPath = $target.Path
  $shortcut.Arguments = $target.Arguments
  $shortcut.WorkingDirectory = $scriptDir
  $shortcut.IconLocation = $iconPath + ',0'
  $shortcut.Description = $shortcutName + ' (WSL)'
  $shortcut.Save()
  # Record what the shortcut is supposed to be — target, arguments, icon, and the .lnk's
  # own size and digest — so Test-ShortcutCurrent can tell a stale one without parsing it.
  try {
    $lnk = Get-Item -LiteralPath $lnkPath
    # .NET, not Get-FileHash: the Utility module does not resolve on every host that
    # runs this script.
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $stream = [System.IO.File]::OpenRead($lnkPath)
      try {
        $digest = ([System.BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-', '')
      } finally { $stream.Dispose() }
    } finally { $sha.Dispose() }
    $stamp = [ordered]@{
      # path is what an uninstall removes (the Start menu folder can be redirected) and the
      # leaf name is what the logs and the tests read.
      shortcut = (Split-Path -Leaf $lnkPath)
      path = $lnkPath
      icon = (Split-Path -Leaf $iconPath)
      target = $target.Path
      arguments = $target.Arguments
      lnkBytes = $lnk.Length
      lnkSha256 = $digest
    } | ConvertTo-Json -Compress
    Set-Content -LiteralPath $stampPath -Value $stamp -Encoding UTF8
  } catch {
    Write-TrayLog 'WARN' ('could not write the shortcut stamp: {0}' -f $_.Exception.Message)
  }
  Write-TrayLog 'INFO' ('Start menu shortcut written: {0} -> {1} {2}' -f $lnkPath, $target.Path, $target.Arguments)
  Update-ShellIconCache
}

# Whether the Start menu shortcut is still the one this install wrote: it exists, the stamp
# beside this script describes it, and its size and digest match. A shortcut that was
# edited, restored from a backup or left behind by an older install is rebuilt.
function Test-ShortcutCurrent {
  if (-not (Test-Path -LiteralPath $stampPath)) { return $false }
  try {
    $stamp = Get-Content -LiteralPath $stampPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $lnkPath = if ([string]$stamp.path -ne '') { [string]$stamp.path } else { Join-Path ([Environment]::GetFolderPath('Programs')) ([string]$stamp.shortcut) }
    if (-not (Test-Path -LiteralPath $lnkPath)) { return $false }
    if ((Split-Path -Leaf $iconPath) -ne [string]$stamp.icon) { return $false }
    $lnk = Get-Item -LiteralPath $lnkPath
    if ([int64]$lnk.Length -ne [int64]$stamp.lnkBytes) { return $false }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $stream = [System.IO.File]::OpenRead($lnkPath)
      try { $digest = ([System.BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-', '') } finally { $stream.Dispose() }
    } finally { $sha.Dispose() }
    return ($digest -eq [string]$stamp.lnkSha256)
  } catch {
    return $false
  }
}

if ($ShortcutOnly) {
  New-DshShortcut
  Write-Output (Join-Path ([Environment]::GetFolderPath('Programs')) ($shortcutName + '.lnk'))
  return
}

# ---- opening DSH ----
$shell = New-Object -ComObject WScript.Shell

# The page's own title, and the process name that must never be touched: the Electron
# desktop app is a different program with its own backend, and this plugin has nothing
# to do with it — its window happens to carry the same words in its title, so it is
# excluded by name.
$dshPageTitleNeedle = 'DeepSeek Harness'
$dshAppProcessName = 'DeepSeek Harness.exe'
# Chromium (and Edge, Brave, ...) draw every window with this class, including an
# installed web app's own window. Requiring it keeps titles from other programs out.
$dshWindowClass = 'Chrome_WidgetWin_1'

# The window class is shared by every Chromium *application*, not just browsers: QQ, Jitsi
# Meet and the DSH desktop app all draw Chrome_WidgetWin_1 windows. Anything the tray
# drives has to belong to a real browser — an executable from this list, or one started
# with a browser profile switch (how a portable or scoop install announces itself).
# Whether the window is an installed web app rather than a browser window. Only the process
# command line can say: closing a browser window takes every tab with it, and Chromium does
# not reliably say in the title which kind of window it is, so a title that merely lacks the
# browser's name proves nothing. A command line that cannot be read is not an app window.
function Test-AppWindow($process) {
  try { return ([string]$process.CommandLine -match '--app(-id)?=') } catch { return $false }
}

$browserProcessNames = @(
  'chrome.exe', 'msedge.exe', 'brave.exe', 'brave-browser.exe', 'vivaldi.exe',
  'opera.exe', 'chromium.exe', 'yandex.exe', 'arc.exe', 'thorium.exe', 'chrome_proxy.exe'
)

function Test-BrowserProcess($process) {
  try { if ($browserProcessNames -contains $process.Name.ToLower()) { return $true } } catch {}
  try { if ([string]$process.CommandLine -match '--(user-data-dir|profile-directory)=') { return $true } } catch {}
  return $false
}

# The profile switches of an existing browser window, so a window opened later shares its
# profile — and therefore its session cookie.
function Get-ProfileArgs([string]$commandLine) {
  $found = New-Object System.Collections.Generic.List[string]
  foreach ($match in [regex]::Matches([string]$commandLine, '--(user-data-dir|profile-directory)=("[^"]*"|\S+)')) {
    $found.Add($match.Value)
  }
  return $found
}

function Find-DshWindow {
  # A window that already shows the DSH page: an installed web app window (a browser
  # started with --app / --app-id) when there is one, otherwise a browser window whose
  # active tab is DSH. Returns a hashtable so the caller can say which it was.
  $none = @{ Handle = [IntPtr]::Zero; WebApp = $false; Description = ''; SkippedApp = 0; SkippedOther = 0; Browser = ''; ProfileArgs = @() }
  try {
    $candidates = @([DshTrayTarget]::FindTitledWindows($dshPageTitleNeedle, $dshWindowClass))
    if ($candidates.Count -eq 0) { return $none }
    $fallback = $null
    foreach ($handle in $candidates) {
      $process = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [DshTrayTarget]::OwnerOf($handle)) -ErrorAction SilentlyContinue
      if ($process -eq $null) { continue }
      if ($process.Name -eq $dshAppProcessName) { $none.SkippedApp = $none.SkippedApp + 1; continue }
      # A Chromium window that is not a browser (QQ, an Electron app) carries the same title
      # words by accident, and reloading or driving it would be nonsense.
      if (-not (Test-BrowserProcess $process)) { $none.SkippedOther = $none.SkippedOther + 1; continue }
      $entry = @{
        Handle = $handle
        WebApp = (Test-AppWindow $process)
        Description = [DshTrayTarget]::Describe($handle)
        Browser = [string]$process.ExecutablePath
        ProfileArgs = (Get-ProfileArgs $process.CommandLine)
      }
      if ($entry.WebApp) {
        $entry.SkippedApp = $none.SkippedApp
        $entry.SkippedOther = $none.SkippedOther
        return $entry
      }
      if ($fallback -eq $null) { $fallback = $entry }
    }
    if ($fallback -ne $null) { $fallback.SkippedApp = $none.SkippedApp; $fallback.SkippedOther = $none.SkippedOther; return $fallback }
    return $none
  } catch { return $none }
}

function Open-DshSurface {
  # Reuse first: a window already showing the page, so no second tab and no new WSL
  # instance just to display something. Returning $true means it was brought forward.
  $found = Find-DshWindow
  if ($found.Handle -ne [IntPtr]::Zero) {
    if ([DshTrayTarget]::Focus($found.Handle)) {
      Write-TrayLog 'INFO' ('brought the DSH window forward ({0}): {1}' -f $(if ($found.WebApp) { 'installed web app' } else { 'browser' }), $found.Description)
      # Whatever this window's browser is, that is the one to open the page in later: the
      # user's Chromium browser, with their profile, not whichever one Windows calls default.
      $script:browserExe = [string]$found.Browser
      $script:browserProfileArgs = @($found.ProfileArgs)
      # In the log, because "which browser did it pick" is the first question when a second
      # copy of the page shows up somewhere unexpected.
      if ($script:browserExe -ne '') { Write-TrayLog 'INFO' ('  its browser: {0}' -f $script:browserExe) }
      # The window is only worth having if the instance behind it is up: a page left on
      # an error page would otherwise stay broken. The probe is a local request, so it
      # costs milliseconds while DSH answers (a 401 counts as alive).
      if (-not (Test-DshAlive)) {
        Start-DshWsl
        $script:reloadHandle = $found.Handle
        $script:opening = $true
        $script:openDeadline = (Get-Date).AddSeconds($openTimeoutSec)
        if ($script:openTimer -ne $null) { $script:openTimer.Start() }
        Write-TrayLog 'INFO' ('{0} was not answering behind that window; started DSH through {1}' -f $webUrl, $wslStartScript)
      }
      return $true
    }
    Write-TrayLog 'WARN' ('found the DSH window but Windows refused the foreground: {0}' -f $found.Description)
  }
  return $false
}


# The wsl.exe command line for one of the shell scripts beside this file, rendered so
# -SelfTest can report the string that actually reaches CreateProcess. `exec` keeps the
# script's own PID, which is what stop.sh finds.
function Get-WslCommand([string]$scriptPath) {
  $inner = 'exec ' + (ConvertTo-BashSingleQuoted $scriptPath)
  return 'wsl.exe -d ' + $distro + ' -- bash -lc ' + (ConvertTo-WindowsArg $inner)
}

function Start-DshWsl {
  # Hidden and not awaited: window style 0 allocates no console and the UI thread stays free.
  $shell.Run((Get-WslCommand $wslStartScript), 0, $false) | Out-Null
}

# The reverse, for the menu's exit entry. Hidden and NOT awaited: awaiting wsl.exe on
# the UI thread is what used to freeze the tray solid.
function Stop-Dsh {
  try {
    $shell.Run((Get-WslCommand $wslStopScript), 0, $false) | Out-Null
    Write-TrayLog 'INFO' ('DSH stop requested through {0} (hidden, not awaited)' -f $wslStopScript)
  } catch {
    Write-TrayLog 'WARN' ('could not ask WSL to stop DSH: {0}' -f $_.Exception.Message)
  }
}

# The host and port liveness is probed on, from WEB_URL.
function Get-WebTarget {
  try {
    $uri = [System.Uri]$webUrl
    return [pscustomobject]@{ Host = $uri.Host; Port = $uri.Port }
  } catch {
    return [pscustomobject]@{ Host = '127.0.0.1'; Port = 3080 }
  }
}

# Whether DSH is listening — a listening socket is what "the instance is up" means here, and a
# 401 without a cookie is as alive as a 200. A hard-bounded TCP connect, not an HTTP request:
# this runs on the UI thread, where a call that outlives its timeout is a frozen tray.
function Test-DshAlive {
  $target = Get-WebTarget
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect($target.Host, $target.Port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne($probeTimeoutMs)) { return $false }
    $client.EndConnect($pending)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

# The launch token belongs to one DSH process and is printed once per run into start.log,
# which sits beside this script: reading it here costs no wsl.exe round-trip.
function Get-WebAuthUrl {
  try {
    if (-not (Test-Path -LiteralPath $startLogPath)) { return $null }
    # Built from the configured URL rather than a hardcoded 127.0.0.1: the token line is
    # whatever DSH printed for this host and this port.
    $authPattern = [regex]::Escape($webUrl) + '/\?token=[A-Za-z0-9_\-\.]+'
    $tail = @(Get-Content -LiteralPath $startLogPath -Tail 120 -Encoding UTF8 -ErrorAction Stop)
    for ($i = $tail.Count - 1; $i -ge 0; $i--) {
      if ($tail[$i] -match $authPattern) { return $Matches[0] }
    }
  } catch {}
  return $null
}

# How to open the page. Every Chromium browser takes --app=<url> — the form the page is
# installed as — so the tray prefers that, in the browser it already saw the user working
# in, or in the default browser when that one is Chromium-like. Anything else is a plain
# open, which is what a non-Chromium default browser needs.
function Get-OpenPageCommand([string]$url) {
  $appArgument = '--app=' + $url
  if ($script:browserExe -ne '' -and (Test-Path -LiteralPath $script:browserExe)) {
    return [pscustomobject]@{ Exe = $script:browserExe; Args = @($script:browserProfileArgs) + @($appArgument); Plain = $false }
  }
  try {
    $progId = (Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice' -ErrorAction Stop).ProgId
    $command = [string](Get-ItemProperty -LiteralPath ('Registry::HKEY_CLASSES_ROOT\' + $progId + '\shell\open\command') -ErrorAction Stop).'(default)'
    # --single-argument means everything after it is one argument, so flags cannot be added.
    if ($command -notmatch '--single-argument') {
      $exe = ''
      if ($command.StartsWith('"')) { $exe = $command.Substring(1, $command.IndexOf('"', 1) - 1) } else { $exe = ($command -split ' ')[0] }
      $name = [System.IO.Path]::GetFileName($exe).ToLower()
      if ($browserProcessNames -contains $name -or $command -match '--(user-data-dir|profile-directory)=') {
        return [pscustomobject]@{ Exe = $exe; Args = @(Get-ProfileArgs $command) + @($appArgument); Plain = $false }
      }
    }
  } catch {}
  return [pscustomobject]@{ Exe = $url; Args = @(); Plain = $true }
}

function Open-DshPage {
  # A double click is two clicks, and a second browser tab is not what the user
  # meant by it.
  if (((Get-Date) - $script:lastOpenAt).TotalMilliseconds -lt 800) { return }
  $script:lastOpenAt = Get-Date
  $auth = Get-WebAuthUrl
  $target = $webUrl
  if ($auth -ne $null) { $target = $auth }
  try {
    $open = Get-OpenPageCommand $target
    if ($open.Plain) {
      Start-Process $target
      Write-TrayLog 'INFO' ('opened {0}' -f $target)
    } else {
      Start-Process -FilePath $open.Exe -ArgumentList $open.Args
      Write-TrayLog 'INFO' ('opened {0} as an app window in {1}' -f $target, (Split-Path -Leaf $open.Exe))
    }
  } catch {
    Write-TrayLog 'WARN' ('could not open {0}: {1}' -f $target, $_.Exception.Message)
    try { Start-Process $target } catch {}
  }
}

# Ask DSH to show itself: reuse a running instance at once, otherwise start it
# and let the timer open the page as soon as the URL answers.
$script:lastOpenAt = [DateTime]::MinValue
$script:openTimer = $null
$script:openDeadline = $null
$script:opening = $false
# A window that already showed the page when the instance behind it was down. That window
# is the one to reload once DSH answers — opening the token URL instead put a second copy
# of the app in the default browser, as a stray tab next to the window just focused.
$script:reloadHandle = [IntPtr]::Zero
# The browser that owned the last window we reused, and its profile switches.
$script:browserExe = ''
$script:browserProfileArgs = @()

# Finish the open flow: reload the window that was already open, or open the token URL when
# there is nothing to reload (no window, or it went away while DSH was starting).
function Complete-OpenFlow {
  if ($script:reloadHandle -ne [IntPtr]::Zero) {
    $handle = $script:reloadHandle
    $script:reloadHandle = [IntPtr]::Zero
    if ([DshTrayTarget]::Reload($handle)) {
      Write-TrayLog 'INFO' ('reloaded the DSH window that was already open: {0}' -f [DshTrayTarget]::Describe($handle))
      return
    }
    Write-TrayLog 'WARN' 'the window that was already open is gone; opening the page instead'
  }
  Open-DshPage
}

function Start-OpenFlow {
  # $shell.Run throws when wsl.exe is missing or the distro was renamed, and `opening` gates
  # every later click, so a failed start must not leave this flow latched.
  try {
    if ($script:opening) { return }
    if (Open-DshSurface) { return }
    # Starting is idempotent — start.sh exits at once when the URL already answers — so no probe
    # gates it: the instance boots while the tray is still being drawn, and the timer opens the
    # page as soon as the URL answers.
    $script:opening = $true
    Start-DshWsl
    $script:openDeadline = (Get-Date).AddSeconds($openTimeoutSec)
    Write-TrayLog 'INFO' ('asked {0} to start DSH' -f $wslStartScript)
    if ($script:openTimer -ne $null) { $script:openTimer.Start() }
  } catch {
    $script:opening = $false
    if ($script:openTimer -ne $null) { $script:openTimer.Stop() }
    Write-TrayLog 'WARN' ('could not start DSH: {0}' -f $_.Exception.Message)
  }
}

# Blocking wait for a DSH that was just started, then finish the flow. The second instance
# has no tray and no message pump, so a plain loop is the whole job there.
function Wait-ForDsh {
  $deadline = (Get-Date).AddSeconds($openTimeoutSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    if (Test-DshAlive) {
      Complete-OpenFlow
      return
    }
  }
  Write-TrayLog 'WARN' ('gave up waiting for {0} after {1}s' -f $webUrl, $openTimeoutSec)
}

# Blocking variant for the second instance: it has no tray and no message pump.
function Invoke-OpenFlowAndWait {
  # This runs in the process a second double-click started, which has no tray and no message
  # loop: a failure here must not surface as a dialog in a hidden process either.
  try {
    if (Open-DshSurface) {
      # The window was there but its instance was not: wait for the DSH that was just
      # started and reload that window (never a second one).
      if ($script:reloadHandle -ne [IntPtr]::Zero) { Wait-ForDsh }
      return
    }
    if (Test-DshAlive) {
      Open-DshPage
      return
    }
    Start-DshWsl
    Wait-ForDsh
  } catch {
    Write-TrayLog 'WARN' ('could not open DSH: {0}' -f $_.Exception.Message)
  }
}

# ---- the tray menu ----
# Measured side by side on this machine's screen, the official DeepSeek Harness
# tray icon next to this one, both at 100% DPI:
#
#                        desktop app (Chromium)         Windows 11 popup menu
#   panel                175 x 97 px, #1F1F1F           224 x 66 px, #2C2C2C
#   item height          28 px                          33 px
#   text inset           20 px                          18 px
#   panel padding        12 px top/bottom               ~3 px
#   separator            #5E5E5E, full panel width      #3E3E3E
#   hovered item         #363636, full panel width      system colour
#   corner radius        12 px, anti-aliased            system
#   item text            #E3E3E3, hovered as well       #FFFFFF
#   font                 system UI, 9pt (YaHei UI)     Microsoft YaHei UI 12pt
#
# So the app's menu is not a Windows menu at all (Electron hands a template to
# Chromium, which draws it), and asking Windows for a menu cannot reproduce it.
# WinForms has no dark mode either, so the panel is composed from a professional
# colour table plus the numbers above — the same approach the desktop app's
# renderer takes. The corners are the one measurement this gives up: they come
# from Windows, which rounds a popup by 8 px rather than 12, and in exchange the
# edges are anti-aliased and the shadow is the real one.
$menuStyleSource = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

/** Process setup that must happen before the first window exists. */
public static class DshTraySetup {
  [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
  [DllImport("kernel32.dll")] private static extern bool FreeConsole();

  /**
   * DPI awareness and visual styles. Both have to be set before any window is
   * created, and both change what the menu looks like: without DPI awareness
   * Windows bitmap-scales the panel, and without visual styles the professional
   * renderer falls back to SYSTEM colours — the hovered item then comes out
   * accent blue (0x0078D7) instead of the app's #363636.
   */
  public static void Enable() {
    try { SetProcessDPIAware(); } catch { }
    try { Application.EnableVisualStyles(); } catch { }
  }

  /**
   * Drop the console this process inherited from its hidden launcher.
   *
   * The tray is a GUI and needs no console, yet a console-hosted PowerShell keeps
   * one (measured: a hidden ConsoleWindowClass window in the tray process). Windows
   * names an unowned top-level window after its process, so that console is what
   * puts "Windows PowerShell" in the taskbar while the menu is open, and showing or
   * restoring it is what pops a PowerShell window up. Tray mode therefore owns no
   * console at all; the command-line flags keep theirs for their output.
   */
  public static void DetachConsole() {
    try { FreeConsole(); } catch { }
  }
}

/** Window styles the tray menu needs, so it is never taken for an app window. */
public static class DshTrayWindow {
  private const int ExStyle = -20;
  private const long WsExToolWindow = 0x00000080L;
  private const long WsExAppWindow = 0x00040000L;
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] private static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);

  /** Current extended window style, reported by the self-test contract. */
  public static long ExStyleOf(IntPtr hwnd) {
    try { return GetWindowLongPtr(hwnd, ExStyle).ToInt64(); } catch { return 0; }
  }

  /**
   * Make the popup a tool window: no taskbar button, no Alt-Tab entry.
   *
   * WinForms leaves a ContextMenuStrip shown on its own as an ordinary unowned
   * top-level window (measured: exstyle 0x00010008, no WS_EX_TOOLWINDOW, owner
   * none), and Explorer labels such a window after its process — whose window title
   * comes from the console. Applying this before the first show is what keeps the
   * menu from being listed as "Windows PowerShell".
   */
  public static void MarkToolWindow(IntPtr hwnd) {
    try {
      long style = GetWindowLongPtr(hwnd, ExStyle).ToInt64();
      long wanted = (style | WsExToolWindow) & ~WsExAppWindow;
      if (wanted != style) { SetWindowLongPtr(hwnd, ExStyle, new IntPtr(wanted)); }
    } catch { }
  }
}

/**
 * Finding and bringing forward the DSH page's own window: an installed web app
 * window if the browser has one, otherwise a browser window whose active tab is DSH.
 * The Electron desktop app is deliberately not a candidate — this plugin only ever
 * deals with the WSL web instance, and the caller excludes that process by name.
 */
public static class DshTrayTarget {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] private struct WINDOWPLACEMENT {
    public int length;
    public int flags;
    public int showCmd;
    public POINT minPosition;
    public POINT maxPosition;
    public RECT normalPosition;
  }
  private const uint GwOwner = 4;
  private const int SwRestore = 9;
  private const int ShowMinimized = 2;
  private const byte VkMenu = 0x12; // ALT
  private const byte VkControl = 0x11; // CTRL
  private const byte VkR = 0x52; // R
  private const byte VkW = 0x57; // W

  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] private static extern bool GetWindowPlacement(IntPtr hwnd, ref WINDOWPLACEMENT placement);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint attach, uint attachTo, bool flag);
  [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] private static extern void SwitchToThisWindow(IntPtr hwnd, bool altTab);

  private const uint WmClose = 0x0010;
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int max);

  /**
   * The size a window restores to, and its show state (1 normal, 2 minimized,
   * 3 maximized). GetWindowRect is useless for a minimized window — it reports a
   * 160x28 placeholder for the desktop app while it sits in the taskbar — and that
   * is exactly the window the tray has to recognise.
   */
  private static bool Placement(IntPtr hwnd, out int width, out int height, out int showCmd) {
    width = 0; height = 0; showCmd = 0;
    try {
      WINDOWPLACEMENT placement = new WINDOWPLACEMENT();
      placement.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
      if (!GetWindowPlacement(hwnd, ref placement)) { return false; }
      width = placement.normalPosition.Right - placement.normalPosition.Left;
      height = placement.normalPosition.Bottom - placement.normalPosition.Top;
      showCmd = placement.showCmd;
      if (width <= 0 || height <= 0) {
        RECT rect;
        if (GetWindowRect(hwnd, out rect)) {
          width = rect.Right - rect.Left;
          height = rect.Bottom - rect.Top;
        }
      }
      return true;
    } catch { return false; }
  }

  /**
   * Resting size and show state as one string ("1280x720/1"), for the self test to
   * read the same number the matcher decides on — without taking the foreground.
   */
  public static string PlacementSummary(IntPtr hwnd) {
    int width, height, showCmd;
    if (!Placement(hwnd, out width, out height, out showCmd)) { return ""; }
    return width + "x" + height + "/" + showCmd;
  }

  /**
   * Bring a window forward. A minimized window is restored first (SW_RESTORE puts a
   * maximized one back maximized); a window that is already on screen is not
   * resized or moved at all. Windows then has to be asked for the foreground three
   * ways, because it only hands it over voluntarily to the process the user is
   * working with: directly, attached to the input queue of whoever holds it, and
   * with a synthetic ALT press, which makes Windows accept the request.
   */
  public static bool Focus(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) { return false; }
    try {
      int width, height, showCmd;
      Placement(hwnd, out width, out height, out showCmd);
      if (showCmd == ShowMinimized || IsIconic(hwnd)) { ShowWindow(hwnd, SwRestore); }
      if (SetForegroundWindow(hwnd)) { return true; }
      IntPtr foreground = GetForegroundWindow();
      if (foreground != IntPtr.Zero) {
        uint ignored;
        uint foregroundThread = GetWindowThreadProcessId(foreground, out ignored);
        uint targetThread = GetWindowThreadProcessId(hwnd, out ignored);
        if (foregroundThread != 0 && targetThread != 0 && foregroundThread != targetThread) {
          if (AttachThreadInput(foregroundThread, targetThread, true)) {
            bool attached = SetForegroundWindow(hwnd);
            AttachThreadInput(foregroundThread, targetThread, false);
            if (attached) { return true; }
          }
        }
      }
      // SwitchToThisWindow is the activation Windows grants a process the user is not
      // working with; the documented calls above only work for that process.
      try { SwitchToThisWindow(hwnd, true); } catch {}
      keybd_event(VkMenu, 0, 0, UIntPtr.Zero);
      keybd_event(VkMenu, 0, 2, UIntPtr.Zero);
      BringWindowToTop(hwnd);
      return SetForegroundWindow(hwnd) || GetForegroundWindow() == hwnd;
    } catch { return false; }
  }

  /**
   * Reload the page in a window that already shows it. DSH's session cookie is signed,
   * named after host:port and valid for thirty days, so a reload after DSH was restarted
   * comes back authenticated — which is why the tray reloads the open window instead of
   * opening the page again, somewhere else. The chord is only sent when the window really
   * is in front, or it would land in whatever the user is typing in.
   *
   * @returns whether the keystroke was sent.
   */
  public static bool Reload(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) { return false; }
    try {
      if (!FocusAndWait(hwnd, 400)) { return false; }
      SendReloadChord();
      return true;
    } catch { return false; }
  }

  /** Whether this window is the one Windows currently considers foreground. */
  public static bool IsForeground(IntPtr hwnd) {
    try { return hwnd != IntPtr.Zero && GetForegroundWindow() == hwnd; } catch { return false; }
  }

  /** Ctrl+<key> to whatever is in front: the caller has already made that this window. */
  private static void SendChord(byte key) {
    keybd_event(VkControl, 0, 0, UIntPtr.Zero);
    keybd_event(key, 0, 0, UIntPtr.Zero);
    keybd_event(key, 0, 2, UIntPtr.Zero);
    keybd_event(VkControl, 0, 2, UIntPtr.Zero);
  }

  /** Ctrl+R: reload the page in the window that is in front. */
  public static void SendReloadChord() { SendChord(VkR); }

  /** Ctrl+W: close the page in the window that is in front. */
  public static void SendCloseChord() { SendChord(VkW); }

  /**
   * Focus the window and wait for the foreground to follow: it changes asynchronously, so a
   * check immediately after SetForegroundWindow still sees the previous window.
   *
   * @returns whether the window is in front by the end of the wait.
   */
  public static bool FocusAndWait(IntPtr hwnd, int timeoutMs) {
    Focus(hwnd);
    for (int waited = 0; waited < timeoutMs; waited += 25) {
      if (IsForeground(hwnd)) { return true; }
      System.Threading.Thread.Sleep(25);
    }
    return IsForeground(hwnd);
  }

  /**
   * Ask the window itself to close. Only safe for an app window, where the page is the whole
   * window; in a browser window it would take every tab with it.
   */
  public static bool RequestClose(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) { return false; }
    try { return PostMessage(hwnd, WmClose, IntPtr.Zero, IntPtr.Zero); } catch { return false; }
  }

  /** "class 'title'" for the log line and the self-test contract. */
  public static string Describe(IntPtr hwnd) {
    try {
      StringBuilder title = new StringBuilder(512);
      GetWindowTextW(hwnd, title, title.Capacity);
      StringBuilder cls = new StringBuilder(256);
      GetClassNameW(hwnd, cls, cls.Capacity);
      return cls.ToString() + " '" + title.ToString() + "'";
    } catch { return "(unreadable window)"; }
  }

  /**
   * Every visible, unowned window of the given window class whose title contains the
   * needle and whose resting size is at least 200x150, largest first. The class keeps
   * this to browser windows: a File Explorer window showing the app's folder carries
   * the same words in its title, and must not be mistaken for the page.
   *
   * Resting size, not the current rect: a minimized window reports a 160x28
   * placeholder through GetWindowRect, and a minimized DSH window is exactly what the
   * tray is asked to bring back.
   */
  public static IntPtr[] FindTitledWindows(string needle, string requiredClass) {
    List<IntPtr> handles = new List<IntPtr>();
    List<long> areas = new List<long>();
    try {
      EnumProc callback = delegate(IntPtr hwnd, IntPtr param) {
        if (!IsWindowVisible(hwnd) || GetWindow(hwnd, GwOwner) != IntPtr.Zero) { return true; }
        int width, height, showCmd;
        if (!Placement(hwnd, out width, out height, out showCmd)) { return true; }
        if (width < 200 || height < 150) { return true; }
        StringBuilder cls = new StringBuilder(256);
        GetClassNameW(hwnd, cls, cls.Capacity);
        if (cls.ToString() != requiredClass) { return true; }
        StringBuilder title = new StringBuilder(512);
        GetWindowTextW(hwnd, title, title.Capacity);
        if (title.ToString().IndexOf(needle, StringComparison.OrdinalIgnoreCase) < 0) { return true; }
        handles.Add(hwnd);
        areas.Add((long)width * height);
        return true;
      };
      EnumWindows(callback, IntPtr.Zero);
    } catch { }
    // Largest first: the biggest window carries the most of the page.
    for (int i = 1; i < handles.Count; i++) {
      for (int j = i; j > 0 && areas[j] > areas[j - 1]; j--) {
        long area = areas[j]; areas[j] = areas[j - 1]; areas[j - 1] = area;
        IntPtr handle = handles[j]; handles[j] = handles[j - 1]; handles[j - 1] = handle;
      }
    }
    return handles.ToArray();
  }

  /** The window class, so the self test can match a window it created itself. */
  public static string ClassOf(IntPtr hwnd) {
    try {
      StringBuilder cls = new StringBuilder(256);
      GetClassNameW(hwnd, cls, cls.Capacity);
      return cls.ToString();
    } catch { return string.Empty; }
  }

  /** The process a window belongs to, so the caller can skip the desktop app. */
  public static uint OwnerOf(IntPtr hwnd) {
    try {
      uint owner;
      GetWindowThreadProcessId(hwnd, out owner);
      return owner;
    } catch { return 0; }
  }
}

/** Chromium's dark menu palette, as measured from the desktop app's tray menu. */
public class DshTrayMenuColors : ProfessionalColorTable {
  public static readonly Color Panel = Color.FromArgb(0x1F, 0x1F, 0x1F);
  public static readonly Color Hover = Color.FromArgb(0x36, 0x36, 0x36);
  public static readonly Color Line = Color.FromArgb(0x5E, 0x5E, 0x5E);
  public static readonly Color Text = Color.FromArgb(0xE3, 0xE3, 0xE3);

  public override Color ToolStripDropDownBackground { get { return Panel; } }
  public override Color MenuBorder { get { return Panel; } }
  public override Color MenuItemBorder { get { return Hover; } }
  public override Color MenuItemSelected { get { return Hover; } }
  public override Color MenuItemSelectedGradientBegin { get { return Hover; } }
  public override Color MenuItemSelectedGradientEnd { get { return Hover; } }
  public override Color ImageMarginGradientBegin { get { return Panel; } }
  public override Color ImageMarginGradientMiddle { get { return Panel; } }
  public override Color ImageMarginGradientEnd { get { return Panel; } }
  public override Color SeparatorDark { get { return Line; } }
  public override Color SeparatorLight { get { return Line; } }
}

/** Applies the palette and drops the frame the default renderer would draw. */
public class DshTrayMenuRenderer : ToolStripProfessionalRenderer {
  /** Left inset of the item text, set from the measured metric (scaled). */
  public static int TextInsetPx = 20;

  /** How far below the item box's centre the app's labels sit, scaled. */
  public static int TextDropPx = 1;

  public DshTrayMenuRenderer() : base(new DshTrayMenuColors()) { RoundedEdges = false; }

  /** The app's menu has no border line: the panel just ends. */
  protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e) { }

  /** The app's separator runs the full panel width; WinForms would inset it. */
  protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e) {
    Rectangle bounds = e.Item.Bounds;
    using (Pen pen = new Pen(DshTrayMenuColors.Line)) {
      e.Graphics.DrawLine(pen, 0, bounds.Height / 2, e.ToolStrip.Width, bounds.Height / 2);
    }
  }

  /**
   * The app centres each item's text in its 28 px box, insets it 20 px, and
   * paints it heavy: Chromium's text covers 388 solid-stroke pixels plus 173
   * anti-aliasing pixels for one label, where GDI's ClearType gives 272 solid,
   * which reads as thin and dim. GDI+ ClearType drawn twice gives 413 solid and
   * 188 fringe — the same distribution — so the label is drawn here rather than
   * by the base renderer, placed by the glyph band DshTrayText measures with the
   * same call.
   */
  protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e) {
    e.TextColor = DshTrayMenuColors.Text;
    try {
      Font font = e.TextFont != null ? e.TextFont : e.Item.Font;
      Rectangle ink = DshTrayText.InkBox(e.Text, font);
      // The measured ink box, not the item bounds: the ink starts at the app's
      // inset and is centred vertically on the band the eye sees.
      float left = e.Item.Bounds.Left + TextInsetPx - ink.Left;
      float top = (e.Item.Bounds.Height - ink.Height) / 2f - ink.Top + TextDropPx;
      TextRenderingHint previous = e.Graphics.TextRenderingHint;
      try {
        e.Graphics.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        using (SolidBrush brush = new SolidBrush(DshTrayMenuColors.Text)) {
          // The second pass over the same pixels is what brings the stroke
          // coverage up to the app's; the colour itself stays #E3E3E3.
          e.Graphics.DrawString(e.Text, font, brush, left, top, StringFormat.GenericTypographic);
          e.Graphics.DrawString(e.Text, font, brush, left, top, StringFormat.GenericTypographic);
        }
      } finally {
        e.Graphics.TextRenderingHint = previous;
      }
      return;
    } catch { }
    base.OnRenderItemText(e);
  }
}

/**
 * Windows 11's own rounded corners and shadow for the popup. Clipping the panel
 * with a Region gives the same shape with hard, aliased edges and no real
 * shadow, so the corners are asked of the window manager instead
 * (DWMWA_WINDOW_CORNER_PREFERENCE, available since Windows 11 22000). The radius
 * is then Windows' own rather than the app's 12 px — that is the one measurement
 * this trades away.
 */
public static class DshTrayCorners {
  private const int CornerPreference = 33; // DWMWA_WINDOW_CORNER_PREFERENCE
  private const int BorderColor = 34;      // DWMWA_BORDER_COLOR
  private const int CornerRound = 2;       // DWMWCP_ROUND
  private const int ColorNone = unchecked((int)0xFFFFFFFE); // DWMWA_COLOR_NONE

  [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
  [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);

  /**
   * Rounds the popup and removes the 1 px window border Windows draws around a
   * rounded window (visible as a light arc against a dark panel; the app's menu
   * has no border).
   * @returns whether Windows accepted the rounding request (false before Win11).
   */
  public static bool Apply(IntPtr hwnd) {
    try {
      int preference = CornerRound;
      bool rounded = DwmSetWindowAttribute(hwnd, CornerPreference, ref preference, sizeof(int)) == 0;
      try {
        int none = ColorNone;
        DwmSetWindowAttribute(hwnd, BorderColor, ref none, sizeof(int));
      } catch { }
      return rounded;
    } catch { return false; }
  }

  /** Reads the preference back: 2 means Windows is rounding this window. */
  public static int Read(IntPtr hwnd) {
    try {
      int preference;
      if (DwmGetWindowAttribute(hwnd, CornerPreference, out preference, sizeof(int)) != 0) { return -1; }
      return preference;
    } catch { return -1; }
  }
}

/** The app's menu font: the system UI family at 9pt, as measured on this screen. */
public static class DshTrayFont {
  /**
   * The desktop app's labels are drawn in the system UI font, which on this
   * machine resolves to Microsoft YaHei UI 9pt: that is the font whose ink box
   * matches the app's own menu exactly (134 x 13 px for 打开 DeepSeek Harness,
   * where Segoe UI 9pt gives 125 x 14 and Microsoft YaHei UI 12pt gives 188 x 21).
   * An English system falls back to Segoe UI, which is what the app uses there.
   */
  public static Font MenuFont(float size) {
    string[] preferred = { "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI" };
    foreach (string family in preferred) {
      try {
        using (FontFamily probe = new FontFamily(family)) {
          return new Font(family, size, FontStyle.Regular, GraphicsUnit.Point);
        }
      } catch { }
    }
    return SystemFonts.DefaultFont;
  }
}

/** Where a label's glyphs really sit, so item text can be centred at any DPI. */
public static class DshTrayText {
  private static readonly System.Collections.Generic.Dictionary<string, Rectangle> Cache = new System.Collections.Generic.Dictionary<string, Rectangle>();

  /**
   * The ink box of the given text in the given font: drawn once with the very
   * call the renderer uses, then scanned. Two things depend on it and neither can
   * be taken from WinForms:
   *
   * - the vertical band, because the line box carries the font's descent and
   *   these labels have no descenders (the default renderer looks ~4 px high),
   * - the width the panel is sized to, because a ToolStripMenuItem's *preferred*
   *   width also reserves the image margin (measured: 214 px of content for a
   *   175 px label, and the drop-down width then varies between shows — 175 px in
   *   one run, 214 in another, which is what left the long blank area on the
   *   right).
   */
  public static Rectangle InkBox(string text, Font font) {
    string key = font.Name + "|" + font.SizeInPoints + "|" + font.GdiCharSet + "|" + text;
    Rectangle cached;
    if (Cache.TryGetValue(key, out cached)) { return cached; }
    Rectangle result = Rectangle.Empty;
    try {
      using (Bitmap probe = new Bitmap(1, 1)) {
        using (Graphics measure = Graphics.FromImage(probe)) {
          SizeF size = measure.MeasureString(text, font, PointF.Empty, StringFormat.GenericTypographic);
          int width = (int)Math.Ceiling(size.Width) + 4;
          int height = (int)Math.Ceiling(size.Height) + 4;
          if (width > 0 && height > 0) {
            using (Bitmap canvas = new Bitmap(width, height)) {
              using (Graphics canvasGraphics = Graphics.FromImage(canvas)) {
                canvasGraphics.Clear(Color.Black);
                canvasGraphics.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
                using (SolidBrush brush = new SolidBrush(Color.White)) {
                  canvasGraphics.DrawString(text, font, brush, 0, 0, StringFormat.GenericTypographic);
                  canvasGraphics.DrawString(text, font, brush, 0, 0, StringFormat.GenericTypographic);
                }
              }
              int left = -1;
              int right = -1;
              int top = -1;
              int bottom = -1;
              for (int y = 0; y < canvas.Height; y++) {
                for (int x = 0; x < canvas.Width; x++) {
                  if (canvas.GetPixel(x, y).R > 40) {
                    if (left < 0 || x < left) { left = x; }
                    if (x > right) { right = x; }
                    if (top < 0) { top = y; }
                    bottom = y;
                  }
                }
              }
              if (left >= 0 && top >= 0) {
                result = new Rectangle(left, top, right - left + 1, bottom - top + 1);
              }
            }
          }
        }
      }
    } catch { }
    if (result.Width <= 0 || result.Height <= 0) { result = new Rectangle(0, 0, font.Height * 5, font.Height); }
    Cache[key] = result;
    return result;
  }
}
'@

# The menu is sized in 96-DPI units and scaled to this display, and a WinForms
# menu needs visual styles or its renderer falls back to system colours:
# both are process-wide switches that must be set before the first window.
$dpiScale = 1.0
# False when the styled menu's C# could not be compiled. Everything that depends on
# those types is behind this flag: the tray then still comes up, with a plain
# WinForms menu in the system palette, instead of dying on the first use of a type
# that does not exist.
$script:styledMenu = $false
function Initialize-MenuStyle {
  try {
    if (-not ('DshTrayMenuRenderer' -as [type])) {
      Add-Type -TypeDefinition $menuStyleSource -ReferencedAssemblies System.Windows.Forms, System.Drawing
    }
    [DshTraySetup]::Enable()
    $script:dpiScale = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero).DpiX / 96.0
    $script:styledMenu = $true
  } catch {
    $script:styledMenu = $false
    Write-TrayLog 'ERROR' ('dark menu style unavailable, falling back to the system menu: {0}' -f $_.Exception.Message)
  }
}

function Get-Scaled([int]$value) {
  return [int][Math]::Round($value * $script:dpiScale)
}

function Update-MenuCorners {
  # Windows draws the rounded corners and the shadow itself, with real
  # anti-aliasing; a Region clip would cut the same shape out of the panel with
  # hard edges and no shadow at all.
  try {
    if (-not [DshTrayCorners]::Apply($script:trayMenu.Handle)) {
      Write-TrayLog 'WARN' 'could not ask Windows for rounded corners; the menu has square ones'
    }
  } catch {}
  # Re-assert the tool-window style after the show too: Explorer decides what to list
  # once the window is up, and the self test reads the resulting style back.
  try { [DshTrayWindow]::MarkToolWindow($script:trayMenu.Handle) } catch {}
}

# Close every window that shows the page, the way the app's own exit does. Repeated, because
# a second copy can sit behind the first (an app window plus a stray tab from an earlier
# version), and re-found every round because closing one changes the next window's title.
# Bring one window showing the page down. The tray is a background process, so the foreground
# is not guaranteed: the shell activates the window first, the chord (Ctrl+W: the tab in a
# browser window, the window in an app window) needs the foreground to land, and an app window
# — where the page is the whole window — is asked to close outright as the last resort.
function Close-DshWindow($found) {
  try { $shell.AppActivate([DshTrayTarget]::OwnerOf($found.Handle)) | Out-Null } catch {}
  if ([DshTrayTarget]::FocusAndWait($found.Handle, 400)) {
    [DshTrayTarget]::SendCloseChord()
    Write-TrayLog 'INFO' ('closed the DSH window: {0}' -f $found.Description)
    return $true
  }
  if ($found.WebApp -and [DshTrayTarget]::RequestClose($found.Handle)) {
    Write-TrayLog 'INFO' ('asked the DSH app window to close: {0}' -f $found.Description)
    return $true
  }
  Write-TrayLog 'WARN' ('could not bring the DSH window down; close it by hand: {0}' -f $found.Description)
  return $false
}

function Close-DshWindows {
  $closed = 0
  $lastHandle = [IntPtr]::Zero
  for ($round = 0; $round -lt 8; $round++) {
    $found = Find-DshWindow
    if ($found.Handle -eq [IntPtr]::Zero) { break }
    # The same window twice means the chord did not take — a page can hold it with an
    # unsaved-changes prompt. Say so instead of hammering it.
    if ($found.Handle -eq $lastHandle) {
      Write-TrayLog 'WARN' ('the DSH window did not close (a page prompt can hold it): {0}' -f $found.Description)
      break
    }
    if (-not (Close-DshWindow $found)) { break }
    $closed = $closed + 1
    $lastHandle = $found.Handle
    Start-Sleep -Milliseconds 400
  }
  return $closed
}

function Close-Tray([switch]$StopDsh) {
  # The exit entry says "退出 DeepSeek Harness", so it stops the WSL instance this
  # shortcut started (through the generated stop script, hidden and not awaited).
  # -StopDsh stays off for the self test, which must never touch WSL.
  if ($StopDsh) {
    Stop-Dsh
    Write-TrayLog 'INFO' 'tray exit requested; DSH stop was asked for'
    # ...and the window goes with it. The entry says the whole application is exiting, so
    # leaving a dead page (or a stale copy of it) behind is the one thing it must not do.
    $closed = Close-DshWindows
    Write-TrayLog 'INFO' ('Tray exit closed {0} DSH window(s)' -f $closed)
  } else {
    Write-TrayLog 'INFO' 'tray exit requested; DSH keeps running'
  }
  Write-TrayLog 'INFO' 'tray stopped'
  try {
    $tray.Visible = $false
    $tray.Dispose()
  } catch {}
  # Leave for real. A pending start keeps the open timer running, and this tray has no forms
  # for Application.Exit() to close, so the message loop is not what decides this process's
  # lifetime; the mutex goes with the process.
  [System.Environment]::Exit(0)
}

Initialize-MenuStyle

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$script:trayMenu = $menu
$menu.ShowImageMargin = $false
$menu.ShowCheckMargin = $false
$menu.DropShadowEnabled = $true

$openItem = $menu.Items.Add($openLabel)
$openItem.Add_Click({ Start-OpenFlow })
$separator = New-Object System.Windows.Forms.ToolStripSeparator
$menu.Items.Add($separator) | Out-Null
$exitItem = $menu.Items.Add($exitLabel)
$exitItem.Add_Click({ Close-Tray -StopDsh })

if ($script:styledMenu) {
  # The app's own menu font: the system UI family at 9pt (measured — see
  # DshTrayFont), not the Windows menu font, which is Microsoft YaHei UI 12pt here.
  $menuFont = [DshTrayFont]::MenuFont(9)
  $panelPadding = Get-Scaled $panelPaddingPx
  # The item box is a fixed height in the app. A ToolStripMenuItem is its text plus
  # this padding plus a 2 px inset on each side, which is why the box is 4 px
  # taller than text + padding; the padding is whatever is left of the height.
  $itemHeight = Get-Scaled $itemHeightPx
  $itemVerticalPadding = [Math]::Max(0, [int](($itemHeight - $menuFont.Height - 4) / 2))
  $itemPadding = New-Object System.Windows.Forms.Padding((Get-Scaled $itemTextInsetPx), $itemVerticalPadding, (Get-Scaled $itemTextInsetPx), $itemVerticalPadding)
  $menu.BackColor = [DshTrayMenuColors]::Panel
  $menu.ForeColor = [DshTrayMenuColors]::Text
  $menu.Font = $menuFont
  $menu.Renderer = New-Object DshTrayMenuRenderer
  [DshTrayMenuRenderer]::TextInsetPx = (Get-Scaled $itemTextInsetPx)
  [DshTrayMenuRenderer]::TextDropPx = (Get-Scaled $itemTextDropPx)

  # The panel is sized from the labels themselves. Left to itself, WinForms sizes a
  # menu item from its *preferred* width, which also reserves the image margin — a
  # 175 px label came out as 214 px of content, and the drop-down's own width then
  # varied between 175 and 214 px from one show to the next, which is what left a
  # long blank strip on the right. Measuring the ink and setting both the items and
  # the panel leaves the app's 20 px on each side, always.
  $itemInset = Get-Scaled $itemTextInsetPx
  $inkWidth = 0
  foreach ($label in @($openLabel, $exitLabel)) {
    $inkWidth = [Math]::Max($inkWidth, [DshTrayText]::InkBox($label, $menuFont).Width)
  }
  $panelWidth = $inkWidth + 2 * $itemInset

  $openItem.Padding = $itemPadding
  # WinForms gives a drop-down 2 px of its own padding and ignores an assigned one,
  # so the panel's top and bottom gaps are item margins, shortened by that 2 px.
  # Item margins also match the app: its hover highlight stops short of the panel
  # edges, which is what a margin (unlike padding) produces.
  $panelMargin = [Math]::Max(0, $panelPadding - $menu.Padding.Top)
  $openItem.Margin = New-Object System.Windows.Forms.Padding(0, $panelMargin, 0, 0)
  $openItem.AutoSize = $false
  $openItem.Size = New-Object System.Drawing.Size($panelWidth, $itemHeight)

  # A separator carrying the app's whole gap: 18 px with the 1 px line centred.
  $separator.AutoSize = $false
  $separator.Size = New-Object System.Drawing.Size($panelWidth, (Get-Scaled $separatorGapPx))

  $exitItem.Padding = $itemPadding
  $exitItem.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, $panelMargin)
  $exitItem.AutoSize = $false
  $exitItem.Size = New-Object System.Drawing.Size($panelWidth, $itemHeight)

  $panelHeight = $menu.Padding.Top + $panelMargin + $itemHeight + (Get-Scaled $separatorGapPx) + $itemHeight + $panelMargin + $menu.Padding.Bottom
  $menu.AutoSize = $false
  $menu.Size = New-Object System.Drawing.Size($panelWidth, $panelHeight)
} else {
  # Degraded mode: the palette and the measured metrics live in the C# that just
  # failed to compile, so the menu keeps WinForms' own font and colours. A plain
  # menu beats a tray that never appears.
  $menuFont = [System.Drawing.SystemFonts]::DefaultFont
  $menu.Font = $menuFont
  $itemHeight = $openItem.Height
  $itemInset = 0
  $inkWidth = 0
  $panelMargin = 0
  $panelWidth = $menu.Width
  $panelHeight = $menu.Height
}

$menu.Add_Opened({ Update-MenuCorners })
# Before the first show, so Windows never gives the popup a taskbar button or an
# Alt-Tab entry in the first place (the handle is created here on purpose).
$menu.Add_Opening({ try { [DshTrayWindow]::MarkToolWindow($script:trayMenu.Handle) } catch {} })
# ---- the notification-area icon ----
# The mark is the page's own favicon whale, drawn at the size the desktop app's
# own tray icon gives it. Windows paints the notification area in the *taskbar*
# theme -- the one behind the taskbar's own right-click menu -- so there is one
# ink per theme: black for a light taskbar, white for a dark one.
function Get-TrayThemeIsLight {
  try {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
    $value = (Get-ItemProperty -Path $key -Name 'SystemUsesLightTheme' -ErrorAction Stop).SystemUsesLightTheme
    return ([int]$value -ne 0)
  } catch {
    # No such value (an older Windows, or a profile that never chose): light is
    # what Windows itself defaults to.
    return $true
  }
}

function Get-TrayIconPath {
  $preferred = if (Get-TrayThemeIsLight) { $trayIconBlackPath } else { $trayIconWhitePath }
  if (Test-Path -LiteralPath $preferred) { return $preferred }
  # A half-written install still gets a tray: the other ink, then the shortcut's
  # own tile, then (in Set-TrayIcon) the generic system icon.
  $other = if ($preferred -eq $trayIconBlackPath) { $trayIconWhitePath } else { $trayIconBlackPath }
  if (Test-Path -LiteralPath $other) { return $other }
  if (Test-Path -LiteralPath $iconPath) { return $iconPath }
  return $null
}

function Set-TrayIcon {
  # Idempotent on purpose: the theme timer calls this on every tick, and only a
  # change of ink touches the icon.
  $path = Get-TrayIconPath
  if (($path -ne $null) -and ($path -ne $script:trayIconFile)) {
    try {
      # Load the frame that matches the notification area: the Icon(path)
      # constructor would take the 32x32 default frame and let WinForms scale it
      # down, which shows a soft, muddy mark.
      $next = New-Object System.Drawing.Icon($path, [System.Windows.Forms.SystemInformation]::SmallIconSize)
      $previous = $script:tray.Icon
      $script:tray.Icon = $next
      $script:trayIconFile = $path
      if ($previous -ne $null) { $previous.Dispose() }
      Write-TrayLog 'INFO' ('tray icon {0} ({1} taskbar)' -f (Split-Path -Leaf $path), $(if (Get-TrayThemeIsLight) { 'light' } else { 'dark' }))
    } catch {
      # Remember the failed path, or the theme timer retries and logs this every five seconds
      # for as long as the file stays broken.
      Write-TrayLog 'WARN' ('could not load the tray icon {0}: {1}' -f $path, $_.Exception.Message)
      $script:trayIconFile = $path
    }
  }
  if ($script:tray.Icon -eq $null) { $script:tray.Icon = [System.Drawing.SystemIcons]::Application }
}

# What the 5s tick owns: the notification-area ink, and the uninstall handshake.
# `dsh-web-tray uninstall` drops tray-exit.flag and waits for this to consume it.
function Update-TrayTick {
  Set-TrayIcon
  if (Test-Path -LiteralPath $exitFlagPath) {
    try { Remove-Item -LiteralPath $exitFlagPath -Force -ErrorAction Stop } catch {}
    Write-TrayLog 'INFO' 'exit requested by a marker file'
    Close-Tray
  }
}

$script:trayIconFile = $null
$tray = New-Object System.Windows.Forms.NotifyIcon
Set-TrayIcon
$tray.Text = $shortcutName

# Left click shows DSH (the desktop app's tray behaves that way), right click opens the
# menu; shown by hand, because assigning it to the NotifyIcon would open it on a left
# click too.
$tray.Add_MouseUp({
  param($sender, $eventArgs)
  if ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    Start-OpenFlow
  } elseif ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Right) {
    Show-TrayMenu
  }
})

function Show-TrayMenu {
  try {
# Anchored at the cursor like the desktop app's menu: its bottom-left corner sits on the
# pointer and it grows up and to the right. Windows still clamps it at the screen edges,
# and the height is known because the panel is sized explicitly.
    $cursor = [System.Windows.Forms.Cursor]::Position
    $menu.Show($cursor.X, $cursor.Y - $script:trayMenu.Height)
  } catch {
    Write-TrayLog 'WARN' ('could not open the tray menu: {0}' -f $_.Exception.Message)
  }
}

# ---- self test (no UI) ----
if ($SelfTest) {
  # The contract goes to a UTF-8 file next to the helper as well as to stdout:
  # redirected stdout runs through the console code page, which mangles the
  # Chinese menu labels for anything parsing it.
  $target = Get-ShortcutTarget
  # Rounded corners are a DWM request, so prove it on a real window: a 10x10
  # form parked off-screen, never shown to anyone.
  $dwmReadBack = -1
  $dwmProbe = New-Object System.Windows.Forms.Form
  $dwmProbe.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $dwmProbe.ShowInTaskbar = $false
  $dwmProbe.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $dwmProbe.Location = New-Object System.Drawing.Point(-32000, -32000)
  $dwmProbe.Size = New-Object System.Drawing.Size(10, 10)
  $dwmProbe.Opacity = 0
  try {
    $dwmProbe.Show()
    [DshTrayCorners]::Apply($dwmProbe.Handle) | Out-Null
    $dwmReadBack = [DshTrayCorners]::Read($dwmProbe.Handle)
  } catch {
  } finally {
    try { $dwmProbe.Close(); $dwmProbe.Dispose() } catch {}
  }
  # Style the popup exactly as the live path does (Opening/Opened fire only on a real
  # show, which the self test never performs), so the contract can assert the bits.
  # Guarded: in degraded mode the type does not exist, and the self test still has to
  # produce a contract that says so.
  try { [DshTrayWindow]::MarkToolWindow($menu.Handle) } catch {}

  # Prove the window matcher on a window we own: that is the code path the tray's
  # "reuse first" step uses, without touching anyone else's window. It is parked
  # off-screen (still "visible" to Win32, so the matcher sees it) because a probe
  # that flashes on screen is exactly the kind of thing a test run should not do.
  $matcherProbe = New-Object System.Windows.Forms.Form
  $matcherProbe.Text = 'dsh-web-tray matcher probe'
  $matcherProbe.StartPosition = 'Manual'
  $matcherProbe.Location = New-Object System.Drawing.Point(-32000, -32000)
  $matcherProbe.Size = New-Object System.Drawing.Size(240, 160)
  $matcherProbe.Show()
  Start-Sleep -Milliseconds 200
  # The probe's own class name carries a per-process hash, so it is read back rather
  # than guessed: the matcher takes the class it must match.
  # Guarded: in degraded mode (the styled C# did not compile) these types do not exist,
  # and the self test still has to produce a contract that says so instead of dying.
  $matcherFoundOwnWindow = $false
  $matcherPlacement = ''
  $focusReturned = $false
  try {
    $matcherFoundOwnWindow = (@([DshTrayTarget]::FindTitledWindows('dsh-web-tray matcher', [DshTrayTarget]::ClassOf($matcherProbe.Handle))) -contains $matcherProbe.Handle)
    # Read the resting size back through the same call the matcher decides on: a
    # minimized window reports a 160x28 placeholder through GetWindowRect, so this is
    # the number that says whether a window is the page.
    $matcherPlacement = [DshTrayTarget]::PlacementSummary($matcherProbe.Handle)
    # Focus() takes the foreground for a moment; a plain self test only reads window
    # facts, and -SelfTestFocus asks for the steal as well.
    if ($SelfTestFocus) { $focusReturned = [DshTrayTarget]::Focus($matcherProbe.Handle) }
  } catch {}

  # Prove the reload keystroke too: the probe records what it receives, so a wrong chord
  # (or a window that never gets one) shows up in the contract instead of in the user's
  # browser. Pumped by hand, because the self test never enters a message loop. Gated with
  # the focus probe: it takes the foreground for a moment.
  $script:probeKey = ''
  $reloadProbeSent = $false
  $reloadProbeKey = ''
  $closeProbeSent = $false
  $closeProbeKey = ''
  if ($SelfTestFocus) {
    $matcherProbe.KeyPreview = $true
    $matcherProbe.Add_KeyDown({
      param($sender, $eventArgs)
      $script:probeKey = $eventArgs.KeyCode.ToString()
    })
    # A chord goes to whatever window is in front, so the self test only sends one once its
    # own probe window has the foreground: otherwise it would reload or close a window the
    # user is working in. reloadProbeKey records the key the probe received, when it had it.
    $reloadProbeSent = [DshTrayTarget]::FocusAndWait($matcherProbe.Handle, 400)
    if ($reloadProbeSent) { [DshTrayTarget]::SendReloadChord() }
    for ($pump = 0; $pump -lt 20; $pump++) {
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 50
      if ($script:probeKey -ne '') { break }
    }
    $reloadProbeKey = $script:probeKey
    # The exit chord, on the same probe: a WinForms window ignores Ctrl+W, so the probe
    # survives to report what it received.
    $script:probeKey = ''
    $closeProbeSent = [DshTrayTarget]::FocusAndWait($matcherProbe.Handle, 400)
    if ($closeProbeSent) { [DshTrayTarget]::SendCloseChord() }
    for ($pump = 0; $pump -lt 20; $pump++) {
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 50
      if ($script:probeKey -ne '') { break }
    }
    $closeProbeKey = $script:probeKey
  }
  $matcherProbe.Close()
  $matcherProbe.Dispose()
  $dshWindow = Find-DshWindow

  $contract = [ordered]@{
    openLabel = $openLabel
    exitLabel = $exitLabel
    items = @($menu.Items | ForEach-Object { $_.GetType().Name + '|' + $_.Text })
    # Measured, not assumed: the renderer has to be the styled one, and visual
    # styles have to be on or that renderer paints system colours.
    renderer = $menu.Renderer.GetType().Name
    # False means the styled C# did not compile and the menu is the system one; the
    # measured values below are then meaningless and are reported as system colours.
    styledMenu = $script:styledMenu
    visualStyles = [System.Windows.Forms.Application]::RenderWithVisualStyles
    backColor = $menu.BackColor.ToArgb()
    foreColor = $menu.ForeColor.ToArgb()
    hoverColor = $(if ($script:styledMenu) { [DshTrayMenuColors]::Hover.ToArgb() } else { $menu.BackColor.ToArgb() })
    separatorColor = $(if ($script:styledMenu) { [DshTrayMenuColors]::Line.ToArgb() } else { 0 })
    font = $menu.Font.Name + ' ' + $menu.Font.Size
    fontHeight = $menu.Font.Height
    itemPadding = @($openItem.Padding.Left, $openItem.Padding.Top, $openItem.Padding.Right, $openItem.Padding.Bottom)
    itemMargin = @($openItem.Margin.Top, $exitItem.Margin.Bottom)
    # WinForms' own drop-down padding, which the item margins above are
    # shortened by; the two together are the app's 12 px panel gap.
    panelPaddingTop = $menu.Padding.Top
    separatorHeight = $separator.Height
    # The panel is measured, not left to WinForms: width from the label ink plus
    # the app's inset on both sides, so the blank strip on the right is the same as
    # on the left (the app's own menu is 175 px for a 134 px label).
    inkWidth = $inkWidth
    textInset = $itemInset
    panelWidth = $menu.Width
    panelHeight = $menu.Height
    itemWidth = $openItem.Width
    panelRightGap = $menu.Width - $itemInset - $inkWidth
    # Corners come from Windows (dwm), not from a Region clip: 2 = rounded.
    cornerMode = 'dwm'
    dwmCornerReadBack = $dwmReadBack
    # The popup must be a tool window, or Explorer lists it as an app window of this
    # PowerShell process (which is what named the menu "Windows PowerShell").
    # Both come from the styled C# source: in degraded mode there is no such type, and
    # the contract reports zeroes rather than dying on it.
    menuExStyle = $(if ($script:styledMenu) { [DshTrayWindow]::ExStyleOf($menu.Handle) } else { 0 })
    toolWindow = $(if ($script:styledMenu) { (([DshTrayWindow]::ExStyleOf($menu.Handle) -band 0x80) -ne 0) } else { $false })
    # "Reuse first": a browser window (installed web app, else a tab window) that
    # already shows the page. The Electron desktop app is never a candidate — the
    # count below says how many of its windows the matcher skipped.
    dshWindowFound = ($dshWindow.Handle -ne [IntPtr]::Zero)
    dshWindow = $dshWindow.Description
    dshWindowIsWebApp = $dshWindow.WebApp
    dshWindowsSkippedAsApp = $dshWindow.SkippedApp
    # Chromium windows that are not browsers (QQ, Electron apps) were skipped as well.
    dshWindowsSkippedAsOther = $dshWindow.SkippedOther
    # What the tray would do to open the page here: an app window in a detected Chromium
    # browser, or a plain open.
    openPageCommand = $( $open = Get-OpenPageCommand $webUrl; if ($open.Plain) { 'plain:' + $open.Exe } else { 'app:' + $open.Exe } )
    # The browser predicate, against a process that is provably not one (this self test).
    # It is what keeps a QQ or Electron window — same window class, same title words — from
    # being reloaded or driven.
    browserProbeOwnProcess = (Test-BrowserProcess (Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $PID) -ErrorAction SilentlyContinue))
    matcherFoundOwnWindow = $matcherFoundOwnWindow
    matcherPlacement = $matcherPlacement
    focusReturned = $focusReturned
    # Whether the reload chord was sent, and which key the probe received.
    reloadProbeSent = $reloadProbeSent
    reloadProbeKey = $reloadProbeKey
    # The exit chord, on the same probe.
    closeProbeSent = $closeProbeSent
    closeProbeKey = $closeProbeKey
    itemHeight = $itemHeight
    dpiScale = $script:dpiScale
    targetPath = $target.Path
    targetArguments = $target.Arguments
    # Rendered, not assembled: this is the string handed to wsl.exe.
    wslStartCommand = (Get-WslCommand $wslStartScript)
    wslStopCommand = (Get-WslCommand $wslStopScript)
    # Which ink the tray wears, and the theme it read it from.
    trayIcon = $(if ($script:trayIconFile -eq $null) { '' } else { Split-Path -Leaf $script:trayIconFile })
    trayIconTheme = $(if (Get-TrayThemeIsLight) { 'light' } else { 'dark' })
    trayIconSize = ('{0}x{1}' -f $tray.Icon.Width, $tray.Icon.Height)
    shortcutIcon = (Split-Path -Leaf $iconPath)
    # Whether the Start menu shortcut still matches the stamp: what the start-up repair reads.
    shortcutCurrent = (Test-ShortcutCurrent)
    webUrl = $webUrl
    dshAlive = (Test-DshAlive)
    openTimeoutSec = $openTimeoutSec
    trayText = $tray.Text
  } | ConvertTo-Json -Compress -Depth 4
  try {
    Set-Content -Path (Join-Path $scriptDir 'tray-selftest.json') -Value $contract -Encoding UTF8
  } catch {}
  Write-Output $contract
  # Exercise the real exit handler too: it has to return on its own and touch nothing.
  Close-Tray
  return
}

# ---- single instance ----
# One tray per install directory: a second double-click of the same shortcut only has to
# show DSH, while the tray of a different install directory is not this one's business.
# The suffix is a digest of the directory, which is stable from run to run.
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $scriptDirDigest = [System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($scriptDir.ToLower())))
} finally { $sha.Dispose() }
$mutexName = 'Local\dsh-web-tray-single-' + (($scriptDirDigest -replace '-', '').Substring(0, 16))
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
try {
  if (-not $mutex.WaitOne(0, $false)) {
    # The tray is up already, so this double-click only has to show DSH.
    $tray.Dispose()
    Invoke-OpenFlowAndWait
    return
  }
} catch {
  return
}

$openTimer = New-Object System.Windows.Forms.Timer
# Readiness is one local connect, so it is polled often: this interval is directly the delay
# between DSH answering and the page being open.
$openTimer.Interval = 500
$openTimer.Add_Tick({
  if (Test-DshAlive) {
    $openTimer.Stop()
    $script:opening = $false
    Complete-OpenFlow
    return
  }
  if ((Get-Date) -gt $script:openDeadline) {
    $openTimer.Stop()
    $script:opening = $false
    Write-TrayLog 'WARN' ('gave up waiting for {0} after {1}s' -f $webUrl, $openTimeoutSec)
  }
})
$script:openTimer = $openTimer

# The taskbar theme can change while the tray is up and the notification area is painted
# in it. One registry read per tick, on the UI thread; the icon is only reassigned when
# the ink really changed.
$themeTimer = New-Object System.Windows.Forms.Timer
$themeTimer.Interval = 5000
$themeTimer.Add_Tick({ Update-TrayTick })
$themeTimer.Start()

$tray.Visible = $true
# Tray mode from here on, so give up the inherited console. Guarded: in degraded mode the
# type does not exist, and a tray with a console beats no tray.
try { [DshTraySetup]::DetachConsole() } catch {}
Write-TrayLog 'INFO' ('tray started (menu: {0} / {1})' -f $openLabel, $exitLabel)

# The shortcut is this install's entry point and the one thing a user can delete or edit by
# hand, so rebuild it whenever it is no longer what we wrote.
if (-not (Test-ShortcutCurrent)) {
  try { New-DshShortcut } catch { Write-TrayLog 'WARN' ('could not repair the Start menu shortcut: {0}' -f $_.Exception.Message) }
}

# The Start menu shortcut exists to show DSH, so a fresh tray opens it right away.
Start-OpenFlow


[System.Windows.Forms.Application]::Run()
