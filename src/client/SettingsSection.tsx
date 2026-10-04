/**
 * The plugin's settings section: what the host knows about the installation
 * (runtime facts, the generated files, the project path) and the actions that
 * are worth a button — recreate the desktop shortcut, refresh the view, open
 * DSH, save the project path.
 *
 * The section is a client-only contribution; every fact comes from
 * `/dsh-web-tray/*` on the host. It fetches once on mount and on demand rather
 * than polling: the slimmed-down plugin keeps no live tray state to watch.
 */

import { createElement as h, useEffect, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LocaleKey } from './locales.ts'

export interface TraySettingsSectionProps {
  t: (key: LocaleKey) => string
}

interface FilesShape {
  shortcutPath?: string | null
  shortcutExists?: boolean
  trayDir?: string | null
  trayScriptExists?: boolean
  launcherScriptExists?: boolean
  iconExists?: boolean
  trayIconExists?: boolean
  startScriptExists?: boolean
  stopScriptExists?: boolean
}

interface StatusBody {
  ok?: boolean
  platform?: 'wsl' | 'win' | 'unsupported'
  distro?: string
  webUrl?: string
  webAuthUrl?: string | null
  shortcutName?: string
  desktopDir?: string | null
  files?: FilesShape
  lastError?: string
  lastResult?: string
}

interface ProjectPathBody {
  ok?: boolean
  projectPath?: string
  error?: string
}

type Phase = 'loading' | 'ready' | 'failed'

const STYLE_ID = 'dsh-web-tray-section-style'
const SECTION_CSS = `
.dsh-web-tray-section{display:flex;flex-direction:column;gap:2px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-web-tray-description{margin:0 0 6px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-web-tray-field{display:flex;flex-direction:column;gap:6px;padding:10px 0}
.dsh-web-tray-field-label{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-web-tray-field-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-web-tray-group{display:flex;flex-direction:column;gap:2px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-web-tray-group-title{font-size:13px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary);padding-bottom:4px}
.dsh-web-tray-message{font-size:12px;line-height:1.5;overflow-wrap:anywhere;margin:8px 0 0;color:var(--dsw-alias-label-tertiary)}
.dsh-web-tray-message-error{color:var(--dsw-alias-label-error)}
.dsh-web-tray-buttons{display:flex;flex-wrap:wrap;gap:8px;padding-top:12px}
`
const rowBase: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, lineHeight: 1.5, padding: '4px 0' }
const labelStyle: CSSProperties = { color: 'var(--dsw-alias-label-tertiary)' }
const valueStyle: CSSProperties = { textAlign: 'right', overflowWrap: 'anywhere', color: 'var(--dsw-alias-label-secondary)' }
const inputStyle: CSSProperties = { width: '100%', height: 34, padding: '0 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)', fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' }

function platformLabel(status: StatusBody | null, t: (key: LocaleKey) => string): string {
  if (status?.platform === 'wsl') return `${t('platformWsl')} (${status.distro ?? '?'})`
  if (status?.platform === 'win') return t('platformWin')
  return t('platformUnsupported')
}

function Row({ label, children }: { label: string; children?: ReactNode }): ReactElement {
  return h('div', { style: rowBase }, h('span', { style: labelStyle }, label), h('span', { style: valueStyle }, children))
}

function mark(present: boolean | undefined, t: (key: LocaleKey) => string): string {
  if (present === true) return '✓'
  return present === undefined ? t('none') : '—'
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
  const [pathLoaded, setPathLoaded] = useState(false)
  const [busy, setBusy] = useState<'regenerate' | 'savePath' | 'refresh' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [messageIsError, setMessageIsError] = useState(false)

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

  const load = async (): Promise<void> => {
    try {
      const response = await fetch('/dsh-web-tray/status', { cache: 'no-store' })
      const body = (await response.json()) as StatusBody
      setStatus(body)
      setPhase('ready')
    } catch {
      setPhase('failed')
    }
  }

  const loadPath = async (): Promise<void> => {
    try {
      const response = await fetch('/dsh-web-tray/project-path', { cache: 'no-store' })
      const body = (await response.json()) as ProjectPathBody
      if (body.projectPath !== undefined) {
        setDraftPath(body.projectPath)
        setPathLoaded(true)
      }
    } catch {
      // The status group already reports an unreachable host.
    }
  }

  useEffect(() => {
    void load()
    void loadPath()
  }, [])

  const unsupported = status !== null && status.platform !== 'wsl'

  const finish = (text: string, isError: boolean): void => {
    setMessage(text)
    setMessageIsError(isError)
  }

  const regenerate = async (): Promise<void> => {
    setBusy('regenerate')
    try {
      const response = await fetch('/dsh-web-tray/regenerate', { method: 'POST', cache: 'no-store' })
      const body = (await response.json()) as StatusBody
      setStatus(body)
      setPhase('ready')
      if (body.ok === true) finish(body.lastResult ?? t('regenerated'), false)
      else finish(body.lastError ?? t('failed'), true)
    } catch {
      finish(t('failed'), true)
    } finally {
      setBusy(null)
    }
  }

  const refresh = async (): Promise<void> => {
    setBusy('refresh')
    try {
      await load()
      await loadPath()
    } finally {
      setBusy(null)
    }
  }

  const savePath = async (): Promise<void> => {
    setBusy('savePath')
    try {
      const response = await fetch('/dsh-web-tray/project-path', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath: draftPath }),
        cache: 'no-store',
      })
      const body = (await response.json()) as ProjectPathBody
      if (body.ok === true) {
        setPathLoaded(true)
        finish(t('pathSaved'), false)
      } else {
        finish(body.error ?? t('failed'), true)
      }
    } catch {
      finish(t('failed'), true)
    } finally {
      setBusy(null)
    }
  }

  const openUrl = (url: string | null | undefined): void => {
    if (url === null || url === undefined || url === '') return
    window.open(url, '_blank', 'noopener')
  }

  const copyAuthUrl = async (): Promise<void> => {
    const url = status?.webAuthUrl
    if (url === null || url === undefined || url === '') return
    try {
      await navigator.clipboard.writeText(url)
      finish(t('copied'), false)
    } catch {
      finish(t('copyFailed'), true)
    }
  }

  const files = status?.files

  return h('section', { className: 'dsh-web-tray-section' },
    h('p', { className: 'dsh-web-tray-description' }, t('description')),

    h('div', { className: 'dsh-web-tray-group' },
      h('span', { className: 'dsh-web-tray-group-title' }, t('statusTitle')),
      h(Row, { label: t('platform') }, platformLabel(status, t)),
      h(Row, { label: t('dshUrl') }, status?.webUrl ?? '—'),
      h(Row, { label: t('dshAuthUrl') }, status?.webAuthUrl ?? t('none')),
      phase === 'failed' ? h('p', { className: 'dsh-web-tray-message dsh-web-tray-message-error' }, t('failed')) : null),

    h('div', { className: 'dsh-web-tray-group' },
      h('span', { className: 'dsh-web-tray-group-title' }, t('filesTitle')),
      h(Row, { label: t('shortcut') }, mark(files?.shortcutExists, t)),
      h(Row, { label: t('tray') }, mark(files?.trayScriptExists, t)),
      h(Row, { label: t('launcher') }, mark(files?.launcherScriptExists, t)),
      h(Row, { label: t('shortcutIcon') }, mark(files?.iconExists, t)),
      h(Row, { label: t('trayIcon') }, mark(files?.trayIconExists, t)),
      h(Row, { label: t('startScript') }, files?.startScriptExists === true && files?.stopScriptExists === true ? '✓' : '—'),
      files?.trayDir !== null && files?.trayDir !== undefined
        ? h('p', { className: 'dsh-web-tray-message' }, `${t('filesDir')}: ${files.trayDir}`)
        : null),

    h('div', { className: 'dsh-web-tray-field' },
      h('span', { className: 'dsh-web-tray-field-label' }, t('projectPath')),
      h('input', {
        style: inputStyle,
        value: draftPath,
        placeholder: '/home/me/deepseek-harness',
        disabled: busy !== null || !pathLoaded,
        onChange: (event: { target: { value: string } }) => { setDraftPath(event.target.value) },
      }),
      h('span', { className: 'dsh-web-tray-field-hint' }, t('projectPathHint'))),

    h('div', { className: 'dsh-web-tray-buttons' },
      h(Button, { variant: 'primary', size: 'sm', disabled: busy !== null || unsupported, onClick: () => { void regenerate() } },
        busy === 'regenerate' ? t('regenerating') : t('regenerate')),
      h(Button, { variant: 'outline', size: 'sm', disabled: busy !== null, onClick: () => { void refresh() } },
        busy === 'refresh' ? t('refreshing') : t('refresh')),
      h(Button, { variant: 'outline', size: 'sm', disabled: busy !== null || !pathLoaded, onClick: () => { void savePath() } },
        busy === 'savePath' ? t('savingPath') : t('savePath')),
      h(Button, { variant: 'outline', size: 'sm', disabled: status?.webUrl === undefined, onClick: () => { openUrl(status?.webUrl) } }, t('openWeb')),
      h(Button, {
        variant: 'outline',
        size: 'sm',
        disabled: status?.webAuthUrl === null || status?.webAuthUrl === undefined,
        onClick: () => { openUrl(status?.webAuthUrl) },
      }, t('openAuth')),
      h(Button, { variant: 'outline', size: 'sm', disabled: status?.webAuthUrl === null || status?.webAuthUrl === undefined, onClick: () => { void copyAuthUrl() } }, t('copyAuth'))),

    h('p', { className: 'dsh-web-tray-message' }, t('trayHint')),
    unsupported ? h('p', { className: 'dsh-web-tray-message dsh-web-tray-message-error' }, t('notWsl')) : null,
    status?.lastResult !== undefined ? h('p', { className: 'dsh-web-tray-message' }, status.lastResult) : null,
    status?.lastError !== undefined ? h('p', { className: 'dsh-web-tray-message dsh-web-tray-message-error' }, status.lastError) : null,
    message !== null ? h('p', { className: `dsh-web-tray-message${messageIsError ? ' dsh-web-tray-message-error' : ''}` }, message) : null,
  )
}
