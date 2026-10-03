import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_TRAY_CONFIG, buildTrayScript, type LaunchConfig } from '../src/artifacts.ts'
import { wslPathToWindowsPath } from '../src/service.ts'
import { windowsUserProfileWslPathResolved } from '../src/windows.ts'

/**
 * The idle counter is the one algorithm worth testing for real: it parses
 * `netstat -ano`, which is the only source that lists WSL-owned loopback
 * sockets on the machine this fork targets (`Get-NetTCPConnection` reports zero
 * rows for them). The generated helper therefore exposes a `-SelfTest` switch
 * that runs the shipped code against stdin, and this test feeds it a captured
 * sample through Windows interop.
 */
const POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
const canRun = process.platform !== 'win32' && existsSync(POWERSHELL)
// Resolved the same way the service does it (PowerShell is authoritative, since
// `appendWindowsPath = false` keeps the Windows directories out of PATH).
let workDir: string | null = null

beforeAll(async () => {
  if (!canRun) return
  const profile = await windowsUserProfileWslPathResolved()
  if (profile === null) return
  workDir = join(profile, 'AppData', 'Local', 'Temp', `dsh-web-tray-selftest-${String(process.pid)}`)
})

/** Captured on the target machine: 2 ESTABLISHED + 1 CLOSE_WAIT, owner chrome. */
const FIXTURE = [
  '  TCP    127.0.0.1:61947        127.0.0.1:3080         ESTABLISHED     14732',
  '  TCP    127.0.0.1:63071        127.0.0.1:3080         CLOSE_WAIT      14732',
  '  TCP    127.0.0.1:64937        127.0.0.1:3080         ESTABLISHED     14732',
  // PID 4 is `System` on every Windows install, which makes the exclusion
  // path deterministic without knowing this machine's process table.
  '  TCP    127.0.0.1:5000           127.0.0.1:3080         ESTABLISHED     4',
  // Another port must never count.
  '  TCP    127.0.0.1:5001           127.0.0.1:9999         ESTABLISHED     14732',
].join('\r\n')

const LAUNCH: LaunchConfig = {
  distro: 'Debian',
  webUrl: 'http://127.0.0.1:3080',
  shortcutName: 'DSH Web',
  wslStartScript: '~/.dsh/dsh-web-tray/start.sh',
  wslStopScript: '~/.dsh/dsh-web-tray/stop.sh',
  wslStartLogPath: '/home/me/.dsh/dsh-web-tray/start.log',
}

interface SelfTestResult {
  port: number
  connections: number | null
  excludes: string[]
  idleCases: Array<{ connections: number; idleSeconds: number; thresholdMinutes: number; due: boolean }>
}

function writeArtifacts(excludes: string[]): string {
  if (workDir === null) throw new Error('no Windows profile')
  mkdirSync(workDir, { recursive: true })
  const scriptPath = join(workDir, 'dsh-web-tray.ps1')
  // The host writes the helper with a BOM for Windows PowerShell 5.1; keep that
  // so the test exercises the artifact as shipped.
  writeFileSync(scriptPath, `\uFEFF${buildTrayScript(LAUNCH, { ...DEFAULT_TRAY_CONFIG, idleProbeExcludeProcesses: excludes })}`, 'utf8')
  writeFileSync(join(workDir, 'tray-config.json'), JSON.stringify({ ...DEFAULT_TRAY_CONFIG, idleProbeExcludeProcesses: excludes }), 'utf8')
  return scriptPath
}

function selfTest(scriptPath: string): SelfTestResult {
  const stdout = execFileSync(
    POWERSHELL,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wslPathToWindowsPath(scriptPath), '-SelfTest'],
    { input: FIXTURE, encoding: 'utf8', timeout: 120_000 },
  )
  const line = stdout.trim().split(/\r?\n/).filter(entry => entry.trim().startsWith('{')).pop()
  if (line === undefined) throw new Error(`no JSON on stdout: ${stdout}`)
  return JSON.parse(line) as SelfTestResult
}

afterAll(() => {
  if (workDir !== null) rmSync(workDir, { recursive: true, force: true })
})

describe.runIf(canRun)('generated helper self test (Windows interop)', () => {
  it('counts only ESTABLISHED connections to the web port', (ctx) => {
    if (workDir === null) { ctx.skip(); return }
    const result = selfTest(writeArtifacts(DEFAULT_TRAY_CONFIG.idleProbeExcludeProcesses))
    expect(result.port).toBe(3080)
    // 2 chrome rows + the System row; CLOSE_WAIT and the other port are dropped.
    expect(result.connections).toBe(3)
  }, 60_000)

  it('honours the exclusion list so the tray probe cannot reset the idle timer', (ctx) => {
    if (workDir === null) { ctx.skip(); return }
    const result = selfTest(writeArtifacts(['system']))
    expect(result.excludes).toEqual(['system'])
    expect(result.connections).toBe(2)
  }, 60_000)

  it('decides the idle stop from connections, elapsed time and the threshold', (ctx) => {
    if (workDir === null) { ctx.skip(); return }
    const result = selfTest(writeArtifacts(DEFAULT_TRAY_CONFIG.idleProbeExcludeProcesses))
    const due = result.idleCases.map(entry => [entry.connections, entry.idleSeconds, entry.thresholdMinutes, entry.due])
    expect(due).toEqual([
      [0, 0, 30, false],
      [0, 1799, 30, false],
      [0, 1800, 30, true],
      [1, 9999, 30, false],
      [0, 9999, 0, false],
    ])
  }, 60_000)
})
