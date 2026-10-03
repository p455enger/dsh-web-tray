/**
 * The WSL desktop/tray launcher service: writes the four generated artifacts
 * (icon, Windows tray helper, WSL start script, WSL stop script) and creates
 * the desktop shortcut through a single PowerShell `-Regenerate` run.
 */
import { type TrayConfig } from './config.ts';
/** Which deployment this host serves. Windows-native is a later phase. */
export type TrayPlatform = 'wsl' | 'win' | 'unsupported';
/** Where the switches are stored, as reported to the card. */
export type ConfigSource = 'file' | 'last-good' | 'defaults';
/** Stable wire shape shared by the status and regenerate routes. */
export interface TrayStatus {
    ok: boolean;
    platform: TrayPlatform;
    distro: string;
    webUrl: string;
    /** Token URL of the running DSH, read from the start script's log. */
    webAuthUrl: string | null;
    shortcutName: string;
    windowsProfileDir: string | null;
    desktopDir: string | null;
    files: {
        shortcutPath: string | null;
        shortcutExists: boolean;
        trayDir: string | null;
        trayScriptExists: boolean;
        trayVbsExists: boolean;
        iconExists: boolean;
        startScriptPath: string;
        startScriptExists: boolean;
        stopScriptExists: boolean;
        configPath: string | null;
        configExists: boolean;
    };
    config: TrayConfig;
    configSource: ConfigSource;
    /** The DSH instance as the host sees it (authoritative pid/uptime). */
    dsh: {
        running: boolean;
        pid: number | null;
        uptimeSec: number | null;
        rssMb: number | null;
    };
    /** The last state the Windows tray wrote, or null before its first tick. */
    tray: TrayStatusFile | null;
    lastError?: string;
    lastResult?: string;
}
/** The webserver face the service reads for the current URL. */
export interface WebServerLike {
    readonly host: string;
    readonly port: number;
}
/**
 * The state the Windows tray rewrites as tray-status.json on every tick. The
 * host only reads it; the tray owns the state machine and the switch reader.
 */
export interface TrayStatusFile {
    updatedAt?: string;
    platform?: string;
    /** starting | probing | restarting | backoff | paused | stopped */
    phase?: string;
    configSource?: string;
    switches?: {
        autoStart?: boolean;
        autoStopOnExit?: boolean;
        autoStopIdleMinutes?: number;
        watchdogEnabled?: boolean;
    };
    probe?: {
        ok?: boolean;
        detail?: string;
        latencyMs?: number;
        failures?: number;
        downThreshold?: number;
    };
    restarts?: {
        count?: number;
        failures?: number;
        maxFailures?: number;
        lastAt?: string | null;
        lastOk?: boolean | null;
    };
    idle?: {
        connections?: number | null;
        idleSeconds?: number;
        thresholdMinutes?: number;
        sampledAt?: string | null;
    };
    dsh?: {
        running?: boolean;
        lastAliveAt?: string | null;
    };
    actions?: Array<{
        at?: string;
        action?: string;
        ok?: boolean;
        detail?: string;
    }>;
    lastError?: string | null;
}
/** Tail of the tray's tray.log. */
export interface WatchdogLogResult {
    log: string;
}
/** The context face this service needs. */
export interface TrayServiceContext {
    readonly logger?: {
        warn(message: string): void;
        info(message: string): void;
    };
}
/** Convert a WSL `/mnt/c/...` path to the Windows `C:\...` form. */
export declare function wslPathToWindowsPath(path: string): string;
/** The DSH web URL for a bound webserver host/port. */
export declare function webUrlFor(webServer: WebServerLike): string;
/** The WSL-side directory holding the generated start script. */
export declare function wslAppDir(): string;
/** The DSH instance as the host sees it; the tray only knows whether the URL answers. */
export interface DshProcessInfo {
    running: boolean;
    pid: number | null;
    uptimeSec: number | null;
    rssMb: number | null;
}
/**
 * Find the DSH web process: the generated PID file first (written by start.sh
 * before exec, so it tracks the final process), then a /proc scan for a
 * `... web` command line when DSH was started by hand.
 */
export declare function findDshProcess(): DshProcessInfo;
/**
 * The token URL of the current DSH run, from the start script's log. The token
 * is per-process, so only the newest line counts; without it the browser lands
 * on a 401 page.
 */
export declare function readWebAuthUrl(): Promise<string | null>;
/**
 * How the checkout's build output looks right now.
 *
 * `built` and `stale` both have a runnable `apps/cli/lib/bin.js`; `missing`
 * means the checkout exists but was never built; `none` means no checkout is
 * known at all.
 */
export type SourceBuildState = 'built' | 'stale' | 'missing' | 'none';
/** The launch facts the generated start script is built from. */
export interface StartCommand {
    nodeBin: string;
    /** The checkout's BUILD OUTPUT cli — never a `src` entry (see below). */
    sourceCli: string | null;
    /** The checkout root the launcher cd's into. */
    sourceCwd: string | null;
    /** The running host's own JS cli, used when no checkout is usable. */
    bakedCli: string | null;
    /** True when the project path came from the user, not from auto-detection. */
    sourceConfigured: boolean;
    /**
     * Whether a `dsh` executable sits on PATH. The generated start script tries
     * `command -v dsh` FIRST, so a PATH install is a complete launcher on its
     * own; without this fact the guard below would refuse to generate anything
     * on a plain global install whose argv[1] is the extensionless shim.
     */
    pathCli: boolean;
    /** Whether that checkout currently has a usable build output. */
    sourceBuildState: SourceBuildState;
}
/**
 * The configured project path itself is unusable, so no artifact should be
 * generated from it (an existing good start script is left alone).
 */
export declare function configuredPathProblem(configuredPath: string): string | null;
/**
 * The checkout exists but was never built. The generated script is still
 * correct — it refuses to launch src and names the fix — so this is reported
 * as a result, not as a failure to generate.
 */
export declare function sourceBuildProblem(launch: StartCommand): string | null;
/**
 * Owns the generated files and the shortcut lifecycle for one plugin mount.
 * All Windows process launches are fenced by the helpers in windows.ts.
 */
export declare class TrayService {
    private readonly ctx;
    private readonly webServer;
    private readonly shortcutName;
    private cachedDesktopDir;
    private cachedWindowsDir;
    private projectPath;
    constructor(ctx: TrayServiceContext, webServer: WebServerLike, shortcutName?: string);
    /** Read the persisted source-project path, defaulting to empty (auto-detect). */
    private readProjectPathFromDisk;
    /** The currently configured source-project path (empty = auto-detect). */
    getProjectPath(): string;
    /** Persist the configured source-project path and keep it live for generation. */
    setProjectPath(value: string): Promise<void>;
    /**
     * The Windows-side directory holding the icon, the tray script and the
     * switches. Resolved once per mount, and authoritatively: with
     * `appendWindowsPath = false` PATH has no Windows directory, so the scan
     * fallback would pick the wrong user and every write would fail.
     */
    private windowsAppDir;
    /** Resolve the desktop once per mount; PowerShell is authoritative. */
    desktopDir(): Promise<string | null>;
    /** Windows-side path of tray-config.json, or null when the profile is unknown. */
    private configPath;
    /**
     * Read the switches in force. The file is written by both the tray menu and
     * this service, so it is re-read rather than cached; a missing file means the
     * built-in defaults, an unparsable one reports `last-good` and keeps them.
     */
    readConfigFile(): Promise<{
        config: TrayConfig;
        source: ConfigSource;
        path: string | null;
        errors: string[];
    }>;
    /** Apply a partial patch and persist it atomically; returns the config in force. */
    writeConfig(patch: unknown): Promise<{
        config: TrayConfig;
        source: ConfigSource;
        path: string | null;
        errors: string[];
    }>;
    /** Write the defaults when the file is absent, so the tray and the card agree. */
    ensureConfig(): Promise<void>;
    /** Read the current on-disk facts. */
    status(): Promise<TrayStatus>;
    /** Read the last state the Windows tray wrote (null before its first tick). */
    trayStatus(): Promise<TrayStatusFile | null>;
    /** Return the last `maxLines` lines of the tray's watchdog log ('' when absent). */
    watchdogLog(maxLines?: number): Promise<WatchdogLogResult>;
    /**
     * Build the text artifacts for the current host facts, plus the launch plan
     * they were derived from. Null when no launcher can be located at all
     * (regenerate reports that as an error).
     */
    private currentScripts;
    /**
     * Ensure the five generated files exist AND match the current host facts
     * (web URL, CLI path, shortcut name). A stale start script from another
     * port/profile is a real failure mode, so compare content, not presence.
     */
    ensure(): Promise<TrayStatus>;
    /** Write all artifacts and create/refresh the desktop shortcut. */
    regenerate(): Promise<TrayStatus>;
}
