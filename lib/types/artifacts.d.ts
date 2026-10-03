/**
 * Generated artifact text: the WSL-side launcher/stop scripts and the hidden
 * Windows launcher. The tray helper itself lives in tray-script.ts; the names
 * and launch facts are re-exported from names.ts so existing importers keep
 * working.
 */
export * from './names.ts';
export { buildTrayScript, wslLogUncPath } from './tray-script.ts';
export { DEFAULT_TRAY_CONFIG, TRAY_CONFIG_NAME, type TrayConfig } from './config.ts';
/**
 * Build the WSL-side launcher. It starts the same DSH web CLI the running
 * plugin host came from, waits for readiness, and opens the default browser.
 *
 * Source checkouts are launched through their BUILD OUTPUT only. Running one
 * from `src` (tsx) puts a src instance and a lib instance of the same packages
 * in one process — plugin packages resolve through the runtime mode, which
 * loads lib — and symbols never cross instances, so tool calls fail with
 * undefined state. When a project path is configured explicitly, a missing
 * build output is a hard error rather than a silent fallback to another
 * install the user did not ask for.
 *
 * @param params - launch facts resolved from the running host.
 */
export declare function buildStartScript(params: {
    nodeBin: string;
    sourceCli: string | null;
    sourceCwd: string | null;
    bakedCli: string | null;
    webUrl: string;
    /** True when the project path was set by the user (not auto-detected). */
    sourceConfigured?: boolean;
}): string;
/**
 * Build the WSL-side stop script. The tray runs it through `wsl.exe`; it
 * stops exactly the instance start.sh launched (PID file, written before
 * exec so it tracks the final DSH process), then falls back to a pkill whose
 * bracketed patterns cover every launcher flavor (source build output, npm
 * global, npx all end in `bin.js web`) without matching the wsl.exe/bash
 * wrapper that carries the pattern text in its own command line. A dev
 * instance started from source (`node --import tsx/esm .../src/bin.ts web`) is
 * covered by a second pattern, because "restart DSH" must also replace one.
 */
export declare function buildStopScript(): string;
/**
 * Build the Windows-side hidden launcher for the tray helper. The shortcut
 * points at wscript.exe (a GUI-subsystem host, no console) and passes this
 * script; the script derives the PowerShell path from its own location and
 * starts the tray helper with window style 0.
 */
export declare function buildTrayVbs(): string;
