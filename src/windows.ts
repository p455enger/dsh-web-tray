/**
 * WSL/Windows interop helpers. Every Windows process launch carries a timeout:
 * the plugin must never hang the DSH server when WSL interop is unavailable.
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Result of a Windows process launch. */
export interface ExecResult {
  /** Exit code, or null when the process was terminated by a signal/timeout. */
  code: number | null
  /** Signal that terminated the process, when one did. */
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  /** Whether the configured timeout killed the process. */
  timedOut: boolean
}

/**
 * Absolute Windows PowerShell hosts, in preference order, for every drive WSL has
 * mounted. Absolute paths come first because `appendWindowsPath = false` leaves
 * Windows directories out of PATH, so spawning the bare name fails with ENOENT on
 * exactly the deployments this plugin targets; the bare name stays as the last
 * candidate for a host whose PATH does carry Windows.
 *
 * Hardcoding C: made the absolute fallback silently useless on a machine whose
 * Windows lives on another drive, so the drive list comes from the mounts (and from
 * PATH, which names them too).
 */
function powershellCandidates(): string[] {
  const drives = new Set<string>(['c'])
  for (const entry of (process.env.PATH ?? '').split(':')) {
    const match = /^\/mnt\/([a-zA-Z])(?:\/|$)/.exec(entry)
    if (match !== null) drives.add(match[1].toLowerCase())
  }
  try {
    for (const match of readFileSync('/proc/mounts', 'utf8').matchAll(/\/mnt\/([a-zA-Z])[\s/]/g)) {
      drives.add(match[1].toLowerCase())
    }
  } catch {
    // No /proc/mounts: PATH and the C: default are all we have.
  }
  const candidates = [...drives].flatMap(drive => [
    `/mnt/${drive}/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`,
    `/mnt/${drive}/Windows/SysWOW64/WindowsPowerShell/v1.0/powershell.exe`,
  ])
  candidates.push('powershell.exe')
  return candidates
}

let cachedPowerShell: string | undefined

/** The Windows PowerShell executable: an absolute path when one exists, else the name. */
export function powershellPath(): string {
  if (cachedPowerShell !== undefined) return cachedPowerShell
  for (const candidate of powershellCandidates()) {
    if (candidate === 'powershell.exe' || existsSync(candidate)) {
      cachedPowerShell = candidate
      return candidate
    }
  }
  cachedPowerShell = 'powershell.exe'
  return cachedPowerShell
}

/**
 * Run a Windows PowerShell process from WSL through the interop launcher.
 * The returned promise always settles: a timeout kills the child and resolves
 * with {@link ExecResult.timedOut} set, and a spawn error resolves as a
 * failed result so callers can degrade gracefully.
 * @param args - arguments after the common `-NoProfile`/`-NonInteractive` set.
 * @param script - optional PowerShell source written to the child's stdin
 * (`powershell.exe -Command -`).
 * @param timeoutMs - hard kill deadline.
 */
export function runWindowsPowerShell(args: readonly string[], script?: string, timeoutMs = 20000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(powershellPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // PSModulePath is deliberately NOT set here: a Windows process launched from WSL
      // takes its environment from the Windows user profile, and a value passed from
      // this side is ignored (measured — removing it and setting it both changed
      // nothing). A machine with PowerShell 7 installed therefore hands 5.1 a module
      // path that starts with 7's directories and some cmdlets stop resolving; the
      // generated helper normalises the variable for itself.
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    timer.unref?.()
    const finish = (result: ExecResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (error: Error) => {
      finish({ code: null, signal: null, stdout, stderr: stderr === '' ? error.message : stderr, timedOut })
    })
    child.on('close', (code, signal) => {
      finish({ code, signal, stdout, stderr, timedOut })
    })
    if (script !== undefined) {
      child.stdin.on('error', () => {})
      child.stdin.end(script)
    } else {
      child.stdin.end()
    }
  })
}

/** Whether the host is running inside WSL. */
export function isWsl(): boolean {
  if (process.env.WSL_DISTRO_NAME !== undefined && process.env.WSL_DISTRO_NAME !== '') return true
  try {
    return readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')
  } catch {
    return false
  }
}

/** The WSL distro name for `wsl.exe -d <distro>`. */
export function distroName(): string {
  return process.env.WSL_DISTRO_NAME || 'Ubuntu'
}

/**
 * Best-effort WSL-side path of the Windows user profile. It is derived from
 * the interop PATH (`/mnt/c/Users/Administrator/...`) so it works even when
 * PowerShell interop is unavailable; null means the drive mapping could not
 * be inferred.
 */
export function windowsUserProfileWslPath(envPath: string = process.env.PATH ?? ''): string | null {
  for (const entry of envPath.split(':')) {
    const match = /^\/mnt\/([a-zA-Z])\/Users\/([^/]+)/.exec(entry)
    if (match !== null) return `/mnt/${match[1].toLowerCase()}/Users/${match[2]}`
  }
  return null
}

/**
 * Convert a Windows path to a WSL path with `wslpath -u` (a Linux binary, so
 * no Windows process is involved). Returns null on failure.
 */
export async function windowsPathToWslPath(windowsPath: string): Promise<string | null> {
  const trimmed = windowsPath.trim().replace(/"/g, '')
  if (trimmed === '') return null
  return new Promise((resolve) => {
    // The trimmed value is the one that was checked: passing the raw string could
    // hand wslpath a stray quote or a newline.
    execFile('wslpath', ['-u', trimmed], { timeout: 5000 }, (error, stdout) => {
      if (error !== null) { resolve(null); return }
      const line = stdout.trim()
      resolve(line === '' ? null : line)
    })
  })
}

/**
 * WSL-side path of the Windows desktop. Uses PowerShell's authoritative
 * `GetFolderPath('Desktop')` (which follows OneDrive redirection) and falls
 * back to the conventional profile/Desktop, then profile/OneDrive/Desktop.
 */
export async function windowsDesktopWslPath(): Promise<string | null> {
  const profile = windowsUserProfileWslPath() ?? fallbackWindowsProfileWslPath()
  if (isWsl()) {
    const result = await runWindowsPowerShell(
      ['-Command', "[Environment]::GetFolderPath('Desktop')"],
      undefined,
      8000,
    )
    if (result.code === 0 && !result.timedOut && result.stdout.trim() !== '') {
      const converted = await windowsPathToWslPath(result.stdout.trim())
      if (converted !== null) return converted
    }
  }
  if (profile === null) return null
  // Redirection first: a machine that moved its Desktop usually keeps an empty
  // `%USERPROFILE%\Desktop` behind, and Explorer only shows the redirected one, so
  // trying the conventional path first wrote the shortcut somewhere invisible.
  // PowerShell's own answer above stays authoritative whenever interop works.
  for (const candidate of [
    join(profile, 'OneDrive', 'Desktop'),
    join(profile, 'OneDriveCommercial', 'Desktop'),
    join(profile, 'Desktop'),
  ]) {
    if (existsSync(candidate)) return candidate
  }
  return join(profile, 'Desktop')
}

/**
 * Every host fact and Windows-facing operation the tray service performs, as one
 * object. The service's lifecycle (idempotence, migration from an older install, the
 * shortcut) is the part worth testing, and it can only be tested by substituting
 * these — a test host is not WSL and has no PowerShell.
 */
export interface TrayHostBridge {
  /** Whether this host runs inside WSL: the only platform this version writes for. */
  isWsl(): boolean
  /** WSL-side home directory; the `~/.dsh/dsh-web-tray` tree lives under it. */
  homeDir(): string
  /** Windows user profile as a WSL path, or null when it cannot be resolved. */
  userProfileDir(): Promise<string | null>
  /** Windows desktop as a WSL path, or null when it cannot be resolved. */
  desktopDir(): Promise<string | null>
  /** Run Windows PowerShell with a hard timeout. */
  runPowerShell(args: readonly string[], script: string | undefined, timeoutMs: number): Promise<ExecResult>
}

/** The real bridge: this machine's WSL, file system and PowerShell. */
export function windowsHostBridge(): TrayHostBridge {
  return {
    isWsl,
    homeDir: homedir,
    userProfileDir: windowsUserProfileWslPathResolved,
    desktopDir: windowsDesktopWslPath,
    runPowerShell: (args, script, timeoutMs) => runWindowsPowerShell(args, script, timeoutMs),
  }
}

/** Pick a single plausible Windows user profile when the PATH probe failed. */
export function fallbackWindowsProfileWslPath(): string | null {
  const base = '/mnt/c/Users'
  try {
    const entries = readdirSync(base).filter(name => !['Public', 'Default', 'Default User', 'All Users', 'desktop.ini'].includes(name))
    return entries.length > 0 ? join(base, entries[0]) : null
  } catch {
    return null
  }
}

/**
 * The Windows user profile, most reliable source first.
 *
 * The interop PATH probe is cheap but only works when `appendWindowsPath` is
 * left at its default: with `appendWindowsPath = false` PATH carries no Windows
 * directory at all, and the directory scan can only guess — on the machine this
 * fork targets it guesses `Administrator`, whose profile is not writable, so
 * every generated file would land in the wrong place and fail. PowerShell's own
 * view is therefore asked next, and the scan stays as the last resort for when
 * interop is temporarily unavailable.
 * @returns the `/mnt/<drive>/Users/<name>` path, or null.
 */
export async function windowsUserProfileWslPathResolved(): Promise<string | null> {
  const fromPath = windowsUserProfileWslPath()
  if (fromPath !== null) return fromPath
  if (isWsl()) {
    const result = await runWindowsPowerShell(
      ['-Command', "[Environment]::GetFolderPath('UserProfile')"],
      undefined,
      8000,
    )
    if (result.code === 0 && !result.timedOut && result.stdout.trim() !== '') {
      const converted = await windowsPathToWslPath(result.stdout.trim())
      if (converted !== null) return converted
    }
  }
  return fallbackWindowsProfileWslPath()
}
