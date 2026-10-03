/**
 * The WSL desktop/tray launcher service: writes the four generated artifacts
 * (icon, Windows tray helper, WSL start script, WSL stop script) and creates
 * the desktop shortcut through a single PowerShell `-Regenerate` run.
 */
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { DEFAULT_SHORTCUT_NAME, DEFAULT_WEB_URL, ICON_FILE_NAME, START_LOG_NAME, START_SCRIPT_NAME, STOP_SCRIPT_NAME, TRAY_LOG_NAME, TRAY_SCRIPT_NAME, TRAY_STATUS_NAME, TRAY_VBS_NAME, WIN_DIR_REL, WSL_DIR_NAME, buildStartScript, buildStopScript, buildTrayScript, buildTrayVbs, } from "./artifacts.js";
import { DEFAULT_TRAY_CONFIG, TRAY_CONFIG_NAME, normalizeTrayConfig, patchTrayConfig, } from "./config.js";
import { distroName, isWsl, runWindowsPowerShell, windowsDesktopWslPath, windowsUserProfileWslPathResolved, } from "./windows.js";
/** Convert a WSL `/mnt/c/...` path to the Windows `C:\...` form. */
export function wslPathToWindowsPath(path) {
    const match = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(path);
    if (match !== null)
        return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
    return path.replace(/\//g, '\\');
}
/** The DSH web URL for a bound webserver host/port. */
export function webUrlFor(webServer) {
    const host = webServer.host === '0.0.0.0' ? '127.0.0.1' : webServer.host;
    return `http://${host}:${webServer.port}`;
}
/** Locate this package's bundled icon bytes. */
async function readIconBytes() {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidate = join(here, '..', 'assets', ICON_FILE_NAME);
    try {
        return await readFile(candidate);
    }
    catch {
        return null;
    }
}
/** The WSL-side directory holding the generated start script. */
export function wslAppDir() {
    return join(homedir(), '.dsh', WSL_DIR_NAME);
}
/** Uptime and RSS of one PID, read from /proc (no extra process spawned). */
function readProcInfo(pid) {
    try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        // The comm field may contain spaces, so slice past the last ')'.
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        const startTicks = Number(fields[19]);
        const uptime = Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
        // CLK_TCK is 100 on every platform this plugin supports; hard-coded to
        // avoid spawning getconf on every status poll.
        const uptimeSec = Number.isFinite(startTicks) && Number.isFinite(uptime)
            ? Math.max(0, Math.round(uptime - startTicks / 100))
            : null;
        let rssMb = null;
        const status = readFileSync(`/proc/${pid}/status`, 'utf8');
        const match = /VmRSS:\s+(\d+)\s+kB/.exec(status);
        if (match !== null)
            rssMb = Math.round(Number(match[1]) / 1024);
        return { uptimeSec, rssMb };
    }
    catch {
        return { uptimeSec: null, rssMb: null };
    }
}
/**
 * Find the DSH web process: the generated PID file first (written by start.sh
 * before exec, so it tracks the final process), then a /proc scan for a
 * `... web` command line when DSH was started by hand.
 */
export function findDshProcess() {
    const candidates = [];
    try {
        const pid = Number(readFileSync(join(wslAppDir(), 'dsh.pid'), 'utf8').trim());
        if (Number.isInteger(pid) && pid > 0)
            candidates.push(pid);
    }
    catch {
        // No PID file: fall through to the scan.
    }
    if (candidates.length === 0) {
        try {
            for (const name of readdirSync('/proc')) {
                if (!/^\d+$/.test(name))
                    continue;
                try {
                    const cmd = readFileSync(join('/proc', name, 'cmdline'), 'utf8');
                    if (cmd.includes('dsh') && /(?:^|\0)[^\0]*\bweb(?:\0|$)/.test(cmd) && !cmd.includes('dsh-web-tray')) {
                        candidates.push(Number(name));
                    }
                }
                catch {
                    // Kernel threads have no cmdline; other users' processes deny it.
                }
            }
        }
        catch {
            // /proc itself is unreadable: report not-running below.
        }
    }
    for (const pid of candidates) {
        try {
            process.kill(pid, 0);
        }
        catch {
            continue;
        }
        const { uptimeSec, rssMb } = readProcInfo(pid);
        return { running: true, pid, uptimeSec, rssMb };
    }
    return { running: false, pid: null, uptimeSec: null, rssMb: null };
}
/**
 * The token URL of the current DSH run, from the start script's log. The token
 * is per-process, so only the newest line counts; without it the browser lands
 * on a 401 page.
 */
export async function readWebAuthUrl() {
    try {
        const raw = await readFile(join(wslAppDir(), START_LOG_NAME), 'utf8');
        const tail = raw.split(/\r?\n/).slice(-200);
        for (let index = tail.length - 1; index >= 0; index--) {
            const match = /http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/.exec(tail[index]);
            if (match !== null)
                return match[0];
        }
    }
    catch {
        // No log yet (DSH was never started by the tray).
    }
    return null;
}
/** `<checkout>/apps/cli/lib/bin.js`, also accepting a configured `apps/cli` dir. */
function checkoutBuildCli(configured) {
    for (const candidate of [
        join(configured, 'apps', 'cli', 'lib', 'bin.js'),
        join(configured, 'lib', 'bin.js'),
    ]) {
        if (existsSync(candidate))
            return candidate;
    }
    return null;
}
/** The checkout root for a configured path (the root itself or its apps/cli). */
function checkoutRoot(configured) {
    return configured.endsWith(join('apps', 'cli')) ? dirname(dirname(configured)) : configured;
}
/**
 * True for an argv[1] that lives in a checkout's `src` tree. Such an entry is
 * started through tsx and would put a src instance and a lib instance of the
 * same packages in one process, which is exactly the mixed-loading failure
 * this plugin avoids; it is never baked in as a launcher.
 */
function isSourceEntry(path) {
    return /[\\/]apps[\\/]cli[\\/]src[\\/]/.test(path) || /\.(?:ts|tsx|mts|cts)$/.test(path);
}
/**
 * Newest `.ts` mtime under a directory, or 0 when it cannot be read. The walk
 * is depth-bounded and only ever runs over one small subtree, because it feeds
 * artifact generation and must not become a repository-wide scan.
 */
function newestSourceMtime(dir, depth = 8) {
    let newest = 0;
    const walk = (current, level) => {
        if (level > depth)
            return;
        let names;
        try {
            names = readdirSync(current);
        }
        catch {
            return;
        }
        for (const name of names) {
            const full = join(current, name);
            let stats;
            try {
                stats = statSync(full);
            }
            catch {
                // A file that vanished mid-walk is not a freshness signal.
                continue;
            }
            if (stats.isDirectory()) {
                walk(full, level + 1);
            }
            else if (stats.isFile() && /\.tsx?$/.test(name)) {
                newest = Math.max(newest, stats.mtimeMs);
            }
        }
    };
    walk(dir, 0);
    return newest;
}
/** Classify a build output as current or older than the cli sources. */
function sourceBuildStateOf(cli) {
    try {
        const appDir = dirname(dirname(cli));
        return newestSourceMtime(join(appDir, 'src')) > statSync(cli).mtimeMs ? 'stale' : 'built';
    }
    catch {
        return 'built';
    }
}
/** Whether an executable `dsh` is on PATH (what start.sh tries first). */
function dshOnPath() {
    for (const entry of (process.env.PATH ?? '').split(':')) {
        if (entry === '')
            continue;
        if (existsSync(join(entry, 'dsh')))
            return true;
    }
    return false;
}
/**
 * Derive DSH launch candidates from the running host process.
 *
 * A configured project path wins: the generated start.sh then launches that
 * checkout's BUILD OUTPUT and fails loudly instead of falling back to another
 * install. Without a configured path, the order stays
 * 1. `dsh` on PATH (global npm / pnpm / binary installs);
 * 2. the checkout build output (`<project>/apps/cli/lib/bin.js`, defaulting to
 *    `~/deepseek-harness`);
 * 3. the current process argv[1] when it is a real JS CLI (npm global or npx
 *    cache while it lasts);
 * 4. `npx --yes dsh` as the final self-healing fallback.
 *
 * Only paths that exist NOW are baked in; runtime fallbacks cover later moves.
 * `src` entries (tsx) are never baked in: the runtime resolution mode loads
 * plugins from lib, so a src host mixes two instances of the same packages.
 */
function resolveStartCommand(projectPath) {
    const nodeBin = process.execPath;
    const configured = (projectPath ?? '').trim();
    const configuredExists = configured !== '' && existsSync(configured);
    const configuredBuild = configuredExists ? checkoutBuildCli(configured) : null;
    const defaultRoot = join(homedir(), 'deepseek-harness');
    const defaultBuild = configuredBuild === null && existsSync(defaultRoot) ? checkoutBuildCli(defaultRoot) : null;
    const sourceCli = configuredBuild ?? defaultBuild;
    const sourceCwd = sourceCli !== null
        ? dirname(dirname(dirname(dirname(sourceCli))))
        : configuredExists
            ? checkoutRoot(configured)
            : existsSync(defaultRoot)
                ? defaultRoot
                : null;
    const sourceBuildState = sourceCli !== null
        ? sourceBuildStateOf(sourceCli)
        : sourceCwd === null
            ? 'none'
            : 'missing';
    const argv1 = process.argv[1];
    let bakedCli = null;
    if (argv1 !== undefined
        && argv1 !== sourceCli
        && !isSourceEntry(argv1)
        && /\.(?:js|mjs|cjs)$/.test(argv1)
        && existsSync(argv1)) {
        bakedCli = argv1;
    }
    return {
        nodeBin,
        sourceCli,
        sourceCwd,
        bakedCli,
        sourceConfigured: configuredExists,
        pathCli: dshOnPath(),
        sourceBuildState,
    };
}
/**
 * The configured project path itself is unusable, so no artifact should be
 * generated from it (an existing good start script is left alone).
 */
export function configuredPathProblem(configuredPath) {
    const trimmed = configuredPath.trim();
    if (trimmed === '' || existsSync(trimmed))
        return null;
    return `the configured project path does not exist: ${trimmed}`;
}
/**
 * The checkout exists but was never built. The generated script is still
 * correct — it refuses to launch src and names the fix — so this is reported
 * as a result, not as a failure to generate.
 */
export function sourceBuildProblem(launch) {
    if (!launch.sourceConfigured || launch.sourceBuildState !== 'missing')
        return null;
    const root = launch.sourceCwd ?? 'the checkout';
    return `the configured source checkout has no build output (${join(root, 'apps', 'cli', 'lib', 'bin.js')} is missing): run "pnpm run build" in ${root} first — a checkout must launch from its build output, because a src host loads plugin packages from lib and mixes two instances of the same packages`;
}
/** A non-blocking freshness note for the regenerate result, or null. */
function launchNotice(launch) {
    return launch.sourceBuildState === 'stale'
        ? 'the checkout sources are newer than its build output; run "pnpm run build" to refresh it'
        : null;
}
/**
 * Owns the generated files and the shortcut lifecycle for one plugin mount.
 * All Windows process launches are fenced by the helpers in windows.ts.
 */
export class TrayService {
    ctx;
    webServer;
    shortcutName;
    cachedDesktopDir;
    cachedWindowsDir;
    projectPath;
    constructor(ctx, webServer, shortcutName = DEFAULT_SHORTCUT_NAME) {
        this.ctx = ctx;
        this.webServer = webServer;
        this.shortcutName = shortcutName;
        this.projectPath = this.readProjectPathFromDisk();
    }
    /** Read the persisted source-project path, defaulting to empty (auto-detect). */
    readProjectPathFromDisk() {
        try {
            const parsed = JSON.parse(readFileSync(join(wslAppDir(), 'project-path.json'), 'utf8'));
            if (parsed !== null && typeof parsed === 'object' && typeof parsed.projectPath === 'string') {
                return parsed.projectPath;
            }
        }
        catch {
            // Missing or malformed file is the empty default.
        }
        return '';
    }
    /** The currently configured source-project path (empty = auto-detect). */
    getProjectPath() {
        return this.projectPath;
    }
    /** Persist the configured source-project path and keep it live for generation. */
    async setProjectPath(value) {
        this.projectPath = value.trim();
        await mkdir(wslAppDir(), { recursive: true });
        await writeFile(join(wslAppDir(), 'project-path.json'), JSON.stringify({ projectPath: this.projectPath }), 'utf8');
    }
    /**
     * The Windows-side directory holding the icon, the tray script and the
     * switches. Resolved once per mount, and authoritatively: with
     * `appendWindowsPath = false` PATH has no Windows directory, so the scan
     * fallback would pick the wrong user and every write would fail.
     */
    async windowsAppDir() {
        if (this.cachedWindowsDir !== undefined)
            return this.cachedWindowsDir;
        const profile = await windowsUserProfileWslPathResolved();
        this.cachedWindowsDir = profile === null ? null : join(profile, ...WIN_DIR_REL.split('/'));
        return this.cachedWindowsDir;
    }
    /** Resolve the desktop once per mount; PowerShell is authoritative. */
    async desktopDir() {
        if (this.cachedDesktopDir !== undefined)
            return this.cachedDesktopDir;
        this.cachedDesktopDir = await windowsDesktopWslPath();
        return this.cachedDesktopDir;
    }
    /** Windows-side path of tray-config.json, or null when the profile is unknown. */
    async configPath() {
        const trayDir = await this.windowsAppDir();
        return trayDir === null ? null : join(trayDir, TRAY_CONFIG_NAME);
    }
    /**
     * Read the switches in force. The file is written by both the tray menu and
     * this service, so it is re-read rather than cached; a missing file means the
     * built-in defaults, an unparsable one reports `last-good` and keeps them.
     */
    async readConfigFile() {
        const path = await this.configPath();
        if (path === null)
            return { config: DEFAULT_TRAY_CONFIG, source: 'defaults', path, errors: [] };
        let raw;
        try {
            raw = await readFile(path, 'utf8');
        }
        catch {
            return { config: DEFAULT_TRAY_CONFIG, source: 'defaults', path, errors: [] };
        }
        let parsed;
        try {
            parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
        }
        catch (error) {
            return {
                config: DEFAULT_TRAY_CONFIG,
                source: 'last-good',
                path,
                errors: [`tray-config.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
            };
        }
        const { config, errors } = normalizeTrayConfig(parsed);
        return { config, source: 'file', path, errors };
    }
    /** Apply a partial patch and persist it atomically; returns the config in force. */
    async writeConfig(patch) {
        const current = await this.readConfigFile();
        const { config, errors } = patchTrayConfig(current.config, patch);
        const path = current.path;
        if (path === null) {
            return {
                config,
                source: current.source,
                path,
                errors: [...errors, 'cannot determine the Windows user profile, so the switches were not saved'],
            };
        }
        try {
            await mkdir(dirname(path), { recursive: true });
            const temporary = `${path}.tmp`;
            await writeFile(temporary, JSON.stringify(config, null, 2), 'utf8');
            await rename(temporary, path);
        }
        catch (error) {
            return {
                config,
                source: current.source,
                path,
                errors: [...errors, `could not write tray-config.json: ${error instanceof Error ? error.message : String(error)}`],
            };
        }
        return { config, source: 'file', path, errors };
    }
    /** Write the defaults when the file is absent, so the tray and the card agree. */
    async ensureConfig() {
        const path = await this.configPath();
        if (path === null || existsSync(path))
            return;
        try {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify(DEFAULT_TRAY_CONFIG, null, 2), 'utf8');
        }
        catch {
            // The tray falls back to its baked defaults, so this is not fatal.
        }
    }
    /** Read the current on-disk facts. */
    async status() {
        const platform = isWsl() ? 'wsl' : 'unsupported';
        const desktopDir = await this.desktopDir();
        const windowsProfileDir = await windowsUserProfileWslPathResolved();
        const trayDir = await this.windowsAppDir();
        const startScriptPath = join(wslAppDir(), START_SCRIPT_NAME);
        const stopScriptPath = join(wslAppDir(), STOP_SCRIPT_NAME);
        const shortcutPath = desktopDir === null ? null : join(desktopDir, `${this.shortcutName}.lnk`);
        const configInfo = await this.readConfigFile();
        return {
            ok: true,
            platform,
            distro: distroName(),
            webUrl: platform === 'wsl' ? webUrlFor(this.webServer) : DEFAULT_WEB_URL,
            webAuthUrl: await readWebAuthUrl(),
            shortcutName: this.shortcutName,
            windowsProfileDir,
            desktopDir,
            files: {
                shortcutPath,
                shortcutExists: shortcutPath !== null && existsSync(shortcutPath),
                trayDir,
                trayScriptExists: trayDir !== null && existsSync(join(trayDir, TRAY_SCRIPT_NAME)),
                trayVbsExists: trayDir !== null && existsSync(join(trayDir, TRAY_VBS_NAME)),
                iconExists: trayDir !== null && existsSync(join(trayDir, ICON_FILE_NAME)),
                startScriptPath,
                startScriptExists: existsSync(startScriptPath),
                stopScriptExists: existsSync(stopScriptPath),
                configPath: configInfo.path,
                configExists: configInfo.path !== null && existsSync(configInfo.path),
            },
            config: configInfo.config,
            configSource: configInfo.source,
            dsh: findDshProcess(),
            tray: await this.trayStatus(),
        };
    }
    /** Read the last state the Windows tray wrote (null before its first tick). */
    async trayStatus() {
        const trayDir = await this.windowsAppDir();
        if (trayDir === null)
            return null;
        try {
            const raw = await readFile(join(trayDir, TRAY_STATUS_NAME), 'utf8');
            const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
            return parsed !== null && typeof parsed === 'object' ? parsed : null;
        }
        catch {
            return null;
        }
    }
    /** Return the last `maxLines` lines of the tray's watchdog log ('' when absent). */
    async watchdogLog(maxLines = 200) {
        const trayDir = await this.windowsAppDir();
        if (trayDir === null)
            return { log: '' };
        try {
            const raw = await readFile(join(trayDir, TRAY_LOG_NAME), 'utf8');
            const text = raw.replace(/^\uFEFF/, '');
            const lines = text.split(/\r?\n/).filter(line => line !== '');
            const capped = Math.max(1, Math.min(Math.floor(maxLines), 2000));
            return { log: lines.slice(-capped).join('\n') };
        }
        catch {
            return { log: '' };
        }
    }
    /**
     * Build the text artifacts for the current host facts, plus the launch plan
     * they were derived from. Null when no launcher can be located at all
     * (regenerate reports that as an error).
     */
    currentScripts() {
        const cli = resolveStartCommand(this.projectPath);
        // A configured checkout with no build output still gets a script: it
        // refuses to launch src and names the fix, so it starts working the moment
        // the user runs the build.
        if (cli.sourceCli === null && cli.bakedCli === null && !cli.sourceConfigured && !cli.pathCli)
            return null;
        const config = {
            distro: distroName(),
            webUrl: webUrlFor(this.webServer),
            shortcutName: this.shortcutName,
            wslStartScript: `~/.dsh/${WSL_DIR_NAME}/${START_SCRIPT_NAME}`,
            wslStopScript: `~/.dsh/${WSL_DIR_NAME}/${STOP_SCRIPT_NAME}`,
            wslStartLogPath: join(wslAppDir(), START_LOG_NAME),
        };
        return {
            startScript: buildStartScript({
                nodeBin: cli.nodeBin,
                sourceCli: cli.sourceCli,
                sourceCwd: cli.sourceCwd,
                bakedCli: cli.bakedCli,
                sourceConfigured: cli.sourceConfigured,
                webUrl: config.webUrl,
            }),
            stopScript: buildStopScript(),
            trayScript: buildTrayScript(config, DEFAULT_TRAY_CONFIG),
            trayVbs: buildTrayVbs(),
            launch: cli,
        };
    }
    /**
     * Ensure the five generated files exist AND match the current host facts
     * (web URL, CLI path, shortcut name). A stale start script from another
     * port/profile is a real failure mode, so compare content, not presence.
     */
    async ensure() {
        const base = await this.status();
        await this.ensureConfig();
        const filesExist = base.files.shortcutExists
            && base.files.trayScriptExists
            && base.files.trayVbsExists
            && base.files.iconExists
            && base.files.startScriptExists;
        if (!filesExist)
            return this.regenerate();
        const current = this.currentScripts();
        if (current === null)
            return base;
        const stopScriptPath = join(wslAppDir(), STOP_SCRIPT_NAME);
        try {
            const startMatches = await readFile(base.files.startScriptPath, 'utf8') === current.startScript;
            if (!startMatches)
                return this.regenerate();
            const stopMatches = await readFile(stopScriptPath, 'utf8') === current.stopScript;
            if (!stopMatches)
                return this.regenerate();
            if (base.files.trayDir !== null) {
                const trayPath = join(base.files.trayDir, TRAY_SCRIPT_NAME);
                // The file is written with a UTF-8 BOM for Windows PowerShell 5.1.
                const trayMatches = await readFile(trayPath, 'utf8').then(text => text.replace(/^\uFEFF/, '') === current.trayScript);
                if (!trayMatches)
                    return this.regenerate();
                const vbsPath = join(base.files.trayDir, TRAY_VBS_NAME);
                const vbsMatches = await readFile(vbsPath, 'utf8') === current.trayVbs;
                if (!vbsMatches)
                    return this.regenerate();
            }
            return base;
        }
        catch {
            return this.regenerate();
        }
    }
    /** Write all artifacts and create/refresh the desktop shortcut. */
    async regenerate() {
        const base = await this.status();
        if (base.platform !== 'wsl') {
            return {
                ...base,
                ok: false,
                lastError: 'dsh-web-tray only runs inside WSL; Windows desktop integration is unavailable here',
            };
        }
        const trayDir = await this.windowsAppDir();
        if (trayDir === null) {
            return {
                ...base,
                ok: false,
                lastError: 'cannot determine the Windows user profile from the WSL environment (no /mnt/<drive>/Users/<name> in PATH)',
            };
        }
        const pathProblem = configuredPathProblem(this.projectPath);
        if (pathProblem !== null) {
            return { ...base, ok: false, lastError: pathProblem };
        }
        const icon = await readIconBytes();
        if (icon === null) {
            return {
                ...base,
                ok: false,
                lastError: 'the bundled dsh-web-tray.ico asset is missing from the installed package',
            };
        }
        const wslStartDir = wslAppDir();
        const scripts = this.currentScripts();
        if (scripts === null) {
            return {
                ...base,
                ok: false,
                lastError: 'cannot locate a DSH launcher: no `dsh` on PATH, process.argv[1] is not a JS file, no built source checkout was found, and no project path is configured',
            };
        }
        try {
            await mkdir(trayDir, { recursive: true });
            await mkdir(wslStartDir, { recursive: true });
            // Write the stop script FIRST: the tray helper it is about to (re)create
            // and the watchdog both stop DSH through it.
            await writeFile(join(trayDir, ICON_FILE_NAME), icon);
            await writeFile(join(trayDir, TRAY_SCRIPT_NAME), '\uFEFF' + scripts.trayScript, 'utf8');
            await writeFile(join(trayDir, TRAY_VBS_NAME), scripts.trayVbs, 'utf8');
            await writeFile(join(wslStartDir, START_SCRIPT_NAME), scripts.startScript, 'utf8');
            await chmod(join(wslStartDir, START_SCRIPT_NAME), 0o755);
            await writeFile(join(wslStartDir, STOP_SCRIPT_NAME), scripts.stopScript, 'utf8');
            await chmod(join(wslStartDir, STOP_SCRIPT_NAME), 0o755);
            const trayScriptWindowsPath = wslPathToWindowsPath(join(trayDir, TRAY_SCRIPT_NAME));
            const result = await runWindowsPowerShell(['-File', trayScriptWindowsPath, '-Regenerate'], undefined, 30000);
            if (result.code !== 0 || result.timedOut) {
                return {
                    ...(await this.status()),
                    ok: false,
                    lastError: result.timedOut
                        ? 'timed out while Windows created the shortcut (PowerShell interop did not answer)'
                        : `PowerShell failed to create the shortcut: ${result.stderr.trim() || result.stdout.trim() || `exit ${String(result.code)}`}`,
                };
            }
            const refreshed = await this.status();
            // The script is correct and self-healing, so a missing build output is
            // reported as an actionable result rather than as a write failure.
            const buildProblem = sourceBuildProblem(scripts.launch);
            if (buildProblem !== null) {
                return { ...refreshed, ok: false, lastError: buildProblem };
            }
            const notice = launchNotice(scripts.launch);
            const lastResult = [result.stdout.trim() || (refreshed.files.shortcutPath ?? 'shortcut created'), notice]
                .filter(part => part !== null && part !== '')
                .join('; ');
            return { ...refreshed, ok: refreshed.files.shortcutExists, lastResult };
        }
        catch (error) {
            this.ctx.logger?.warn(`[dsh-web-tray] regenerate failed: ${error instanceof Error ? error.message : String(error)}`);
            return {
                ...(await this.status()),
                ok: false,
                lastError: error instanceof Error ? error.message : String(error),
            };
        }
    }
}
