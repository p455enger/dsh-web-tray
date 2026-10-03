/**
 * The generated Windows-side tray helper.
 *
 * This is the one process deliberately independent of DSH: it must start DSH,
 * stop it when idle, and keep the switches honoured while `dsh web` is down.
 * Upstream baked the watchdog tuning into the generated text, so changing a
 * value needed a regenerate plus a tray restart. Here the helper re-reads
 * `tray-config.json` on every tick, and the baked JSON is only the fallback
 * default.
 *
 * The generated script is deliberately plain PowerShell 5.1: no modules, no
 * `Get-NetTCPConnection` (measured: it reports zero connections for WSL-owned
 * loopback sockets), just `netstat.exe` parsing and WinForms.
 */
import { type TrayConfig } from './config.ts';
import { type LaunchConfig } from './names.ts';
/** `\\wsl.localhost\<distro>\home\me\.dsh\dsh-web-tray\start.log` from a WSL path. */
export declare function wslLogUncPath(distro: string, wslLogPath: string): string;
/**
 * Build the Windows tray helper, including the watchdog state machine, the
 * runtime switch reader, the idle counter and the status writer.
 *
 * Watchdog phases: `starting` (initial boot grace) → `probing` (steady state)
 * → `restarting` (after a restart trigger, waiting for DSH to answer) →
 * `backoff` (cooldown after a failed restart) or `paused` (auto-give-up after
 * `maxRestartFailures`, or the watchdog switch is off). `stopped` means DSH was
 * stopped on purpose (tray menu or the idle timer) and must not be restarted
 * until it answers again.
 *
 * @param config - launch facts baked into the script.
 * @param defaults - the config a fresh install starts from; `tray-config.json`
 *   overrides every field at runtime.
 */
export declare function buildTrayScript(config: LaunchConfig, defaults?: TrayConfig): string;
