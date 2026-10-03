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
export const TRAY_CONFIG_NAME = 'tray-config.json';
/**
 * Defaults. `restartBackoffSec` and the watchdog numbers keep the upstream
 * values so a fork install behaves like the plugin it forked; the new
 * switches default to the upstream behaviour (auto start on, stop on exit,
 * no idle stop).
 */
export const DEFAULT_TRAY_CONFIG = {
    version: 1,
    autoStart: true,
    autoStopOnExit: true,
    autoStopIdleMinutes: 0,
    watchdogEnabled: true,
    probeIntervalSec: 10,
    probeTimeoutSec: 3,
    downThreshold: 3,
    restartWaitSec: 180,
    maxRestartFailures: 3,
    restartBackoffSec: 60,
    idleProbeExcludeProcesses: ['powershell', 'pwsh', 'wscript', 'wsl', 'wslhost', 'wslrelay', 'conhost'],
};
/** Inclusive numeric bounds; a value outside them is clamped and reported. */
const NUMERIC_RANGES = {
    autoStopIdleMinutes: [0, 1440],
    probeIntervalSec: [2, 300],
    probeTimeoutSec: [1, 30],
    downThreshold: [1, 10],
    restartWaitSec: [30, 1800],
    maxRestartFailures: [1, 10],
    restartBackoffSec: [0, 600],
};
/** Longest accepted exclusion list; enough for every Windows process we name. */
const MAX_EXCLUDES = 32;
const BOOLEAN_KEYS = ['autoStart', 'autoStopOnExit', 'watchdogEnabled'];
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Clamp one numeric field, reporting the reason when it had to move. */
function readNumber(key, raw, config, errors) {
    const range = NUMERIC_RANGES[key];
    if (range === undefined)
        return;
    const [min, max] = range;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        errors.push(`${key} must be a number`);
        return;
    }
    const rounded = Math.round(raw);
    if (rounded < min || rounded > max) {
        errors.push(`${key} must be between ${min} and ${max}; using ${Math.min(Math.max(rounded, min), max)}`);
        config[key] = Math.min(Math.max(rounded, min), max);
        return;
    }
    config[key] = rounded;
}
/** Normalise the exclusion list: strings, trimmed, lowercased, de-duplicated. */
function readExcludes(raw, config, errors) {
    if (!Array.isArray(raw)) {
        errors.push('idleProbeExcludeProcesses must be an array of process names');
        return;
    }
    const seen = new Set();
    for (const entry of raw) {
        if (typeof entry !== 'string' || entry.trim() === '') {
            errors.push('idleProbeExcludeProcesses entries must be non-empty strings');
            continue;
        }
        if (seen.size >= MAX_EXCLUDES) {
            errors.push(`idleProbeExcludeProcesses keeps at most ${MAX_EXCLUDES} entries`);
            break;
        }
        seen.add(entry.trim().toLowerCase().replace(/\.exe$/, ''));
    }
    if (seen.size === 0) {
        // An empty exclusion list would let the tray's own probe keep the idle
        // timer at zero forever, so it falls back to the defaults (the generated
        // helper applies the same rule to its last-good list).
        errors.push('idleProbeExcludeProcesses was empty; using the default list');
        config.idleProbeExcludeProcesses = [...DEFAULT_TRAY_CONFIG.idleProbeExcludeProcesses];
        return;
    }
    config.idleProbeExcludeProcesses = [...seen];
}
/**
 * Coerce an untrusted value (file contents or a POST body) into a valid
 * config. Missing keys take the default; unknown keys are ignored so a newer
 * tray can add one without breaking an older host; invalid values are
 * replaced by the default and reported in `errors`.
 * @param input - parsed JSON of unknown shape.
 * @returns the usable config plus one message per repaired field.
 */
export function normalizeTrayConfig(input) {
    const errors = [];
    const config = { ...DEFAULT_TRAY_CONFIG };
    if (!isRecord(input)) {
        if (input !== undefined && input !== null)
            errors.push('config must be a JSON object');
        return { config: config, errors };
    }
    for (const key of BOOLEAN_KEYS) {
        const raw = input[key];
        if (raw === undefined)
            continue;
        if (typeof raw !== 'boolean') {
            errors.push(`${key} must be a boolean`);
            continue;
        }
        config[key] = raw;
    }
    for (const key of Object.keys(NUMERIC_RANGES)) {
        const raw = input[key];
        if (raw === undefined)
            continue;
        readNumber(key, raw, config, errors);
    }
    if (input.idleProbeExcludeProcesses !== undefined) {
        readExcludes(input.idleProbeExcludeProcesses, config, errors);
    }
    config.version = 1;
    return { config: config, errors };
}
/**
 * Apply a partial patch on top of a current config (the card sends only the
 * field it changed) and normalise the result.
 * @param current - the config in force right now.
 * @param patch - the fields to change.
 * @returns the next config plus repair messages.
 */
export function patchTrayConfig(current, patch) {
    if (!isRecord(patch))
        return { config: current, errors: ['patch must be a JSON object'] };
    return normalizeTrayConfig({ ...current, ...patch });
}
/** Whether two configs are equal field by field (used to skip redundant writes). */
export function sameTrayConfig(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
