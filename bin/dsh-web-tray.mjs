#!/usr/bin/env node
/**
 * dsh-web-tray installer.
 *
 * Installs and removes the Windows-side tray that opens and exits a `dsh web` instance
 * running inside WSL, and reports what is on disk. It runs from either side of the
 * boundary: inside WSL it writes the Windows install directory through /mnt/<drive>, and on
 * Windows it writes it directly, asking wsl.exe only to start and stop DSH.
 *
 * Everything it installs lives in one Windows directory plus the Start menu shortcut, and the
 * only Windows process it starts is the tray helper itself — once, with -ShortcutOnly, to
 * write that shortcut. No install script runs on `npm i`: installing is this command.
 *
 * Usage: dsh-web-tray <install|uninstall|status|open|stop> [options]
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INSTALL_DIR_NAME = 'dsh-web-tray'
const TRAY_SCRIPT = 'dsh-web-tray.ps1'
const SHORTCUT_STAMP = 'tray-shortcut.json'
const EXIT_FLAG = 'tray-exit.flag'
const DEFAULT_WEB_PORT = 3080
const DEFAULT_COMMAND = 'dsh web --no-open'
const DEFAULT_SHORTCUT_NAME = 'DeepSeek Harness (Web)'
/** Where the shortcut goes inside the Windows profile; recorded in full in the stamp. */
const START_MENU_DIR = 'AppData/Roaming/Microsoft/Windows/Start Menu/Programs'

/** Windows files copied verbatim; start.sh and stop.sh must keep LF endings. */
const WINDOWS_FILES = ['dsh-web-tray.ps1', 'dsh-web-tray.js', 'start.sh', 'stop.sh']
export const ICON_FILES = ['dsh-web-tray.ico', 'dsh-web-tray-black.ico', 'dsh-web-tray-white.ico']

/** Files this install owns, for uninstall and for the status listing. */
export const OWNED_FILES = [
  ...WINDOWS_FILES,
  ...ICON_FILES,
  'tray.env',
  SHORTCUT_STAMP,
  'start.log',
  'tray.log',
  'tray-selftest.json',
]

const HELP = `dsh-web-tray — Windows tray and Start menu entry for \`dsh web\` in WSL

Usage: dsh-web-tray <command> [options]

Commands
  install      Copy the tray into %USERPROFILE%\\.dsh\\${INSTALL_DIR_NAME} and write the
               Start menu shortcut (one Windows process, no install scripts)
  uninstall    Ask the tray to exit, then remove the shortcut and every installed file
  status       Report the install, the shortcut, the configured URL and the last log lines
  open         Start DSH if it is not answering, then print its authorised URL
  stop         Stop the DSH web instance(s) started from this install

Options
  --distro <name>     WSL distribution the tray addresses (default: $WSL_DISTRO_NAME, else Ubuntu)
  --workspace <path>  Directory DSH runs in (default: the current directory)
  --command <line>    Command that starts DSH (default: ${DEFAULT_COMMAND})
  --port <number>     Port the web UI listens on (default: ${DEFAULT_WEB_PORT})
  --windows-user <u>  Windows user whose profile to install into, when it cannot be found
  -h, --help          This text
  -v, --version       Package version
`

/**
 * Quote one value for tray.env. Values are read back by both this package and the tray, and
 * neither unescapes anything, so a value that cannot survive verbatim is rejected instead.
 * @param name - key being written, for the error message.
 * @param value - the value as given on the command line.
 */
export function envValue(name, value) {
  const text = String(value)
  if (text === '') throw new Error(`${name} must not be empty`)
  for (const bad of ["'", '\n', '\r']) {
    if (text.includes(bad)) throw new Error(`${name} must not contain ${JSON.stringify(bad)}: ${text}`)
  }
  return `'${text}'`
}

/**
 * Render tray.env. LF endings: Windows PowerShell and the shell scripts both read this file
 * line by line, and the scripts are executed by bash from an NTFS path.
 * @param values - DISTRO, WSL_DIR, WEB_URL, WORKSPACE and DSH_COMMAND.
 */
export function renderEnv(values) {
  // SHORTCUT_NAME is optional: the tray falls back to 'DSH Web' when it is absent.
  const order = ['DISTRO', 'WSL_DIR', 'WEB_URL', 'WORKSPACE', 'DSH_COMMAND', 'SHORTCUT_NAME']
  const lines = [
    '# Written by `dsh-web-tray install`. Read by dsh-web-tray.ps1 (tray) and by start.sh.',
    '# One KEY=\'value\' per line; edit and re-run `dsh-web-tray status` to check it.',
  ]
  for (const name of order) {
    if (values[name] === undefined) continue
    lines.push(`${name}=${envValue(name, values[name])}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Read tray.env, the same way the tray and start.sh do: strip the outer quotes, keep the
 * value otherwise verbatim, ignore comments.
 * @param text - file contents.
 */
export function parseEnv(text) {
  const values = {}
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line === '' || line.startsWith('#')) continue
    const split = line.indexOf('=')
    if (split < 1) continue
    let value = line.slice(split + 1).trim()
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
    values[line.slice(0, split).trim()] = value
  }
  return values
}

/**
 * `/mnt/c/Users/me/...` from `C:\Users\me\...`. WSL reaches the install directory through
 * this path, and the tray hands it to bash, so it has to be exact.
 * @param windowsPath - drive-absolute Windows path.
 */
export function windowsDirToWsl(windowsPath) {
  const match = /^([A-Za-z]):\\(.*)$/.exec(windowsPath.replace(/\//g, '\\'))
  if (match === null) throw new Error(`not a drive-absolute Windows path: ${windowsPath}`)
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`
}

/**
 * `C:\Users\me\...` from `/mnt/c/Users/me/...`. Needed when handing a path to a Windows
 * process, which cannot read the /mnt form.
 * @param wslPath - path under /mnt/<drive>.
 */
export function wslDirToWindows(wslPath) {
  const match = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(wslPath)
  if (match === null) throw new Error(`not a /mnt/<drive> path: ${wslPath}`)
  return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`
}

/**
 * Drive letters WSL has mounted under /mnt, from PATH and from the mount table.
 * @param {NodeJS.ProcessEnv} env - environment to read PATH from.
 * @param {string | null} [mountsText] - mount table to read; the real one by default.
 */
export function mountedDrives(env = process.env, mountsText = null) {
  const drives = new Set(['c'])
  for (const entry of (env.PATH ?? '').split(':')) {
    const match = /^\/mnt\/([a-zA-Z])(?:\/|$)/.exec(entry)
    if (match !== null) drives.add(match[1].toLowerCase())
  }
  try {
    const text = mountsText ?? readFileSync('/proc/mounts', 'utf8')
    for (const match of text.matchAll(/\/mnt\/([a-zA-Z])[\s/]/g)) {
      drives.add(match[1].toLowerCase())
    }
  } catch {
    // No mount table to read: PATH and the C: default are all we have.
  }
  return [...drives]
}

/**
 * Windows PowerShell to run helper switches with: the absolute path when a mount provides
 * one (appendWindowsPath may be off), the bare name last.
 * @param env - environment to read PATH from.
 */
export function powershellPath(env = process.env) {
  if (process.platform === 'win32') return 'powershell.exe'
  const candidates = mountedDrives(env).flatMap(drive => [
    `/mnt/${drive}/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`,
    `/mnt/${drive}/Windows/SysWOW64/WindowsPowerShell/v1.0/powershell.exe`,
  ])
  candidates.push('powershell.exe')
  for (const candidate of candidates) {
    if (candidate === 'powershell.exe' || existsSync(candidate)) return candidate
  }
  return 'powershell.exe'
}

/**
 * The Windows user profile as a WSL path, most reliable source first: the interop PATH
 * names it directly, and PowerShell's own answer covers `appendWindowsPath = false`. The
 * directory scan is deliberately not a source — it can pick another user's profile, and
 * installing into the wrong profile is worse than refusing.
 * @param options - injectable environment and PowerShell runner.
 */
export async function resolveWindowsProfile(options = {}) {
  const env = options.env ?? process.env
  const runPowerShell = options.runPowerShell ?? defaultRunPowerShell
  if (options.windowsUser !== undefined) {
    return { wslPath: `/mnt/c/Users/${options.windowsUser}`, source: '--windows-user' }
  }
  const fromPath = windowsProfileFromPath(env)
  if (fromPath !== null) { return fromPath }
  const result = await runPowerShell(['-Command', "[Environment]::GetFolderPath('UserProfile')"])
  if (result.code === 0 && result.stdout.trim() !== '') {
    const converted = /^([A-Za-z]):\\(.*)$/.exec(result.stdout.trim().replace(/"/g, ''))
    if (converted !== null) {
      return { wslPath: `/mnt/${converted[1].toLowerCase()}/${converted[2].replace(/\\/g, '/')}`, source: 'PowerShell' }
    }
  }
  throw new Error('cannot find the Windows user profile: pass --windows-user, or run this where WSL interop works')
}

/** Run Windows PowerShell, always settling. */
function defaultRunPowerShell(args, timeoutMs = 20000) {
  return new Promise((done) => {
    const child = spawn(powershellPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
    timer.unref?.()
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    const finish = (code, message) => {
      clearTimeout(timer)
      if (message !== undefined && stderr === '') { stderr = message }
      done({ code, stdout, stderr, timedOut })
    }
    child.on('error', error => finish(null, error.message))
    child.on('close', code => finish(code))
  })
}

/** The Windows install directory and the paths derived from it. */
export async function resolveLayout(options = {}) {
  // Every path here is a WSL path because the install directory is written through /mnt and
  // the tray is driven with wsl.exe; on Windows the same strings resolve against the current
  // drive root, so the honest answer is to refuse rather than half-install.
  if (process.platform === 'win32') {
    throw new Error('run this inside WSL: the tray is installed from the Linux side (see the README)')
  }
  const profile = await resolveWindowsProfile(options)
  const home = options.home ?? homedir()
  const targetDir = `${profile.wslPath}/.dsh/${INSTALL_DIR_NAME}`
  return {
    profile,
    targetDir,
    trayEnvPath: join(targetDir, 'tray.env'),
    trayScriptWsl: join(targetDir, TRAY_SCRIPT),
    trayScriptWindows: wslDirToWindows(join(targetDir, TRAY_SCRIPT)),
    targetDirWindows: wslDirToWindows(targetDir),
    exitFlagPath: join(targetDir, EXIT_FLAG),
    stampPath: join(targetDir, SHORTCUT_STAMP),
    home,
  }
}

/**
 * Copy the package's files into the install directory and write tray.env. The helper keeps
 * the byte-order mark Windows PowerShell 5.1 needs for the non-ASCII menu labels, and the
 * shell scripts are written with LF endings only.
 * @param layout - from {@link resolveLayout}.
 * @param config - DISTRO, WSL_DIR, WEB_URL, WORKSPACE, DSH_COMMAND.
 */
export async function installFiles(layout, config) {
  await mkdir(layout.targetDir, { recursive: true })
  const written = []
  for (const name of WINDOWS_FILES) {
    const body = await readFile(join(PACKAGE_ROOT, 'windows', name), 'utf8')
    const text = body.replace(/\r\n/g, '\n')
    await writeFile(join(layout.targetDir, name), name.endsWith('.ps1') ? `\uFEFF${text}` : text, 'utf8')
    written.push(name)
  }
  for (const name of ICON_FILES) {
    await writeFile(join(layout.targetDir, name), await readFile(join(PACKAGE_ROOT, 'assets', name)))
    written.push(name)
  }
  await writeFile(layout.trayEnvPath, renderEnv(config), 'utf8')
  written.push('tray.env')
  return written
}

/**
 * Create or refresh the Start menu shortcut by running the tray helper's -ShortcutOnly switch:
 * resolving the Start menu folder (which can be redirected) and writing a .lnk both need Windows.
 * @returns the helper's output, or an explanation when Windows could not be reached.
 */
export async function writeShortcut(layout, options = {}) {
  const runPowerShell = options.runPowerShell ?? defaultRunPowerShell
  const result = await runPowerShell(['-File', layout.trayScriptWindows, '-ShortcutOnly'], 30000)
  if (result.timedOut) return { ok: false, detail: 'timed out' }
  if (result.code !== 0) return { ok: false, detail: (result.stdout + result.stderr).trim() || `exit ${result.code}` }
  return { ok: true, detail: result.stdout.trim() }
}

/**
 * Say so when a DSH profile still lists this package as a plugin. 1.0 is not one, so DSH logs
 * a skipped bundle on every start until the profile is cleaned up; dropping it is the user's
 * call and one command.
 * @param layout - from {@link resolveLayout}.
 * @param log - where to report.
 */
function reportStalePlugin(layout, log) {
  const profiles = join(layout.home, '.dsh', 'profiles')
  if (!existsSync(profiles)) return
  for (const profile of readdirSync(profiles)) {
    const manifest = join(profiles, profile, 'package.json')
    if (!existsSync(manifest)) continue
    let text = ''
    try {
      text = readFileSync(manifest, 'utf8')
    } catch {
      continue
    }
    if (!text.includes('dsh-web-tray')) continue
    log(`note: the DSH profile "${profile}" still lists dsh-web-tray as a plugin — drop it with:`)
    log(`  dsh plugin --profile ${profile} remove dsh-web-tray`)
  }
}

/** `install`: files, configuration, shortcut. */
export async function install(options = {}) {
  const log = options.log ?? console.log
  const distro = options.distro ?? process.env.WSL_DISTRO_NAME ?? 'Ubuntu'
  const workspace = options.workspace ?? process.cwd()
  const command = options.command ?? DEFAULT_COMMAND
  const port = options.port ?? DEFAULT_WEB_PORT
  const layout = await resolveLayout(options)
  const config = {
    DISTRO: distro,
    WSL_DIR: layout.targetDir,
    WEB_URL: `http://127.0.0.1:${port}`,
    WORKSPACE: workspace,
    DSH_COMMAND: command,
    SHORTCUT_NAME: options.shortcutName ?? DEFAULT_SHORTCUT_NAME,
  }
  const written = await installFiles(layout, config)
  log(`installed ${written.length} files in ${layout.targetDirWindows} (profile from ${layout.profile.source})`)
  log(`  distro ${distro} · workspace ${workspace} · ${config.WEB_URL}`)
  // A stamp from an install that put the shortcut elsewhere names a shortcut this one does
  // not use any more; leaving it behind would give the user two entries.
  const previous = existsSync(layout.stampPath) ? shortcutPathFromStamp(layout) : null
  const wanted = `${layout.profile.wslPath}/${START_MENU_DIR}/${config.SHORTCUT_NAME}.lnk`
  if (previous !== null && previous !== wanted && existsSync(previous) && isRemovableShortcut(previous, layout.profile.wslPath)) {
    rmSync(previous, { force: true })
    log(`removed the older shortcut at ${previous}`)
  }
  const shortcut = await writeShortcut(layout, options)
  if (shortcut.ok) {
    log(`Start menu shortcut: ${shortcut.detail}`)
  } else {
    log(`could not write the Start menu shortcut (${shortcut.detail})`)
    log(`  run it yourself, or start the tray once and it repairs its own shortcut:`)
    log(`  ${powershellPath()} -File "${layout.trayScriptWindows}" -ShortcutOnly`)
  }
  reportStalePlugin(layout, log)
  return { layout, config, shortcut }
}

/**
 * `uninstall`: ask the running tray to exit, then remove the shortcut and this install's
 * files. DSH itself is never touched.
 * @param options - `timeoutMs` for the tray handshake.
 */
export async function uninstall(options = {}) {
  const log = options.log ?? console.log
  const layout = await resolveLayout(options)
  if (!existsSync(layout.targetDir)) {
    log(`nothing installed at ${layout.targetDirWindows}`)
    return { removed: [] }
  }
  const shortcut = shortcutPathFromStamp(layout)
  // The tray consumes this on its next tick and exits; waiting for that is what keeps the
  // icon from lingering after its files are gone.
  await writeFile(layout.exitFlagPath, 'exit\n', 'utf8')
  const deadline = Date.now() + (options.timeoutMs ?? 10000)
  while (existsSync(layout.exitFlagPath) && Date.now() < deadline) {
    await new Promise(done => setTimeout(done, 250))
  }
  if (existsSync(layout.exitFlagPath)) {
    log('the tray did not exit on its own; stopping it')
    const script = layout.trayScriptWindows
    await (options.runPowerShell ?? defaultRunPowerShell)(['-Command',
      `Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like '*${script}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], 20000)
    rmSync(layout.exitFlagPath, { force: true })
  }
  const removed = []
  if (isRemovableShortcut(shortcut, layout.profile.wslPath) && existsSync(shortcut)) {
    rmSync(shortcut, { force: true })
    removed.push(shortcut)
  }
  for (const name of OWNED_FILES) {
    const path = join(layout.targetDir, name)
    if (existsSync(path)) {
      rmSync(path, { force: true })
      removed.push(path)
    }
  }
  const leftovers = existsSync(layout.targetDir) ? readdirSync(layout.targetDir) : []
  if (leftovers.length === 0) {
    rmSync(layout.targetDir, { recursive: true, force: true })
  } else {
    log(`kept ${layout.targetDirWindows}: ${leftovers.join(', ')}`)
  }
  log(`removed ${removed.length} item(s); DSH was left running`)
  log('if this was installed as a DSH plugin, drop it from the profile: dsh plugin remove dsh-web-tray')
  return { removed }
}

/**
 * Whether a path may be removed as a shortcut: a .lnk inside the user's Desktop or Start
 * menu. A stamp is a file on disk that anything could have written, so what it names is
 * checked before it is deleted.
 * @param shortcutPath - WSL-side path from a stamp or from the conventional fallback.
 * @param profileWslPath - the Windows profile as a WSL path.
 */
export function isRemovableShortcut(shortcutPath, profileWslPath) {
  if (!shortcutPath.endsWith('.lnk')) { return false }
  return shortcutPath.startsWith(`${profileWslPath}/Desktop/`)
    || shortcutPath.startsWith(`${profileWslPath}/${START_MENU_DIR}/`)
}

/**
 * The shortcut this install wrote, as a WSL path. The stamp records the full Windows path
 * because the Start menu folder can be redirected; the conventional location is the fallback.
 * @param layout - from {@link resolveLayout}.
 */
export function shortcutPathFromStamp(layout) {
  try {
    // The tray writes the stamp with Set-Content -Encoding UTF8, which is UTF-8 *with* a
    // byte-order mark; JSON.parse rejects that, and the failure used to fall back to the
    // conventional path silently — so the mark is stripped before parsing.
    const stamp = JSON.parse(readFileSync(layout.stampPath, 'utf8').replace(/^\uFEFF/, ''))
    if (typeof stamp.path === 'string' && stamp.path !== '') return windowsDirToWsl(stamp.path)
    if (typeof stamp.shortcut === 'string' && stamp.shortcut !== '') {
      // A stamp with a name and no path predates the Start menu entry: that shortcut is on
      // the desktop, and an install has to know so it can remove it.
      return `${layout.profile.wslPath}/Desktop/${stamp.shortcut}`
    }
  } catch {
    // No stamp: the shortcut may still be at the conventional path.
  }
  return `${layout.profile.wslPath}/${START_MENU_DIR}/${DEFAULT_SHORTCUT_NAME}.lnk`
}

/** `status`: what is installed, whether it is consistent, and what it last did. */
export async function status(options = {}) {
  const log = options.log ?? console.log
  const layout = await resolveLayout(options)
  log(`install directory: ${layout.targetDirWindows} (profile from ${layout.profile.source})`)
  if (!existsSync(layout.targetDir)) {
    log('  not installed: run `dsh-web-tray install`')
    return { installed: false }
  }
  const missing = OWNED_FILES.filter(name => !existsSync(join(layout.targetDir, name)))
  const present = OWNED_FILES.filter(name => existsSync(join(layout.targetDir, name)))
  log(`  ${present.length} of ${OWNED_FILES.length} files present${missing.length > 0 ? ` (missing: ${missing.join(', ')})` : ''}`)
  const env = existsSync(layout.trayEnvPath) ? parseEnv(readFileSync(layout.trayEnvPath, 'utf8')) : {}
  for (const [name, value] of Object.entries(env)) log(`  ${name}=${value}`)
  for (const name of ['tray.env', 'start.sh', 'stop.sh']) {
    const path = join(layout.targetDir, name)
    if (existsSync(path) && readFileSync(path, 'utf8').includes('\r')) {
      log(`  WARNING ${name} has CR endings: re-run \`dsh-web-tray install\` (or save it as LF)`)
    }
  }
  const shortcut = shortcutPathFromStamp(layout)
  log(`  Start menu shortcut: ${existsSync(shortcut) ? shortcut : `missing (${shortcut})`}`)
  if (env.DISTRO !== undefined && process.env.WSL_DISTRO_NAME !== undefined
    && env.DISTRO !== process.env.WSL_DISTRO_NAME) {
    log(`  WARNING this shell is in ${process.env.WSL_DISTRO_NAME}, the tray addresses ${env.DISTRO}`)
  }
  const url = env.WEB_URL ?? `http://127.0.0.1:${DEFAULT_WEB_PORT}`
  log(`  ${url}: ${await answers(url) ? 'answering' : 'not answering'}`)
  for (const name of ['start.log', 'tray.log']) {
    const path = join(layout.targetDir, name)
    if (!existsSync(path)) continue
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n').slice(-3)
    for (const line of lines) log(`  ${name}: ${line}`)
  }
  return { installed: true, missing, env }
}

/** Whether the web UI answers; a 401 means it is up and simply wants its cookie. */
export async function answers(url, timeoutMs = 2500) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return response.status >= 200 && response.status < 500
  } catch {
    return false
  }
}

/** The shell command that runs one of the two scripts through the configured distro. */
function wslCommandLayout(distro, wslDir, script) {
  return { file: 'wsl.exe', args: ['-d', distro, '--', 'bash', '-lc', `exec '${wslDir}/${script}'`] }
}

/**
 * `open`: start DSH unless it already answers, then print its authorised URL — the same
 * token the tray opens, read from the log the launcher writes beside itself.
 */
export async function open(options = {}) {
  const log = options.log ?? console.log
  const layout = await resolveLayout(options)
  const env = readTrayEnv(layout)
  const url = env.WEB_URL ?? `http://127.0.0.1:${DEFAULT_WEB_PORT}`
  if (await answers(url)) {
    log(`DSH is already answering at ${url}`)
  } else {
    log(`starting DSH through ${env.DSH_COMMAND ?? DEFAULT_COMMAND}`)
    launchScript(layout, 'start.sh')
    const deadline = Date.now() + (options.timeoutMs ?? 120000)
    while (!(await answers(url)) && Date.now() < deadline) {
      await new Promise(done => setTimeout(done, 1000))
    }
    if (!(await answers(url))) {
      log(`gave up waiting for ${url}; see ${join(layout.targetDir, 'start.log')}`)
      return { url: null }
    }
  }
  const target = tokenUrl(layout, url) ?? url
  if (target === url) {
    log('no launch token in start.log: this instance was started elsewhere, so the page may ask you to sign in')
  }
  log(target)
  return { url: target }
}

/** `stop`: stop the DSH web instance(s) this install manages. */
export async function stop(options = {}) {
  const log = options.log ?? console.log
  const layout = await resolveLayout(options)
  readTrayEnv(layout)
  log('stopping the DSH web instance(s) started from this install')
  runScript(layout, 'stop.sh')
  return { ok: true }
}

/**
 * Read tray.env, or say that there is nothing installed. Both callers would otherwise fail
 * with a raw ENOENT from a path the user never chose.
 * @param layout - from {@link resolveLayout}.
 */
function readTrayEnv(layout) {
  if (!existsSync(layout.trayEnvPath)) {
    throw new Error(`nothing is installed at ${layout.targetDirWindows}; run: dsh-web-tray install`)
  }
  return parseEnv(readFileSync(layout.trayEnvPath, 'utf8'))
}

/** Run start.sh or stop.sh detached: start.sh execs into DSH, so it must outlive us. */
function launchScript(layout, script) {
  const env = parseEnv(readFileSync(layout.trayEnvPath, 'utf8'))
  if (process.platform === 'win32') {
    const command = wslCommandLayout(env.DISTRO, env.WSL_DIR, script)
    const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    return
  }
  const child = spawn('bash', [join(layout.targetDir, script)], { detached: true, stdio: 'ignore' })
  child.unref()
}

/** Same, but waited for: stop.sh is quick and its exit status is worth reporting. */
function runScript(layout, script) {
  const env = parseEnv(readFileSync(layout.trayEnvPath, 'utf8'))
  if (process.platform === 'win32') {
    const command = wslCommandLayout(env.DISTRO, env.WSL_DIR, script)
    spawnSync(command.file, command.args, { stdio: 'inherit' })
    return
  }
  spawnSync('bash', [join(layout.targetDir, script)], { stdio: 'inherit' })
}

/**
 * The PATH half of {@link resolveWindowsProfile}: the interop PATH names the profile when
 * WSL keeps Windows directories on it, which is the common case.
 * @param env - environment to read PATH from.
 * @returns the profile as a WSL path, or null when PATH carries no Windows user directory.
 */
function windowsProfileFromPath(env) {
  for (const entry of (env.PATH ?? '').split(':')) {
    const match = /^\/mnt\/([a-zA-Z])\/Users\/([^/]+)/.exec(entry)
    if (match !== null) return { wslPath: `/mnt/${match[1].toLowerCase()}/Users/${match[2]}`, source: 'PATH' }
  }
  return null
}

/** The newest authorised URL in start.log, if the launcher has written one. */
export function tokenUrl(layout, url) {
  const path = join(layout.targetDir, 'start.log')
  if (!existsSync(path)) return null
  const pattern = new RegExp(`${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\?token=[A-Za-z0-9_.-]+`)
  const lines = readFileSync(path, 'utf8').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = pattern.exec(lines[i])
    if (match !== null) return match[0]
  }
  return null
}

/**
 * Parse the command line.
 * @param argv - arguments after the command name.
 */
export function parseArgs(argv) {
  const options = { verb: '', help: false, version: false }
  const rest = [...argv]
  // A leading flag is a flag, not a command name: `dsh-web-tray --help` is help.
  if (rest.length > 0 && !rest[0].startsWith('-')) options.verb = rest.shift()
  while (rest.length > 0) {
    const flag = rest.shift()
    if (flag === '-h' || flag === '--help') { options.help = true; continue }
    if (flag === '-v' || flag === '--version') { options.version = true; continue }
    if (!flag.startsWith('-')) { throw new Error(`unexpected argument: ${flag}`) }
    const value = rest.shift()
    if (value === undefined || value.startsWith('-')) throw new Error(`${flag} needs a value`)
    if (flag === '--distro') options.distro = value
    else if (flag === '--workspace') options.workspace = value
    else if (flag === '--command') options.command = value
    else if (flag === '--windows-user') options.windowsUser = value
    else if (flag === '--port') options.port = Number(value)
    else throw new Error(`unknown option ${flag}`)
  }
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) {
    throw new Error(`--port must be 1-65535, got ${options.port}`)
  }
  return options
}

/** Run one command. */
export async function main(argv, io = {}) {
  const log = io.log ?? console.log
  const options = parseArgs(argv)
  if (options.help) { log(HELP); return 0 }
  // Before the empty-verb shortcut: `-v` is advertised in the help text, and the
  // shortcut used to answer `--version` with the help instead of the version.
  if (options.version) {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    log(pkg.version)
    return 0
  }
  if (options.verb === '') { log(HELP); return 0 }
  if (options.verb !== 'install') {
    // These describe what install writes; silently ignoring them would let a user believe a
    // status or open call had changed the configuration.
    for (const [flag, value] of [['--distro', options.distro], ['--workspace', options.workspace], ['--command', options.command], ['--port', options.port]]) {
      if (value !== undefined) throw new Error(`${flag} is only meaningful for install`)
    }
  }
  if (options.verb === 'install') {
    const result = await install({ ...options, log })
    // The files are in place either way, but a missing Start menu entry is what the user sees.
    return result.shortcut.ok ? 0 : 1
  }
  if (options.verb === 'uninstall') { await uninstall({ ...options, log }); return 0 }
  if (options.verb === 'status') { await status({ ...options, log }); return 0 }
  if (options.verb === 'open') { await open({ ...options, log }); return 0 }
  if (options.verb === 'stop') { return await stop({ ...options, log }) }
  log(`unknown command: ${options.verb}\n`)
  log(HELP)
  return 1
}

/**
 * Whether this module is the process entry point.
 *
 * npm's `bin` shim — and therefore every `npx dsh-web-tray` run — is a symlink on
 * Linux, so `argv[1]` names the link while `import.meta.url` is the real file.
 * Comparing those two resolves directly told the CLI it had been imported, and it
 * exited 0 without printing anything: `npx dsh-web-tray install` did nothing at
 * all. Resolve both sides instead.
 */
function isEntryPoint(argv1 = process.argv[1]) {
  if (argv1 === undefined) return false
  const self = fileURLToPath(import.meta.url)
  try {
    return realpathSync(argv1) === realpathSync(self)
  } catch {
    return resolve(argv1) === resolve(self)
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2)).then(
    code => { process.exitCode = code },
    error => {
      console.error(`dsh-web-tray: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    },
  )
}
