/**
 * Both bundled `.ico` assets are product assets with a contract worth pinning
 * down:
 *
 * - the shortcut icon wears the DeepSeek Harness app style (dark whale on a
 *   light rounded tile) at every size the shell asks for under common DPI
 *   settings, and the frames a `System.Drawing` consumer can request (up to
 *   96px) are BMP, because the .NET icon decoder cannot read a PNG-compressed
 *   frame that large ("Requested range extends past the end of the array")
 *   while the shell renders PNG frames fine — so PNG stays for 128/256 only;
 * - the notification-area icon is the same mark with the colours inverted
 *   (light whale on a dark tile), which is what makes the tray distinguishable
 *   from the official desktop app's own tray icon.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ICON_FILE_NAME, TRAY_ICON_FILE_NAME } from '../src/names.ts'

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

interface Frame {
  /** Frame width in pixels; 256 is stored as 0 in the directory. */
  size: number
  /** Whether the payload is a PNG rather than a DIB. */
  png: boolean
  offset: number
}

interface IconAsset {
  data: Buffer
  frames: Frame[]
  /** One RGBA pixel of a BMP frame; DIB rows are stored bottom-up. */
  pixel(frame: Frame, x: number, y: number): [number, number, number, number]
}

/** Parse an ICO file (ICONDIR + one ICONDIRENTRY per frame). */
function load(name: string): IconAsset {
  const data = readFileSync(join(ASSETS, name))
  expect(data.readUInt16LE(0)).toBe(0)
  expect(data.readUInt16LE(2)).toBe(1)
  const count = data.readUInt16LE(4)
  const frames = Array.from({ length: count }, (_entry, index) => {
    const entry = 6 + index * 16
    const offset = data.readUInt32LE(entry + 12)
    return {
      size: data[entry] === 0 ? 256 : data[entry],
      png: data.subarray(offset, offset + 8).equals(PNG_SIGNATURE),
      offset,
    }
  })
  return {
    data,
    frames,
    pixel: (frame, x, y) => {
      const width = data.readInt32LE(frame.offset + 4)
      const height = data.readInt32LE(frame.offset + 8) / 2
      const start = frame.offset + 40 + ((height - 1 - y) * width + x) * 4
      return [data[start + 2], data[start + 1], data[start], data[start + 3]]
    },
  }
}

function luminance(pixel: [number, number, number, number]): number {
  return 0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2]
}

describe('bundled icons', () => {
  it('ships every shortcut size the shell asks for, smallest first', () => {
    const icon = load(ICON_FILE_NAME)
    expect(icon.frames.map(frame => frame.size)).toEqual([16, 20, 24, 32, 40, 48, 64, 96, 128, 256])
  })

  it('keeps the shortcut frames a .NET consumer can load as BMP and only 128/256 as PNG', () => {
    const icon = load(ICON_FILE_NAME)
    const stored = icon.frames.map(frame => ({ size: frame.size, png: frame.png }))
    expect(stored).toEqual([
      { size: 16, png: false },
      { size: 20, png: false },
      { size: 24, png: false },
      { size: 32, png: false },
      { size: 40, png: false },
      { size: 48, png: false },
      { size: 64, png: false },
      { size: 96, png: false },
      { size: 128, png: true },
      { size: 256, png: true },
    ])
  })

  it('draws a dark whale on a light rounded tile for the shortcut', () => {
    const icon = load(ICON_FILE_NAME)
    const frame = icon.frames.find(entry => entry.size === 48)
    expect(frame).toBeDefined()
    if (frame === undefined) return
    // Rounded corner and tile inset: the outermost pixels are transparent.
    expect(icon.pixel(frame, 0, 0)[3]).toBe(0)
    expect(icon.pixel(frame, 0, 24)[3]).toBe(0)
    // Tile in front of the whale's head: light and opaque.
    const tile = icon.pixel(frame, 24, 4)
    expect(tile[3]).toBeGreaterThan(240)
    expect(luminance(tile)).toBeGreaterThan(220)
    // Whale body at the centre: dark and opaque.
    const whale = icon.pixel(frame, 24, 22)
    expect(whale[3]).toBe(255)
    expect(luminance(whale)).toBeLessThan(90)
  })

  it('inverts the shortcut mark for the notification area, in BMP only', () => {
    const icon = load(TRAY_ICON_FILE_NAME)
    expect(icon.frames.map(frame => frame.size)).toEqual([16, 20, 24, 32, 40, 48, 64])
    for (const frame of icon.frames) {
      expect({ size: frame.size, png: frame.png }).toEqual({ size: frame.size, png: false })
    }
    const frame48 = icon.frames.find(entry => entry.size === 48)
    expect(frame48).toBeDefined()
    if (frame48 === undefined) return
    // Same geometry, opposite colours: dark tile, light whale.
    const tile = icon.pixel(frame48, 24, 4)
    expect(tile[3]).toBeGreaterThan(240)
    expect(luminance(tile)).toBeLessThan(90)
    const whale = icon.pixel(frame48, 24, 22)
    expect(whale[3]).toBe(255)
    expect(luminance(whale)).toBeGreaterThan(200)
  })
})
