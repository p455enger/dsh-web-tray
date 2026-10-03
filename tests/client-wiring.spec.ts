import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children }: { children?: unknown }) => children ?? null,
  Switch: ({ label, checked }: { label?: string; checked?: boolean }) => `${label ?? ''}:${checked === true ? 'on' : 'off'}`,
  StateDot: ({ state }: { state?: string }) => `[${state ?? ''}]`,
}))

import { renderToStaticMarkup } from 'react-dom/server'
import { createElement as h } from 'react'
import { apply, inject, name } from '../src/client/index.ts'
import { TraySettingsSection } from '../src/client/SettingsSection.tsx'

describe('client section wiring', () => {
  it('registers the settings.section entry dsh-web-tray owns', () => {
    const registered: Array<{ meta: Record<string, unknown>; render: () => unknown }> = []
    const calls: string[] = []
    const slots = {
      inject(slot: string, register: () => unknown) {
        calls.push(`slots.inject:${slot}`)
        register()
      },
      register(meta: Record<string, unknown>, render: () => unknown) {
        registered.push({ meta, render })
        return () => {}
      },
    }
    const ctx = {
      effect(callback: () => unknown, label?: string) {
        calls.push(label ?? '')
        callback()
      },
      locale: {
        register(namespace: string) {
          calls.push(`locale.register:${namespace}`)
        },
        bind(namespace: string) {
          return (key: string) => `${namespace}.${key}`
        },
      },
      slots,
    }

    apply(ctx as never)

    expect(name).toBe('dsh-web-tray')
    expect(inject).toEqual(['slots', 'locale'])
    expect(calls).toContain('locale.register:dsh-web-tray')
    expect(calls).toContain('slots.inject:settings.section')
    expect(registered).toHaveLength(1)
    expect(registered[0].meta).toMatchObject({ name: 'settings.section', id: 'dsh-web-tray', order: 100 })
    expect(typeof registered[0].meta.label).toBe('function')
    expect(registered[0].render()).toBeTruthy()
  })

  it('renders the settings section without a runtime error', () => {
    const html = renderToStaticMarkup(h(TraySettingsSection, { t: (key: string) => key }))
    expect(html).toContain('dsh-web-tray-section')
    expect(html).toContain('description')
    expect(html).toContain('projectPath')
    expect(html).toContain('regenerate')
    // The switches and the live status groups render from the same component.
    expect(html).toContain('switchesTitle')
    expect(html).toContain('swAutoStart')
    expect(html).toContain('statusTitle')
    expect(html).toContain('wdLogAuto')
  })
})
