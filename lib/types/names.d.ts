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
/**
 * Hidden-console launcher the desktop shortcut runs, through
 * `wscript.exe //E:JScript //B`.
 */
export declare const LAUNCHER_SCRIPT_NAME = "dsh-web-tray.js";
/**
 * Launcher this plugin used before the JScript one. It is deleted on
 * regenerate: a shortcut pointing at a `.vbs` is exactly the defect that made
 * the desktop shortcut dead, so no install should keep the file around.
 */
export declare const LEGACY_LAUNCHER_NAME = "dsh-web-tray.vbs";
/** Shortcut icon: the DeepSeek Harness app's own mark. */
export declare const ICON_FILE_NAME = "dsh-web-tray.ico";
/**
 * Notification-area icon: the same mark with its colours inverted (dark tile,
 * light whale), so the tray can be told apart from the official desktop app's
 * tray icon at a glance.
 */
export declare const TRAY_ICON_FILE_NAME = "dsh-web-tray-inverted.ico";
export declare const START_SCRIPT_NAME = "start.sh";
export declare const STOP_SCRIPT_NAME = "stop.sh";
/** stdout of the launched DSH; the launch token is printed into this file. */
export declare const START_LOG_NAME = "start.log";
export declare const TRAY_LOG_NAME = "tray.log";
/**
 * Switch and status files the plugin used before the tray was reduced to
 * open/exit. They are deleted on regenerate: nothing reads them any more, and a
 * leftover switch file would suggest the tray still honours it.
 */
export declare const LEGACY_CONFIG_NAME = "tray-config.json";
export declare const LEGACY_STATUS_NAME = "tray-status.json";
export declare const DEFAULT_SHORTCUT_NAME = "DSH Web";
export declare const DEFAULT_WEB_URL = "http://127.0.0.1:3080";
/** Parameters baked into the generated scripts. */
export interface LaunchConfig {
    /** WSL distro name passed to `wsl.exe -d`. */
    distro: string;
    /** DSH web URL the tray opens and the start script polls. */
    webUrl: string;
    /** Shortcut display name (without the .lnk suffix). */
    shortcutName: string;
    /** WSL-side path of the generated start script. */
    wslStartScript: string;
    /** WSL-side path of the generated stop script, run by the tray's exit entry. */
    wslStopScript: string;
    /** WSL-side path of the start script's log, read for the launch token. */
    wslStartLogPath: string;
}
