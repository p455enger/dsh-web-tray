/**
 * windows/start.sh, run for real. Its "is DSH already up" decision is what started a second
 * instance on an occupied port and threw away the running instance's token line, so the three
 * cases are pinned here: an instance answering 401 (up, waiting for a cookie), nothing
 * listening at all, and a workspace that does not exist. The launcher is pointed at `touch`
 * instead of DSH, so the test only observes whether it decided to start something.
 *
 * The 401 responder runs in its own process on purpose: the script is started with
 * execFileSync, which blocks this process's event loop, and an in-process HTTP server could
 * never answer it — the child's curl would time out and the probe would look "down".
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const START_SH = fileURLToPath(new URL('../windows/start.sh', import.meta.url))

/** The script needs bash; it can fall back on /dev/tcp when no downloader exists. */
const canRun = ((): boolean => {
  try {
    execFileSync('bash', ['-c', 'exit 0'], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
})()

let root = ''
let marker = ''
const responders: ChildProcess[] = []

beforeAll(() => {
  if (!canRun) return
  root = mkdtempSync(join(tmpdir(), 'dsh-web-tray-start-'))
  marker = join(root, 'launched')
})

afterAll(() => {
  for (const responder of responders) responder.kill('SIGKILL')
  if (root !== '') rmSync(root, { recursive: true, force: true })
})

/** A free port: bound, read, released. */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(done => { server.listen(0, '127.0.0.1', done) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port was assigned')
  await new Promise<void>(done => { server.close(() => { done() }) })
  return address.port
}

/** A separate process that answers every request with one status code. */
async function responder(status: number): Promise<string> {
  const port = await freePort()
  const script = 'const [port, status] = process.argv.slice(1);'
    + 'require("http").createServer((q, s) => { s.statusCode = Number(status); s.end("no") }).listen(Number(port), "127.0.0.1")'
  const child = spawn(process.execPath, ['-e', script, String(port), String(status)], { stdio: 'ignore' })
  responders.push(child)
  const url = `http://127.0.0.1:${String(port)}`
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      await fetch(url)
      return url
    } catch {
      if (Date.now() > deadline) throw new Error(`the ${String(status)} responder never came up on ${url}`)
      await new Promise(done => setTimeout(done, 100))
    }
  }
}

/** An install-like directory whose launcher records that it decided to start something. */
function installDir(name: string, url: string, workspace: string, log?: string): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  copyFileSync(START_SH, join(dir, 'start.sh'))
  writeFileSync(join(dir, 'tray.env'), [
    `WEB_URL='${url}'`,
    `WORKSPACE='${workspace}'`,
    `DSH_COMMAND='touch ${marker}'`,
    '',
  ].join('\n'), 'utf8')
  if (log !== undefined) writeFileSync(join(dir, 'start.log'), log, 'utf8')
  return dir
}

/**
 * Exit status of running the script. Every case ends on its own: an instance that is up makes
 * it exit, a missing workspace makes it exit, and DSH_COMMAND is `touch` rather than DSH.
 */
function run(dir: string): number {
  try {
    execFileSync('bash', [join(dir, 'start.sh')], { timeout: 30_000, stdio: 'ignore' })
    return 0
  } catch (error) {
    return (error as { status?: number }).status ?? -1
  }
}

describe.runIf(canRun)('start.sh liveness', () => {
  it('treats a 401 as a running instance and keeps its token line', async () => {
    const url = await responder(401)
    const kept = '2026-01-01 00:00:00 launching: dsh web --no-open\n'
      + `2026-01-01 00:00:01 dsh web: ${url}/?token=keepme\n`
    const dir = installDir('unauthorised', url, root, kept)
    rmSync(marker, { force: true })

    expect(run(dir)).toBe(0)
    // Nothing was started, and the token of the instance that is up is still there: this is
    // the bug that made the window open on a 401 sign-in page instead of the app.
    expect(existsSync(marker)).toBe(false)
    expect(readFileSync(join(dir, 'start.log'), 'utf8')).toBe(kept)
  }, 60_000)

  it('starts DSH when nothing answers, and logs that launch', async () => {
    const url = `http://127.0.0.1:${String(await freePort())}`
    const dir = installDir('down', url, root)
    rmSync(marker, { force: true })

    expect(run(dir)).toBe(0)
    expect(existsSync(marker)).toBe(true)
    expect(readFileSync(join(dir, 'start.log'), 'utf8')).toContain('launching:')
  }, 60_000)

  it('refuses a workspace that does not exist without losing the log first', async () => {
    const url = `http://127.0.0.1:${String(await freePort())}`
    const kept = '2026-01-01 00:00:00 dsh web: http://127.0.0.1:3080/?token=keepme\n'
    const dir = installDir('bad-workspace', url, join(root, 'nowhere'), kept)
    rmSync(marker, { force: true })

    expect(run(dir)).toBe(1)
    expect(existsSync(marker)).toBe(false)
    // The failure is appended, and the running instance's token line survives: a launch that
    // fails must not truncate the log the tray reads the token from.
    const log = readFileSync(join(dir, 'start.log'), 'utf8')
    expect(log).toContain(kept.trimEnd())
    expect(log).toContain('ERROR workspace does not exist')
    expect(log).not.toContain('launching:')
  }, 60_000)
})
