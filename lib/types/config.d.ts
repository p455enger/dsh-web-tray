/**
 * dsh-web-tray configuration — the single source of truth for the switches and
 * the watchdog tuning.
 *
 * It lives on the WINDOWS side (`%USERPROFILE%\.dsh\dsh-web-tray\tray-config.json`)
 * because the switches must keep working while `dsh web` is down: the settings
 * card is unreachable then, but "start DSH when the tray starts" still has to
 * be honoured. So the tray (PowerShell) reads this file every tick, the tray
 * menu writes it directly, and the host writes it through its `/mnt/c` mapping
 * when the card changes something.
 *
 * Nothing here touches the filesystem: the service owns IO, this module owns
 * shape, defaults and clamping.
 */
/** Windows-side file name, next to the generated tray script. */
export declare const TRAY_CONFIG_NAME = "tray-config.json";
/** Every switch and tuning value the tray reads at runtime. */
export interface TrayConfig {
    version: 1;
    /** Start DSH when the tray starts (and it is not already up). */
    autoStart: boolean;
    /** Stop DSH when the tray exits. */
    autoStopOnExit: boolean;
    /** Stop DSH after this many minutes with no browser connection; 0 disables. */
    autoStopIdleMinutes: number;
    /** Master switch for the probe + auto-restart watchdog. */
    watchdogEnabled: boolean;
    /** Seconds between HTTP probes. */
    probeIntervalSec: number;
    /** HTTP probe timeout per attempt. */
    probeTimeoutSec: number;
    /** Consecutive failed probes that declare DSH down. */
    downThreshold: number;
    /** Seconds a restart may take before it counts as failed. */
    restartWaitSec: number;
    /** Give up (pause) after this many consecutive failed restarts. */
    maxRestartFailures: number;
    /** Cooldown between two failed restart attempts. */
    restartBackoffSec: number;
    /**
     * Process names whose connections never count as "a browser is watching".
     * The tray's own probe (powershell/wscript) and the WSL plumbing (wsl,
     * wslhost, wslrelay, conhost) must not reset the idle timer.
     */
    idleProbeExcludeProcesses: string[];
}
/**
 * Defaults. `restartBackoffSec` and the watchdog numbers keep the upstream
 * values so a fork install behaves like the plugin it forked; the new
 * switches default to the upstream behaviour (auto start on, stop on exit,
 * no idle stop).
 */
export declare const DEFAULT_TRAY_CONFIG: TrayConfig;
/**
 * Coerce an untrusted value (file contents or a POST body) into a valid
 * config. Missing keys take the default; unknown keys are ignored so a newer
 * tray can add one without breaking an older host; invalid values are
 * replaced by the default and reported in `errors`.
 * @param input - parsed JSON of unknown shape.
 * @returns the usable config plus one message per repaired field.
 */
export declare function normalizeTrayConfig(input: unknown): {
    config: TrayConfig;
    errors: string[];
};
/**
 * Apply a partial patch on top of a current config (the card sends only the
 * field it changed) and normalise the result.
 * @param current - the config in force right now.
 * @param patch - the fields to change.
 * @returns the next config plus repair messages.
 */
export declare function patchTrayConfig(current: TrayConfig, patch: unknown): {
    config: TrayConfig;
    errors: string[];
};
/** Whether two configs are equal field by field (used to skip redundant writes). */
export declare function sameTrayConfig(left: TrayConfig, right: TrayConfig): boolean;
