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
			description: "Desktop shortcut and tray launcher for DSH running in WSL (open and exit only).",
			statusTitle: "Runtime",
			filesTitle: "Generated files",
			regenerate: "Recreate desktop shortcut",
			regenerating: "Creating shortcut…",
			refresh: "Refresh",
			refreshing: "Refreshing…",
			openWeb: "Open DSH web",
			openAuth: "Open with token",
			copyAuth: "Copy token URL",
			copied: "Copied.",
			copyFailed: "Could not copy.",
			shortcut: "Desktop shortcut",
			tray: "Tray helper",
			launcher: "Launcher (wscript + JScript)",
			shortcutIcon: "Shortcut icon",
			trayIcon: "Tray icon (inverted)",
			startScript: "start.sh / stop.sh",
			platform: "Host",
			platformWsl: "WSL",
			platformWin: "Windows (not supported yet)",
			platformUnsupported: "Unsupported",
			filesDir: "Windows-side directory",
			failed: "Failed",
			notWsl: "This build only works when DSH itself runs inside WSL. Native Windows support is planned.",
			regenerated: "Shortcut created on the Windows desktop.",
			projectPath: "DSH project path (WSL)",
			projectPathHint: "Source checkout path, e.g. /home/me/deepseek-harness. Empty = auto-detect.",
			savePath: "Save path",
			savingPath: "Saving…",
			pathSaved: "Project path saved.",
			trayHint: "The tray menu has two entries, the same two the desktop app shows: 打开 DeepSeek Harness and 退出 DeepSeek Harness. It is drawn to match the desktop app's own tray menu. 退出 stops DSH through ~/.dsh/dsh-web-tray/stop.sh (hidden, never awaited) and then closes the tray.",
			dshUrl: "Web URL",
			dshAuthUrl: "Token URL",
			none: "—"
		};
		const zh = {
			title: "WSL 桌面与托盘",
			description: "为 WSL 里的 DSH 提供桌面快捷方式与托盘启动器（只有打开与退出）。",
			statusTitle: "运行状态",
			filesTitle: "生成的文件",
			regenerate: "重新生成桌面快捷方式",
			regenerating: "正在生成快捷方式…",
			refresh: "刷新",
			refreshing: "正在刷新…",
			openWeb: "打开 DSH 网页",
			openAuth: "用授权链接打开",
			copyAuth: "复制授权链接",
			copied: "已复制。",
			copyFailed: "复制失败。",
			shortcut: "桌面快捷方式",
			tray: "托盘助手",
			launcher: "启动器（wscript + JScript）",
			shortcutIcon: "快捷方式图标",
			trayIcon: "托盘图标（反色）",
			startScript: "start.sh / stop.sh",
			platform: "宿主环境",
			platformWsl: "WSL",
			platformWin: "Windows（暂不支持）",
			platformUnsupported: "不支持",
			filesDir: "Windows 侧目录",
			failed: "失败",
			notWsl: "当前版本仅在 DSH 运行于 WSL 中时可用；Windows 原生支持在后续版本。",
			regenerated: "已在 Windows 桌面生成快捷方式。",
			projectPath: "DSH 工程路径（WSL 内）",
			projectPathHint: "源码目录，例如 /home/me/deepseek-harness。留空则自动检测。",
			savePath: "保存路径",
			savingPath: "正在保存…",
			pathSaved: "工程路径已保存。",
			trayHint: "托盘右键菜单只有两项，和桌面端一致：打开 DeepSeek Harness、退出 DeepSeek Harness；外观按桌面端自己的托盘菜单复刻（同一套配色与尺寸）。「退出」会先通过 ~/.dsh/dsh-web-tray/stop.sh 停掉 DSH（隐藏、不等待），然后关闭托盘。",
			dshUrl: "网页地址",
			dshAuthUrl: "授权链接",
			none: "—"
		};
		//#endregion
		//#region src/client/SettingsSection.tsx
		/**
		* The plugin's settings section: what the host knows about the installation
		* (runtime facts, the generated files, the project path) and the actions that
		* are worth a button — recreate the desktop shortcut, refresh the view, open
		* DSH, save the project path.
		*
		* The section is a client-only contribution; every fact comes from
		* `/dsh-web-tray/*` on the host. It fetches once on mount and on demand rather
		* than polling: the slimmed-down plugin keeps no live tray state to watch.
		*/
		const STYLE_ID = "dsh-web-tray-section-style";
		const SECTION_CSS = `
.dsh-web-tray-section{display:flex;flex-direction:column;gap:2px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-web-tray-description{margin:0 0 6px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-web-tray-field{display:flex;flex-direction:column;gap:6px;padding:10px 0}
.dsh-web-tray-field-label{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-web-tray-field-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-web-tray-group{display:flex;flex-direction:column;gap:2px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-web-tray-group-title{font-size:13px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary);padding-bottom:4px}
.dsh-web-tray-message{font-size:12px;line-height:1.5;overflow-wrap:anywhere;margin:8px 0 0;color:var(--dsw-alias-label-tertiary)}
.dsh-web-tray-message-error{color:var(--dsw-alias-label-error)}
.dsh-web-tray-buttons{display:flex;flex-wrap:wrap;gap:8px;padding-top:12px}
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
		function platformLabel(status, t) {
			if (status?.platform === "wsl") return `${t("platformWsl")} (${status.distro ?? "?"})`;
			if (status?.platform === "win") return t("platformWin");
			return t("platformUnsupported");
		}
		function Row({ label, children }) {
			return (0, react.createElement)("div", { style: rowBase }, (0, react.createElement)("span", { style: labelStyle }, label), (0, react.createElement)("span", { style: valueStyle }, children));
		}
		function mark(present, t) {
			if (present === true) return "✓";
			return present === void 0 ? t("none") : "—";
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
			const [pathLoaded, setPathLoaded] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(null);
			const [message, setMessage] = (0, react.useState)(null);
			const [messageIsError, setMessageIsError] = (0, react.useState)(false);
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
			const load = async () => {
				try {
					const body = await (await fetch("/dsh-web-tray/status", { cache: "no-store" })).json();
					setStatus(body);
					setPhase("ready");
				} catch {
					setPhase("failed");
				}
			};
			const loadPath = async () => {
				try {
					const body = await (await fetch("/dsh-web-tray/project-path", { cache: "no-store" })).json();
					if (body.projectPath !== void 0) {
						setDraftPath(body.projectPath);
						setPathLoaded(true);
					}
				} catch {}
			};
			(0, react.useEffect)(() => {
				load();
				loadPath();
			}, []);
			const unsupported = status !== null && status.platform !== "wsl";
			const finish = (text, isError) => {
				setMessage(text);
				setMessageIsError(isError);
			};
			const regenerate = async () => {
				setBusy("regenerate");
				try {
					const body = await (await fetch("/dsh-web-tray/regenerate", {
						method: "POST",
						cache: "no-store"
					})).json();
					setStatus(body);
					setPhase("ready");
					if (body.ok === true) finish(body.lastResult ?? t("regenerated"), false);
					else finish(body.lastError ?? t("failed"), true);
				} catch {
					finish(t("failed"), true);
				} finally {
					setBusy(null);
				}
			};
			const refresh = async () => {
				setBusy("refresh");
				try {
					await load();
					await loadPath();
				} finally {
					setBusy(null);
				}
			};
			const savePath = async () => {
				setBusy("savePath");
				try {
					const body = await (await fetch("/dsh-web-tray/project-path", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ projectPath: draftPath }),
						cache: "no-store"
					})).json();
					if (body.ok === true) {
						setPathLoaded(true);
						finish(t("pathSaved"), false);
					} else finish(body.error ?? t("failed"), true);
				} catch {
					finish(t("failed"), true);
				} finally {
					setBusy(null);
				}
			};
			const openUrl = (url) => {
				if (url === null || url === void 0 || url === "") return;
				window.open(url, "_blank", "noopener");
			};
			const copyAuthUrl = async () => {
				const url = status?.webAuthUrl;
				if (url === null || url === void 0 || url === "") return;
				try {
					await navigator.clipboard.writeText(url);
					finish(t("copied"), false);
				} catch {
					finish(t("copyFailed"), true);
				}
			};
			const files = status?.files;
			return (0, react.createElement)("section", { className: "dsh-web-tray-section" }, (0, react.createElement)("p", { className: "dsh-web-tray-description" }, t("description")), (0, react.createElement)("div", { className: "dsh-web-tray-group" }, (0, react.createElement)("span", { className: "dsh-web-tray-group-title" }, t("statusTitle")), (0, react.createElement)(Row, { label: t("platform") }, platformLabel(status, t)), (0, react.createElement)(Row, { label: t("dshUrl") }, status?.webUrl ?? "—"), (0, react.createElement)(Row, { label: t("dshAuthUrl") }, status?.webAuthUrl ?? t("none")), phase === "failed" ? (0, react.createElement)("p", { className: "dsh-web-tray-message dsh-web-tray-message-error" }, t("failed")) : null), (0, react.createElement)("div", { className: "dsh-web-tray-group" }, (0, react.createElement)("span", { className: "dsh-web-tray-group-title" }, t("filesTitle")), (0, react.createElement)(Row, { label: t("shortcut") }, mark(files?.shortcutExists, t)), (0, react.createElement)(Row, { label: t("tray") }, mark(files?.trayScriptExists, t)), (0, react.createElement)(Row, { label: t("launcher") }, mark(files?.launcherScriptExists, t)), (0, react.createElement)(Row, { label: t("shortcutIcon") }, mark(files?.iconExists, t)), (0, react.createElement)(Row, { label: t("trayIcon") }, mark(files?.trayIconExists, t)), (0, react.createElement)(Row, { label: t("startScript") }, files?.startScriptExists === true && files?.stopScriptExists === true ? "✓" : "—"), files?.trayDir !== null && files?.trayDir !== void 0 ? (0, react.createElement)("p", { className: "dsh-web-tray-message" }, `${t("filesDir")}: ${files.trayDir}`) : null), (0, react.createElement)("div", { className: "dsh-web-tray-field" }, (0, react.createElement)("span", { className: "dsh-web-tray-field-label" }, t("projectPath")), (0, react.createElement)("input", {
				style: inputStyle,
				value: draftPath,
				placeholder: "/home/me/deepseek-harness",
				disabled: busy !== null || !pathLoaded,
				onChange: (event) => {
					setDraftPath(event.target.value);
				}
			}), (0, react.createElement)("span", { className: "dsh-web-tray-field-hint" }, t("projectPathHint"))), (0, react.createElement)("div", { className: "dsh-web-tray-buttons" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "primary",
				size: "sm",
				disabled: busy !== null || unsupported,
				onClick: () => {
					regenerate();
				}
			}, busy === "regenerate" ? t("regenerating") : t("regenerate")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: busy !== null,
				onClick: () => {
					refresh();
				}
			}, busy === "refresh" ? t("refreshing") : t("refresh")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: busy !== null || !pathLoaded,
				onClick: () => {
					savePath();
				}
			}, busy === "savePath" ? t("savingPath") : t("savePath")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
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
				disabled: status?.webAuthUrl === null || status?.webAuthUrl === void 0,
				onClick: () => {
					copyAuthUrl();
				}
			}, t("copyAuth"))), (0, react.createElement)("p", { className: "dsh-web-tray-message" }, t("trayHint")), unsupported ? (0, react.createElement)("p", { className: "dsh-web-tray-message dsh-web-tray-message-error" }, t("notWsl")) : null, status?.lastResult !== void 0 ? (0, react.createElement)("p", { className: "dsh-web-tray-message" }, status.lastResult) : null, status?.lastError !== void 0 ? (0, react.createElement)("p", { className: "dsh-web-tray-message dsh-web-tray-message-error" }, status.lastError) : null, message !== null ? (0, react.createElement)("p", { className: `dsh-web-tray-message${messageIsError ? " dsh-web-tray-message-error" : ""}` }, message) : null);
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