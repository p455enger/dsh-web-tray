import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildTrayScript } from '../src/artifacts.ts'
import { ICON_FILE_NAME, TRAY_ICON_FILE_NAME } from '../src/names.ts'
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
  matcherFoundOwnWindow: boolean
  focusReturned: boolean
  itemHeight: number
  dpiScale: number
  targetPath: string
  targetArguments: string
  trayIcon: string
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

function selfTest(): MenuContract {
  if (workDir === null) throw new Error('no Windows profile')
  mkdirSync(workDir, { recursive: true })
  const scriptPath = join(workDir, 'dsh-web-tray.ps1')
  // Both icons live next to the helper, exactly as the host writes them: the
  // tray prefers the inverted one and only falls back to the shortcut icon when
  // it is missing.
  for (const name of [ICON_FILE_NAME, TRAY_ICON_FILE_NAME]) {
    copyFileSync(new URL(`../assets/${name}`, import.meta.url), join(workDir, name))
  }
  // The host writes the helper with a BOM for Windows PowerShell 5.1; keep that
  // so the test exercises the artifact as shipped.
  writeFileSync(scriptPath, `\uFEFF${buildTrayScript({
    distro: 'Debian',
    webUrl: 'http://127.0.0.1:3080',
    shortcutName: 'DSH Web',
    wslStartScript: '~/.dsh/dsh-web-tray/start.sh',
    wslStopScript: '~/.dsh/dsh-web-tray/stop.sh',
    wslStartLogPath: '/home/me/.dsh/dsh-web-tray/start.log',
  })}`, 'utf8')
  const stdout = execFileSync(
    POWERSHELL,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wslPathToWindowsPath(scriptPath), '-SelfTest'],
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
    expect(typeof contract.dshAlive).toBe('boolean')
  }, 90_000)

  it('wears the measured desktop-app palette and metrics', (ctx) => {
    if (workDir === null) { ctx.skip(); return }
    const contract = selfTest()
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

  it('targets the JScript launcher, keeps the icons apart and waits 120s for DSH', (ctx) => {
    if (workDir === null) { ctx.skip(); return }
    const contract = selfTest()
    expect(contract.targetPath.toLowerCase()).toContain('wscript.exe')
    expect(contract.targetArguments).toContain('//E:JScript //B')
    expect(contract.targetArguments).toContain('dsh-web-tray.js')
    expect(contract.shortcutIcon).toBe('dsh-web-tray.ico')
    expect(contract.trayIcon).toBe('dsh-web-tray-inverted.ico')
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
    // The matcher and the focus call run against a real window we own, which is the
    // same code path the tray uses for the page's window.
    expect(contract.matcherFoundOwnWindow).toBe(true)
    expect(typeof contract.focusReturned).toBe('boolean')
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
    const friends = ['dsh-web-tray.js', ICON_FILE_NAME, TRAY_ICON_FILE_NAME, 'tray.log', 'tray-selftest.json']
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

    // Give it a shortcut of its own to delete.
    run('-Regenerate')
    const lnkPath = join(profileDir, 'Desktop', `${shortcutName}.lnk`)
    expect(existsSync(lnkPath)).toBe(true)

    const stdout = run('-Uninstall')
    expect(stdout).toContain('dsh-web-tray removed')
    expect(existsSync(join(installDir, 'dsh-web-tray.ps1'))).toBe(false)
    for (const name of friends) expect(existsSync(join(installDir, name))).toBe(false)
    expect(existsSync(installDir)).toBe(false)
    expect(existsSync(wslDir)).toBe(false)
    expect(existsSync(lnkPath)).toBe(false)
    // And the live install is untouched: the helper still runs where it was.
    expect(existsSync(join(profileDir, '.dsh', 'dsh-web-tray', 'dsh-web-tray.ps1'))).toBe(true)

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
