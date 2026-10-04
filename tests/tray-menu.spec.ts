import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildTrayScript } from '../src/artifacts.ts'
import {
  GENERATED_TRAY_FILE_NAMES,
  ICON_FILE_NAME,
  LEGACY_TRAY_FILE_NAMES,
  TRAY_ICON_BLACK_NAME,
  TRAY_ICON_FILE_NAMES,
  TRAY_ICON_WHITE_NAME,
} from '../src/names.ts'
import { wslPathToWindowsPath } from '../src/service.ts'
import { windowsUserProfileWslPathResolved } from '../src/windows.ts'

/**
 * The tray helper is generated text, so the only honest way to test its menu is
 * to run it: `-SelfTest` builds the real NotifyIcon, the real styled
 * ContextMenuStrip and the real shortcut target resolution, then prints the
 * contract as JSON without showing any UI. This is what catches a styling or
 * menu change that would otherwise only be visible on the user's desktop.
 *
 * The expected numbers are the ones measured off the DeepSeek Harness desktop
 * app's own tray menu on this machine (see tray-script.ts).
 */
const POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
const canRun = process.platform !== 'win32' && existsSync(POWERSHELL)
/**
 * These six tests are the only end-to-end coverage this plugin has: everything else
 * checks generated text. A machine without Windows interop silently dropped them and
 * the suite still exited green, which is how a broken tray reaches a release. Set
 * `DSH_WEB_TRAY_REQUIRE_INTEROP=1` (CI) to make that a failure instead.
 */
const requireInterop = process.env.DSH_WEB_TRAY_REQUIRE_INTEROP === '1'
if (!canRun && requireInterop) {
  throw new Error('interop is required (DSH_WEB_TRAY_REQUIRE_INTEROP=1) but Windows PowerShell is unreachable')
}
if (!canRun) {
  console.warn('[tray-menu] Windows interop unavailable: the 6 tray tests are skipped and the suite still exits green')
}

let workDir: string | null = null
let profileDir: string | null = null

beforeAll(async () => {
  if (!canRun) return
  const profile = await windowsUserProfileWslPathResolved()
  if (profile === null) return
  profileDir = profile
  workDir = join(profile, 'AppData', 'Local', 'Temp', `dsh-web-tray-menu-${String(process.pid)}`)
})

afterAll(() => {
  if (workDir !== null) rmSync(workDir, { recursive: true, force: true })
})

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
  textDrop: number
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
  matcherFoundOwnWindow: boolean
  focusReturned: boolean
  itemHeight: number
  dpiScale: number
  targetPath: string
  targetArguments: string
  styledMenu: boolean
  wslStartCommand: string
  ownFiles: string[]
  matcherPlacement: string
  reloadProbeSent: boolean
  reloadProbeKey: string
  reloadProbeControl: boolean
  trayIcon: string
  trayIconTheme: string
  trayIconSize: string
  shortcutIcon: string
  webUrl: string
  dshAlive: boolean
  openTimeoutSec: number
  trayText: string
}

/** `Color.ToArgb()` for an `#RRGGBB` value, signed as .NET returns it. */
function argb(red: number, green: number, blue: number): number {
  return ((0xFF << 24) | (red << 16) | (green << 8) | blue) | 0
}

function selfTest(overrides: { distro?: string; wslStartScript?: string; focus?: boolean } = {}): MenuContract {
  if (workDir === null) throw new Error('no Windows profile')
  mkdirSync(workDir, { recursive: true })
  const scriptPath = join(workDir, 'dsh-web-tray.ps1')
  // Every icon lives next to the helper, exactly as the host writes them: the
  // tray picks the ink its taskbar theme needs and only falls back to the other
  // file, and then to the shortcut icon, when one is missing.
  for (const name of [ICON_FILE_NAME, ...TRAY_ICON_FILE_NAMES]) {
    copyFileSync(new URL(`../assets/${name}`, import.meta.url), join(workDir, name))
  }
  // The host writes the helper with a BOM for Windows PowerShell 5.1; keep that
  // so the test exercises the artifact as shipped.
  writeFileSync(scriptPath, `\uFEFF${buildTrayScript({
    distro: overrides.distro ?? 'Debian',
    webUrl: 'http://127.0.0.1:3080',
    shortcutName: 'DSH Web',
    wslStartScript: overrides.wslStartScript ?? '~/.dsh/dsh-web-tray/start.sh',
    wslStopScript: '~/.dsh/dsh-web-tray/stop.sh',
    wslStartLogPath: '/home/me/.dsh/dsh-web-tray/start.log',
  })}`, 'utf8')
  const stdout = execFileSync(
    POWERSHELL,
    [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wslPathToWindowsPath(scriptPath), '-SelfTest',
      ...(overrides.focus === true ? ['-SelfTestFocus'] : []),
    ],
    { encoding: 'utf8', timeout: 120_000 },
  )
  // The contract file is UTF-8 with a BOM; stdout goes through the console code
  // page and is only kept for a human reading the terminal.
  const contractPath = join(workDir, 'tray-selftest.json')
  const raw = existsSync(contractPath)
    ? readFileSync(contractPath, 'utf8')
    : stdout
  const line = raw.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(entry => entry.trim().startsWith('{')).pop()
  if (line === undefined) throw new Error(`no JSON contract: ${stdout}`)
  return JSON.parse(line) as MenuContract
}

describe.runIf(canRun)('tray menu self test (Windows interop)', () => {
  it('exposes the two desktop-app entries and nothing else', (ctx) => {
    if (workDir === null) { ctx.skip(); return }
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
    // The removal list the helper carries is the one the host writes from, so a file
    // can never be added on one side and forgotten on the other.
    expect(contract.ownFiles).toEqual(expect.arrayContaining([
      ...GENERATED_TRAY_FILE_NAMES,
      ...LEGACY_TRAY_FILE_NAMES,
    ]))
    expect(typeof contract.dshAlive).toBe('boolean')
  }, 90_000)

  it('wears the measured desktop-app palette and metrics', (ctx) => {
    if (workDir === null) { ctx.skip(); return }
    const contract = selfTest()
    expect(contract.styledMenu).toBe(true)
    expect(contract.renderer).toBe('DshTrayMenuRenderer')
    // Visual styles off would make that renderer paint system colours, which is
    // how the hovered item once came out accent blue instead of #363636.
    expect(contract.visualStyles).toBe(true)
    expect(contract.backColor).toBe(argb(0x1F, 0x1F, 0x1F))
    expect(contract.foreColor).toBe(argb(0xE3, 0xE3, 0xE3))
    expect(contract.hoverColor).toBe(argb(0x36, 0x36, 0x36))
    expect(contract.separatorColor).toBe(argb(0x5E, 0x5E, 0x5E))
    // The app's font is the system UI family at 9pt: Microsoft YaHei UI on a
    // Chinese Windows (whose ink box matches the app's own menu exactly), Segoe
    // UI on an English one — never the Windows *menu* font, which is YaHei UI
    // 12pt here and would give a 188 px wide label instead of 134.
    expect(contract.font).toMatch(/^(Microsoft YaHei UI|Microsoft YaHei|Segoe UI) 9$/)
    // Item box 28 px, text inset 20 px, panel padding 12 px, separator gap 18 px,
    // corner radius 12 px — all in device pixels, so they scale with dpiScale.
    expect(contract.dpiScale).toBeGreaterThan(0)
    const scale = contract.dpiScale
    // Corners are Windows' job; 2 = DWMWCP_ROUND read back from a real window.
    expect(contract.cornerMode).toBe('dwm')
    expect(contract.dwmCornerReadBack).toBe(2)
    // The popup is a tool window: no taskbar button, no Alt-Tab entry, so Explorer
    // cannot list the menu as an app window of this PowerShell process.
    expect(contract.toolWindow).toBe(true)
    expect(contract.menuExStyle & 0x80).toBe(0x80)
    expect(contract.menuExStyle & 0x40000).toBe(0)
    expect(contract.separatorHeight).toBe(Math.round(17 * scale))
    expect(contract.itemHeight).toBe(Math.round(28 * scale))
    expect(contract.itemMargin).toEqual([Math.round(12 * scale) - contract.panelPaddingTop, Math.round(12 * scale) - contract.panelPaddingTop])
    expect(contract.itemPadding[0]).toBe(Math.round(20 * scale))
    expect(contract.itemPadding[2]).toBe(Math.round(20 * scale))
    expect(contract.itemPadding[1]).toBe(contract.itemPadding[3])
    // The item box the app has: text + padding + WinForms' own 2 px per side.
    expect(contract.fontHeight + contract.itemPadding[1] + contract.itemPadding[3] + 4)
      .toBe(contract.itemHeight)
    // The panel hugs the label: inset on each side, so the blank strip on the
    // right is the same as the one on the left (the app's menu is 175 px for a
    // 134 px label). WinForms' own sizing used to reserve the image margin, which
    // left 214 px of content and a long blank area on the right.
    expect(contract.panelWidth).toBe(contract.inkWidth + 2 * contract.textInset)
    expect(contract.panelRightGap).toBe(contract.textInset)
    expect(contract.itemWidth).toBe(contract.panelWidth)
    expect(contract.panelHeight).toBe(contract.itemMargin[0] + contract.itemHeight
      + contract.separatorHeight + contract.itemHeight + contract.itemMargin[1] + 2 * contract.panelPaddingTop)
  }, 90_000)

  it('targets the JScript launcher, wears the taskbar theme ink and waits 120s for DSH', (ctx) => {
    if (workDir === null) { ctx.skip(); return }
    const contract = selfTest()
    expect(contract.targetPath.toLowerCase()).toContain('wscript.exe')
    expect(contract.targetArguments).toContain('//E:JScript //B')
    expect(contract.targetArguments).toContain('dsh-web-tray.js')
    expect(contract.shortcutIcon).toBe('dsh-web-tray.ico')
    // Which ink is this machine's answer; the mapping from the theme the helper
    // read back is the part that has to hold everywhere.
    expect(['light', 'dark']).toContain(contract.trayIconTheme)
    expect(contract.trayIcon).toBe(
      contract.trayIconTheme === 'light' ? TRAY_ICON_BLACK_NAME : TRAY_ICON_WHITE_NAME,
    )
    // The frame loaded is the notification area's own size — never the 32x32
    // default frame the Icon(path) constructor would pick and WinForms scale down.
    const side = String(Math.round(16 * contract.dpiScale))
    expect(contract.trayIconSize).toBe(`${side}x${side}`)
    expect(contract.openTimeoutSec).toBe(120)
  }, 90_000)

  it('reuses a DSH page window and never the desktop app', (ctx) => {
    if (workDir === null) { ctx.skip(); return }
    const contract = selfTest()
    // "Reuse first": a browser window already showing the page (an installed web app
    // window is preferred over a tab window). Machine-dependent, so only the shape is
    // asserted here; the live values are what the tray logs.
    expect(typeof contract.dshWindowFound).toBe('boolean')
    expect(typeof contract.dshWindow).toBe('string')
    expect(typeof contract.dshWindowIsWebApp).toBe('boolean')
    // The Electron desktop app's window carries the same words in its title and has to
    // be skipped by name — this is the "no relation to the desktop app" rule.
    expect(typeof contract.dshWindowsSkippedAsApp).toBe('number')
    expect(contract.dshWindowsSkippedAsApp).toBeGreaterThanOrEqual(0)
    // Chromium windows that are not browsers (QQ, Electron apps) are skipped as well.
    expect(typeof contract.dshWindowsSkippedAsOther).toBe('number')
    expect(contract.dshWindowsSkippedAsOther).toBeGreaterThanOrEqual(0)
    // The matcher runs against a real window we own, which is the same code path the
    // tray uses for the page's window: found by title + class, and its *resting* size
    // read back (a minimized window reports a 160x28 placeholder through
    // GetWindowRect, and that is exactly the window the tray has to recognise).
    expect(contract.matcherFoundOwnWindow).toBe(true)
    expect(contract.matcherPlacement).toMatch(/^[0-9]+x[0-9]+\/[0-9]$/)
    const [probeWidth] = contract.matcherPlacement.split('x')
    expect(Number(probeWidth)).toBeGreaterThanOrEqual(200)
    // A plain self test must not steal the foreground: that is -SelfTestFocus, and
    // what a real double-click of the shortcut does.
    expect(contract.focusReturned).toBe(false)
  }, 90_000)

  it('quotes the script path for CreateProcess and for bash', (ctx) => {
    if (workDir === null) { ctx.skip(); return }
    // A script path may contain anything (the earlier bare concatenation split it into
    // the wrong arguments and the tray silently did nothing). The distro name stays
    // bare on purpose: quoting it makes wsl.exe look for a distro called "Debian"
    // (measured, exit -1 / WSL_E_DISTRO_NOT_FOUND).
    const contract = selfTest({ distro: 'Debian', wslStartScript: "/home/a b/it's/start.sh" })
    expect(contract.wslStartCommand.startsWith('wsl.exe -d Debian -- bash -lc "')).toBe(true)
    expect(contract.wslStartCommand).toContain(`'/home/a b/it'\\''s/start.sh'`)
    // And bash reads that inner command back as exactly the path, which is the half a
    // string assertion cannot prove. Only the leading `exec` is swapped out, so the
    // quoting under test is the quoting that ships.
    const marker = 'bash -lc "'
    const inner = contract.wslStartCommand.slice(
      contract.wslStartCommand.indexOf(marker) + marker.length,
      contract.wslStartCommand.length - 1,
    )
    const printed = execFileSync('bash', ['-c', inner.replace(/^exec /, "printf '%s' ")], { encoding: 'utf8' })
    expect(printed).toBe("/home/a b/it's/start.sh")
  }, 90_000)

  it('would open the page as an app window in a Chromium browser', (ctx) => {
    if (workDir === null) { ctx.skip(); return }
    // Whichever Chromium browser this machine's default is — Chrome, Edge, Brave, Vivaldi,
    // a scoop install — the tray opens the page the way it is installed, as an app window,
    // rather than as another tab. A non-Chromium default would report plain:.
    const contract = selfTest()
    const kind = contract.openPageCommand.slice(0, contract.openPageCommand.indexOf(':'))
    expect(['app', 'plain']).toContain(kind)
    if (kind === 'app') {
      const exe = contract.openPageCommand.slice(4)
      expect(exe.toLowerCase()).toMatch(/(chrome|msedge|brave|vivaldi|opera|chromium|yandex|thorium|arc)\.exe$/)
    }
    // ...and the browser rule itself rejects a process that is not one: this PowerShell.
    expect(contract.browserProbeOwnProcess).toBe(false)
  }, 90_000)

  it('reloads the window that was already open instead of opening a second one', (ctx) => {
    if (workDir === null) { ctx.skip(); return }
    // After the exit entry stopped DSH, the next start finds the window still there: the
    // page has to be reloaded in place (its session cookie outlives the process) rather
    // than the token URL opened somewhere else. The probe window records the chord, so a
    // wrong keystroke fails here instead of in the user's browser.
    const contract = selfTest({ focus: true })
    expect(contract.reloadProbeSent).toBe(true)
    expect(contract.reloadProbeKey).toBe('R')
    expect(contract.reloadProbeControl).toBe(true)
  }, 90_000)

  it('keeps a tilde path expandable, and the exit entry actually resolves', (ctx) => {
    if (workDir === null) { ctx.skip(); return }
    // `exec '~/.dsh/x.sh'` is a *literal* file name: bash expands `~` only when it is
    // unquoted. That is precisely how 退出 DeepSeek Harness stopped doing anything —
    // the stop script was never found, and a hidden process said nothing about it.
    const contract = selfTest({ wslStartScript: '~/.dsh/dsh-web-tray/start.sh' })
    expect(contract.wslStartCommand).toContain(`exec ~/'.dsh/dsh-web-tray/start.sh'`)
    expect(contract.wslStopCommand).toContain(`exec ~/'.dsh/dsh-web-tray/stop.sh'`)
    // Swapping only `exec` for printf, the inner command must print the expanded path.
    const marker = 'bash -lc "'
    const inner = contract.wslStopCommand.slice(
      contract.wslStopCommand.indexOf(marker) + marker.length,
      contract.wslStopCommand.length - 1,
    )
    const printed = execFileSync('bash', ['-c', inner.replace(/^exec /, "printf '%s' ")], { encoding: 'utf8' })
    expect(printed).toBe(join(homedir(), '.dsh', 'dsh-web-tray', 'stop.sh'))
  }, 90_000)

  it('runs the exit handler without touching WSL', (ctx) => {
    if (workDir === null) { ctx.skip(); return }
    // -SelfTest ends by calling the real Close-Tray: the process has to finish on
    // its own (execFileSync would time out otherwise), and the only trace is a
    // local log line — no wsl.exe, which is what used to wedge the tray.
    selfTest()
    const log = readFileSync(join(workDir, 'tray.log'), 'utf8')
    expect(log).toContain('tray exit requested; DSH keeps running')
  }, 90_000)

  it('removes exactly its own install on -Uninstall, and nothing else', (ctx) => {
    if (workDir === null || profileDir === null) { ctx.skip(); return }
    // A throwaway install: the helper plus everything the host writes next to it,
    // its own WSL directory and its own shortcut name, so the live install cannot
    // be touched. Since the helper resolves its paths from its own location, it has
    // to delete only this copy.
    const installDir = join(workDir, 'uninstall')
    const wslDir = `/tmp/dsh-web-tray-uninstall-${String(process.pid)}`
    const shortcutName = `DSH Web Uninstall ${String(process.pid)}`
    // Every file the plugin writes, plus every file an older version left behind
    // (0.1.0's .vbs launcher, its switch and status files, the inverted tile): the
    // cleanup is the only thing that removes them, so it has to know all of them.
    const friends = [
      'dsh-web-tray.js',
      ICON_FILE_NAME,
      ...TRAY_ICON_FILE_NAMES,
      ...LEGACY_TRAY_FILE_NAMES,
      'tray.log',
      'tray-selftest.json',
      'tray-shortcut.json',
    ]
    mkdirSync(installDir, { recursive: true })
    mkdirSync(wslDir, { recursive: true })
    writeFileSync(join(wslDir, 'start.sh'), '#!/bin/sh\n', 'utf8')
    const helper = `\uFEFF${buildTrayScript({
      distro: 'Debian',
      webUrl: 'http://127.0.0.1:3080',
      shortcutName,
      wslStartScript: `${wslDir}/start.sh`,
      wslStopScript: `${wslDir}/stop.sh`,
      wslStartLogPath: `${wslDir}/start.log`,
    })}`
    writeFileSync(join(installDir, 'dsh-web-tray.ps1'), helper, 'utf8')
    for (const name of friends) writeFileSync(join(installDir, name), 'placeholder', 'utf8')

    const scriptPath = wslPathToWindowsPath(join(installDir, 'dsh-web-tray.ps1'))
    const run = (...args: string[]): string => execFileSync(
      POWERSHELL,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      { encoding: 'utf8', timeout: 120_000 },
    )

    // A neighbour of ours, created by this test: the cleanup removes files *inside*
    // the directory it owns, and must not walk out of it.
    const neighbour = join(profileDir, '.dsh', 'dsh-web-tray-test-neighbour')
    mkdirSync(neighbour, { recursive: true })
    writeFileSync(join(neighbour, 'keep.txt'), 'keep', 'utf8')

    // Give it a shortcut of its own to delete.
    run('-Regenerate')
    const lnkPath = join(profileDir, 'Desktop', `${shortcutName}.lnk`)
    expect(existsSync(lnkPath)).toBe(true)
    // -Regenerate also records what that shortcut is supposed to be. The content is
    // asserted, not the presence: the harness writes a placeholder for every file name
    // it prepares, so "it exists" would prove nothing.
    const stamp = JSON.parse(readFileSync(join(installDir, 'tray-shortcut.json'), 'utf8').replace(/^\uFEFF/, '')) as {
      shortcut?: string
      icon?: string
      lnkBytes?: number
      lnkSha256?: string
    }
    expect(stamp.shortcut).toBe(`${shortcutName}.lnk`)
    expect(stamp.icon).toBe(ICON_FILE_NAME)
    expect(stamp.lnkBytes).toBe(readFileSync(lnkPath).length)
    expect(stamp.lnkSha256).toMatch(/^[0-9a-f]{64}$/i)

    const stdout = run('-Uninstall')
    expect(stdout).toContain('dsh-web-tray removed')
    expect(existsSync(join(installDir, 'dsh-web-tray.ps1'))).toBe(false)
    for (const name of friends) expect(existsSync(join(installDir, name))).toBe(false)
    expect(existsSync(installDir)).toBe(false)
    expect(existsSync(wslDir)).toBe(false)
    expect(existsSync(lnkPath)).toBe(false)
    // The neighbour directory survives: nothing outside the install directory is
    // touched. (The old assertion here instead required the developer's own live
    // install to exist, which failed on a machine that never installed the plugin.)
    expect(existsSync(join(neighbour, 'keep.txt'))).toBe(true)
    rmSync(neighbour, { recursive: true, force: true })

    // A second run is harmless: with only the helper left behind it still reports
    // what it removed, removes that too, and touches nothing that is already gone.
    mkdirSync(installDir, { recursive: true })
    writeFileSync(join(installDir, 'dsh-web-tray.ps1'), helper, 'utf8')
    expect(run('-Uninstall')).toContain('dsh-web-tray removed')
    expect(existsSync(join(installDir, 'dsh-web-tray.ps1'))).toBe(false)
    expect(existsSync(wslDir)).toBe(false)
    expect(existsSync(lnkPath)).toBe(false)
  }, 120_000)
})
