/**
 * The installer is the only thing that writes an install, and it runs on either side of the
 * WSL/Windows boundary, so its path rules, its environment file and its file set are pinned
 * here. Windows is injected (a fake PowerShell runner and a fake environment), which is what
 * makes these hermetic.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  INSTALLED_FILES,
  OWNED_FILES,
  envValue,
  installFiles,
  mountedDrives,
  parseArgs,
  parseEnv,
  renderEnv,
  resolveLayout,
  resolveWindowsProfile,
  shortcutPathFromStamp,
  tryRemove,
  tokenUrl,
  windowsDirToWsl,
  wslDirToWindows,
} from '../bin/dsh-web-tray.mjs'

const tmp = mkdtempSync(join(tmpdir(), 'dsh-web-tray-installer-'))
afterAll(() => { rmSync(tmp, { recursive: true, force: true }) })

const CONFIG = {
  DISTRO: 'Debian',
  WSL_DIR: '/mnt/c/Users/me/.dsh/dsh-web-tray',
  WEB_URL: 'http://127.0.0.1:3080',
  WORKSPACE: '/home/me/work',
  DSH_COMMAND: 'dsh web --no-open',
}

/** A layout whose Windows-side facts are injected, so no Windows is needed. */
async function fakeLayout(windowsUser = 'me') {
  return await resolveLayout({ windowsUser })
}

describe('tray.env', () => {
  it('round-trips a value byte for byte, whatever is in it', () => {
    const values = {
      ...CONFIG,
      WORKSPACE: '/home/me/two words/$(echo hi)/back\\slash/中文',
      DSH_COMMAND: 'npx --yes dsh web --no-open',
    }
    expect(parseEnv(renderEnv(values))).toEqual(values)
  })

  it('writes LF endings only', () => {
    expect(renderEnv(CONFIG).includes('\r')).toBe(false)
    expect(renderEnv(CONFIG).endsWith('\n')).toBe(true)
  })

  it('refuses a value that neither reader would unescape', () => {
    // A quote or a newline cannot survive verbatim, and both the tray and start.sh read the
    // value as-is: rejecting it at install time is what keeps the command line correct.
    expect(() => envValue('WORKSPACE', "/home/it's")).toThrow()
    expect(() => envValue('DSH_COMMAND', 'dsh web\nrm -rf /')).toThrow()
    expect(() => envValue('DISTRO', '')).toThrow()
    expect(envValue('DISTRO', 'Debian')).toBe("'Debian'")
  })

  it('ignores comments and blank lines, and tolerates CR', () => {
    const text = "# written by install\n\nDISTRO='Debian'\r\nWSL_DIR='/mnt/c/x'\r\n"
    expect(parseEnv(text)).toEqual({ DISTRO: 'Debian', WSL_DIR: '/mnt/c/x' })
  })
})

describe('paths', () => {
  it('maps a drive path to /mnt and back', () => {
    expect(windowsDirToWsl('C:\\Users\\me\\.dsh\\dsh-web-tray')).toBe('/mnt/c/Users/me/.dsh/dsh-web-tray')
    expect(wslDirToWindows('/mnt/c/Users/me/.dsh/dsh-web-tray')).toBe('C:\\Users\\me\\.dsh\\dsh-web-tray')
    expect(windowsDirToWsl(wslDirToWindows('/mnt/c/Users/me/.dsh/dsh-web-tray'))).toBe('/mnt/c/Users/me/.dsh/dsh-web-tray')
  })

  it('keeps a drive letter other than C', () => {
    expect(windowsDirToWsl('D:\\tools\\dsh-web-tray')).toBe('/mnt/d/tools/dsh-web-tray')
    expect(wslDirToWindows('/mnt/d/tools/dsh-web-tray')).toBe('D:\\tools\\dsh-web-tray')
  })

  it('refuses a path it cannot translate instead of guessing', () => {
    expect(() => windowsDirToWsl('\\\\wsl.localhost\\Debian\\home\\me')).toThrow()
    expect(() => windowsDirToWsl('Users\\me')).toThrow()
    expect(() => wslDirToWindows('/home/me/.dsh')).toThrow()
  })

  it('finds the mounted drives from PATH and from the mount table', () => {
    const drives = mountedDrives({ PATH: '/mnt/d/bin:/usr/bin:/mnt/c/Windows' }, '')
    expect(drives).toContain('c')
    expect(drives).toContain('d')
    // Nothing but C: when neither source has more, and the mount table on its own works.
    expect(mountedDrives({ PATH: '/usr/bin' }, '')).toEqual(['c'])
    expect(mountedDrives({ PATH: '/usr/bin' }, 'E:\\ on /mnt/e type 9p (rw,noatime)')).toContain('e')
  })
})

describe('the Windows profile', () => {
  it('takes the answer the interop PATH already carries', async () => {
    const profile = await resolveWindowsProfile({ env: { PATH: '/mnt/c/Users/me/bin:/usr/bin' } })
    expect(profile).toEqual({ wslPath: '/mnt/c/Users/me', source: 'PATH' })
  })

  it('asks PowerShell when PATH carries no Windows directory', async () => {
    const profile = await resolveWindowsProfile({
      env: { PATH: '/usr/bin' },
      runPowerShell: async () => ({ code: 0, stdout: 'C:\\Users\\other\r\n', stderr: '', timedOut: false }),
    })
    expect(profile).toEqual({ wslPath: '/mnt/c/Users/other', source: 'PowerShell' })
  })

  it('honours an explicit user and otherwise refuses to guess', async () => {
    expect((await resolveWindowsProfile({ windowsUser: 'named' })).wslPath).toBe('/mnt/c/Users/named')
    await expect(resolveWindowsProfile({
      env: { PATH: '/usr/bin' },
      runPowerShell: async () => ({ code: 1, stdout: '', stderr: 'no', timedOut: false }),
    })).rejects.toThrow(/--windows-user/)
  })
})

describe('install layout', () => {
  it('puts everything in one Windows directory named by the profile', async () => {
    const layout = await fakeLayout('me')
    expect(layout.targetDir).toBe('/mnt/c/Users/me/.dsh/dsh-web-tray')
    expect(layout.targetDirWindows).toBe('C:\\Users\\me\\.dsh\\dsh-web-tray')
    expect(layout.trayScriptWindows).toBe('C:\\Users\\me\\.dsh\\dsh-web-tray\\dsh-web-tray.ps1')
    expect(layout.profile.source).toBe('--windows-user')
  })

  it('writes the helper with a BOM, the scripts with LF, and the icons unchanged', async () => {
    const layout = await fakeLayout('me')
    const target = join(tmp, 'bom-lf')
    const written = await installFiles({ ...layout, targetDir: target, trayEnvPath: join(target, 'tray.env') }, CONFIG)
    const helper = readFileSync(join(target, 'dsh-web-tray.ps1'), 'utf8')
    // Windows PowerShell 5.1 needs the mark to read the non-ASCII menu labels.
    expect(helper.startsWith('\uFEFF')).toBe(true)
    expect(helper).toContain('打开 DeepSeek Harness')
    for (const name of ['start.sh', 'stop.sh']) {
      const text = readFileSync(join(target, name), 'utf8')
      expect(text.includes('\r')).toBe(false)
      expect(text.startsWith('#!/usr/bin/env bash')).toBe(true)
    }
    expect(readFileSync(join(target, 'dsh-web-tray.ico')).equals(
      readFileSync(new URL('../assets/dsh-web-tray.ico', import.meta.url)),
    )).toBe(true)
    expect(parseEnv(readFileSync(join(target, 'tray.env'), 'utf8'))).toEqual(CONFIG)
    // The set it writes is exactly the shipped set; the rest of OWNED_FILES is written by
    // the tray itself at run time.
    expect(written.sort()).toEqual([
      'dsh-web-tray-black.ico', 'dsh-web-tray-white.ico', 'dsh-web-tray.ico',
      'dsh-web-tray.js', 'dsh-web-tray.ps1', 'start.sh', 'stop.sh', 'tray.env',
    ].sort())
    for (const name of written) expect(OWNED_FILES).toContain(name)
  })
})

describe('command line', () => {
  it('parses the documented options', () => {
    const options = parseArgs(['install', '--distro', 'Ubuntu', '--workspace', '/w', '--command', 'x', '--port', '3081', '--windows-user', 'u'])
    expect(options).toMatchObject({ verb: 'install', distro: 'Ubuntu', workspace: '/w', command: 'x', port: 3081, windowsUser: 'u' })
    expect(parseArgs(['-h']).help).toBe(true)
    expect(parseArgs(['-v']).version).toBe(true)
    expect(parseArgs([]).verb).toBe('')
  })

  it('rejects an unknown option, a missing value and an impossible port', () => {
    expect(() => parseArgs(['install', '--nope', 'x'])).toThrow(/unknown option/)
    expect(() => parseArgs(['install', '--port'])).toThrow(/needs a value/)
    expect(() => parseArgs(['install', '--port', '0'])).toThrow(/1-65535/)
    expect(() => parseArgs(['install', '--port', '65536'])).toThrow(/1-65535/)
  })
})

describe('the entry point', () => {
  it('runs when it is reached through a symlink, the way npm\'s bin shim does', () => {
    // `npm i -g` and `npx` both run the package through a symlink in `.bin`, so
    // argv[1] is the link while import.meta.url is the real file. Comparing those
    // directly made every shimmed run exit 0 without a word.
    const link = join(tmp, 'bin-shim-dsh-web-tray')
    symlinkSync(fileURLToPath(new URL('../bin/dsh-web-tray.mjs', import.meta.url)), link)
    // No verb: the CLI prints its usage.
    const noVerb = spawnSync(process.execPath, [link], { encoding: 'utf8' })
    expect(noVerb.stdout).toContain('Usage: dsh-web-tray')
    // And the real path is still found, so PACKAGE_ROOT and the windows/ directory resolve.
    const version = spawnSync(process.execPath, [link, '--version'], { encoding: 'utf8' })
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(version.stdout.trim()).toBe(pkg.version)
  })
})

describe('reading back what was installed', () => {
  it('finds the newest token URL for the configured host and port', async () => {
    const layout = await fakeLayout('me')
    const target = join(tmp, 'token')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'start.log'), [
      'http://127.0.0.1:3099/?token=someone-elses',
      'http://127.0.0.1:3080/?token=first',
      'noise',
      'http://127.0.0.1:3080/?token=second',
    ].join('\n'), 'utf8')
    expect(tokenUrl({ ...layout, targetDir: target }, 'http://127.0.0.1:3080')).toBe('http://127.0.0.1:3080/?token=second')
    expect(tokenUrl({ ...layout, targetDir: target }, 'http://127.0.0.1:3099')).toBe('http://127.0.0.1:3099/?token=someone-elses')
    expect(tokenUrl({ ...layout, targetDir: join(tmp, 'nowhere') }, 'http://127.0.0.1:3080')).toBeNull()
  })

  it('reads the shortcut the stamp names, and the conventional name without one', async () => {
    const layout = await fakeLayout('me')
    const stampPath = join(tmp, 'stamp', 'tray-shortcut.json')
    mkdirSync(join(tmp, 'stamp'), { recursive: true })
    const programs = '/mnt/c/Users/me/AppData/Roaming/Microsoft/Windows/Start Menu/Programs'
    writeFileSync(stampPath, JSON.stringify({ path: 'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\DeepSeek Harness (Web).lnk' }), 'utf8')
    expect(shortcutPathFromStamp({ ...layout, stampPath })).toBe(`${programs}/DeepSeek Harness (Web).lnk`)
    // A stamp with a name and no path is from the version that used the desktop.
    writeFileSync(stampPath, JSON.stringify({ shortcut: 'My DSH.lnk' }), 'utf8')
    expect(shortcutPathFromStamp({ ...layout, stampPath })).toBe('/mnt/c/Users/me/Desktop/My DSH.lnk')
    writeFileSync(stampPath, '{}', 'utf8')
    expect(shortcutPathFromStamp({ ...layout, stampPath })).toBe(`${programs}/DeepSeek Harness (Web).lnk`)
    expect(shortcutPathFromStamp({ ...layout, stampPath: join(tmp, 'missing.json') })).toBe(`${programs}/DeepSeek Harness (Web).lnk`)
  })

  it('removes what it can and reports what it cannot, instead of throwing', () => {
    // The real case: a directory a running DSH still holds open. Windows refuses, and that is
    // not a failed uninstall — so the remover is injectable and the refusal is reported.
    const spoken: string[] = []
    const refuses = () => { const error = new Error('busy') as Error & { code?: string }; error.code = 'EACCES'; throw error }
    expect(tryRemove('/somewhere/dsh-web-tray', (message: string) => { spoken.push(message) }, refuses)).toBe(false)
    expect(spoken.join(' ')).toContain('EACCES')
    // And a working remover still reports success, quietly.
    expect(tryRemove('/somewhere/gone', undefined, () => {})).toBe(true)
  })

  it('keeps the install list and the owned list straight', () => {
    // status must not call a healthy install incomplete because the tray has not written its
    // run-time files yet; uninstall must still remove them when they exist.
    expect(INSTALLED_FILES).toContain('dsh-web-tray.ps1')
    expect(INSTALLED_FILES).toContain('tray.env')
    for (const runtimeOnly of ['start.log', 'tray.log', 'tray-selftest.json', 'tray-shortcut.json']) {
      expect(INSTALLED_FILES).not.toContain(runtimeOnly)
      expect(OWNED_FILES).toContain(runtimeOnly)
    }
    for (const name of INSTALLED_FILES) expect(OWNED_FILES).toContain(name)
  })

  it('leaves a file it does not own alone', async () => {
    const layout = await fakeLayout('me')
    const target = join(tmp, 'leftovers')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'notes.txt'), 'mine', 'utf8')
    expect(existsSync(join(target, 'notes.txt'))).toBe(true)
    expect(OWNED_FILES).not.toContain('notes.txt')
  })
})
