/**
 * The WSL desktop/tray launcher service: writes the generated artifacts (three
 * icons, the Windows launcher, the tray helper, the WSL start and stop scripts)
 * and creates the desktop shortcut through a single PowerShell `-Regenerate`
 * run.
 *
 * Nothing here samples the running DSH: the tray knows whether the URL answers,
 * the start script writes a PID file, and `stop.sh` stops that PID. A PID/uptime/
 * RSS poll on every status request was state nobody acted on.
 */

import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import {
  DEFAULT_SHORTCUT_NAME,
  DEFAULT_WEB_URL,
  ICON_FILE_NAME,
  LAUNCHER_SCRIPT_NAME,
  LEGACY_CONFIG_NAME,
  LEGACY_LAUNCHER_NAME,
  LEGACY_STATUS_NAME,
  LEGACY_TRAY_FILE_NAMES,
  SHORTCUT_STAMP_NAME,
  START_LOG_NAME,
  START_SCRIPT_NAME,
  STOP_SCRIPT_NAME,
  TRAY_ICON_FILE_NAMES,
  TRAY_SCRIPT_NAME,
  WIN_DIR_REL,
  WSL_DIR_NAME,
  buildLauncherScript,
  buildStartScript,
  buildStopScript,
  buildTrayScript,
  type LaunchConfig,
} from './artifacts.ts'
import { distroName, windowsHostBridge, type TrayHostBridge } from './windows.ts'

/** Which deployment this host serves. Windows-native is a later phase. */
export type TrayPlatform = 'wsl' | 'win' | 'unsupported'

/** Stable wire shape shared by the status and regenerate routes. */
export interface TrayStatus {
  ok: boolean
  platform: TrayPlatform
  distro: string
  webUrl: string
  /** Token URL of the running DSH, read from the start script's log. */
  webAuthUrl: string | null
  shortcutName: string
  windowsProfileDir: string | null
  desktopDir: string | null
  files: {
    shortcutPath: string | null
    shortcutExists: boolean
    trayDir: string | null
    trayScriptExists: boolean
    launcherScriptExists: boolean
    iconExists: boolean
    trayIconExists: boolean
    startScriptPath: string
    startScriptExists: boolean
    stopScriptExists: boolean
  }
  lastError?: string
  lastResult?: string
}

/** The webserver face the service reads for the current URL. */
export interface WebServerLike {
  readonly host: string
  readonly port: number
}

/** The context face this service needs. */
export interface TrayServiceContext {
  readonly logger?: {
    warn(message: string): void
    info(message: string): void
  }
}

/** Convert a WSL `/mnt/c/...` path to the Windows `C:\...` form. */
export function wslPathToWindowsPath(path: string): string {
  const match = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(path)
  if (match !== null) return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`
  return path.replace(/\//g, '\\')
}

/** The DSH web URL for a bound webserver host/port. */
export function webUrlFor(webServer: WebServerLike): string {
  const host = webServer.host === '0.0.0.0' ? '127.0.0.1' : webServer.host
  return `http://${host}:${webServer.port}`
}

/** Locate one of this package's bundled icon assets by file name. */
async function readIconBytes(name: string = ICON_FILE_NAME): Promise<Buffer | null> {
  const here = dirname(fileURLToPath(import.meta.url))
  try {
    return await readFile(join(here, '..', 'assets', name))
  } catch {
    return null
  }
}

/**
 * The WSL-side directory holding the generated start script.
 * @param home - the user's home directory; the service passes the bridge's own.
 */
export function wslAppDir(home: string = homedir()): string {
  return join(home, '.dsh', WSL_DIR_NAME)
}

/**
 * The token URL of the current DSH run, from the start script's log. The token
 * is per-process, so only the newest line counts; without it the browser lands
 * on a 401 page.
 */
export async function readWebAuthUrl(appDir: string = wslAppDir()): Promise<string | null> {
  try {
    const raw = await readFile(join(appDir, START_LOG_NAME), 'utf8')
    const tail = raw.split(/\r?\n/).slice(-200)
    for (let index = tail.length - 1; index >= 0; index--) {
      const match = /http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/.exec(tail[index])
      if (match !== null) return match[0]
    }
  } catch {
    // No log yet (DSH was never started by the tray).
  }
  return null
}

/** The launch facts the generated start script is built from. */
export interface StartCommand {
  nodeBin: string
  /** The checkout's BUILD OUTPUT cli — never a `src` entry (see below). */
  sourceCli: string | null
  /** The checkout root the launcher cd's into. */
  sourceCwd: string | null
  /** The running host's own JS cli, used when no checkout is usable. */
  bakedCli: string | null
  /** True when the project path came from the user, not from auto-detection. */
  sourceConfigured: boolean
  /**
   * Whether a `dsh` executable sits on PATH. The generated start script tries
   * `command -v dsh` FIRST, so a PATH install is a complete launcher on its
   * own; without this fact the guard below would refuse to generate anything
   * on a plain global install whose argv[1] is the extensionless shim.
   */
  pathCli: boolean
}

/** `<checkout>/apps/cli/lib/bin.js`, also accepting a configured `apps/cli` dir. */
function checkoutBuildCli(configured: string): string | null {
  for (const candidate of [
    join(configured, 'apps', 'cli', 'lib', 'bin.js'),
    join(configured, 'lib', 'bin.js'),
  ]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** The checkout root for a configured path (the root itself or its apps/cli). */
function checkoutRoot(configured: string): string {
  return configured.endsWith(join('apps', 'cli')) ? dirname(dirname(configured)) : configured
}

/**
 * True for an argv[1] that lives in a checkout's `src` tree. Such an entry is
 * started through tsx and would put a src instance and a lib instance of the
 * same packages in one process, which is exactly the mixed-loading failure
 * this plugin avoids; it is never baked in as a launcher.
 */
function isSourceEntry(path: string): boolean {
  return /[\\/]apps[\\/]cli[\\/]src[\\/]/.test(path) || /\.(?:ts|tsx|mts|cts)$/.test(path)
}

/** Whether an executable `dsh` is on PATH (what start.sh tries first). */
function dshOnPath(): boolean {
  for (const entry of (process.env.PATH ?? '').split(':')) {
    if (entry === '') continue
    if (existsSync(join(entry, 'dsh'))) return true
  }
  return false
}

/**
 * Derive DSH launch candidates from the running host process.
 *
 * A configured project path wins: the generated start.sh then launches that
 * checkout's BUILD OUTPUT and fails loudly instead of falling back to another
 * install. Without a configured path, the order stays
 * 1. `dsh` on PATH (global npm / pnpm / binary installs);
 * 2. the checkout build output (`<project>/apps/cli/lib/bin.js`, defaulting to
 *    `~/deepseek-harness`);
 * 3. the current process argv[1] when it is a real JS CLI (npm global or npx
 *    cache while it lasts);
 * 4. `npx --yes dsh` as the final self-healing fallback.
 *
 * Only paths that exist NOW are baked in; runtime fallbacks cover later moves.
 * `src` entries (tsx) are never baked in: the runtime resolution mode loads
 * plugins from lib, so a src host mixes two instances of the same packages.
 * Whether a checkout's build output is CURRENT is not decided here — start.sh
 * checks that when it launches, and logs the `pnpm run build` reminder.
 */
function resolveStartCommand(projectPath: string | null | undefined): StartCommand {
  const nodeBin = process.execPath
  const configured = (projectPath ?? '').trim()
  const configuredExists = configured !== '' && existsSync(configured)
  const configuredBuild = configuredExists ? checkoutBuildCli(configured) : null
  const defaultRoot = join(homedir(), 'deepseek-harness')
  const defaultBuild = configuredBuild === null && existsSync(defaultRoot) ? checkoutBuildCli(defaultRoot) : null
  const sourceCli = configuredBuild ?? defaultBuild
  const sourceCwd = sourceCli !== null
    ? dirname(dirname(dirname(dirname(sourceCli))))
    : configuredExists
      ? checkoutRoot(configured)
      : existsSync(defaultRoot)
        ? defaultRoot
        : null
  const argv1 = process.argv[1]
  let bakedCli: string | null = null
  if (argv1 !== undefined
    && argv1 !== sourceCli
    && !isSourceEntry(argv1)
    && /\.(?:js|mjs|cjs)$/.test(argv1)
    && existsSync(argv1)) {
    bakedCli = argv1
  }
  return {
    nodeBin,
    sourceCli,
    sourceCwd,
    bakedCli,
    sourceConfigured: configuredExists,
    pathCli: dshOnPath(),
  }
}

/**
 * The configured project path itself is unusable, so no artifact should be
 * generated from it (an existing good start script is left alone).
 */
export function configuredPathProblem(configuredPath: string): string | null {
  const trimmed = configuredPath.trim()
  if (trimmed === '' || existsSync(trimmed)) return null
  return `the configured project path does not exist: ${trimmed}`
}

/**
 * Write in the same directory and rename into place, so a reader (notably the
 * PowerShell run that follows, and the settings card polling `/status`) sees either
 * the old file or the new one, never half of either.
 */
async function writeFileAtomic(path: string, data: string | Buffer): Promise<void> {
  const temp = `${path}.tmp-${String(process.pid)}-${Math.random().toString(36).slice(2)}`
  await writeFile(temp, data)
  await rename(temp, path)
}

/**
 * What the helper recorded about the desktop shortcut it wrote. `shortcut` and `icon`
 * are file names (the helper knows the Windows path, this host the WSL one) and the
 * digest is what actually decides staleness; `target` and `arguments` are kept for
 * whoever reads the file.
 */
interface ShortcutStamp {
  shortcut?: unknown
  icon?: unknown
  target?: unknown
  arguments?: unknown
  lnkBytes?: unknown
  lnkSha256?: unknown
}

/**
 * Whether the shortcut on disk is still the one the helper wrote. The stamp carries
 * the `.lnk`'s own size and digest, which is what makes this answer a real one: a
 * shortcut that was replaced, restored from a backup, or pointed at the old `.vbs` by
 * another tool is rebuilt on the next mount instead of being trusted for existing.
 */
function shortcutIsCurrent(trayDir: string, shortcutPath: string, iconPath: string): boolean {
  try {
    const raw = readFileSync(join(trayDir, SHORTCUT_STAMP_NAME), 'utf8').replace(/^\uFEFF/, '')
    const stamp = JSON.parse(raw) as ShortcutStamp
    if (stamp.shortcut !== basename(shortcutPath) || stamp.icon !== basename(iconPath)) return false
    if (typeof stamp.lnkBytes !== 'number' || typeof stamp.lnkSha256 !== 'string') return false
    const lnk = readFileSync(shortcutPath)
    if (lnk.length !== stamp.lnkBytes) return false
    const digest = createHash('sha256').update(lnk).digest('hex')
    return digest.toLowerCase() === stamp.lnkSha256.toLowerCase()
  } catch {
    return false
  }
}

/**
 * Owns the generated files and the shortcut lifecycle for one plugin mount.
 * All Windows process launches are fenced by the helpers in windows.ts.
 */
export class TrayService {
  private cachedDesktopDir: string | null | undefined

  private cachedWindowsDir: string | null | undefined

  private cachedProfileDir: string | null | undefined

  private regenerating: Promise<TrayStatus> | null = null

  private projectPath: string

  constructor(
    private readonly ctx: TrayServiceContext,
    private readonly webServer: WebServerLike,
    private readonly shortcutName: string = DEFAULT_SHORTCUT_NAME,
    private readonly bridge: TrayHostBridge = windowsHostBridge(),
  ) {
    this.projectPath = this.readProjectPathFromDisk()
  }

  /** The WSL-side directory this service owns, under the bridge's home. */
  private appDir(): string {
    return wslAppDir(this.bridge.homeDir())
  }

  /** Read the persisted source-project path, defaulting to empty (auto-detect). */
  private readProjectPathFromDisk(): string {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(this.appDir(), 'project-path.json'), 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).projectPath === 'string') {
        return (parsed as Record<string, unknown>).projectPath as string
      }
    } catch {
      // Missing or malformed file is the empty default.
    }
    return ''
  }

  /** The currently configured source-project path (empty = auto-detect). */
  getProjectPath(): string {
    return this.projectPath
  }

  /** Persist the configured source-project path and keep it live for generation. */
  async setProjectPath(value: string): Promise<void> {
    this.projectPath = value.trim()
    await mkdir(this.appDir(), { recursive: true })
    // Atomic: a truncated file here is read back as "no project path" on the next
    // mount, which silently reverts the user to auto-detection.
    await writeFileAtomic(join(this.appDir(), 'project-path.json'), JSON.stringify({ projectPath: this.projectPath }))
  }

  /**
   * The Windows-side directory holding the icons, the tray script and the
   * launcher. Resolved once per mount, and authoritatively: with
   * `appendWindowsPath = false` PATH has no Windows directory, so the scan
   * fallback would pick the wrong user and every write would fail.
   */
  private async windowsAppDir(): Promise<string | null> {
    if (this.cachedWindowsDir !== undefined) return this.cachedWindowsDir
    const profile = await this.windowsProfileDir()
    this.cachedWindowsDir = profile === null ? null : join(profile, ...WIN_DIR_REL.split('/'))
    return this.cachedWindowsDir
  }

  /**
   * The Windows user profile, resolved once per mount: the PowerShell fallback costs
   * seconds, and `/status` is fetched by the settings card.
   */
  private async windowsProfileDir(): Promise<string | null> {
    if (this.cachedProfileDir !== undefined) return this.cachedProfileDir
    this.cachedProfileDir = await this.bridge.userProfileDir()
    return this.cachedProfileDir
  }

  /** Resolve the desktop once per mount; PowerShell is authoritative. */
  async desktopDir(): Promise<string | null> {
    if (this.cachedDesktopDir !== undefined) return this.cachedDesktopDir
    this.cachedDesktopDir = await this.bridge.desktopDir()
    return this.cachedDesktopDir
  }

  /** Read the current on-disk facts. */
  async status(): Promise<TrayStatus> {
    const platform: TrayPlatform = this.bridge.isWsl() ? 'wsl' : 'unsupported'
    const desktopDir = await this.desktopDir()
    const windowsProfileDir = await this.windowsProfileDir()
    const trayDir = await this.windowsAppDir()
    const startScriptPath = join(this.appDir(), START_SCRIPT_NAME)
    const stopScriptPath = join(this.appDir(), STOP_SCRIPT_NAME)
    const shortcutPath = desktopDir === null ? null : join(desktopDir, `${this.shortcutName}.lnk`)
    return {
      ok: true,
      platform,
      distro: distroName(),
      webUrl: platform === 'wsl' ? webUrlFor(this.webServer) : DEFAULT_WEB_URL,
      webAuthUrl: await readWebAuthUrl(this.appDir()),
      shortcutName: this.shortcutName,
      windowsProfileDir,
      desktopDir,
      files: {
        shortcutPath,
        shortcutExists: shortcutPath !== null && existsSync(shortcutPath),
        trayDir,
        trayScriptExists: trayDir !== null && existsSync(join(trayDir, TRAY_SCRIPT_NAME)),
        launcherScriptExists: trayDir !== null && existsSync(join(trayDir, LAUNCHER_SCRIPT_NAME)),
        iconExists: trayDir !== null && existsSync(join(trayDir, ICON_FILE_NAME)),
        // Both inks: the tray picks by taskbar theme and only falls back to the
        // other file when one is missing.
        trayIconExists: trayDir !== null && TRAY_ICON_FILE_NAMES.every(name => existsSync(join(trayDir, name))),
        startScriptPath,
        startScriptExists: existsSync(startScriptPath),
        stopScriptExists: existsSync(stopScriptPath),
      },
    }
  }

  /**
   * Build the text artifacts for the current host facts. Null when no launcher
   * can be located at all (regenerate reports that as an error).
   */
  private currentScripts(): {
    startScript: string
    stopScript: string
    trayScript: string
    launcher: string
  } | null {
    const cli = resolveStartCommand(this.projectPath)
    // A configured checkout with no build output still gets a script: it
    // refuses to launch src and names the fix, so it starts working the moment
    // the user runs the build.
    if (cli.sourceCli === null && cli.bakedCli === null && !cli.sourceConfigured && !cli.pathCli) return null
    const config: LaunchConfig = {
      distro: distroName(),
      webUrl: webUrlFor(this.webServer),
      shortcutName: this.shortcutName,
      // Absolute, not `~/...`: the helper passes these to bash, and a tilde only
      // expands when it is unquoted — which it cannot be once the path needs quoting.
      wslStartScript: join(this.appDir(), START_SCRIPT_NAME),
      wslStopScript: join(this.appDir(), STOP_SCRIPT_NAME),
      wslStartLogPath: join(this.appDir(), START_LOG_NAME),
    }
    return {
      startScript: buildStartScript({
        nodeBin: cli.nodeBin,
        sourceCli: cli.sourceCli,
        sourceCwd: cli.sourceCwd,
        bakedCli: cli.bakedCli,
        sourceConfigured: cli.sourceConfigured,
        webUrl: config.webUrl,
      }),
      stopScript: buildStopScript(),
      trayScript: buildTrayScript(config),
      launcher: buildLauncherScript(),
    }
  }

  /**
   * Ensure the six generated files exist AND match the current host facts
   * (web URL, CLI path, shortcut name, icon art). A stale start script from
   * another port/profile — or an icon from an older release — is a real failure
   * mode, so compare content, not presence.
   */
  async ensure(): Promise<TrayStatus> {
    const base = await this.status()
    const filesExist = base.files.shortcutExists
      && base.files.trayScriptExists
      && base.files.launcherScriptExists
      && base.files.iconExists
      && base.files.trayIconExists
      && base.files.startScriptExists
    if (!filesExist) return this.regenerate()
    const current = this.currentScripts()
    if (current === null) return base
    const trayDir = base.files.trayDir
    // A file an older version left behind — or one that was locked during the last
    // upgrade — means this install is not current even when every byte below matches.
    // regenerate() is what deletes them.
    if (trayDir !== null && LEGACY_TRAY_FILE_NAMES.some(name => existsSync(join(trayDir, name)))) {
      return this.regenerate()
    }
    // The shortcut is not one of those bytes: its target can be wrong while every
    // generated file is exactly right, which "the .lnk exists" cannot see.
    if (trayDir !== null
      && (base.files.shortcutPath === null
        || !shortcutIsCurrent(trayDir, base.files.shortcutPath, join(trayDir, ICON_FILE_NAME)))) {
      return this.regenerate()
    }
    const stopScriptPath = join(this.appDir(), STOP_SCRIPT_NAME)
    try {
      const startMatches = await readFile(base.files.startScriptPath, 'utf8') === current.startScript
      if (!startMatches) return this.regenerate()
      const stopMatches = await readFile(stopScriptPath, 'utf8') === current.stopScript
      if (!stopMatches) return this.regenerate()
      if (trayDir !== null) {
        const trayPath = join(trayDir, TRAY_SCRIPT_NAME)
        // The file is written with a UTF-8 BOM for Windows PowerShell 5.1.
        const trayMatches = await readFile(trayPath, 'utf8').then(text => text.replace(/^\uFEFF/, '') === current.trayScript)
        if (!trayMatches) return this.regenerate()
        const launcherPath = join(trayDir, LAUNCHER_SCRIPT_NAME)
        const launcherMatches = await readFile(launcherPath, 'utf8') === current.launcher
        if (!launcherMatches) return this.regenerate()
        // Bytes, not presence: restyled icons have to reach an existing install,
        // and the shortcut Explorer caches is what the user sees.
        for (const name of [ICON_FILE_NAME, ...TRAY_ICON_FILE_NAMES]) {
          const expected = await readIconBytes(name)
          const matches = expected !== null
            && await readFile(join(trayDir, name))
              .then(bytes => bytes.equals(expected))
              .catch(() => false)
          if (!matches) return this.regenerate()
        }
      }
      return base
    } catch {
      return this.regenerate()
    }
  }

  /**
   * Write all artifacts and create/refresh the desktop shortcut.
   *
   * Single-flight: two mounts, or a mount racing the settings card's button, must not
   * write the same files (and the same `.lnk`) at the same time.
   */
  regenerate(): Promise<TrayStatus> {
    if (this.regenerating !== null) return this.regenerating
    this.regenerating = this.regenerateOnce().finally(() => { this.regenerating = null })
    return this.regenerating
  }

  private async regenerateOnce(): Promise<TrayStatus> {
    const base = await this.status()
    if (base.platform !== 'wsl') {
      return {
        ...base,
        ok: false,
        lastError: 'dsh-web-tray only runs inside WSL; Windows desktop integration is unavailable here',
      }
    }
    const trayDir = await this.windowsAppDir()
    if (trayDir === null) {
      return {
        ...base,
        ok: false,
        lastError: 'cannot determine the Windows user profile from the WSL environment (no /mnt/<drive>/Users/<name> in PATH)',
      }
    }
    const pathProblem = configuredPathProblem(this.projectPath)
    if (pathProblem !== null) {
      return { ...base, ok: false, lastError: pathProblem }
    }
    const icons: Array<[string, Buffer]> = []
    for (const name of [ICON_FILE_NAME, ...TRAY_ICON_FILE_NAMES]) {
      const bytes = await readIconBytes(name)
      if (bytes === null) {
        return {
          ...base,
          ok: false,
          lastError: `the bundled ${name} asset is missing from the installed package`,
        }
      }
      icons.push([name, bytes])
    }

    const wslStartDir = this.appDir()
    const scripts = this.currentScripts()
    if (scripts === null) {
      return {
        ...base,
        ok: false,
        lastError: 'cannot locate a DSH launcher: no `dsh` on PATH, process.argv[1] is not a JS file, no built source checkout was found, and no project path is configured',
      }
    }

    try {
      await mkdir(trayDir, { recursive: true })
      await mkdir(wslStartDir, { recursive: true })
      for (const [name, bytes] of icons) {
        await writeFileAtomic(join(trayDir, name), bytes)
      }
      // The BOM is required: without it Windows PowerShell 5.1 reads the
      // Chinese menu labels as ANSI and the script fails to parse.
      await writeFileAtomic(join(trayDir, TRAY_SCRIPT_NAME), '\uFEFF' + scripts.trayScript)
      // Plain ASCII, no BOM: Windows Script Host reads a .js launcher as ANSI,
      // and a BOM would be a syntax error for it.
      await writeFileAtomic(join(trayDir, LAUNCHER_SCRIPT_NAME), scripts.launcher)
      // An install from before the JScript launcher keeps a .vbs that the shortcut no
      // longer points at, one from before the simplification keeps a switch and a
      // status file nothing reads any more, and one from before the favicon mark keeps
      // the inverted tile the tray no longer loads. One list, shared with the helper's
      // -Uninstall and with ensure().
      for (const legacy of LEGACY_TRAY_FILE_NAMES) {
        await rm(join(trayDir, legacy), { force: true })
      }
      await writeFileAtomic(join(wslStartDir, START_SCRIPT_NAME), scripts.startScript)
      await chmod(join(wslStartDir, START_SCRIPT_NAME), 0o755)
      await writeFileAtomic(join(wslStartDir, STOP_SCRIPT_NAME), scripts.stopScript)
      await chmod(join(wslStartDir, STOP_SCRIPT_NAME), 0o755)

      const trayScriptWindowsPath = wslPathToWindowsPath(join(trayDir, TRAY_SCRIPT_NAME))
      const result = await this.bridge.runPowerShell(['-File', trayScriptWindowsPath, '-Regenerate'], undefined, 30000)
      if (result.code !== 0 || result.timedOut) {
        return {
          ...(await this.status()),
          ok: false,
          lastError: result.timedOut
            ? 'timed out while Windows created the shortcut (PowerShell interop did not answer)'
            : `PowerShell failed to create the shortcut: ${result.stderr.trim() || result.stdout.trim() || `exit ${String(result.code)}`}`,
        }
      }
      const refreshed = await this.status()
      const lastResult = result.stdout.trim() || refreshed.files.shortcutPath || 'shortcut created'
      return { ...refreshed, ok: refreshed.files.shortcutExists, lastResult }
    } catch (error) {
      this.ctx.logger?.warn(`[dsh-web-tray] regenerate failed: ${error instanceof Error ? error.message : String(error)}`)
      return {
        ...(await this.status()),
        ok: false,
        lastError: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
