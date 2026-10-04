/**
 * Generated artifact text: the WSL-side start/stop scripts and the hidden
 * Windows launcher. The tray helper itself lives in tray-script.ts; the names
 * and launch facts are re-exported from names.ts so existing importers keep
 * working.
 */
export * from './names.ts';
export { buildTrayScript, wslLogUncPath } from './tray-script.ts';
/**
 * Quote a value for bash. JSON escaping is NOT shell escaping: inside double
 * quotes bash still expands `$(...)`, backticks and `$VAR`, and it turns a
 * newline into the two characters `\` and `n` — so a path containing either was
 * executed or corrupted. Single quotes with `'\''` doubling keep every byte and
 * expand nothing.
 *
 * The PowerShell counterpart is `psSingleQuoted` in tray-script.ts.
 *
 * @param value - the literal to quote.
 */
export declare function bashSingleQuoted(value: string): string;
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
 * Build the WSL-side stop script. It is what the tray's exit entry runs: the
 * generated script stops exactly the instance start.sh launched (PID file,
 * written before exec so it tracks the final DSH process), then falls back to
 * every other `dsh web` process on the machine.
 *
 * The fallback enumerates candidates with pgrep and applies the same predicate
 * the PID file gets — a global install's own command line is
 * `node /usr/local/bin/dsh web` (the shim keeps the symlink path in argv), which
 * none of the `bin.js web` patterns match, and a `grep dsh web` of your own is
 * never signalled because the predicate inspects /proc, not the pattern text.
 *
 * The PID from the file is checked against /proc before anything is signalled: a
 * stale PID file plus a reused PID would otherwise kill an unrelated process.
 * That is the same idea as the port-verified kill a Tauri tray app uses on
 * Windows (resolve the owner, check what it actually is, then terminate).
 */
export declare function buildStopScript(): string;
/**
 * Build the Windows-side hidden launcher for the tray helper.
 *
 * The shortcut runs `wscript.exe //E:JScript //B <this file>`. `wscript.exe` is
 * a GUI-subsystem host, so no console is ever allocated and the tray appears
 * without a window; the explicit `//E:JScript` names the engine instead of
 * letting Windows derive it from the file extension.
 *
 * Upstream started a `.vbs` without `//E:`, and that is a real failure mode
 * now: Windows 11 24H2 ships VBScript as a Feature-on-Demand, and a machine can
 * end up with `HKCR\.vbs` carrying no ProgID while `vbscript.dll` is still
 * registered. Windows Script Host then refuses to run the file at all
 * (没有文件扩展'.vbs'的脚本引擎), the tray never starts, and double-clicking
 * the shortcut looks like nothing happening. JScript is not part of the
 * VBScript deprecation, and `//E:` keeps working even when the extension
 * mapping is gone — `wscript.exe //E:JScript file.txt` runs like `file.js`.
 */
export declare function buildLauncherScript(): string;
