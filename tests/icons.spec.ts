/**
 * The bundled `.ico` files are product assets with a contract worth pinning down:
 *
 * - the shortcut icon wears the DeepSeek Harness app style (dark whale on a light
 *   rounded tile) at every size the shell asks for under common DPI settings, and
 *   the frames a `System.Drawing` consumer can request (up to 96px) are BMP,
 *   because the .NET icon decoder cannot read a PNG-compressed frame that large
 *   ("Requested range extends past the end of the array") while the shell renders
 *   PNG frames fine — so PNG stays for 128/256 only;
 * - the two notification-area icons are the page's own favicon mark — the whale
 *   alone, with no tile behind it — in the two inks a light or a dark notification
 *   area needs, drawn at the size the desktop app's own `resources/tray.ico` uses.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
/** The bundled asset names: the installer copies these and the tray script loads them. */
const ICON_FILE_NAME = 'dsh-web-tray.ico'
const TRAY_ICON_BLACK_NAME = 'dsh-web-tray-black.ico'
const TRAY_ICON_WHITE_NAME = 'dsh-web-tray-white.ico'
const TRAY_ICON_FILE_NAMES = [TRAY_ICON_BLACK_NAME, TRAY_ICON_WHITE_NAME]

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

/** The alpha-channel bounding box of a frame: the mark's own box in it. */
function inkBox(icon: IconAsset, frame: Frame): { width: number; height: number } {
  let left = frame.size
  let top = frame.size
  let right = -1
  let bottom = -1
  for (let y = 0; y < frame.size; y++) {
    for (let x = 0; x < frame.size; x++) {
      if (icon.pixel(frame, x, y)[3] <= 8) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  if (right < 0) return { width: 0, height: 0 }
  return { width: right - left + 1, height: bottom - top + 1 }
}

/** Every pixel's alpha, top-down: two icons that differ in ink only share it. */
function alphaMap(icon: IconAsset, frame: Frame): number[] {
  const alphas: number[] = []
  for (let y = 0; y < frame.size; y++) {
    for (let x = 0; x < frame.size; x++) alphas.push(icon.pixel(frame, x, y)[3])
  }
  return alphas
}

/** One frame of an asset, by its size. */
function frameOf(icon: IconAsset, size: number): Frame {
  const frame = icon.frames.find(entry => entry.size === size)
  expect(frame).toBeDefined()
  if (frame === undefined) throw new Error(`no ${String(size)} frame`)
  return frame
}

/** The favicon's own ink box is 48.3 x 36.3 units: a whale, never a square. */
function expectWhaleAspect(box: { width: number; height: number }): void {
  expect(box.height / box.width).toBeGreaterThan(0.70)
  expect(box.height / box.width).toBeLessThan(0.82)
}

describe('bundled icons', () => {  it('ships every shortcut size the shell asks for, smallest first', () => {
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

  it('is the page favicon itself: the mark on transparency, with no tile', () => {
    // What a Chromium "install as app" shortcut carries: the favicon, not a composited tile.
    const icon = load(ICON_FILE_NAME)
    const frame = frameOf(icon, 48)
    for (const corner of [[0, 0], [47, 0], [0, 47], [47, 47]]) {
      expect(icon.pixel(frame, corner[0] as number, corner[1] as number)[3]).toBe(0)
    }
    // The mark fills the frame the way a favicon does, and it is a whale, not a square.
    const box = inkBox(icon, frame)
    expect(box.width).toBeGreaterThanOrEqual(Math.round(frame.size * 0.95))
    expectWhaleAspect(box)
    // The dark ink the page's own favicon draws, opaque at the body.
    const body = icon.pixel(frame, 24, 24)
    expect(body[3]).toBe(255)
    expect(luminance(body)).toBeLessThan(90)
  })

  it('ships the favicon mark in both tray inks, BMP only, at the tray frame sizes', () => {
    for (const name of TRAY_ICON_FILE_NAMES) {
      const icon = load(name)
      expect(icon.frames.map(frame => frame.size)).toEqual([16, 20, 24, 32, 40, 48, 64])
      for (const frame of icon.frames) {
        expect({ size: frame.size, png: frame.png }).toEqual({ size: frame.size, png: false })
      }
    }
  })

  it('draws that mark at the size the desktop app tray gives it, over no tile', () => {
    // The official `resources/tray.ico` draws this whale 7/8 of the frame wide
    // (measured 28/32, 42/48 and 56/64); the launcher asset above draws the same
    // mark at 3/4, which is a whole size smaller in the notification area.
    for (const name of TRAY_ICON_FILE_NAMES) {
      const icon = load(name)
      for (const frame of icon.frames) {
        const box = inkBox(icon, frame)
        const expected = Math.round(frame.size * 7 / 8)
        expect(box.width).toBeGreaterThanOrEqual(expected - 1)
        expect(box.width).toBeLessThanOrEqual(expected)
        // The favicon's own ink box is 48.3 x 36.3 units: a whale, not a square.
        expectWhaleAspect(box)
      }
    }
    // No tile: the corners are transparent and only the mark carries alpha, which
    // is what makes this a bare whale rather than the shortcut's rounded tile.
    const icon = load(TRAY_ICON_BLACK_NAME)
    const frame = frameOf(icon, 48)
    for (const corner of [[0, 0], [47, 0], [0, 47], [47, 47]]) {
      expect(icon.pixel(frame, corner[0] as number, corner[1] as number)[3]).toBe(0)
    }
    expect(icon.pixel(frame, 24, 24)[3]).toBe(255)
  })

  it('inks the two tray icons black and white, over one shared alpha map', () => {
    const black = load(TRAY_ICON_BLACK_NAME)
    const white = load(TRAY_ICON_WHITE_NAME)
    for (const size of [16, 48]) {
      const blackFrame = frameOf(black, size)
      const whiteFrame = frameOf(white, size)
      expect(alphaMap(white, whiteFrame)).toEqual(alphaMap(black, blackFrame))
      // Body pixel: the same place, the two inks.
      const middle = size / 2
      const dark = black.pixel(blackFrame, middle, middle)
      const light = white.pixel(whiteFrame, middle, middle)
      expect(dark[3]).toBe(255)
      expect(light[3]).toBe(255)
      expect(luminance(dark)).toBeLessThan(20)
      expect(luminance(light)).toBeGreaterThan(235)
    }
  })
})
