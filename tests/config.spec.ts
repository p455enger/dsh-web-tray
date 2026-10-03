import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRAY_CONFIG,
  normalizeTrayConfig,
  patchTrayConfig,
  sameTrayConfig,
} from '../src/config.ts'

describe('tray config normalization', () => {
  it('returns the defaults for missing, null, or non-object input', () => {
    for (const input of [undefined, null, 'nope', 42, []]) {
      const { config, errors } = normalizeTrayConfig(input)
      expect(config).toEqual(DEFAULT_TRAY_CONFIG)
      if (input === undefined || input === null) expect(errors).toEqual([])
    }
  })

  it('keeps valid booleans and presents an untouched default as version 1', () => {
    const { config, errors } = normalizeTrayConfig({
      autoStart: false,
      autoStopOnExit: false,
      watchdogEnabled: false,
      version: 99,
    })
    expect(errors).toEqual([])
    expect(config.autoStart).toBe(false)
    expect(config.autoStopOnExit).toBe(false)
    expect(config.watchdogEnabled).toBe(false)
    expect(config.version).toBe(1)
  })

  it('rejects a wrong boolean type and keeps the default', () => {
    const { config, errors } = normalizeTrayConfig({ autoStart: 'yes' })
    expect(config.autoStart).toBe(DEFAULT_TRAY_CONFIG.autoStart)
    expect(errors).toEqual(['autoStart must be a boolean'])
  })

  it('clamps numeric fields to their range and reports each repair', () => {
    const { config, errors } = normalizeTrayConfig({
      probeIntervalSec: 0,
      probeTimeoutSec: 999,
      downThreshold: 0,
      restartWaitSec: 10,
      maxRestartFailures: 99,
      restartBackoffSec: -5,
      autoStopIdleMinutes: 100000,
    })
    expect(config.probeIntervalSec).toBe(2)
    expect(config.probeTimeoutSec).toBe(30)
    expect(config.downThreshold).toBe(1)
    expect(config.restartWaitSec).toBe(30)
    expect(config.maxRestartFailures).toBe(10)
    expect(config.restartBackoffSec).toBe(0)
    expect(config.autoStopIdleMinutes).toBe(1440)
    expect(errors).toHaveLength(7)
    expect(errors.some(message => message.includes('probeIntervalSec must be between 2 and 300'))).toBe(true)
  })

  it('rejects a non-numeric tuning value and keeps the default', () => {
    const { config, errors } = normalizeTrayConfig({ probeIntervalSec: 'fast' })
    expect(config.probeIntervalSec).toBe(DEFAULT_TRAY_CONFIG.probeIntervalSec)
    expect(errors).toEqual(['probeIntervalSec must be a number'])
  })

  it('normalizes the exclusion list: trim, lowercase, strip .exe, dedupe', () => {
    const { config, errors } = normalizeTrayConfig({
      idleProbeExcludeProcesses: ['  PowerShell.EXE ', 'wsl', 'wsl', '', 7],
    })
    expect(config.idleProbeExcludeProcesses).toEqual(['powershell', 'wsl'])
    // The empty string and the number are reported; the duplicate is not.
    expect(errors).toEqual([
      'idleProbeExcludeProcesses entries must be non-empty strings',
      'idleProbeExcludeProcesses entries must be non-empty strings',
    ])
  })

  it('falls back to the default list when the list is empty or unusable', () => {
    // An empty list would let the tray's own probe keep the idle timer at zero
    // forever, so the defaults win and the repair is reported.
    for (const input of [[], ['', 7]]) {
      const { config, errors } = normalizeTrayConfig({ idleProbeExcludeProcesses: input })
      expect(config.idleProbeExcludeProcesses).toEqual(DEFAULT_TRAY_CONFIG.idleProbeExcludeProcesses)
      expect(errors.length).toBeGreaterThan(0)
    }
  })

  it('ignores unknown keys so a newer tray can add one', () => {
    const { config, errors } = normalizeTrayConfig({ somethingNew: true })
    expect(errors).toEqual([])
    expect(config).toEqual(DEFAULT_TRAY_CONFIG)
  })

  it('patches only the fields the patch names', () => {
    const base = { ...DEFAULT_TRAY_CONFIG, autoStart: false, autoStopIdleMinutes: 15 }
    const { config, errors } = patchTrayConfig(base, { watchdogEnabled: false })
    expect(errors).toEqual([])
    expect(config.autoStart).toBe(false)
    expect(config.autoStopIdleMinutes).toBe(15)
    expect(config.watchdogEnabled).toBe(false)
    expect(config.probeIntervalSec).toBe(DEFAULT_TRAY_CONFIG.probeIntervalSec)
  })

  it('reports a non-object patch instead of applying it', () => {
    const base = { ...DEFAULT_TRAY_CONFIG }
    const { config, errors } = patchTrayConfig(base, 'nope')
    expect(config).toBe(base)
    expect(errors).toEqual(['patch must be a JSON object'])
  })

  it('compares configs field by field', () => {
    expect(sameTrayConfig(DEFAULT_TRAY_CONFIG, { ...DEFAULT_TRAY_CONFIG })).toBe(true)
    expect(sameTrayConfig(DEFAULT_TRAY_CONFIG, { ...DEFAULT_TRAY_CONFIG, autoStart: false })).toBe(false)
  })
})
