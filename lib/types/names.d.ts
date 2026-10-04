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
 * Notification-area icons: the page's own favicon mark — the whale alone, with
 * no tile behind it — in the two inks the notification area can need. Windows
 * paints that area in the taskbar's theme, so the tray wears the black mark on a
 * light taskbar and the white one on a dark one.
 *
 * The mark is drawn 7/8 of the frame wide, which is the size the desktop app's
 * own `resources/tray.ico` draws it at (measured: 28/32, 42/48, 56/64 px). The
 * launcher asset above draws the same whale at 3/4, so a tray icon built from
 * that one looked a size smaller than the app's.
 */
export declare const TRAY_ICON_BLACK_NAME = "dsh-web-tray-black.ico";
export declare const TRAY_ICON_WHITE_NAME = "dsh-web-tray-white.ico";
/** Both tray icons, in the order every artifact list walks them. */
export declare const TRAY_ICON_FILE_NAMES: string[];
/**
 * The notification-area icon this plugin shipped before the favicon mark: the
 * shortcut's tile with its colours inverted. Regenerate and uninstall delete it.
 */
export declare const LEGACY_TRAY_ICON_NAME = "dsh-web-tray-inverted.ico";
export declare const START_SCRIPT_NAME = "start.sh";
export declare const STOP_SCRIPT_NAME = "stop.sh";
/** stdout of the launched DSH; the launch token is printed into this file. */
export declare const START_LOG_NAME = "start.log";
export declare const TRAY_LOG_NAME = "tray.log";
/**
 * What the helper wrote into the desktop shortcut, recorded next to it: the
 * target, the arguments, the icon and the `.lnk`'s own size and digest. The host
 * compares that with the shortcut on disk, so a shortcut that was replaced,
 * restored from a backup or edited by hand is rebuilt instead of being trusted
 * for merely existing.
 */
export declare const SHORTCUT_STAMP_NAME = "tray-shortcut.json";
/** The menu contract `-SelfTest` prints and writes next to the helper. */
export declare const SELFTEST_FILE_NAME = "tray-selftest.json";
/**
 * Switch and status files the plugin used before the tray was reduced to
 * open/exit. They are deleted on regenerate: nothing reads them any more, and a
 * leftover switch file would suggest the tray still honours it.
 */
export declare const LEGACY_CONFIG_NAME = "tray-config.json";
export declare const LEGACY_STATUS_NAME = "tray-status.json";
/**
 * Every file that ends up in the Windows-side directory: the ones the host
 * writes (icons, launcher, helper) plus the ones the helper writes itself (log,
 * shortcut stamp, self-test contract). `-Uninstall` removes exactly this list,
 * and the generated helper gets it baked in, so the two sides cannot drift.
 */
export declare const GENERATED_TRAY_FILE_NAMES: readonly ["dsh-web-tray.ico", ...string[], "dsh-web-tray.js", "dsh-web-tray.ps1", "tray-shortcut.json", "tray-selftest.json", "tray.log"];
/**
 * Files earlier versions wrote into the same directory. Regenerate and uninstall
 * delete them, and `ensure()` treats their presence as "an upgrade is pending":
 * without that, a file that was locked during one upgrade (or a 0.1.0 tray still
 * recreating its status file) would survive every later mount.
 */
export declare const LEGACY_TRAY_FILE_NAMES: readonly ["dsh-web-tray.vbs", "tray-config.json", "tray-status.json", "dsh-web-tray-inverted.ico"];
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
