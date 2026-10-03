# dsh-web-tray

中文 | [English](README.md)

为运行在 WSL 里的 DeepSeek Harness（DSH）提供 **Windows 托盘 + 桌面快捷方式**，带
**可开关的自动启停** 与 **实时状态显示**。

本仓库是 [liyu34/dsh-wsl-tray](https://github.com/liyu34/dsh-wsl-tray) 的 fork
（上游 `ff03276`，v0.1.7，MIT）。上游那套「桌面快捷方式 + 隐藏托盘 + 守护进程」的
架构完整保留；下面「与上游的差异」列出本 fork 新增与修正的内容。

## 与上游的差异

| 能力 | 上游 | 本 fork |
| --- | --- | --- |
| 自动启停 | 行为固定：托盘启动即拉起 DSH，退出即停止 | **四个开关，可随时开关**：托盘启动时自动启动、退出托盘时停止、空闲自动停止、守护进程（自动重启） |
| 开关生效方式 | 守护参数**烧进**生成的 PS1，改参数要重新生成 + 重启托盘 | 开关写在 `tray-config.json`，托盘**每个 tick 重新读取**；改变开关不重新生成任何产物（已验证 PS1 哈希不变） |
| 状态显示 | 设置页只在打开时抓取一次；字段较少 | 设置页**每 2 秒轮询**（页面隐藏时暂停）；新增 DSH 进程 PID / 运行时长 / 内存、授权链接、空闲计时与连接数、开关当前值、配置来源、最近 10 条动作 |
| 空闲判断 | 无 | `netstat -ano` 统计 web 端口上属主不在排除表内的 `ESTABLISHED` 连接 |
| 打开网页 | 打开裸 URL，浏览器无 cookie 时会停在 401 | 从启动脚本日志里取本次进程的 `?token=` 地址打开，顺手种 cookie |
| 环境适配 | 假设 Windows 目录在 PATH 上（`appendWindowsPath = true`） | 三个真实缺陷已修，见「本机环境适配」 |

## 功能

- **双击桌面「DSH Web」快捷方式**：需要时启动 WSL 发行版，DSH 在后台启动（或复用已在
  运行的实例），就绪后浏览器自动打开一次（带授权 token）。
- **托盘图标**（`wscript.exe` + VBS 隐藏启动，全程无控制台窗口）。右键菜单：
  - 状态行：`状态: 运行中 | 连接 2，30 分钟后停服`
  - 打开 DSH 网页 / 启动 DSH 服务 / 停止 DSH 服务 / 重启 DSH 服务
  - 重新生成桌面快捷方式
  - ☑ 托盘启动时自动启动 DSH
  - ☑ 退出托盘时停止 DSH
  - ☑ 守护进程（自动重启）
  - 空闲自动停止 ▸ 关闭 / 5 / 15 / 30 / 60 分钟
  - 退出
- **双击托盘图标**也打开 DSH 网页。
- **守护进程**：按 `probeIntervalSec` 探测 DSH 网址，连续 `downThreshold` 次失败则重启；
  连续 `maxRestartFailures` 次重启失败后暂停（不再无限重启），DSH 一旦恢复回答就自动
  恢复。全过程写入 `tray.log`。
- **主动停止语义**：从托盘菜单点「停止 DSH 服务」或空闲自动停服后，进入 `stopped`
  阶段 —— 守护进程**不会**把它再拉起来，直到 DSH 自己重新应答（例如你手动启动）。
- **设置页**（**设置 → WSL 桌面与托盘**）：开关、DSH 实例状态、守护进程状态、浏览器
  连接与空闲计时、生成文件清单、工程路径、托盘日志（可开自动刷新）。

## 环境要求

- DSH 本身运行在 WSL 中（`WSL_DISTRO_NAME` 已设置，或 `/mnt/c` 可访问）。
- Windows 侧可执行 `wscript.exe`、`powershell.exe`、`wsl.exe`（interop 开启）。
- DSH web **0.2.0-rc.2** 验证通过（客户端 `dsh.client.inject` 已按 0.2.0 的包列表更新：
  上游列的 `@deepseek-ai/dsh-client-runtime` 在 0.2.0 里不存在）。

## 安装

三种方式任选。**方式 B 是本次验证用的方式**，不需要 pnpm。

### 方式 A：官方插件管理器

```sh
cd /path/to/dsh-web-tray
dsh plugin --profile web add "$PWD"      # 需要 PATH 上有 pnpm（corepack enable）
```

### 方式 B：profile 里放符号链接（无需 pnpm）

```sh
P=~/.dsh/profiles/web
python3 - <<'PY'
import json, os
p = os.path.expanduser('~/.dsh/profiles/web/package.json')
d = json.load(open(p))
b = d['dsh']['profile']['bundles']
if 'dsh-web-tray' not in b:
    b.append('dsh-web-tray')
json.dump(d, open(p, 'w'), indent=2)
PY
mkdir -p "$P/node_modules"
ln -sfn /path/to/dsh-web-tray "$P/node_modules/dsh-web-tray"
```

### 方式 C：打包成 tarball 再装

```sh
npm pack            # 生成 dsh-web-tray-0.1.0.tgz
dsh plugin --profile web add ./dsh-web-tray-0.1.0.tgz
```

三种方式都需要**重启 `dsh web`**，插件才会挂载。首次挂载时 `ensure()` 会自动生成全部
产物并在 Windows 桌面创建快捷方式。

## 生成的文件

| 文件 | 位置 |
| --- | --- |
| `dsh-web-tray.ico` / `dsh-web-tray.ps1` / `dsh-web-tray.vbs` | `%USERPROFILE%\.dsh\dsh-web-tray\` |
| `tray-config.json`（开关，**唯一真相源**） | 同上 |
| `tray-status.json`（托盘每 tick 覆盖写） | 同上 |
| `tray.log`（512 KB 轮转） | 同上 |
| `start.sh` / `stop.sh` / `start.log` / `dsh.pid` | `~/.dsh/dsh-web-tray/` |
| `DSH Web.lnk` | Windows 桌面 |

数据流：

```
设置页 ──POST /dsh-web-tray/config──▶ host ──原子写──▶ %USERPROFILE%\.dsh\dsh-web-tray\tray-config.json
                                                        │ 每 tick 读取
托盘菜单 ──直接写同一文件────────────────────────────────▶┤
                                                        ▼
                                            托盘 PS1（守护 + 空闲计数 + 动作）
                                                        │ 每 tick 覆盖写
                                                        ▼
                                    tray-status.json ──▶ host 读取 ──▶ 设置页轮询展示
```

开关放在 **Windows 侧** 是刻意的：`dsh web` 停着的时候设置页根本访问不到，但「托盘启动
时自动启动 DSH」必须在那时仍然有效。

## 开关（`tray-config.json`）

| 键 | 默认 | 取值 | 作用 |
| --- | --- | --- | --- |
| `autoStart` | `true` | 布尔 | 托盘启动时若 DSH 未运行则拉起 |
| `autoStopOnExit` | `true` | 布尔 | 退出托盘时停止 DSH |
| `autoStopIdleMinutes` | `0` | 0–1440 | 无浏览器连接达到该分钟数后停止 DSH；0 = 关闭 |
| `watchdogEnabled` | `true` | 布尔 | 守护进程总开关（关闭后只探测，永不自动重启） |
| `probeIntervalSec` | `10` | 2–300 | 探测间隔 |
| `probeTimeoutSec` | `3` | 1–30 | 单次探测超时 |
| `downThreshold` | `3` | 1–10 | 连续失败多少次判定为 DOWN |
| `restartWaitSec` | `180` | 30–1800 | 重启后等待多久算失败 |
| `maxRestartFailures` | `3` | 1–10 | 连续重启失败多少次后暂停 |
| `restartBackoffSec` | `60` | 0–600 | 两次重启尝试之间的冷却 |
| `idleProbeExcludeProcesses` | `powershell, pwsh, wscript, wsl, wslhost, wslrelay, conhost` | 进程名数组 | 属主在此列表内的连接不计入空闲判断 |

越界值会被**夹取**并把原因回报到设置页；坏 JSON 时托盘保留上一次有效值
（设置页显示 `开关来自: 上次有效值`）。文件缺失时用上面这套内置默认值。

## 空闲判断（为什么是 `netstat`）

```
netstat -ano → 取端口匹配 web 端口的行 → 只保留 ESTABLISHED
             → PID 映射进程名（缓存 60 秒）→ 丢掉排除表内的属主 → 计数
```

- **不用 `Get-NetTCPConnection`**：在本机（WSL 3.0.1 + mirrored 网络）它对
  `-LocalPort 3080` 返回 **0 行**，而同一时刻 `netstat -ano` 能列出 2 条 `ESTABLISHED`
  + 1 条 `CLOSE_WAIT`。已实测，故刻意改用 `netstat`。
- **排除表的意义**：托盘自己的 HTTP 探测（属主 `powershell`）也会连 3080。若不过滤，
  空闲计时永远归零，空闲停服永远不会触发。
- 计数为 0 且达阈值 → 执行 `stop.sh`，阶段变 `stopped`，并写一条 `actions` 记录。
- `netstat` 取不到时把 `idle.connections` 记为 `null` 且**跳过**空闲停服，同时写日志。

## HTTP 接口（`/dsh-web-tray`，环回 + 同源围栏）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/status` | 完整状态（平台、网址、授权链接、配置、生成文件、DSH 进程、托盘状态） |
| GET | `/config` | 当前开关 + 来源 + 文件路径 + 修复说明 |
| POST | `/config` | 部分开关（只写传入字段），返回生效值与修复说明 |
| GET | `/watchdog` | 托盘最近一次 tick 的状态（`tray-status.json`） |
| GET | `/watchdog-log?lines=N` | `tray.log` 尾部 |
| POST | `/regenerate` | 重写全部产物并重建桌面快捷方式 |
| GET/POST | `/project-path` | 源码 checkout 路径（留空 = 自动检测） |

## 本机环境适配（三个真实缺陷）

这三条都是在本机（`%UserProfile%\.wslconfig` 里 `appendWindowsPath = false`，dsh 由
npm 全局安装）上实测暴露的；上游在这种环境下**无法工作**：

1. **`powershell.exe` 不在 PATH 上** → `spawn('powershell.exe')` 直接 ENOENT，创建快捷
   方式、解析桌面目录、解析用户目录全部失败。修复：`powershellPath()` 先用 PATH，再回
   退到绝对路径 `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`。
2. **用户目录解析落到 `Administrator`** → 只靠扫描 `/mnt/c/Users` 会取到字母序第一个
   目录，而它不可写（EACCES）。修复：先问 PowerShell
   `[Environment]::GetFolderPath('UserProfile')`，扫描只作最后兜底。
3. **PATH 安装的 `dsh` 被产物生成守卫拒绝** → 上游要求 `process.argv[1]` 以 `.js` 结尾
   或存在源码 checkout；而全局安装时 `argv[1]` 是无扩展名的 shim
   `/usr/local/bin/dsh`，于是报 "cannot locate a DSH launcher"，**一个产物都不生成**。
   修复：把「PATH 上有 `dsh`」也算作可用启动器（生成的 `start.sh` 本来就优先
   `command -v dsh`）。

## 开发与验证

```sh
npm install
npm run typecheck     # 宿主 + 客户端两半
npm test              # 41 项（含 3 项真跑 Windows PowerShell 的集成测试）
npm run build         # tsc + tsdown + banner 归一化
npm pack --dry-run
```

- 生成的 PS1 支持 `-SelfTest`：从 stdin 读 `netstat` 文本，输出连接计数与空闲判定用例
  JSON，供 `tests/tray-selftest.spec.ts` 通过 Windows interop 真跑（无 interop 时自动跳过）。
- **验证记录**（本机 WSL2 + Windows 11，dsh 0.2.0-rc.2）：
  - `npm run typecheck` / `npm test`（41 通过）/ `npm run build` / `npm pack --dry-run` 全绿；
  - 真跑 PS1 语法检查通过；解析器对真实抓包样本给出 3（默认排除表）与 2（排除
    `system`）两个预期结果；空闲判定 5 个用例全部符合预期；
  - 在独立 `DSH_HOME`（3099 端口，不影响 3080 上的活动会话）里挂载插件：`/status`
    返回 `platform: wsl`、正确用户目录、`dsh.running/pid/uptimeSec/rssMb`；产物与桌面
    `DSH Web.lnk` 全部生成（快捷方式指向 `wscript.exe` + VBS + 图标）；
  - 首页 boot 载荷里出现 `dsh-web-tray/client.js`（客户端半边已注册）；
  - `POST /config` 改开关后写入 Windows 侧文件、`GET /config` 复读一致，且 **PS1 哈希
    不变**（证明开关不需要重新生成）；越界值被夹取并回报，数组 body → 400，非环回
    Host → 403。

## 已知限制

- **托盘必须在运行**：守护进程与空闲停服都活在托盘进程里。退出托盘（且
  `autoStopOnExit` 关闭时）DSH 继续运行，但没人守护它。
- **Windows 原生（非 WSL）尚未实现**：非 WSL 环境返回 `platform: 'unsupported'`，
  设置页给出说明，不启动任何 Windows 进程。平台缝（`platform.ts` 规划为适配器）留在
  路线图上，本期只完成 WSL 适配。
- **空闲停服会中断后台作业**：标签页关掉但后台任务还在跑时，达阈值会停掉 DSH（会话已
  落盘，历史不丢）。因此默认阈值是 0（关闭）。
- 不是由本插件启动的 DSH 实例没有 PID 文件，`stop.sh` 只靠括号化 `pkill` 模式兜底；
  模式覆盖 `bin.js web` 与 `src/bin.ts web` 两类。
- `pkill -f 'dsh web'` 类模式过宽的问题在上游就存在；本 fork 的守护逻辑不依赖它
  （只有 `stop.sh` 用括号化模式）。

## 与上游同步

```sh
git remote -v                  # upstream = liyu34/dsh-wsl-tray
git fetch upstream
git log --oneline upstream/master ^master   # 看上游新增
git cherry-pick <commit>       # 或 merge
```

## 许可

MIT（见 [LICENSE](LICENSE)）。原始版权声明保留自上游。
