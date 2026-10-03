/**
 * The plugin's settings section: the switches, the live status of the DSH
 * instance and of the Windows tray, the generated-file facts, the project path
 * and the tray log.
 *
 * The section is a client-only contribution; every fact comes from
 * `/dsh-web-tray/*` on the host. It polls while visible, because the switches
 * can also be changed from the tray menu and the tray rewrites its state every
 * tick — a one-shot fetch would show stale values.
 */

import { createElement as h, useEffect, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { Button, StateDot, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LocaleKey } from './locales.ts'

export interface TraySettingsSectionProps {
  t: (key: LocaleKey) => string
}

interface ConfigShape {
  autoStart?: boolean
  autoStopOnExit?: boolean
  autoStopIdleMinutes?: number
  watchdogEnabled?: boolean
  probeIntervalSec?: number
  probeTimeoutSec?: number
  downThreshold?: number
  restartWaitSec?: number
  maxRestartFailures?: number
  restartBackoffSec?: number
}

interface TrayFileShape {
  updatedAt?: string
  phase?: string
  configSource?: string
  switches?: ConfigShape
  probe?: { ok?: boolean; detail?: string; latencyMs?: number; failures?: number; downThreshold?: number }
  restarts?: { count?: number; failures?: number; maxFailures?: number; lastAt?: string | null; lastOk?: boolean | null }
  idle?: { connections?: number | null; idleSeconds?: number; thresholdMinutes?: number; sampledAt?: string | null }
  dsh?: { running?: boolean; lastAliveAt?: string | null }
}

interface FilesShape {
  shortcutPath?: string | null
  shortcutExists?: boolean
  trayDir?: string | null
  trayScriptExists?: boolean
  trayVbsExists?: boolean
  iconExists?: boolean
  startScriptExists?: boolean
  configPath?: string | null
  configExists?: boolean
}

interface StatusBody {
  ok?: boolean
  platform?: 'wsl' | 'win' | 'unsupported'
  distro?: string
  webUrl?: string
  webAuthUrl?: string | null
  config?: ConfigShape
  configSource?: 'file' | 'last-good' | 'defaults'
  dsh?: { running?: boolean; pid?: number | null; uptimeSec?: number | null; rssMb?: number | null }
  tray?: TrayFileShape | null
  files?: FilesShape
  lastError?: string
  lastResult?: string
}

interface ConfigBody {
  ok?: boolean
  config?: ConfigShape
  configPath?: string | null
  configSource?: string
  errors?: string[]
  error?: string
}

interface ProjectPathBody {
  ok?: boolean
  projectPath?: string
  error?: string
}

type Phase = 'loading' | 'ready' | 'failed'

const POLL_MS = 2000
const STYLE_ID = 'dsh-web-tray-section-style'
const SECTION_CSS = `
.dsh-web-tray-section{display:flex;flex-direction:column;gap:2px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-web-tray-description{margin:0 0 6px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-web-tray-field{display:flex;flex-direction:column;gap:6px;padding:10px 0}
.dsh-web-tray-field-label{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-web-tray-field-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-web-tray-group{display:flex;flex-direction:column;gap:2px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-web-tray-group-title{font-size:13px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary);padding-bottom:4px}
.dsh-web-tray-switch{display:flex;align-items:flex-start;gap:10px;padding:6px 0}
.dsh-web-tray-switch-text{display:flex;flex-direction:column;gap:2px}
.dsh-web-tray-message{font-size:12px;line-height:1.5;overflow-wrap:anywhere;margin:8px 0 0;color:var(--dsw-alias-label-tertiary)}
.dsh-web-tray-message-error{color:var(--dsw-alias-label-error)}
.dsh-web-tray-buttons{display:flex;flex-wrap:wrap;gap:8px;padding-top:12px}
.dsh-web-tray-state{display:inline-flex;align-items:center;gap:6px;justify-content:flex-end}
`
const rowBase: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, lineHeight: 1.5, padding: '4px 0' }
const labelStyle: CSSProperties = { color: 'var(--dsw-alias-label-tertiary)' }
const valueStyle: CSSProperties = { textAlign: 'right', overflowWrap: 'anywhere', color: 'var(--dsw-alias-label-secondary)' }
const inputStyle: CSSProperties = { width: '100%', height: 34, padding: '0 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)', fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' }

const PHASE_KEYS: Record<string, LocaleKey> = {
  starting: 'wdPhaseStarting',
  probing: 'wdPhaseProbing',
  restarting: 'wdPhaseRestarting',
  backoff: 'wdPhaseBackoff',
  paused: 'wdPhasePaused',
  stopped: 'wdPhaseStopped',
}

const IDLE_CHOICES: Array<{ minutes: number; key: LocaleKey }> = [
  { minutes: 0, key: 'idleOff' },
  { minutes: 5, key: 'idle5' },
  { minutes: 15, key: 'idle15' },
  { minutes: 30, key: 'idle30' },
  { minutes: 60, key: 'idle60' },
]

function formatTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** `2d 3h`, `4h 5m`, `12m 30s`, `45s` — the two coarsest units. */
function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—'
  const total = Math.max(0, Math.round(seconds))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${total % 60}s`
  return `${total}s`
}

function restartResultLabel(ok: boolean | null | undefined, t: (key: LocaleKey) => string): string {
  if (ok === null || ok === undefined) return t('wdRestartUnknown')
  return ok === true ? t('wdRestartOk') : t('wdRestartFailed')
}

function configSourceLabel(source: string | undefined, t: (key: LocaleKey) => string): string {
  if (source === 'file') return t('configSourceFile')
  if (source === 'last-good') return t('configSourceLastGood')
  return t('configSourceDefaults')
}

function platformLabel(status: StatusBody | null, t: (key: LocaleKey) => string): string {
  if (status?.platform === 'wsl') return `${t('platformWsl')} (${status.distro ?? '?'})`
  if (status?.platform === 'win') return t('platformWin')
  return t('platformUnsupported')
}

function Row({ label, children }: { label: string; children?: ReactNode }): ReactElement {
  return h('div', { style: rowBase }, h('span', { style: labelStyle }, label), h('span', { style: valueStyle }, children))
}

/**
 * Render the plugin's settings section.
 * @param props.t - locale reader bound to this plugin's dictionary.
 * @returns the section element.
 */
export function TraySettingsSection({ t }: TraySettingsSectionProps): ReactElement {
  const [status, setStatus] = useState<StatusBody | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [draftPath, setDraftPath] = useState('')
  const [pathDirty, setPathDirty] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [busy, setBusy] = useState<'regenerate' | 'savePath' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [messageIsError, setMessageIsError] = useState(false)
  const [logText, setLogText] = useState('')
  const [logAuto, setLogAuto] = useState(false)
  const [logLoading, setLogLoading] = useState(false)

  useEffect(() => {
    if (document.getElementById(STYLE_ID) === null) {
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.textContent = SECTION_CSS
      document.head.appendChild(tag)
    }
    return () => {
      document.getElementById(STYLE_ID)?.remove()
    }
  }, [])

  // Poll while the page is visible: the tray menu can change the switches, and
  // the tray rewrites its own state every tick.
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setInterval> | null = null
    const load = async (): Promise<void> => {
      try {
        const response = await fetch('/dsh-web-tray/status', { cache: 'no-store' })
        const body = (await response.json()) as StatusBody
        if (disposed) return
        setStatus(body)
        setPhase('ready')
      } catch {
        if (!disposed) setPhase('failed')
      }
    }
    const start = (): void => {
      if (timer === null) timer = setInterval(() => { void load() }, POLL_MS)
    }
    const stop = (): void => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        void load()
        start()
      } else {
        stop()
      }
    }
    void load().then(() => {
      if (!disposed && document.visibilityState === 'visible') start()
    })
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const response = await fetch('/dsh-web-tray/project-path', { cache: 'no-store' })
        const body = (await response.json()) as ProjectPathBody
        if (live && typeof body.projectPath === 'string') setDraftPath(body.projectPath)
      } catch {
        // The path input stays empty; saving still works.
      }
    })()
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!logAuto) return
    let live = true
    const load = async (): Promise<void> => {
      try {
        const response = await fetch('/dsh-web-tray/watchdog-log?lines=120', { cache: 'no-store' })
        const body = (await response.json()) as { log?: string }
        if (live) setLogText(typeof body.log === 'string' ? body.log : '')
      } catch {
        // Keep the previous tail on a failed refresh.
      }
    }
    void load()
    const timer = setInterval(() => { void load() }, 5000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [logAuto])

  const refreshLog = async (): Promise<void> => {
    setLogLoading(true)
    try {
      const response = await fetch('/dsh-web-tray/watchdog-log?lines=120', { cache: 'no-store' })
      const body = (await response.json()) as { log?: string }
      setLogText(typeof body.log === 'string' ? body.log : '')
    } catch {
      setMessage(t('failed'))
      setMessageIsError(true)
    } finally {
      setLogLoading(false)
    }
  }

  const saveConfig = async (patch: ConfigShape, hint: string): Promise<void> => {
    setSaving(hint)
    setMessage(null)
    try {
      const response = await fetch('/dsh-web-tray/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = (await response.json()) as ConfigBody
      if (body.config !== undefined) {
        setStatus((previous) => (previous === null
          ? previous
          : { ...previous, config: body.config, configSource: body.configSource as StatusBody['configSource'] }))
      }
      if (body.ok === true) {
        setMessage(t('configSaved'))
        setMessageIsError(false)
      } else {
        setMessage(body.errors?.[0] ?? body.error ?? t('configFailed'))
        setMessageIsError(true)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('configFailed'))
      setMessageIsError(true)
    } finally {
      setSaving(null)
    }
  }

  const regenerate = async (): Promise<void> => {
    setBusy('regenerate')
    setMessage(null)
    try {
      const response = await fetch('/dsh-web-tray/regenerate', { method: 'POST' })
      const body = (await response.json()) as StatusBody
      setStatus(body)
      setMessage(body.ok === true ? t('regenerated') : (body.lastError ?? t('failed')))
      setMessageIsError(body.ok !== true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('failed'))
      setMessageIsError(true)
    } finally {
      setBusy(null)
    }
  }

  const savePath = async (): Promise<void> => {
    setBusy('savePath')
    setMessage(null)
    try {
      const response = await fetch('/dsh-web-tray/project-path', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath: draftPath.trim() }),
      })
      const body = (await response.json()) as ProjectPathBody
      if (body.ok !== true) {
        setMessage(body.error ?? t('failed'))
        setMessageIsError(true)
        return
      }
      setPathDirty(false)
      setMessage(t('pathSaved'))
      setMessageIsError(false)
      await regenerate()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('failed'))
      setMessageIsError(true)
    } finally {
      setBusy(null)
    }
  }

  const copyAuthUrl = async (): Promise<void> => {
    const url = status?.webAuthUrl ?? status?.webUrl
    if (url === undefined) return
    try {
      await navigator.clipboard.writeText(url)
      setMessage(t('copied'))
      setMessageIsError(false)
    } catch {
      setMessage(t('copyFailed'))
      setMessageIsError(true)
    }
  }

  const openUrl = (url: string | null | undefined): void => {
    if (url === null || url === undefined || url === '') return
    window.open(url, '_blank', 'noopener')
  }

  const config = status?.config
  const tray = status?.tray ?? null
  const files = status?.files
  const dsh = status?.dsh
  const idle = tray?.idle
  const probe = tray?.probe
  const restarts = tray?.restarts
  const dshState: StateDotState = dsh?.running === true ? 'done' : (phase === 'failed' ? 'error' : 'idle')
  const unsupported = status?.platform !== 'wsl'
  const switchDisabled = unsupported || saving !== null

  return h('div', { className: 'dsh-web-tray-section' },
    h('p', { className: 'dsh-web-tray-description' }, t('description')),

    h('div', { className: 'dsh-web-tray-group' },
      h('span', { className: 'dsh-web-tray-group-title' }, t('statusTitle')),
      h(Row, { label: t('platform') }, platformLabel(status, t)),
      h(Row, { label: t('dshRunning') },
        h('span', { className: 'dsh-web-tray-state' },
          h(StateDot, { state: dshState }),
          h('span', null, dsh?.running === true ? t('dshRunning') : t('dshStopped')))),
      h(Row, { label: t('dshPid') }, dsh?.pid ?? '—'),
      h(Row, { label: t('dshUptime') }, formatDuration(dsh?.uptimeSec)),
      h(Row, { label: t('dshRss') }, dsh?.rssMb === null || dsh?.rssMb === undefined ? '—' : `${dsh.rssMb} MB`),
      h(Row, { label: t('dshUrl') }, status?.webUrl ?? '—'),
      h(Row, { label: t('trayRunning') },
        tray === null
          ? t('wdNotRunning')
          : `${t(PHASE_KEYS[tray.phase ?? ''] ?? 'wdPhaseUnknown')} · ${formatTime(tray.updatedAt)}`),
      h(Row, { label: t('trayConfigSource') }, configSourceLabel(status?.configSource, t)),
    ),

    h('div', { className: 'dsh-web-tray-group' },
      h('span', { className: 'dsh-web-tray-group-title' }, t('switchesTitle')),
      h('div', { className: 'dsh-web-tray-switch' },
        h(Switch, {
          checked: config?.autoStart === true,
          onChange: (next: boolean) => { void saveConfig({ autoStart: next }, 'autoStart') },
          label: t('swAutoStart'),
          disabled: switchDisabled,
        }),
        h('span', { className: 'dsh-web-tray-switch-text' },
          h('span', null, t('swAutoStart')),
          h('span', { className: 'dsh-web-tray-field-hint' }, t('swAutoStartHint')))),
      h('div', { className: 'dsh-web-tray-switch' },
        h(Switch, {
          checked: config?.autoStopOnExit === true,
          onChange: (next: boolean) => { void saveConfig({ autoStopOnExit: next }, 'autoStopOnExit') },
          label: t('swAutoStopExit'),
          disabled: switchDisabled,
        }),
        h('span', { className: 'dsh-web-tray-switch-text' },
          h('span', null, t('swAutoStopExit')),
          h('span', { className: 'dsh-web-tray-field-hint' }, t('swAutoStopExitHint')))),
      h('div', { className: 'dsh-web-tray-switch' },
        h(Switch, {
          checked: config?.watchdogEnabled === true,
          onChange: (next: boolean) => { void saveConfig({ watchdogEnabled: next }, 'watchdogEnabled') },
          label: t('swWatchdog'),
          disabled: switchDisabled,
        }),
        h('span', { className: 'dsh-web-tray-switch-text' },
          h('span', null, t('swWatchdog')),
          h('span', { className: 'dsh-web-tray-field-hint' }, t('swWatchdogHint')))),
      h('div', { className: 'dsh-web-tray-field' },
        h('span', { className: 'dsh-web-tray-field-label' }, t('swIdle')),
        h('div', { className: 'dsh-web-tray-buttons' },
          ...IDLE_CHOICES.map(choice => h(Button, {
            key: `idle-${choice.minutes}`,
            variant: config?.autoStopIdleMinutes === choice.minutes ? 'primary' : 'outline',
            size: 'sm',
            disabled: switchDisabled,
            onClick: () => { void saveConfig({ autoStopIdleMinutes: choice.minutes }, `idle-${choice.minutes}`) },
          }, t(choice.key))))),
    ),

    h('div', { className: 'dsh-web-tray-group' },
      h('span', { className: 'dsh-web-tray-group-title' }, t('wdTitle')),
      h(Row, { label: t('wdEnabled') }, tray === null ? '—' : (probe === undefined ? '—' : `${t('wdProbes')}: ${probe.failures ?? 0}/${probe.downThreshold ?? '—'}`)),
      h(Row, { label: t('wdState') }, t(PHASE_KEYS[tray?.phase ?? ''] ?? 'wdPhaseUnknown')),
      h(Row, { label: t('wdProbeDetail') },
        probe === undefined || probe.detail === undefined
          ? '—'
          : `${probe.detail}${probe.latencyMs === undefined ? '' : ` (${probe.latencyMs} ms)`}`),
      h(Row, { label: t('wdRestartFailures') }, `${restarts?.failures ?? 0}/${restarts?.maxFailures ?? '—'}`),
      h(Row, { label: t('wdRestartCount') }, restarts?.count ?? 0),
      h(Row, { label: t('wdLastAlive') }, formatTime(tray?.dsh?.lastAliveAt)),
      h(Row, { label: t('wdLastRestart') }, `${formatTime(restarts?.lastAt)} [${restartResultLabel(restarts?.lastOk, t)}]`),
      h(Row, { label: t('idleConnections') }, idle?.connections === null || idle?.connections === undefined ? t('idleUnknown') : idle.connections),
      h(Row, { label: t('idleSeconds') }, formatDuration(idle?.idleSeconds)),
      h(Row, { label: t('idleThreshold') }, config?.autoStopIdleMinutes === undefined || config.autoStopIdleMinutes === 0 ? t('idleOff') : `${config.autoStopIdleMinutes} min`),
    ),

    h('div', { className: 'dsh-web-tray-group' },
      h('span', { className: 'dsh-web-tray-group-title' }, t('filesTitle')),
      h(Row, { label: t('shortcut') }, files?.shortcutExists === true ? '✓' : '—'),
      h(Row, { label: t('tray') }, files?.trayScriptExists === true && files?.trayVbsExists === true && files?.iconExists === true ? '✓' : '—'),
      h(Row, { label: 'tray-config.json' }, files?.configExists === true ? '✓' : '—'),
      h(Row, { label: 'start.sh / stop.sh' }, files?.startScriptExists === true ? '✓' : '—'),
      files?.configPath !== null && files?.configPath !== undefined
        ? h('p', { className: 'dsh-web-tray-message' }, files.configPath)
        : null,
    ),

    h('div', { className: 'dsh-web-tray-field' },
      h('span', { className: 'dsh-web-tray-field-label' }, t('projectPath')),
      h('input', {
        style: inputStyle,
        value: draftPath,
        placeholder: '/home/me/deepseek-harness',
        disabled: busy !== null,
        onChange: (event: { target: { value: string } }) => {
          setDraftPath(event.target.value)
          setPathDirty(true)
        },
      }),
      h('span', { className: 'dsh-web-tray-field-hint' }, t('projectPathHint'))),

    h('div', { className: 'dsh-web-tray-buttons' },
      h(Button, { variant: 'primary', size: 'sm', disabled: busy !== null || unsupported, onClick: () => { void savePath() } },
        busy === 'savePath' ? t('savingPath') : t('savePath')),
      h(Button, { variant: 'outline', size: 'sm', disabled: busy !== null || unsupported, onClick: () => { void regenerate() } },
        busy === 'regenerate' ? t('regenerating') : t('regenerate')),
      h(Button, { variant: 'outline', size: 'sm', disabled: status?.webUrl === undefined, onClick: () => { openUrl(status?.webUrl) } }, t('openWeb')),
      h(Button, {
        variant: 'outline',
        size: 'sm',
        disabled: status?.webAuthUrl === null || status?.webAuthUrl === undefined,
        onClick: () => { openUrl(status?.webAuthUrl) },
      }, t('openAuth')),
      h(Button, { variant: 'outline', size: 'sm', disabled: status?.webUrl === undefined, onClick: () => { void copyAuthUrl() } }, t('copyAuth'))),

    h('div', { className: 'dsh-web-tray-group' },
      h('span', { className: 'dsh-web-tray-group-title' }, t('wdLog')),
      h('div', { className: 'dsh-web-tray-switch' },
        h(Switch, { checked: logAuto, onChange: setLogAuto, label: t('wdLogAuto') }),
        h('span', { className: 'dsh-web-tray-switch-text' }, h('span', null, t('wdLogAuto')))),
      h('div', { className: 'dsh-web-tray-buttons' },
        h(Button, { variant: 'outline', size: 'sm', disabled: logLoading, onClick: () => { void refreshLog() } },
          logLoading ? t('wdLogLoading') : t('wdLogRefresh'))),
      logText !== ''
        ? h('pre', {
          style: {
            margin: '8px 0 0',
            padding: 10,
            maxHeight: 260,
            overflow: 'auto',
            borderRadius: 8,
            background: 'var(--dsw-alias-bg-layer-1)',
            border: '1px solid var(--dsw-alias-border-l2)',
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--dsw-alias-label-secondary)',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          },
        }, logText)
        : h('p', { className: 'dsh-web-tray-message' }, t('wdLogEmpty'))),

    unsupported ? h('p', { className: 'dsh-web-tray-message dsh-web-tray-message-error' }, t('notWsl')) : null,
    status?.lastResult !== undefined
      ? h('p', { className: 'dsh-web-tray-message' }, status.lastResult)
      : null,
    message !== null
      ? h('p', { className: `dsh-web-tray-message${messageIsError ? ' dsh-web-tray-message-error' : ''}` }, message)
      : null,
  )
}
