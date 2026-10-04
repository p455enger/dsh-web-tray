# dsh-web-tray

中文 | [English](README.md)

一个面向 WSL 部署的 DeepSeek Harness（DSH）插件：**Windows 桌面快捷方式 + 极简托盘图标**，
右键菜单只有两项 —— **打开 DeepSeek Harness** 和 **退出 DeepSeek Harness**（退出会顺带停掉
DSH）。没有守护进程、没有空闲自动停止、没有配置文件、没有状态文件。

本项目是 [liyu34/dsh-wsl-tray](https://github.com/liyu34/dsh-wsl-tray) 的 fork（上游
`ff03276`，v0.1.7，MIT）。上游的架构（桌面快捷方式 + 隐藏的托盘助手）保留，去掉看门狗、
菜单里的一堆开关和状态监控，并修掉了下面列出的平台缺陷。

## 功能

- **双击桌面的 `DSH Web`**：WSL 里的 DSH 没在跑就通过 `start.sh` 启动（隐藏、异步），
  在跑就直接复用，然后用本次运行的 `?token=` 地址打开浏览器。
- **托盘图标**（经 `wscript.exe` + JScript 隐藏启动，不弹控制台窗口）：
  - 左键单击或双击：打开 DSH
  - 右键：**打开 DeepSeek Harness** / 分隔线 / **退出 DeepSeek Harness**
  - **退出会先停掉 DSH**：调用生成的 `~/.dsh/dsh-web-tray/stop.sh`（隐藏、不等待），
    然后关闭托盘。`stop.sh` 会先核对 PID 文件背后的命令行，所以过期的 PID 文件配上被
    复用的 PID 也不会误杀别的进程。
- **菜单是按桌面端自己的托盘菜单复刻的**。桌面端那份是 Chromium 自绘，不是 Windows
  `CreatePopupMenu` 的样子，所以颜色和尺寸是在同一块屏幕上、对着并排的两个托盘图标量出来的：
  深色 `#1F1F1F` 面板 175×97 px、`#E3E3E3` 文字、`#363636` 悬停、`#5E5E5E` 满宽分隔线、
  系统 UI 字体 9pt，并按进程 DPI 缩放。圆角用 Windows 11 自己的（8 px），不是桌面端的
  12 px。这些常数都在 `src/tray-script.ts`，由 `tests/tray-menu.spec.ts` 经 Windows
  interop 断言。
- **设置卡片**（**设置 → WSL Desktop & Tray**）：运行环境信息、生成的文件、项目路径，以及
  “重建桌面快捷方式”。按需拉取，不做轮询。

## 从 0.1.0 升级（破坏性）

0.2.0 把托盘缩到「打开 / 退出」两项，并重建了 Windows 侧助手。相对 0.1.0：

- **移除**：托盘上的四个开关、守护进程（自动重启）、空闲自动停服、轮询状态卡片、
  `netstat` 采样，以及状态里的 DSH 进程信息。
- **移除两个状态文件**：`tray-config.json`、`tray-status.json` —— 重新生成产物时会一并删除。
- **更换启动器**：桌面快捷方式从 `.vbs` 改为 `wscript.exe //E:JScript //B dsh-web-tray.js`
  （Windows 11 24H2 起 VBScript 是按需功能），旧的 `.vbs` 会被删掉。
- **托盘图标换过两次** —— 0.2.0 是反色底板，0.3.0 起是随任务栏主题取黑 / 白的 favicon 鲸鱼
  （见下一节）。
- 升级后**重新生成一次产物**即可：挂载插件时会自动做，或在设置卡片点「重建桌面快捷方式」。

## 从 0.2.0 升级

0.3.0 修掉 0.2.0 Windows 侧的问题，另有两处看得见的变化：

- **托盘图标**：反色底板换成页面 favicon 上的鲸鱼 —— 去掉底板的纯鲸鱼，尺寸与桌面应用自带的
  托盘图标一致，按**任务栏主题取黑或白**（每 5 s 读一次注册表）。`dsh-web-tray-inverted.ico`
  会被删除。
- **新增快捷方式戳**：`tray-shortcut.json` 记下快捷方式应有的样子 —— 目标、参数、图标，以及
  `.lnk` 自身的大小与摘要。被替换、从备份还原或被手工改过的快捷方式现在会被重建，而不是
  只要存在就被信任。
- **0.2.0 评审的修复**：烘进生成脚本的每个值都做了 shell 引号处理；`-Uninstall` 覆盖旧版本
  留下的文件；未捕获的错误会在 `tray.log` 里留一行而不是静默失败；产物原子写入、`regenerate()`
  单飞；`ensure()` 能发现遗留文件；`pkill` 兜底也覆盖全局安装的 `dsh`。无需手动步骤：挂载即
  重新生成。

## 环境要求

- DSH 跑在 WSL 里（设置了 `WSL_DISTRO_NAME`，或能访问 `/mnt/c`）。
- Windows 能运行 `wscript.exe`（JScript）、`powershell.exe`、`wsl.exe`。
- 验证环境：DSH web **0.2.0-rc.2**。

## 安装

```sh
# A. 官方插件管理器 —— 是 DSH 的插件管理器在调用 pnpm，PATH 里得有 pnpm；
#    本插件自己从不调用 pnpm
cd /path/to/dsh-web-tray && dsh plugin --profile web add "$PWD"

# B. profile 里放符号链接 —— 不需要 pnpm，本 fork 的验证路径：
P=~/.dsh/profiles/web
python3 - <<'PY'
import json, os
p = os.path.expanduser('~/.dsh/profiles/web/package.json')
d = json.load(open(p)); b = d['dsh']['profile']['bundles']
if 'dsh-web-tray' not in b: b.append('dsh-web-tray')
json.dump(d, open(p, 'w'), indent=2)
PY
mkdir -p "$P/node_modules" && ln -sfn /path/to/dsh-web-tray "$P/node_modules/dsh-web-tray"

# C. 打包成 tarball
npm pack && dsh plugin --profile web add ./dsh-web-tray-0.3.0.tgz
```

三种方式都需要**重启 `dsh web`**。首次挂载时 `ensure()` 会写出全部产物并创建桌面快捷方式。
安装与重新生成都是幂等的：`ensure()` 会比对各产物、旧版本残留的文件以及快捷方式自己的戳，
一致时什么都不重写、不起第二个托盘、也不跑 PowerShell —— 日常使用中只有 `tray.log` 和
`start.log` 会增长。

## 卸载

移除一个 bundle 不会执行插件里的任何代码 —— DSH 没有卸载钩子 —— 所以清理动作放在生成的
托盘助手里：

```powershell
# 在 Windows 上执行，删除 bundle 之前或之后都可以：
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.dsh\dsh-web-tray\dsh-web-tray.ps1" -Uninstall
```

```sh
# 然后在对应的 profile 里移除插件：
dsh plugin --profile web remove dsh-web-tray
```

`-Uninstall` 会先停掉从该目录启动的托盘，然后删除桌面快捷方式、助手脚本、启动器、三个图标、
`tray.log`、`tray-selftest.json`，以及 WSL 侧目录（`start.sh`、`stop.sh`、`start.log`、
`dsh.pid`、`project-path.json`）。DSH 本身会继续运行；重复执行也无副作用。若不执行它，
上述文件会全部留在机器上 —— 而且仍然可用，因为快捷方式和生成的脚本都是自包含的。

用 DSH 插件管理器安装时，profile 里还会多出一些**属于管理器、不属于本插件**的文件：
`dsh-web-tray-<版本>.published/`（打包出来的副本）、`pnpm-lock.yaml`、`pnpm-workspace.yaml`。
没有任何东西读它们 —— profile 是通过 `node_modules` 条目解析插件的 —— 清理这一侧由
`dsh plugin remove` 负责；若想让 profile 彻底干净，也可以手动删除。

## 生成的文件

| 文件 | 位置 |
| --- | --- |
| `dsh-web-tray.ps1`（托盘助手）、`dsh-web-tray.js`（隐藏启动器） | `%USERPROFILE%\.dsh\dsh-web-tray\` |
| `dsh-web-tray.ico`（快捷方式图标）、`dsh-web-tray-black.ico` / `dsh-web-tray-white.ico`（托盘图标，黑 / 白对应任务栏主题） | 同上 |
| `tray.log`（每次打开/退出/报错一行，不轮转） | 同上 |
| `tray-shortcut.json`（快捷方式应有的样子：目标、参数、图标、`.lnk` 摘要） | 同上 |
| `start.sh`、`stop.sh`、`start.log`、`dsh.pid` | `~/.dsh/dsh-web-tray/` |
| `project-path.json`（仅在保存过项目路径时存在） | `~/.dsh/dsh-web-tray/` |
| `DSH Web.lnk`（目标为 `wscript.exe //E:JScript //B …dsh-web-tray.js`） | Windows 桌面 |

运行 `dsh-web-tray.ps1 -SelfTest` 会在助手旁边写出 `tray-selftest.json`（菜单契约，UTF-8）。

`~/.dsh/dsh-web-tray.env`（可选，`chmod 600`，每行一个 `KEY=VALUE`）会被 `start.sh` 读取并
导出到 DSH 进程环境里 —— 比如 MCP 服务器要的 token。脚本只负责读，不会创建它；更早的个人命名
`~/.dsh/github-mcp-token` 仍然生效。

## 工作原理

```
桌面 .lnk
  └─ wscript.exe //E:JScript //B dsh-web-tray.js
       └─ powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File dsh-web-tray.ps1
            ├─ 托盘图标 + 深色圆角右键菜单（打开 / 退出）
            └─ 打开流程：
                 探测 http://127.0.0.1:3080（2 s 超时；401 视为存活 ——
                 没有 cookie 时 DSH 本来就回 401）
                 存活 → 打开页面（优先用 start.log 里的 ?token= 地址）
                 不存活 → wsl.exe -d <发行版> -- bash -lc "start.sh"（隐藏、异步、
                 不等待），随后每 2 s 探测一次、最多 120 s，一有响应就打开页面
```

- **退出会停掉 DSH 并关闭托盘**：退出项隐藏地触发 `wsl.exe … stop.sh` 且**从不等待**它
  （`bWaitOnReturn = $false`），然后退出消息循环。旧设计是在 UI 线程上等 `wsl.exe`，
  那正是托盘卡死（没退出、也点不动）的原因。`-SelfTest` 走的是不带停止开关的退出处理，
  所以跑测试绝不会停掉真正的 DSH。
- **不带控制台，弹出菜单是工具窗口**：助手一进入托盘模式就交还启动器给它的那个控制台
  （`FreeConsole`），并在菜单首次显示之前把它标成 `WS_EX_TOOLWINDOW`。不做这两件事时，
  进程会持有一个隐藏的 PowerShell 控制台窗口，而菜单只是一个无属主的普通顶层窗口 ——
  这正是任务栏和 Alt-Tab 把菜单显示成「Windows PowerShell」的原因（也是那个控制台可能被
  翻出来的原因）。带参数的几种调用保留自己的控制台，因为它们要打印输出。
- **「打开」优先复用网页自己的窗口。** 已经有浏览器窗口显示着 DSH 时，就把它拿到前台，而不是再
  开一个标签页：优先「安装为应用的窗口」（用 `--app`/`--app-id` 启动的浏览器窗口），否则是活动
  标签页为 DSH 的普通浏览器窗口。匹配同时看标题**和窗口类**（`Chrome_WidgetWin_1`），因为显示
  应用目录的文件资源管理器窗口标题里也带着同样的字样。窗口若是最小化的，先还原 —— 静息尺寸取自
  `GetWindowPlacement`（最小化时 `GetWindowRect` 只会报 160×28 的占位值）—— 再用
  `SetForegroundWindow` 置前，失败依次退回「附着前台线程输入队列」和「模拟 ALT 按键」。只有确实
  没有这样的窗口时，才会启动 WSL 实例并用本次运行的 token 打开页面。**Electron 桌面应用永远不是
  候选**：它是另一套程序、自带后端，其窗口按进程名被显式跳过。`-SelfTest` 会报告找到了什么、以及
  因这个原因跳过了几个窗口（`dshWindow`、`dshWindowIsWebApp`、`dshWindowsSkippedAsApp`、
  `focusReturned`）。
- **不做后台采样**：没有 `netstat`、没有状态文件、不扫 `/proc`。只有被要求打开时，UI 线程才
  探测一次（≤ 2 s）；打开流程里那个 2 s 定时器只在它自己拉起的 DSH 启动期间轮询，最多 120 s。
  除此之外唯一的后台动作是每 5 s 读一次注册表取任务栏主题。
- **单实例**：`Local\dsh-web-tray-single` 互斥体。托盘在跑时再次双击不会起第二个托盘，
  那个进程只是打开 DSH。

## HTTP 接口（`/dsh-web-tray`，环回 + 同源围栏）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/status` | 平台、两个地址（web + token）、生成的文件 |
| POST | `/regenerate` | 重写全部产物并重建桌面快捷方式 |
| GET/POST | `/project-path` | 源码 checkout 路径（留空 = 自动探测） |

## 平台适配

1. **PATH 里没有 `powershell.exe`**（`.wslconfig` 设了 `appendWindowsPath = false`）→
   创建快捷方式、解析桌面路径和用户目录全部失败。现在先按盘符探测
   `/mnt/<盘符>/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`，裸名字放到最后：
   PATH 里带 Windows 目录的机器照常可用，Windows 装在别的盘上也不会再退回失败。
2. **用户目录解析成了 `Administrator`**（`/mnt/c/Users` 里按字母序的第一个，不可写）→
   改为先问 PowerShell 要 `[Environment]::GetFolderPath('UserProfile')`，扫目录只作兜底。
3. **用 npm 全局装的 `dsh` 被启动器判定拒绝**，导致什么都不生成 → 现在 PATH 上的 `dsh`
   也算可用启动器。
4. **桌面快捷方式在 Windows 11 24H2 上是死的**：它执行 `.vbs`，而 VBScript 现在是
   按需功能。启动器改为 JScript，用 `wscript.exe //E:JScript //B …` 显式指定引擎；
   写快捷方式时会探测引擎，只有在 JScript 也缺失时才退回隐藏的 `powershell.exe`，
   重新生成时会删掉旧的 `.vbs`。
5. **宿主拉起的 PowerShell 里缺 cmdlet**：本机同时装了 PowerShell 7，而从 WSL 启动的 Windows
   进程继承的是**用户**环境，于是 5.1 拿到一个以 7 的模块目录开头的模块路径：`Get-FileHash`
   报「无法识别」、其模块却显示已加载，快捷方式戳因此从未写出，每次挂载都整份重新生成。
   现在助手自己把 `PSModulePath` 指到 `$PSHOME\Modules`，并用 .NET 计算 `.lnk` 摘要。
6. **图标**：快捷方式用 DSH 应用风格（浅色圆角底、深色鲸鱼，16–256）。托盘改用页面 favicon
   上的鲸鱼：没有底板，按任务栏主题取黑 / 白两色 —— 白色圆角底在浅色通知区域里看不见，在深色
   里又太扎眼。鲸鱼占画面 7/8，与桌面应用自带的 `tray.ico` 同尺寸；快捷方式图标画的是同一个
   鲸鱼的 3/4，所以直接拿它当托盘图标会显得比官方小一圈。写快捷方式时会用
   `SHChangeNotify(SHCNE_ASSOCCHANGED)` 让资源管理器的图标缓存失效，否则会一直显示旧图标。

## 开发

```sh
npm install
npm run typecheck     # 宿主端与客户端
npm test              # 66 项测试（30 项产物文本、12 项服务生命周期、10 项经 Windows interop 驱动真实托盘菜单、6 项图标、8 项接线）
DSH_WEB_TRAY_REQUIRE_INTEROP=1 npm test   # 缺 interop 时直接失败，而不是静默跳过
                                      # （66 项中有 10 项需要 Windows，其余 56 项到处都能跑）
npm run build         # tsc + tsdown + banner 规范化
npm pack --dry-run
```

`dsh-web-tray.ps1 -SelfTest` 会构建真实的 `NotifyIcon`、真实菜单和真实的快捷方式目标解析，
但不显示任何 UI，并把结果契约写成 JSON。`tests/tray-menu.spec.ts` 经 Windows interop 运行它，
断言菜单项、配色与尺寸（按真实 DPI 缩放）、目标路径，以及托盘实际选用的图标与它读到的主题；
interop 不可用时自动跳过（可用 `DSH_WEB_TRAY_REQUIRE_INTEROP=1` 把「跳过」变成失败）。
`tests/icon-asset.spec.ts` 钉住三个 `.ico`：尺寸表、BMP/PNG 规则、鲸鱼在画面中的占比，以及
黑 / 白两种墨色。`tests/service.spec.ts` 则针对临时 home 和注入的宿主桥驱动生命周期本身 ——
幂等、旧版本残留、被换掉的快捷方式、并发生成只跑一次 —— 既不需要 Windows 也不需要 WSL。

验证环境为 WSL2 + Windows 11、2560×1440 @ 100% DPI、dsh 0.2.0-rc.2：typecheck、
测试、构建、打包全绿；真实托盘进程上打开、量测并关闭过菜单；双击真实 `.lnk` 不会出现控制台
窗口；`/status` 返回 `platform: wsl`，各产物齐全。

## 已知限制

- **与桌面应用完全无关**：插件只跟 WSL 网页实例、以及显示它的浏览器窗口打交道。Electron
  桌面应用自带后端（本机 `127.0.0.1:19387`），与 WSL 实例的 `:3080` 并存；托盘既不聚焦也不启动
  它，并且按进程名把它的窗口排除在复用匹配之外。
- **退出是“发完就不管”**：停止请求发出后托盘立刻关闭，WSL 那边稍后完成，因为没有任何东西
  在等它（这是刻意的）。手动执行 `bash ~/.dsh/dsh-web-tray/stop.sh` 效果相同。
- **托盘不是守护进程**：DSH 崩了不会被重启。
- **失败时降级而不是死掉**：深色菜单、窗口匹配、摘除控制台都来自同一份 `Add-Type` 源码；它编不过
  时托盘照样出现（系统配色的菜单、没有圆角），并把原因写进 `tray.log`。任何未捕获的错误也会在
  那里留一行 —— 隐藏进程失败与「根本没启动」本来无法区分。
- **菜单是复刻而非系统菜单**，而且圆角完全没法复刻（Windows 给弹出窗口的就是 8 px 圆角，
  桌面端用 12 px；换来的是抗锯齿和真实阴影）。桌面端以后改版不会自动跟随：改
  `src/tray-script.ts` 里的常数即可。真要一字不差地复刻 Chromium 的绘制，就得打包
  Electron（约 90 MB，而本插件约 125 kB）—— 已安装的桌面端二进制不接受外部 app 路径，
  所以没有免费的路子。
- **打开依赖 `start.sh` 能拉起 CLI**：源码 checkout 必须已经构建过（`start.sh` 不会跑
  `src`；构建产物缺失时它会把原因写进 `start.log`）。不会在背后替你重新构建。
- **不支持原生 Windows（非 WSL）**：这类宿主返回 `platform: 'unsupported'`，什么都不启动。
- 用别的方式启动的 DSH 实例没有 PID 文件：`stop.sh` 会用 `pgrep` 列出所有 `dsh web` 进程，
  逐个读 `/proc` 确认命令行确实是 DSH 才杀（你自己的 `grep dsh web` 不会被误杀）。
- **只驱动浏览器**：托盘按窗口类匹配（`Chrome_WidgetWin_1`），而这个类并非浏览器独有 ——
  QQ、Jitsi Meet、DSH 桌面端都画这种窗口。因此只有当窗口所属进程确实是浏览器时才认（可执行
  文件名在白名单里，或命令行带 `--user-data-dir` / `--profile-directory`，便携版 / scoop
  安装就是这样标识自己的）。
- **任意 Chromium 内核浏览器，而不只是某一个**：Chrome、Edge、Brave、Vivaldi、Opera、
  Chromium、ungoogled-chromium、Thorium、Yandex、Arc 都支持 `--app=<url>`，窗口类与刷新快捷键
  也一致，所以同一套代码通吃。打开页面时优先用"已经看到过这个页面的那个浏览器"（连同它的
  profile），其次才用默认浏览器（前提是它也是 Chromium 系），非 Chromium 默认浏览器才退回普通
  打开（新标签页）。
- **发行版名字里带空格的，托盘拉不起来**：`wsl.exe` 读的是原始命令行并会保留
  `WScript.Shell.Run` 传过去的引号，`-d "My Distro"` 会被当成名为 `"My Distro"` 的发行版
  并报 `WSL_E_DISTRO_NOT_FOUND`（实测）。因此发行版名按 WSL 的期望裸传。

## 与上游同步

```sh
git remote -v                                 # upstream = liyu34/dsh-wsl-tray
git fetch upstream && git log --oneline upstream/master ^master
```

## 许可

MIT —— 见 [LICENSE](LICENSE)。上游的版权声明保留。
