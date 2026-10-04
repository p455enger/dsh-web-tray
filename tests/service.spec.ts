/**
 * The service's lifecycle: what it writes, when it stays quiet, and how it recovers
 * from an older install or a shortcut that was replaced behind its back.
 *
 * Everything here runs against a temporary home directory and an injected
 * {@link TrayHostBridge}, so no test touches this machine's real install, its real
 * desktop or a real PowerShell.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ICON_FILE_NAME,
  LAUNCHER_SCRIPT_NAME,
  LEGACY_CONFIG_NAME,
  SHORTCUT_STAMP_NAME,
  START_SCRIPT_NAME,
  STOP_SCRIPT_NAME,
  TRAY_ICON_FILE_NAMES,
  TRAY_SCRIPT_NAME,
} from '../src/names.ts'
import { TrayService, wslAppDir } from '../src/service.ts'
import { powershellPath, runWindowsPowerShell } from '../src/windows.ts'
import type { ExecResult, TrayHostBridge } from '../src/windows.ts'

const SHORTCUT_NAME = 'DSH Web'
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface Host {
  service: TrayService
  /** Every PowerShell invocation, in order. */
  powershell: string[][]
  /** How often the profile was resolved (the service caches it per mount). */
  profileCalls: () => number
  root: string
  home: string
  profile: string
  desktop: string
  appDir: string
  trayDir: string
}

/** Emulate the helper's `-Regenerate`: write the `.lnk` and the stamp next to it. */
function writeShortcut(desktop: string, trayDir: string): string {
  const lnkPath = join(desktop, `${SHORTCUT_NAME}.lnk`)
  const bytes = Buffer.from(`lnk:${SHORTCUT_NAME}`)
  writeFileSync(lnkPath, bytes)
  mkdirSync(trayDir, { recursive: true })
  // The helper writes the stamp with a UTF-8 BOM (PowerShell 5.1) and reports the
  // digest upper-cased (Get-FileHash), both of which the host has to cope with.
  const stamp = {
    // The helper records names (it knows the Windows path, the host the WSL one).
    shortcut: `${SHORTCUT_NAME}.lnk`,
    icon: ICON_FILE_NAME,
    target: 'C:\\WINDOWS\\system32\\wscript.exe',
    arguments: `//E:JScript //B "${join(trayDir, LAUNCHER_SCRIPT_NAME)}"`,
    lnkBytes: bytes.length,
    lnkSha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
  }
  writeFileSync(join(trayDir, SHORTCUT_STAMP_NAME), `\uFEFF${JSON.stringify(stamp)}`, 'utf8')
  return lnkPath
}

function makeHost(options: { wsl?: boolean; profile?: boolean } = {}): Host {
  const root = mkdtempSync(join(tmpdir(), 'dsh-web-tray-service-'))
  roots.push(root)
  const home = join(root, 'home')
  const profile = join(root, 'winprofile')
  const desktop = join(root, 'desktop')
  for (const dir of [home, profile, desktop]) mkdirSync(dir, { recursive: true })
  const appDir = wslAppDir(home)
  const trayDir = join(profile, '.dsh', 'dsh-web-tray')
  const powershell: string[][] = []
  let profileCalls = 0
  const bridge: TrayHostBridge = {
    isWsl: () => options.wsl ?? true,
    homeDir: () => home,
    userProfileDir: async () => {
      profileCalls++
      return options.profile === false ? null : profile
    },
    desktopDir: async () => desktop,
    runPowerShell: async (args): Promise<ExecResult> => {
      powershell.push([...args])
      if (args.includes('-Regenerate')) writeShortcut(desktop, trayDir)
      return { code: 0, signal: null, stdout: 'shortcut created', stderr: '', timedOut: false }
    },
  }
  const service = new TrayService({}, { host: '127.0.0.1', port: 3080 }, SHORTCUT_NAME, bridge)
  return { service, powershell, profileCalls: () => profileCalls, root, home, profile, desktop, appDir, trayDir }
}

describe('TrayService lifecycle', () => {
  it('writes every artifact, the shortcut and its stamp, then creates nothing new', async () => {
    const host = makeHost()
    const status = await host.service.regenerate()
    expect(status.ok).toBe(true)
    expect(status.platform).toBe('wsl')
    for (const name of [ICON_FILE_NAME, ...TRAY_ICON_FILE_NAMES, LAUNCHER_SCRIPT_NAME, TRAY_SCRIPT_NAME]) {
      expect(existsSync(join(host.trayDir, name))).toBe(true)
    }
    // The helper script needs the UTF-8 BOM: Windows PowerShell 5.1 reads the
    // Chinese menu labels as ANSI without it and fails to parse.
    expect(readFileSync(join(host.trayDir, TRAY_SCRIPT_NAME), 'utf8').startsWith('\uFEFF')).toBe(true)
    for (const name of [START_SCRIPT_NAME, STOP_SCRIPT_NAME]) {
      expect(existsSync(join(host.appDir, name))).toBe(true)
    }
    expect(existsSync(join(host.desktop, `${SHORTCUT_NAME}.lnk`))).toBe(true)
    expect(existsSync(join(host.trayDir, SHORTCUT_STAMP_NAME))).toBe(true)
    expect(host.powershell).toHaveLength(1)
    expect(host.powershell[0]).toContain('-Regenerate')
  })

  it('bakes absolute WSL script paths, never a tilde', async () => {
    const host = makeHost()
    await host.service.regenerate()
    const script = readFileSync(join(host.trayDir, TRAY_SCRIPT_NAME), 'utf8')
    // These two strings are handed to bash by the tray. A tilde cannot survive the
    // quoting a path needs, and a quoted tilde is a literal file name: the exit entry
    // then ran nothing at all (and `rm -rf -- '~/...'` exited 0 without deleting).
    expect(script).toContain(`$wslStartScript = '${join(host.appDir, START_SCRIPT_NAME)}'`)
    expect(script).toContain(`$wslStopScript = '${join(host.appDir, STOP_SCRIPT_NAME)}'`)
    // Only the assignments matter: the helper's comments mention tildes on purpose.
    for (const line of script.split('\n')) {
      if (!line.startsWith('$wsl')) continue
      expect(line).not.toContain('~/')
    }
  })

  it('stays quiet on a second ensure: no write, no PowerShell, one profile lookup', async () => {
    const host = makeHost()
    await host.service.regenerate()
    const callsAfterRegenerate = host.powershell.length
    const before = readFileSync(join(host.trayDir, TRAY_SCRIPT_NAME), 'utf8')
    const status = await host.service.ensure()
    expect(status.ok).toBe(true)
    // Nothing was rewritten and no second PowerShell ran: that is the whole point of
    // the byte comparison.
    expect(host.powershell).toHaveLength(callsAfterRegenerate)
    expect(readFileSync(join(host.trayDir, TRAY_SCRIPT_NAME), 'utf8')).toBe(before)
    // The Windows profile is resolved once per mount, not once per status call.
    expect(host.profileCalls()).toBeLessThanOrEqual(2)
  })

  it('regenerates exactly once when an artifact changed', async () => {
    const host = makeHost()
    await host.service.regenerate()
    writeFileSync(join(host.appDir, START_SCRIPT_NAME), '#!/usr/bin/env bash\n# stale\n', 'utf8')
    await host.service.ensure()
    expect(host.powershell).toHaveLength(2)
  })

  it('regenerates when an older version left a file behind, and removes it', async () => {
    const host = makeHost()
    await host.service.regenerate()
    // 0.1.0's switch file: nothing reads it any more, so only its presence says the
    // install is not current.
    writeFileSync(join(host.trayDir, LEGACY_CONFIG_NAME), '{}', 'utf8')
    const status = await host.service.ensure()
    expect(status.ok).toBe(true)
    expect(host.powershell).toHaveLength(2)
    expect(existsSync(join(host.trayDir, LEGACY_CONFIG_NAME))).toBe(false)
    // And the install is quiet again afterwards.
    await host.service.ensure()
    expect(host.powershell).toHaveLength(2)
  })

  it('regenerates when the shortcut is no longer the one it wrote', async () => {
    const host = makeHost()
    await host.service.regenerate()
    // Replaced, restored from a backup, or repointed at the old .vbs by another tool:
    // the generated files are all still current, so only the stamp can tell.
    writeFileSync(join(host.desktop, `${SHORTCUT_NAME}.lnk`), 'lnk:tampered')
    await host.service.ensure()
    expect(host.powershell).toHaveLength(2)
    // The helper rewrote it, so the next ensure is quiet again.
    await host.service.ensure()
    expect(host.powershell).toHaveLength(2)
  })

  it('regenerates when the stamp is missing altogether', async () => {
    const host = makeHost()
    await host.service.regenerate()
    rmSync(join(host.trayDir, SHORTCUT_STAMP_NAME), { force: true })
    await host.service.ensure()
    expect(host.powershell).toHaveLength(2)
  })

  it('runs PowerShell once for concurrent regenerate calls', async () => {
    const host = makeHost()
    const results = await Promise.all([
      host.service.regenerate(),
      host.service.regenerate(),
      host.service.regenerate(),
    ])
    expect(results.every(result => result.ok)).toBe(true)
    expect(host.powershell).toHaveLength(1)
  })

  it('writes nothing on a host that is not WSL', async () => {
    const host = makeHost({ wsl: false })
    const status = await host.service.regenerate()
    expect(status.ok).toBe(false)
    expect(status.platform).toBe('unsupported')
    expect(status.lastError).toContain('only runs inside WSL')
    expect(host.powershell).toHaveLength(0)
    expect(existsSync(host.trayDir)).toBe(false)
    expect(existsSync(host.appDir)).toBe(false)
  })

  it('reports an unresolvable Windows profile instead of guessing one', async () => {
    const host = makeHost({ profile: false })
    const status = await host.service.regenerate()
    expect(status.ok).toBe(false)
    expect(status.lastError).toContain('cannot determine the Windows user profile')
    expect(host.powershell).toHaveLength(0)
  })

  it('persists the project path atomically and reads it back on the next mount', async () => {
    const host = makeHost()
    const configured = join(host.root, 'checkout')
    mkdirSync(configured, { recursive: true })
    await host.service.setProjectPath(`  ${configured}  `)
    expect(host.service.getProjectPath()).toBe(configured)
    const stored = JSON.parse(readFileSync(join(host.appDir, 'project-path.json'), 'utf8')) as { projectPath: string }
    expect(stored.projectPath).toBe(configured)
    // A truncated write would silently revert to auto-detection; the rename means a
    // reader sees one whole document or the old one, and here there is no temp file
    // left over either.
    expect(existsSync(`${join(host.appDir, 'project-path.json')}.tmp`)).toBe(false)
    const reopened = new TrayService({}, { host: '127.0.0.1', port: 3080 }, SHORTCUT_NAME, ((): TrayHostBridge => ({
      isWsl: () => true,
      homeDir: () => host.home,
      userProfileDir: async () => host.profile,
      desktopDir: async () => host.desktop,
      runPowerShell: async (): Promise<ExecResult> => ({ code: 0, signal: null, stdout: '', stderr: '', timedOut: false }),
    }))())
    expect(reopened.getProjectPath()).toBe(configured)
  })
})

describe('runWindowsPowerShell', () => {
  // P2-9: -WindowStyle Hidden is added to every launch. Without interop there is no
  // PowerShell to launch, so the check is skipped rather than failing.
  const available = existsSync(powershellPath())

  it.runIf(available)('launches hidden and still returns stdout and the exit code', async () => {
    const result = await runWindowsPowerShell(['-Command', 'Write-Output "hidden-ok"; exit 7'], undefined, 30_000)
    expect(result.timedOut).toBe(false)
    // A hidden console must not swallow either: the host reads both of these.
    expect(result.stdout).toContain('hidden-ok')
    expect(result.code).toBe(7)
  }, 60_000)

})