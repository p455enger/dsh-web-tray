/**
 * The WSL desktop/tray launcher service: writes the generated artifacts (three
 * icons, the Windows launcher, the tray helper, the WSL start and stop scripts)
 * and creates the desktop shortcut through a single PowerShell `-Regenerate`
 * run.
 *
 * Nothing here samples the running DSH: the tray knows whether the URL answers,
 * the start script writes a PID file, and `stop.sh` stops that PID. A PID/uptime/
 * RSS poll on every status request was state nobody acted on.
 */
import { type TrayHostBridge } from './windows.ts';
/** Which deployment this host serves. Windows-native is a later phase. */
export type TrayPlatform = 'wsl' | 'win' | 'unsupported';
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
        launcherScriptExists: boolean;
        iconExists: boolean;
        trayIconExists: boolean;
        startScriptPath: string;
        startScriptExists: boolean;
        stopScriptExists: boolean;
    };
    lastError?: string;
    lastResult?: string;
}
/** The webserver face the service reads for the current URL. */
export interface WebServerLike {
    readonly host: string;
    readonly port: number;
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
/**
 * The WSL-side directory holding the generated start script.
 * @param home - the user's home directory; the service passes the bridge's own.
 */
export declare function wslAppDir(home?: string): string;
/**
 * The token URL of the current DSH run, from the start script's log. The token
 * is per-process, so only the newest line counts; without it the browser lands
 * on a 401 page.
 */
export declare function readWebAuthUrl(appDir?: string): Promise<string | null>;
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
}
/**
 * The configured project path itself is unusable, so no artifact should be
 * generated from it (an existing good start script is left alone).
 */
export declare function configuredPathProblem(configuredPath: string): string | null;
/**
 * Owns the generated files and the shortcut lifecycle for one plugin mount.
 * All Windows process launches are fenced by the helpers in windows.ts.
 */
export declare class TrayService {
    private readonly ctx;
    private readonly webServer;
    private readonly shortcutName;
    private readonly bridge;
    private cachedDesktopDir;
    private cachedWindowsDir;
    private cachedProfileDir;
    private regenerating;
    private projectPath;
    constructor(ctx: TrayServiceContext, webServer: WebServerLike, shortcutName?: string, bridge?: TrayHostBridge);
    /** The WSL-side directory this service owns, under the bridge's home. */
    private appDir;
    /** Read the persisted source-project path, defaulting to empty (auto-detect). */
    private readProjectPathFromDisk;
    /** The currently configured source-project path (empty = auto-detect). */
    getProjectPath(): string;
    /** Persist the configured source-project path and keep it live for generation. */
    setProjectPath(value: string): Promise<void>;
    /**
     * The Windows-side directory holding the icons, the tray script and the
     * launcher. Resolved once per mount, and authoritatively: with
     * `appendWindowsPath = false` PATH has no Windows directory, so the scan
     * fallback would pick the wrong user and every write would fail.
     */
    private windowsAppDir;
    /**
     * The Windows user profile, resolved once per mount: the PowerShell fallback costs
     * seconds, and `/status` is fetched by the settings card.
     */
    private windowsProfileDir;
    /** Resolve the desktop once per mount; PowerShell is authoritative. */
    desktopDir(): Promise<string | null>;
    /** Read the current on-disk facts. */
    status(): Promise<TrayStatus>;
    /**
     * Build the text artifacts for the current host facts. Null when no launcher
     * can be located at all (regenerate reports that as an error).
     */
    private currentScripts;
    /**
     * Ensure the six generated files exist AND match the current host facts
     * (web URL, CLI path, shortcut name, icon art). A stale start script from
     * another port/profile — or an icon from an older release — is a real failure
     * mode, so compare content, not presence.
     */
    ensure(): Promise<TrayStatus>;
    /**
     * Write all artifacts and create/refresh the desktop shortcut.
     *
     * Single-flight: two mounts, or a mount racing the settings card's button, must not
     * write the same files (and the same `.lnk`) at the same time.
     */
    regenerate(): Promise<TrayStatus>;
    private regenerateOnce;
}
