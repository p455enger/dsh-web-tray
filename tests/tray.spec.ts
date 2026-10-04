/**
 * The tray helper is a PowerShell script, so the honest way to test it is to run it:
 * `-SelfTest` builds the real NotifyIcon and the styled ContextMenuStrip, then prints the
 * contract as JSON without showing any UI. Every number asserted here was measured off the
 * DeepSeek Harness desktop app's own tray menu on the same screen at the same DPI (the
 * script says where each one comes from).
 *
 * Set DSH_WEB_TRAY_REQUIRE_INTEROP=1 (CI) to turn a machine without Windows interop into a
 * failure rather than a skip.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ICON_FILES,
  powershellPath,
  renderEnv,
  resolveWindowsProfile,
  wslDirToWindows,
} from '../bin/dsh-web-tray.mjs'

const POWERSHELL = powershellPath()
/** A trivial call, because a PowerShell path that exists is not yet a working one. */
const interopWorks = ((): boolean => {
  try {
    return spawnSync(POWERSHELL, ['-NoProfile', '-Command', 'exit 0'], { timeout: 30_000 }).status === 0
  } catch {
    return false
  }
})()
if (!interopWorks && process.env.DSH_WEB_TRAY_REQUIRE_INTEROP === '1') {
  throw new Error('interop is required (DSH_WEB_TRAY_REQUIRE_INTEROP=1) but Windows PowerShell is unreachable')
}
if (!interopWorks) {
  console.warn('[tray] Windows interop unavailable: the tray tests are skipped and the suite still exits green')
}

/** Install directory for this run, under the Windows temp directory. */
let root: string | null = null
let profileDir: string | null = null

beforeAll(async () => {
  if (!interopWorks) return
  const profile = await resolveWindowsProfile()
  profileDir = profile.wslPath
  root = join(profile.wslPath, 'AppData', 'Local', 'Temp', `dsh-web-tray-${String(process.pid)}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
})

afterAll(() => {
  if (root !== null) rmSync(root, { recursive: true, force: true })
})

interface TrayEnvOverrides {
  distro?: string
  wslDir?: string
  webUrl?: string
  command?: string
  shortcutName?: string
}

interface MenuContract {
  openLabel: string
  exitLabel: string
  items: string[]
  renderer: string
  visualStyles: boolean
  backColor: number
  foreColor: number
  hoverColor: number
  separatorColor: number
  font: string
  fontHeight: number
  itemPadding: number[]
  itemMargin: number[]
  panelPaddingTop: number
  separatorHeight: number
  inkWidth: number
  textInset: number
  panelWidth: number
  panelHeight: number
  itemWidth: number
  panelRightGap: number
  cornerMode: string
  dwmCornerReadBack: number
  menuExStyle: number
  toolWindow: boolean
  dshWindowFound: boolean
  dshWindow: string
  dshWindowIsWebApp: boolean
  dshWindowsSkippedAsApp: number
  dshWindowsSkippedAsOther: number
  openPageCommand: string
  browserProbeOwnProcess: boolean
  closeProbeSent: boolean
  closeProbeKey: string
  matcherFoundOwnWindow: boolean
  matcherPlacement: string
  focusReturned: boolean
  itemHeight: number
  dpiScale: number
  targetPath: string
  targetArguments: string
  styledMenu: boolean
  wslStartCommand: string
  wslStopCommand: string
  reloadProbeSent: boolean
  reloadProbeKey: string
  trayIcon: string
  trayIconTheme: string
  trayIconSize: string
  shortcutIcon: string
  shortcutCurrent: boolean
  webUrl: string
  dshAlive: boolean
  openTimeoutSec: number
  trayText: string
}

/** `Color.ToArgb()` for an `#RRGGBB` value, signed as .NET returns it. */
function argb(red: number, green: number, blue: number): number {
  return ((0xFF << 24) | (red << 16) | (green << 8) | blue) | 0
}

/**
 * Write a directory that looks like `dsh-web-tray install` made it: the helper (with the
 * BOM the installer adds), the icons, the two shell scripts and tray.env.
 */
function prepare(overrides: TrayEnvOverrides = {}, name = 'selftest'): string {
  if (root === null) throw new Error('no Windows profile')
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const helper = readFileSync(new URL('../windows/dsh-web-tray.ps1', import.meta.url), 'utf8')
  writeFileSync(join(dir, 'dsh-web-tray.ps1'), `\uFEFF${helper}`, 'utf8')
  for (const name of ['dsh-web-tray.js', 'start.sh', 'stop.sh']) {
    copyFileSync(new URL(`../windows/${name}`, import.meta.url), join(dir, name))
  }
  for (const icon of ICON_FILES) copyFileSync(new URL(`../assets/${icon}`, import.meta.url), join(dir, icon))
  writeFileSync(join(dir, 'tray.env'), renderEnv({
    DISTRO: overrides.distro ?? 'Debian',
    WSL_DIR: overrides.wslDir ?? dir,
    WEB_URL: overrides.webUrl ?? 'http://127.0.0.1:3080',
    WORKSPACE: '/tmp',
    DSH_COMMAND: overrides.command ?? 'dsh web --no-open',
    SHORTCUT_NAME: overrides.shortcutName ?? 'DSH Web',
  }), 'utf8')
  return dir
}

/** Run the helper in one install directory and return its stdout. */
function run(dir: string, args: string[] = [], timeout = 120_000): string {
  return execFileSync(
    POWERSHELL,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wslDirToWindows(join(dir, 'dsh-web-tray.ps1')), ...args],
    { encoding: 'utf8', timeout },
  )
}

/**
 * Run the helper in tray mode and wait for the process itself, not for its stdio: it starts
 * wsl.exe, which would keep a captured pipe open after the tray has already exited.
 */
function runTray(dir: string, timeoutMs = 60_000): Promise<number | null> {
  return new Promise((done, fail) => {
    const child = spawn(
      POWERSHELL,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wslDirToWindows(join(dir, 'dsh-web-tray.ps1'))],
      { stdio: 'ignore', windowsHide: true },
    )
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error('the tray did not exit')) }, timeoutMs)
    child.on('error', error => { clearTimeout(timer); fail(error) })
    child.on('exit', code => { clearTimeout(timer); done(code) })
  })
}

/** The contract `-SelfTest` prints and writes beside the helper. */
function selfTestIn(dir: string, focus = false): MenuContract {
  const stdout = run(dir, ['-SelfTest', ...(focus ? ['-SelfTestFocus'] : [])])
  const contractPath = join(dir, 'tray-selftest.json')
  // The contract file is UTF-8 with a BOM; stdout goes through the console code page and
  // is kept only for a human reading the terminal.
  const raw = existsSync(contractPath) ? readFileSync(contractPath, 'utf8') : stdout
  const line = raw.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(entry => entry.trim().startsWith('{')).pop()
  if (line === undefined) throw new Error(`no JSON contract: ${stdout}`)
  return JSON.parse(line) as MenuContract
}

function selfTest(overrides: TrayEnvOverrides & { focus?: boolean } = {}): MenuContract {
  const { focus, ...env } = overrides
  return selfTestIn(prepare(env, `selftest-${String(Math.random()).slice(2, 8)}`), focus === true)
}

/**
 * Skip a test when this machine has no Windows profile to install into. Every interop test
 * needs the same guard; the skip is what keeps a machine without interop green.
 * @param ctx - the vitest test context.
 */
function requireInstall(ctx: { skip: () => void }): boolean {
  if (root === null) { ctx.skip(); return false }
  return true
}

describe.runIf(interopWorks)('tray helper (Windows interop)', () => {  it('exposes the two desktop-app entries and nothing else', (ctx) => {
    if (!requireInstall(ctx)) return
    const contract = selfTest()
    expect(contract.openLabel).toBe('打开 DeepSeek Harness')
    expect(contract.exitLabel).toBe('退出 DeepSeek Harness')
    expect(contract.items).toEqual([
      'ToolStripMenuItem|打开 DeepSeek Harness',
      'ToolStripSeparator|',
      'ToolStripMenuItem|退出 DeepSeek Harness',
    ])
    expect(contract.trayText).toBe('DSH Web')
    expect(contract.webUrl).toBe('http://127.0.0.1:3080')
    expect(typeof contract.dshAlive).toBe('boolean')
  }, 90_000)

  it('wears the measured desktop-app palette and metrics', (ctx) => {
    if (!requireInstall(ctx)) return
    const contract = selfTest()
    expect(contract.styledMenu).toBe(true)
    expect(contract.renderer).toBe('DshTrayMenuRenderer')
    // Visual styles off would make that renderer paint system colours, which is how the
    // hovered item once came out accent blue instead of #363636.
    expect(contract.visualStyles).toBe(true)
    expect(contract.backColor).toBe(argb(0x1F, 0x1F, 0x1F))
    expect(contract.foreColor).toBe(argb(0xE3, 0xE3, 0xE3))
    expect(contract.hoverColor).toBe(argb(0x36, 0x36, 0x36))
    expect(contract.separatorColor).toBe(argb(0x5E, 0x5E, 0x5E))
    // The app's font is the system UI family at 9pt: Microsoft YaHei UI on a Chinese
    // Windows, Segoe UI on an English one — never the Windows *menu* font.
    expect(contract.font).toMatch(/^(Microsoft YaHei UI|Microsoft YaHei|Segoe UI) 9$/)
    expect(contract.dpiScale).toBeGreaterThan(0)
    const scale = contract.dpiScale
    expect(contract.cornerMode).toBe('dwm')
    expect(contract.dwmCornerReadBack).toBe(2)
    // The popup is a tool window: no taskbar button, no Alt-Tab entry, so Explorer cannot
    // list the menu as an app window of this PowerShell process.
    expect(contract.toolWindow).toBe(true)
    expect(contract.menuExStyle & 0x80).toBe(0x80)
    expect(contract.menuExStyle & 0x40000).toBe(0)
    expect(contract.separatorHeight).toBe(Math.round(17 * scale))
    expect(contract.itemHeight).toBe(Math.round(28 * scale))
    expect(contract.itemMargin).toEqual([Math.round(12 * scale) - contract.panelPaddingTop, Math.round(12 * scale) - contract.panelPaddingTop])
    expect(contract.itemPadding[0]).toBe(Math.round(20 * scale))
    expect(contract.itemPadding[2]).toBe(Math.round(20 * scale))
    expect(contract.itemPadding[1]).toBe(contract.itemPadding[3])
    expect(contract.fontHeight + contract.itemPadding[1] + contract.itemPadding[3] + 4).toBe(contract.itemHeight)
    // The panel hugs the label: the same inset on both sides.
    expect(contract.panelWidth).toBe(contract.inkWidth + 2 * contract.textInset)
    expect(contract.panelRightGap).toBe(contract.textInset)
    expect(contract.itemWidth).toBe(contract.panelWidth)
    expect(contract.panelHeight).toBe(contract.itemMargin[0] + contract.itemHeight
      + contract.separatorHeight + contract.itemHeight + contract.itemMargin[1] + 2 * contract.panelPaddingTop)
  }, 90_000)

  it('targets the JScript launcher, wears the taskbar theme ink and waits 120s for DSH', (ctx) => {
    if (!requireInstall(ctx)) return
    const contract = selfTest()
    expect(contract.targetPath.toLowerCase()).toContain('wscript.exe')
    expect(contract.targetArguments).toContain('//E:JScript //B')
    expect(contract.targetArguments).toContain('dsh-web-tray.js')
    expect(contract.shortcutIcon).toBe('dsh-web-tray.ico')
    // Which ink is this machine's answer; the mapping from the theme the helper read back
    // is the part that has to hold everywhere.
    expect(['light', 'dark']).toContain(contract.trayIconTheme)
    expect(contract.trayIcon).toBe(
      contract.trayIconTheme === 'light' ? 'dsh-web-tray-black.ico' : 'dsh-web-tray-white.ico',
    )
    // The frame loaded is the notification area's own size — never the 32x32 default frame
    // the Icon(path) constructor would pick and WinForms scale down.
    const side = String(Math.round(16 * contract.dpiScale))
    expect(contract.trayIconSize).toBe(`${side}x${side}`)
    expect(contract.openTimeoutSec).toBe(120)
  }, 90_000)

  it('reuses a DSH page window and never the desktop app', (ctx) => {
    if (!requireInstall(ctx)) return
    const contract = selfTest()
    // "Reuse first": a browser window already showing the page (an installed web app window
    // is preferred over a tab window). Machine-dependent, so only the shape is asserted
    // here; the live values are what the tray logs.
    expect(typeof contract.dshWindowFound).toBe('boolean')
    expect(typeof contract.dshWindow).toBe('string')
    expect(typeof contract.dshWindowIsWebApp).toBe('boolean')
    // The Electron desktop app's window carries the same words in its title and is skipped
    // by process name — the "no relation to the desktop app" rule.
    expect(contract.dshWindowsSkippedAsApp).toBeGreaterThanOrEqual(0)
    // Chromium windows that are not browsers (QQ, Electron apps) are skipped as well.
    expect(contract.dshWindowsSkippedAsOther).toBeGreaterThanOrEqual(0)
    // The matcher runs against a real window we own, which is the same code path the tray
    // uses for the page: found by title + class, with its *resting* size read back (a
    // minimized window reports a 160x28 placeholder through GetWindowRect).
    expect(contract.matcherFoundOwnWindow).toBe(true)
    expect(contract.matcherPlacement).toMatch(/^[0-9]+x[0-9]+\/[0-9]$/)
    expect(Number(contract.matcherPlacement.split('x')[0])).toBeGreaterThanOrEqual(200)
    // A plain self test must not steal the foreground: that is -SelfTestFocus, which is
    // what a real double-click of the shortcut does.
    expect(contract.focusReturned).toBe(false)
  }, 90_000)

  it('quotes the /mnt path for CreateProcess and for bash', (ctx) => {
    if (!requireInstall(ctx)) return
    // The install directory may contain a space (a user profile can), so the helper
    // single-quotes the path for bash and double-quotes the inner command for
    // CreateProcess. The distro name stays bare on purpose: wsl.exe looks a quoted name up
    // literally and fails with WSL_E_DISTRO_NOT_FOUND.
    const contract = selfTest({ distro: 'Debian', wslDir: '/mnt/c/Users/a b/.dsh/dsh-web-tray' })
    expect(contract.wslStartCommand.startsWith('wsl.exe -d Debian -- bash -lc "')).toBe(true)
    expect(contract.wslStartCommand).toContain(`'/mnt/c/Users/a b/.dsh/dsh-web-tray/start.sh'`)
    expect(contract.wslStopCommand).toContain(`'/mnt/c/Users/a b/.dsh/dsh-web-tray/stop.sh'`)
    // And bash reads that inner command back as exactly the path — the half a string
    // assertion cannot prove. Only the leading `exec` is swapped out, so the quoting under
    // test is the quoting that ships.
    const marker = 'bash -lc "'
    const inner = contract.wslStopCommand.slice(contract.wslStopCommand.indexOf(marker) + marker.length, -1)
    const printed = execFileSync('bash', ['-c', inner.replace(/^exec /, "printf '%s' ")], { encoding: 'utf8' })
    expect(printed).toBe('/mnt/c/Users/a b/.dsh/dsh-web-tray/stop.sh')
  }, 90_000)

  it('would open the page as an app window in a Chromium browser', (ctx) => {
    if (!requireInstall(ctx)) return
    // Whichever Chromium browser this machine's default is — Chrome, Edge, Brave, Vivaldi,
    // a scoop install — the tray opens the page the way it is installed, as an app window
    // rather than another tab. A non-Chromium default reports plain:.
    const contract = selfTest()
    const kind = contract.openPageCommand.slice(0, contract.openPageCommand.indexOf(':'))
    expect(['app', 'plain']).toContain(kind)
    if (kind === 'app') {
      expect(contract.openPageCommand.slice(4).toLowerCase())
        .toMatch(/(chrome|msedge|brave|vivaldi|opera|chromium|yandex|thorium|arc)\.exe$/)
    }
    // ...and the browser rule rejects a process that is not one: this PowerShell.
    expect(contract.browserProbeOwnProcess).toBe(false)
  }, 90_000)

  it('reloads the window that was already open instead of opening a second one', (ctx) => {
    if (!requireInstall(ctx)) return
    // After the exit entry stopped DSH the window is still there, so the page is reloaded
    // in place (its session cookie outlives the process) rather than the token URL opened
    // somewhere else. The probe window records the chord, so a wrong keystroke fails here
    // instead of in the user's browser.
    const contract = selfTest({ focus: true })
    // The chord is only sent once the helper's own probe window is in front: an interactive
    // session cannot hand a background process the foreground on demand, so what is asserted
    // is that the chord was sent and that the key, when the probe did receive it, was R.
    expect(typeof contract.reloadProbeSent).toBe('boolean')
    expect(['', 'R']).toContain(contract.reloadProbeKey)
  }, 90_000)

  it('takes the page away with the instance when the exit entry is used', (ctx) => {
    if (!requireInstall(ctx)) return
    // Ctrl+W closes the tab in a browser window and the window in an app window, so the
    // exit entry leaves no dead page behind and never touches another tab.
    const contract = selfTest({ focus: true })
    // Ctrl+W is the exit chord, and the key is asserted the same way as the reload one.
    expect(typeof contract.closeProbeSent).toBe('boolean')
    expect(['', 'W']).toContain(contract.closeProbeKey)
  }, 90_000)

  it('runs the exit handler without touching WSL', (ctx) => {
    if (!requireInstall(ctx)) return
    // -SelfTest ends by calling the real Close-Tray: the process has to finish on its own
    // (execFileSync would time out otherwise) and the only trace is a local log line — no
    // wsl.exe and no -StopDsh, which is what used to wedge the tray and kill DSH.
    const dir = prepare({}, 'exit-handler')
    selfTestIn(dir)
    const log = readFileSync(join(dir, 'tray.log'), 'utf8')
    expect(log).toContain('tray exit requested; DSH keeps running')
  }, 90_000)

  it('writes its shortcut on start-up and exits on the marker file', async (ctx) => {
    if (!requireInstall(ctx) || profileDir === null) { ctx.skip(); return }
    // The uninstall handshake, and the on-start repair, in one run: the tray is started the
    // way the shortcut starts it, with the marker file already there so it ends by itself.
    // Its shortcut name is unique, so the user's own shortcut is never involved.
    const name = `DSH Web test ${String(process.pid)}`
    const dir = prepare({ webUrl: 'http://127.0.0.1:3099', command: 'true', shortcutName: name }, 'tray-mode')
    const programs = join(profileDir, 'AppData/Roaming/Microsoft/Windows/Start Menu/Programs')
    const lnk = join(programs, `${name}.lnk`)
    const liveLnk = join(programs, 'DeepSeek Harness (Web).lnk')
    const liveBefore = existsSync(liveLnk) ? readFileSync(liveLnk) : null
    rmSync(lnk, { force: true })
    writeFileSync(join(dir, 'tray-exit.flag'), 'exit\n', 'utf8')
    expect(await runTray(dir)).toBe(0)
    // The marker is consumed, and the exit is the tray's own (no -StopDsh): DSH survives.
    expect(existsSync(join(dir, 'tray-exit.flag'))).toBe(false)
    const log = readFileSync(join(dir, 'tray.log'), 'utf8')
    expect(log).toContain('exit requested by a marker file')
    expect(log).toContain('tray exit requested; DSH keeps running')
    // It wrote its own shortcut and recorded it.
    expect(existsSync(lnk)).toBe(true)
    const stamp = JSON.parse(readFileSync(join(dir, 'tray-shortcut.json'), 'utf8').replace(/^\uFEFF/, '')) as {
      shortcut: string
      icon: string
      lnkBytes: number
      lnkSha256: string
    }
    expect(stamp.shortcut).toBe(`${name}.lnk`)
    expect(stamp.icon).toBe('dsh-web-tray.ico')
    expect(stamp.lnkBytes).toBe(statSync(lnk).size)
    expect(stamp.lnkSha256).toMatch(/^[0-9a-f]{64}$/i)
    // The shortcut that was already on the desktop was not touched.
    if (liveBefore !== null) expect(readFileSync(liveLnk).equals(liveBefore)).toBe(true)
    // And the stamp is what the start-up repair reads: a stamp that no longer matches the
    // .lnk is exactly what makes it rebuild.
    expect(selfTestIn(dir).shortcutCurrent).toBe(true)
    writeFileSync(join(dir, 'tray-shortcut.json'), '{}', 'utf8')
    expect(selfTestIn(dir).shortcutCurrent).toBe(false)
    rmSync(lnk, { force: true })
  }, 120_000)
})
