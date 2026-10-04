/**
 * The generated Windows-side tray helper.
 *
 * This is the one process deliberately independent of DSH: it opens DSH when it
 * is asked to and disappears when the user exits it. It is a launcher, not a
 * supervisor — no watchdog, no idle stop, no configuration file — because all
 * of that needed background sampling and a state machine on the UI thread, and
 * the synchronous `wsl.exe` stop it offered is exactly what used to freeze the
 * tray solid (it never exited, and the menu stopped responding).
 *
 * The context menu is styled after the DeepSeek Harness desktop app's own tray
 * menu. That menu is NOT a Windows menu: Electron hands a template to Chromium
 * and Chromium draws it, so its palette and metrics differ from the Windows 11
 * popup menu. Both were measured side by side on the same screen and at the
 * same DPI (tray icon vs tray icon), and those numbers are the constants below.
 *
 * The generated script is deliberately plain PowerShell 5.1: no modules, just
 * WinForms, plus one `Add-Type` for the dark context menu.
 */
import { type LaunchConfig } from './names.ts';
/** `\\wsl.localhost\<distro>\home\me\.dsh\dsh-web-tray\start.log` from a WSL path. */
export declare function wslLogUncPath(distro: string, wslLogPath: string): string;
/**
 * Build the Windows tray helper: a notification-area icon whose context menu
 * offers exactly two actions, 打开 and 退出.
 *
 * Opening is idempotent — a running DSH is reused and only the browser opens,
 * a stopped one is started through the generated `start.sh` and the browser
 * opens once the URL answers. Nothing is sampled in the background, so the UI
 * thread never blocks on WSL and the tray cannot wedge.
 *
 * `-Regenerate` (used by the host on mount and by the settings card) only
 * rewrites the desktop shortcut; `-SelfTest` builds the real menu and prints the
 * contract as JSON without showing any UI; `-Uninstall` deletes everything this
 * helper writes (the plugin itself cannot: removing a bundle runs no code).
 *
 * @param config - launch facts baked into the script.
 */
export declare function buildTrayScript(config: LaunchConfig): string;
