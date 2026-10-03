/**
 * Stable names and the launch facts shared by every generated artifact.
 *
 * They live in their own module so `tray-script.ts` and `artifacts.ts` can both
 * import them without a cycle.
 */
export const PLUGIN_ID = 'dsh-web-tray';
export const WSL_DIR_NAME = 'dsh-web-tray';
export const WIN_DIR_REL = '.dsh/dsh-web-tray';
export const TRAY_SCRIPT_NAME = 'dsh-web-tray.ps1';
export const TRAY_VBS_NAME = 'dsh-web-tray.vbs';
export const ICON_FILE_NAME = 'dsh-web-tray.ico';
export const START_SCRIPT_NAME = 'start.sh';
export const STOP_SCRIPT_NAME = 'stop.sh';
/** stdout of the launched DSH; the launch token is printed into this file. */
export const START_LOG_NAME = 'start.log';
export const TRAY_LOG_NAME = 'tray.log';
export const TRAY_STATUS_NAME = 'tray-status.json';
export const DEFAULT_SHORTCUT_NAME = 'DSH Web';
export const DEFAULT_WEB_URL = 'http://127.0.0.1:3080';
