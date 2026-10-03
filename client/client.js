window.__ModuleLoader__.load({ id: "dsh-web-tray", factory: (require) => {


		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/client/locales.ts
		/** Bilingual copy for the settings card. */
		const en = {
			title: "WSL Desktop & Tray",
			description: "Switchable auto start/stop and live status for the DSH tray launcher (WSL).",
			status: "Status",
			statusTitle: "Runtime",
			switchesTitle: "Auto start / stop",
			filesTitle: "Generated files",
			regenerate: "Recreate desktop shortcut",
			regenerating: "Creating shortcut…",
			openWeb: "Open DSH web",
			openAuth: "Open with token",
			copyAuth: "Copy token URL",
			copied: "Copied.",
			copyFailed: "Could not copy.",
			shortcut: "Desktop shortcut",
			tray: "Tray helper",
			platform: "Host",
			platformWsl: "WSL",
			platformWin: "Windows (not supported yet)",
			platformUnsupported: "Unsupported",
			yes: "Yes",
			no: "No",
			failed: "Failed",
			notWsl: "This build only works when DSH itself runs inside WSL. Native Windows support is planned.",
			regenerated: "Shortcut created on the Windows desktop.",
			forbidden: "Request refused.",
			projectPath: "DSH project path (WSL)",
			projectPathHint: "Source checkout path, e.g. /home/me/deepseek-harness. Empty = auto-detect.",
			savePath: "Save path",
			savingPath: "Saving…",
			pathSaved: "Project path saved.",
			dshTitle: "DSH instance",
			dshRunning: "Running",
			dshStopped: "Not running",
			dshUrl: "Web URL",
			dshPid: "PID",
			dshUptime: "Uptime",
			dshRss: "Memory (RSS)",
			trayRunning: "Tray state",
			trayUpdatedAt: "Tray updated",
			trayConfigSource: "Switches read from",
			configSourceFile: "tray-config.json",
			configSourceDefaults: "built-in defaults",
			configSourceLastGood: "last good values (file unreadable)",
			swAutoStart: "Start DSH when the tray starts",
			swAutoStartHint: "Off = the tray never starts DSH by itself.",
			swAutoStopExit: "Stop DSH when the tray exits",
			swAutoStopExitHint: "Off = DSH keeps running after you exit the tray.",
			swWatchdog: "Watchdog (restart DSH when it stops answering)",
			swWatchdogHint: "Off = probe only; DSH is never restarted automatically.",
			swIdle: "Stop DSH after this long with no browser connection",
			idleOff: "Off",
			idle5: "5 minutes",
			idle15: "15 minutes",
			idle30: "30 minutes",
			idle60: "60 minutes",
			configSaved: "Switches saved.",
			configFailed: "Could not save the switches.",
			wdTitle: "Watchdog",
			wdEnabled: "Watchdog enabled",
			wdState: "State",
			wdRestartFailures: "Consecutive failed restarts",
			wdRestartCount: "Restarts performed",
			wdLastAlive: "Last alive",
			wdLastRestart: "Last restart",
			wdProbes: "Failed probes",
			wdProbeDetail: "Last probe",
			wdPhaseStarting: "Starting",
			wdPhaseProbing: "Running (probing)",
			wdPhaseRestarting: "Restarting…",
			wdPhaseBackoff: "Cooling down",
			wdPhasePaused: "Paused",
			wdPhaseStopped: "Stopped on purpose",
			wdPhaseUnknown: "Unknown",
			wdPausedAuto: "gave up after failures",
			wdRestartOk: "OK",
			wdRestartFailed: "failed",
			wdRestartUnknown: "n/a",
			idleTitle: "Browser connections",
			idleConnections: "Established connections",
			idleSeconds: "Idle for",
			idleUnknown: "unknown (netstat unavailable)",
			idleThreshold: "Idle limit",
			wdLog: "Tray log",
			wdLogRefresh: "Refresh",
			wdLogAuto: "Auto refresh",
			wdLogLoading: "Loading…",
			wdLogEmpty: "(no log entries yet)",
			wdNotRunning: "No tray state on disk yet (tray not running?)"
		};
		const zh = {
			title: "WSL 桌面与托盘",
			description: "为 WSL 里的 DSH 托盘启动器提供可开关的自动启停与实时状态。",
			status: "状态",
			statusTitle: "运行状态",
			switchesTitle: "自动启停开关",
			filesTitle: "生成的文件",
			regenerate: "重新生成桌面快捷方式",
			regenerating: "正在生成快捷方式…",
			openWeb: "打开 DSH 网页",
			openAuth: "用授权链接打开",
			copyAuth: "复制授权链接",
			copied: "已复制。",
			copyFailed: "复制失败。",
			shortcut: "桌面快捷方式",
			tray: "托盘助手",
			platform: "宿主环境",
			platformWsl: "WSL",
			platformWin: "Windows（暂不支持）",
			platformUnsupported: "不支持",
			yes: "是",
			no: "否",
			failed: "失败",
			notWsl: "当前版本仅在 DSH 运行于 WSL 中时可用；Windows 原生支持在后续版本。",
			regenerated: "已在 Windows 桌面生成快捷方式。",
			forbidden: "请求被拒绝。",
			projectPath: "DSH 工程路径（WSL 内）",
			projectPathHint: "源码目录，例如 /home/me/deepseek-harness。留空则自动检测。",
			savePath: "保存路径",
			savingPath: "正在保存…",
			pathSaved: "工程路径已保存。",
			dshTitle: "DSH 实例",
			dshRunning: "运行中",
			dshStopped: "未运行",
			dshUrl: "网页地址",
			dshPid: "进程号",
			dshUptime: "运行时长",
			dshRss: "内存（RSS）",
			trayRunning: "托盘状态",
			trayUpdatedAt: "托盘更新时间",
			trayConfigSource: "开关来自",
			configSourceFile: "tray-config.json",
			configSourceDefaults: "内置默认值",
			configSourceLastGood: "上次有效值（文件读不出）",
			swAutoStart: "托盘启动时自动启动 DSH",
			swAutoStartHint: "关闭后托盘不会主动启动 DSH。",
			swAutoStopExit: "退出托盘时停止 DSH",
			swAutoStopExitHint: "关闭后退出托盘不会停止 DSH。",
			swWatchdog: "守护进程（不响应时自动重启）",
			swWatchdogHint: "关闭后只探测，永不自动重启。",
			swIdle: "无浏览器连接多久后停止 DSH",
			idleOff: "关闭",
			idle5: "5 分钟",
			idle15: "15 分钟",
			idle30: "30 分钟",
			idle60: "60 分钟",
			configSaved: "开关已保存。",
			configFailed: "开关保存失败。",
			wdTitle: "守护进程",
			wdEnabled: "守护进程已启用",
			wdState: "状态",
			wdRestartFailures: "连续重启失败",
			wdRestartCount: "累计重启次数",
			wdLastAlive: "上次存活",
			wdLastRestart: "上次重启",
			wdProbes: "探针失败次数",
			wdProbeDetail: "上次探测",
			wdPhaseStarting: "启动中",
			wdPhaseProbing: "运行中（探测）",
			wdPhaseRestarting: "重启中…",
			wdPhaseBackoff: "冷却中",
			wdPhasePaused: "已暂停",
			wdPhaseStopped: "已主动停止",
			wdPhaseUnknown: "未知",
			wdPausedAuto: "连续失败已放弃",
			wdRestartOk: "成功",
			wdRestartFailed: "失败",
			wdRestartUnknown: "未知",
			idleTitle: "浏览器连接",
			idleConnections: "已建立连接数",
			idleSeconds: "已空闲",
			idleUnknown: "未知（netstat 不可用）",
			idleThreshold: "空闲上限",
			wdLog: "托盘日志",
			wdLogRefresh: "刷新",
			wdLogAuto: "自动刷新",
			wdLogLoading: "加载中…",
			wdLogEmpty: "（暂无日志）",
			wdNotRunning: "磁盘上还没有托盘状态（托盘未运行？）"
		};
		//#endregion
		//#region src/client/SettingsSection.tsx
		/**
		* The plugin's settings section: the switches, the live status of the DSH
		* instance and of the Windows tray, the generated-file facts, the project path
		* and the tray log.
		*
		* The section is a client-only contribution; every fact comes from
		* `/dsh-web-tray/*` on the host. It polls while visible, because the switches
		* can also be changed from the tray menu and the tray rewrites its state every
		* tick — a one-shot fetch would show stale values.
		*/
		const POLL_MS = 2e3;
		const STYLE_ID = "dsh-web-tray-section-style";
		const SECTION_CSS = `
.dsh-web-tray-section{display:flex;flex-direction:column;gap:2px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-web-tray-description{margin:0 0 6px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-web-tray-field{display:flex;flex-direction:column;gap:6px;padding:10px 0}
.dsh-web-tray-field-label{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-web-tray-field-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-web-tray-group{display:flex;flex-direction:column;gap:2px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-web-tray-group-title{font-size:13px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary);padding-bottom:4px}
.dsh-web-tray-switch{display:flex;align-items:flex-start;gap:10px;padding:6px 0}
.dsh-web-tray-switch-text{display:flex;flex-direction:column;gap:2px}
.dsh-web-tray-message{font-size:12px;line-height:1.5;overflow-wrap:anywhere;margin:8px 0 0;color:var(--dsw-alias-label-tertiary)}
.dsh-web-tray-message-error{color:var(--dsw-alias-label-error)}
.dsh-web-tray-buttons{display:flex;flex-wrap:wrap;gap:8px;padding-top:12px}
.dsh-web-tray-state{display:inline-flex;align-items:center;gap:6px;justify-content:flex-end}
`;
		const rowBase = {
			display: "flex",
			justifyContent: "space-between",
			gap: 12,
			fontSize: 13,
			lineHeight: 1.5,
			padding: "4px 0"
		};
		const labelStyle = { color: "var(--dsw-alias-label-tertiary)" };
		const valueStyle = {
			textAlign: "right",
			overflowWrap: "anywhere",
			color: "var(--dsw-alias-label-secondary)"
		};
		const inputStyle = {
			width: "100%",
			height: 34,
			padding: "0 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-3)",
			fontSize: 13,
			lineHeight: 1.5,
			color: "var(--dsw-alias-label-primary)"
		};
		const PHASE_KEYS = {
			starting: "wdPhaseStarting",
			probing: "wdPhaseProbing",
			restarting: "wdPhaseRestarting",
			backoff: "wdPhaseBackoff",
			paused: "wdPhasePaused",
			stopped: "wdPhaseStopped"
		};
		const IDLE_CHOICES = [
			{
				minutes: 0,
				key: "idleOff"
			},
			{
				minutes: 5,
				key: "idle5"
			},
			{
				minutes: 15,
				key: "idle15"
			},
			{
				minutes: 30,
				key: "idle30"
			},
			{
				minutes: 60,
				key: "idle60"
			}
		];
		function formatTime(iso) {
			if (iso === null || iso === void 0 || iso === "") return "—";
			const date = new Date(iso);
			if (Number.isNaN(date.getTime())) return iso;
			const pad = (n) => String(n).padStart(2, "0");
			return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
		}
		/** `2d 3h`, `4h 5m`, `12m 30s`, `45s` — the two coarsest units. */
		function formatDuration(seconds) {
			if (seconds === null || seconds === void 0 || !Number.isFinite(seconds)) return "—";
			const total = Math.max(0, Math.round(seconds));
			const days = Math.floor(total / 86400);
			const hours = Math.floor(total % 86400 / 3600);
			const minutes = Math.floor(total % 3600 / 60);
			if (days > 0) return `${days}d ${hours}h`;
			if (hours > 0) return `${hours}h ${minutes}m`;
			if (minutes > 0) return `${minutes}m ${total % 60}s`;
			return `${total}s`;
		}
		function restartResultLabel(ok, t) {
			if (ok === null || ok === void 0) return t("wdRestartUnknown");
			return ok === true ? t("wdRestartOk") : t("wdRestartFailed");
		}
		function configSourceLabel(source, t) {
			if (source === "file") return t("configSourceFile");
			if (source === "last-good") return t("configSourceLastGood");
			return t("configSourceDefaults");
		}
		function platformLabel(status, t) {
			if (status?.platform === "wsl") return `${t("platformWsl")} (${status.distro ?? "?"})`;
			if (status?.platform === "win") return t("platformWin");
			return t("platformUnsupported");
		}
		function Row({ label, children }) {
			return (0, react.createElement)("div", { style: rowBase }, (0, react.createElement)("span", { style: labelStyle }, label), (0, react.createElement)("span", { style: valueStyle }, children));
		}
		/**
		* Render the plugin's settings section.
		* @param props.t - locale reader bound to this plugin's dictionary.
		* @returns the section element.
		*/
		function TraySettingsSection({ t }) {
			const [status, setStatus] = (0, react.useState)(null);
			const [phase, setPhase] = (0, react.useState)("loading");
			const [draftPath, setDraftPath] = (0, react.useState)("");
			const [pathDirty, setPathDirty] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(null);
			const [message, setMessage] = (0, react.useState)(null);
			const [messageIsError, setMessageIsError] = (0, react.useState)(false);
			const [logText, setLogText] = (0, react.useState)("");
			const [logAuto, setLogAuto] = (0, react.useState)(false);
			const [logLoading, setLogLoading] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (document.getElementById(STYLE_ID) === null) {
					const tag = document.createElement("style");
					tag.id = STYLE_ID;
					tag.textContent = SECTION_CSS;
					document.head.appendChild(tag);
				}
				return () => {
					document.getElementById(STYLE_ID)?.remove();
				};
			}, []);
			(0, react.useEffect)(() => {
				let disposed = false;
				let timer = null;
				const load = async () => {
					try {
						const body = await (await fetch("/dsh-web-tray/status", { cache: "no-store" })).json();
						if (disposed) return;
						setStatus(body);
						setPhase("ready");
					} catch {
						if (!disposed) setPhase("failed");
					}
				};
				const start = () => {
					if (timer === null) timer = setInterval(() => {
						load();
					}, POLL_MS);
				};
				const stop = () => {
					if (timer !== null) {
						clearInterval(timer);
						timer = null;
					}
				};
				const onVisibility = () => {
					if (document.visibilityState === "visible") {
						load();
						start();
					} else stop();
				};
				load().then(() => {
					if (!disposed && document.visibilityState === "visible") start();
				});
				document.addEventListener("visibilitychange", onVisibility);
				return () => {
					disposed = true;
					stop();
					document.removeEventListener("visibilitychange", onVisibility);
				};
			}, []);
			(0, react.useEffect)(() => {
				let live = true;
				(async () => {
					try {
						const body = await (await fetch("/dsh-web-tray/project-path", { cache: "no-store" })).json();
						if (live && typeof body.projectPath === "string") setDraftPath(body.projectPath);
					} catch {}
				})();
				return () => {
					live = false;
				};
			}, []);
			(0, react.useEffect)(() => {
				if (!logAuto) return;
				let live = true;
				const load = async () => {
					try {
						const body = await (await fetch("/dsh-web-tray/watchdog-log?lines=120", { cache: "no-store" })).json();
						if (live) setLogText(typeof body.log === "string" ? body.log : "");
					} catch {}
				};
				load();
				const timer = setInterval(() => {
					load();
				}, 5e3);
				return () => {
					live = false;
					clearInterval(timer);
				};
			}, [logAuto]);
			const refreshLog = async () => {
				setLogLoading(true);
				try {
					const body = await (await fetch("/dsh-web-tray/watchdog-log?lines=120", { cache: "no-store" })).json();
					setLogText(typeof body.log === "string" ? body.log : "");
				} catch {
					setMessage(t("failed"));
					setMessageIsError(true);
				} finally {
					setLogLoading(false);
				}
			};
			const saveConfig = async (patch, hint) => {
				setSaving(hint);
				setMessage(null);
				try {
					const body = await (await fetch("/dsh-web-tray/config", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(patch)
					})).json();
					if (body.config !== void 0) setStatus((previous) => previous === null ? previous : {
						...previous,
						config: body.config,
						configSource: body.configSource
					});
					if (body.ok === true) {
						setMessage(t("configSaved"));
						setMessageIsError(false);
					} else {
						setMessage(body.errors?.[0] ?? body.error ?? t("configFailed"));
						setMessageIsError(true);
					}
				} catch (error) {
					setMessage(error instanceof Error ? error.message : t("configFailed"));
					setMessageIsError(true);
				} finally {
					setSaving(null);
				}
			};
			const regenerate = async () => {
				setBusy("regenerate");
				setMessage(null);
				try {
					const body = await (await fetch("/dsh-web-tray/regenerate", { method: "POST" })).json();
					setStatus(body);
					setMessage(body.ok === true ? t("regenerated") : body.lastError ?? t("failed"));
					setMessageIsError(body.ok !== true);
				} catch (error) {
					setMessage(error instanceof Error ? error.message : t("failed"));
					setMessageIsError(true);
				} finally {
					setBusy(null);
				}
			};
			const savePath = async () => {
				setBusy("savePath");
				setMessage(null);
				try {
					const body = await (await fetch("/dsh-web-tray/project-path", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ projectPath: draftPath.trim() })
					})).json();
					if (body.ok !== true) {
						setMessage(body.error ?? t("failed"));
						setMessageIsError(true);
						return;
					}
					setPathDirty(false);
					setMessage(t("pathSaved"));
					setMessageIsError(false);
					await regenerate();
				} catch (error) {
					setMessage(error instanceof Error ? error.message : t("failed"));
					setMessageIsError(true);
				} finally {
					setBusy(null);
				}
			};
			const copyAuthUrl = async () => {
				const url = status?.webAuthUrl ?? status?.webUrl;
				if (url === void 0) return;
				try {
					await navigator.clipboard.writeText(url);
					setMessage(t("copied"));
					setMessageIsError(false);
				} catch {
					setMessage(t("copyFailed"));
					setMessageIsError(true);
				}
			};
			const openUrl = (url) => {
				if (url === null || url === void 0 || url === "") return;
				window.open(url, "_blank", "noopener");
			};
			const config = status?.config;
			const tray = status?.tray ?? null;
			const files = status?.files;
			const dsh = status?.dsh;
			const idle = tray?.idle;
			const probe = tray?.probe;
			const restarts = tray?.restarts;
			const dshState = dsh?.running === true ? "done" : phase === "failed" ? "error" : "idle";
			const unsupported = status?.platform !== "wsl";
			const switchDisabled = unsupported || saving !== null;
			return (0, react.createElement)("div", { className: "dsh-web-tray-section" }, (0, react.createElement)("p", { className: "dsh-web-tray-description" }, t("description")), (0, react.createElement)("div", { className: "dsh-web-tray-group" }, (0, react.createElement)("span", { className: "dsh-web-tray-group-title" }, t("statusTitle")), (0, react.createElement)(Row, { label: t("platform") }, platformLabel(status, t)), (0, react.createElement)(Row, { label: t("dshRunning") }, (0, react.createElement)("span", { className: "dsh-web-tray-state" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: dshState }), (0, react.createElement)("span", null, dsh?.running === true ? t("dshRunning") : t("dshStopped")))), (0, react.createElement)(Row, { label: t("dshPid") }, dsh?.pid ?? "—"), (0, react.createElement)(Row, { label: t("dshUptime") }, formatDuration(dsh?.uptimeSec)), (0, react.createElement)(Row, { label: t("dshRss") }, dsh?.rssMb === null || dsh?.rssMb === void 0 ? "—" : `${dsh.rssMb} MB`), (0, react.createElement)(Row, { label: t("dshUrl") }, status?.webUrl ?? "—"), (0, react.createElement)(Row, { label: t("trayRunning") }, tray === null ? t("wdNotRunning") : `${t(PHASE_KEYS[tray.phase ?? ""] ?? "wdPhaseUnknown")} · ${formatTime(tray.updatedAt)}`), (0, react.createElement)(Row, { label: t("trayConfigSource") }, configSourceLabel(status?.configSource, t))), (0, react.createElement)("div", { className: "dsh-web-tray-group" }, (0, react.createElement)("span", { className: "dsh-web-tray-group-title" }, t("switchesTitle")), (0, react.createElement)("div", { className: "dsh-web-tray-switch" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				checked: config?.autoStart === true,
				onChange: (next) => {
					saveConfig({ autoStart: next }, "autoStart");
				},
				label: t("swAutoStart"),
				disabled: switchDisabled
			}), (0, react.createElement)("span", { className: "dsh-web-tray-switch-text" }, (0, react.createElement)("span", null, t("swAutoStart")), (0, react.createElement)("span", { className: "dsh-web-tray-field-hint" }, t("swAutoStartHint")))), (0, react.createElement)("div", { className: "dsh-web-tray-switch" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				checked: config?.autoStopOnExit === true,
				onChange: (next) => {
					saveConfig({ autoStopOnExit: next }, "autoStopOnExit");
				},
				label: t("swAutoStopExit"),
				disabled: switchDisabled
			}), (0, react.createElement)("span", { className: "dsh-web-tray-switch-text" }, (0, react.createElement)("span", null, t("swAutoStopExit")), (0, react.createElement)("span", { className: "dsh-web-tray-field-hint" }, t("swAutoStopExitHint")))), (0, react.createElement)("div", { className: "dsh-web-tray-switch" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				checked: config?.watchdogEnabled === true,
				onChange: (next) => {
					saveConfig({ watchdogEnabled: next }, "watchdogEnabled");
				},
				label: t("swWatchdog"),
				disabled: switchDisabled
			}), (0, react.createElement)("span", { className: "dsh-web-tray-switch-text" }, (0, react.createElement)("span", null, t("swWatchdog")), (0, react.createElement)("span", { className: "dsh-web-tray-field-hint" }, t("swWatchdogHint")))), (0, react.createElement)("div", { className: "dsh-web-tray-field" }, (0, react.createElement)("span", { className: "dsh-web-tray-field-label" }, t("swIdle")), (0, react.createElement)("div", { className: "dsh-web-tray-buttons" }, ...IDLE_CHOICES.map((choice) => (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				key: `idle-${choice.minutes}`,
				variant: config?.autoStopIdleMinutes === choice.minutes ? "primary" : "outline",
				size: "sm",
				disabled: switchDisabled,
				onClick: () => {
					saveConfig({ autoStopIdleMinutes: choice.minutes }, `idle-${choice.minutes}`);
				}
			}, t(choice.key)))))), (0, react.createElement)("div", { className: "dsh-web-tray-group" }, (0, react.createElement)("span", { className: "dsh-web-tray-group-title" }, t("wdTitle")), (0, react.createElement)(Row, { label: t("wdEnabled") }, tray === null ? "—" : probe === void 0 ? "—" : `${t("wdProbes")}: ${probe.failures ?? 0}/${probe.downThreshold ?? "—"}`), (0, react.createElement)(Row, { label: t("wdState") }, t(PHASE_KEYS[tray?.phase ?? ""] ?? "wdPhaseUnknown")), (0, react.createElement)(Row, { label: t("wdProbeDetail") }, probe === void 0 || probe.detail === void 0 ? "—" : `${probe.detail}${probe.latencyMs === void 0 ? "" : ` (${probe.latencyMs} ms)`}`), (0, react.createElement)(Row, { label: t("wdRestartFailures") }, `${restarts?.failures ?? 0}/${restarts?.maxFailures ?? "—"}`), (0, react.createElement)(Row, { label: t("wdRestartCount") }, restarts?.count ?? 0), (0, react.createElement)(Row, { label: t("wdLastAlive") }, formatTime(tray?.dsh?.lastAliveAt)), (0, react.createElement)(Row, { label: t("wdLastRestart") }, `${formatTime(restarts?.lastAt)} [${restartResultLabel(restarts?.lastOk, t)}]`), (0, react.createElement)(Row, { label: t("idleConnections") }, idle?.connections === null || idle?.connections === void 0 ? t("idleUnknown") : idle.connections), (0, react.createElement)(Row, { label: t("idleSeconds") }, formatDuration(idle?.idleSeconds)), (0, react.createElement)(Row, { label: t("idleThreshold") }, config?.autoStopIdleMinutes === void 0 || config.autoStopIdleMinutes === 0 ? t("idleOff") : `${config.autoStopIdleMinutes} min`)), (0, react.createElement)("div", { className: "dsh-web-tray-group" }, (0, react.createElement)("span", { className: "dsh-web-tray-group-title" }, t("filesTitle")), (0, react.createElement)(Row, { label: t("shortcut") }, files?.shortcutExists === true ? "✓" : "—"), (0, react.createElement)(Row, { label: t("tray") }, files?.trayScriptExists === true && files?.trayVbsExists === true && files?.iconExists === true ? "✓" : "—"), (0, react.createElement)(Row, { label: "tray-config.json" }, files?.configExists === true ? "✓" : "—"), (0, react.createElement)(Row, { label: "start.sh / stop.sh" }, files?.startScriptExists === true ? "✓" : "—"), files?.configPath !== null && files?.configPath !== void 0 ? (0, react.createElement)("p", { className: "dsh-web-tray-message" }, files.configPath) : null), (0, react.createElement)("div", { className: "dsh-web-tray-field" }, (0, react.createElement)("span", { className: "dsh-web-tray-field-label" }, t("projectPath")), (0, react.createElement)("input", {
				style: inputStyle,
				value: draftPath,
				placeholder: "/home/me/deepseek-harness",
				disabled: busy !== null,
				onChange: (event) => {
					setDraftPath(event.target.value);
					setPathDirty(true);
				}
			}), (0, react.createElement)("span", { className: "dsh-web-tray-field-hint" }, t("projectPathHint"))), (0, react.createElement)("div", { className: "dsh-web-tray-buttons" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "primary",
				size: "sm",
				disabled: busy !== null || unsupported,
				onClick: () => {
					savePath();
				}
			}, busy === "savePath" ? t("savingPath") : t("savePath")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: busy !== null || unsupported,
				onClick: () => {
					regenerate();
				}
			}, busy === "regenerate" ? t("regenerating") : t("regenerate")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: status?.webUrl === void 0,
				onClick: () => {
					openUrl(status?.webUrl);
				}
			}, t("openWeb")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: status?.webAuthUrl === null || status?.webAuthUrl === void 0,
				onClick: () => {
					openUrl(status?.webAuthUrl);
				}
			}, t("openAuth")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: status?.webUrl === void 0,
				onClick: () => {
					copyAuthUrl();
				}
			}, t("copyAuth"))), (0, react.createElement)("div", { className: "dsh-web-tray-group" }, (0, react.createElement)("span", { className: "dsh-web-tray-group-title" }, t("wdLog")), (0, react.createElement)("div", { className: "dsh-web-tray-switch" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				checked: logAuto,
				onChange: setLogAuto,
				label: t("wdLogAuto")
			}), (0, react.createElement)("span", { className: "dsh-web-tray-switch-text" }, (0, react.createElement)("span", null, t("wdLogAuto")))), (0, react.createElement)("div", { className: "dsh-web-tray-buttons" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: logLoading,
				onClick: () => {
					refreshLog();
				}
			}, logLoading ? t("wdLogLoading") : t("wdLogRefresh"))), logText !== "" ? (0, react.createElement)("pre", { style: {
				margin: "8px 0 0",
				padding: 10,
				maxHeight: 260,
				overflow: "auto",
				borderRadius: 8,
				background: "var(--dsw-alias-bg-layer-1)",
				border: "1px solid var(--dsw-alias-border-l2)",
				fontSize: 12,
				lineHeight: 1.5,
				color: "var(--dsw-alias-label-secondary)",
				whiteSpace: "pre-wrap",
				overflowWrap: "anywhere"
			} }, logText) : (0, react.createElement)("p", { className: "dsh-web-tray-message" }, t("wdLogEmpty"))), unsupported ? (0, react.createElement)("p", { className: "dsh-web-tray-message dsh-web-tray-message-error" }, t("notWsl")) : null, status?.lastResult !== void 0 ? (0, react.createElement)("p", { className: "dsh-web-tray-message" }, status.lastResult) : null, message !== null ? (0, react.createElement)("p", { className: `dsh-web-tray-message${messageIsError ? " dsh-web-tray-message-error" : ""}` }, message) : null);
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* dsh-web-tray client half: registers its own settings section in the settings
		* shell (current DSH renders a section per registrant, so no host-side
		* namespace pairs with it any more). The section owns its controls and drives
		* the host routes.
		*/
		const NS = "dsh-web-tray";
		/** Nav position: after the built-in sections (General 0, Models 10, Plugins 15, Agent presets 20). */
		const SECTION_ORDER = 100;
		const name = "dsh-web-tray";
		const inject = ["slots", "locale"];
		/**
		* Register the section. The shell projects `id`, `order`, and `label` into its
		* navigation and mounts the component in the content column; the label thunk is
		* resolved per render, so switching locale needs no re-registration.
		* @param ctx - client plugin context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-web-tray: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: NS,
				order: SECTION_ORDER,
				label: () => t("title"),
				inject: () => ({ t })
			}, () => (0, react.createElement)(TraySettingsSection, { t })));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map