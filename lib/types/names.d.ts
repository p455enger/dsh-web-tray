/**
 * Stable names and the launch facts shared by every generated artifact.
 *
 * They live in their own module so `tray-script.ts` and `artifacts.ts` can both
 * import them without a cycle.
 */
export declare const PLUGIN_ID = "dsh-web-tray";
export declare const WSL_DIR_NAME = "dsh-web-tray";
export declare const WIN_DIR_REL = ".dsh/dsh-web-tray";
export declare const TRAY_SCRIPT_NAME = "dsh-web-tray.ps1";
export declare const TRAY_VBS_NAME = "dsh-web-tray.vbs";
export declare const ICON_FILE_NAME = "dsh-web-tray.ico";
export declare const START_SCRIPT_NAME = "start.sh";
export declare const STOP_SCRIPT_NAME = "stop.sh";
/** stdout of the launched DSH; the launch token is printed into this file. */
export declare const START_LOG_NAME = "start.log";
export declare const TRAY_LOG_NAME = "tray.log";
export declare const TRAY_STATUS_NAME = "tray-status.json";
export declare const DEFAULT_SHORTCUT_NAME = "DSH Web";
export declare const DEFAULT_WEB_URL = "http://127.0.0.1:3080";
/** Parameters baked into both generated scripts. */
export interface LaunchConfig {
    /** WSL distro name passed to `wsl.exe -d`. */
    distro: string;
    /** DSH web URL the tray opens and the start script polls. */
    webUrl: string;
    /** Shortcut display name (without the .lnk suffix). */
    shortcutName: string;
    /** WSL-side path of the generated start script. */
    wslStartScript: string;
    /** WSL-side path of the generated stop script. */
    wslStopScript: string;
    /** WSL-side path of the start script's log, read for the launch token. */
    wslStartLogPath: string;
}
