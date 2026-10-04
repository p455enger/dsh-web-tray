# dsh-web-tray

English | [中文](README.zh.md)

Windows 开始菜单项 + 极简托盘图标，服务于**跑在 WSL 里的 `dsh web`**：只有两项 ——
**打开 DeepSeek Harness** 与 **退出 DeepSeek Harness** —— 仅此而已。没有守护进程、没有空闲
停服、没有状态文件，而且**不是 DSH 插件**：DSH 永远不会加载这个包，这个包也不关心 DSH 是
怎么装的，它只需要一个能起 web UI 的 `dsh` 命令和一个 WSL 发行版。

Fork 自 [liyu34/dsh-wsl-tray](https://github.com/liyu34/dsh-wsl-tray)（上游 `ff03276`，
v0.1.7，MIT）。保留上游架构（桌面快捷方式 + 隐藏托盘助手），去掉看门狗、菜单开关与状态监控。

## 它做什么

- **从开始菜单选择 `DeepSeek Harness (Web)`**：托盘隐藏启动。配置的地址无人应答时，`start.sh` 拉起实例
  （隐藏、不等待），随后带本次运行的 `?token=` 地址打开一次页面。已经显示该页面的窗口会被
  复用；如果它背后的实例已经停了，就**刷新那个窗口**，而不是另外开一份。
- **托盘图标**（由 `wscript.exe` + JScript 启动，永不出现控制台窗口）：
  - 左键：显示 DSH
  - 右键：**打开 DeepSeek Harness** / 分隔线 / **退出 DeepSeek Harness**
  - **退出**：让 `stop.sh` 停掉实例，并关闭所有显示该页面的窗口（Ctrl+W —— 浏览器窗口里关
    掉那个标签、app 窗口里关掉整个窗口，你别的标签永远不会被碰），然后托盘退出。
  - **手动关窗口**对 DSH、对托盘都没有任何影响。
- **菜单视觉复刻桌面端自己的托盘菜单。** 那个菜单是 Chromium 画的，不是 Windows
  `CreatePopupMenu` 的样子，所以配色与尺寸是在同一块屏幕上对着两个托盘图标实测出来的：
  深色 `#1F1F1F` 面板 175×97 px、`#E3E3E3` 文字、`#363636` 悬停、整宽 `#5E5E5E` 分隔线、
  系统 UI 字体 9pt、按 DPI 缩放；圆角交给 Windows 11 自己。常量在
  [`windows/dsh-web-tray.ps1`](windows/dsh-web-tray.ps1)，
  [`tests/tray.spec.ts`](tests/tray.spec.ts) 通过 Windows 互操作把它们钉死。
- **托盘图标就是页面自己的 favicon 鲸鱼**，按通知区域可能需要的两套墨色（浅色任务栏黑、深色
  白），尺寸与桌面端托盘图标一致；快捷方式用的是同一个 favicon（只有图形、没有底板），也就是
  Chromium「安装为应用」时的图标。任务栏主题每 5 秒重读一次。
- **任意 Chromium 内核浏览器**都能承载这个页面：Chrome、Edge、Brave、Vivaldi、Opera、
  Chromium、ungoogled-chromium、Thorium、Yandex、Arc 都支持 `--app=<url>` 且共用窗口类，
  于是优先用"已经见过这个页面的那个浏览器"开成应用窗口，其次是默认浏览器（前提是 Chromium
  系）；非 Chromium 默认浏览器才退回普通标签页。

## 依赖

- Windows 10/11 + WSL2，以及它自带的 Windows PowerShell 5.1（不需要 PS7，也不使用 PS7）。
- Node.js ≥20，**仅用于安装和执行 `dsh-web-tray` 命令**。托盘本身不需要 Node：它是一个隐藏的
  PowerShell 进程，WSL 侧只由它按需调用两个 shell 脚本。
- 一个能起 web UI 的 `dsh` 命令 —— 任何等价命令都行，见下面的 `DSH_COMMAND`。

## 安装

```sh
npm i -g dsh-web-tray
dsh-web-tray install --distro Debian --workspace ~/work
```

不安装也可以直接跑：`npx dsh-web-tray install`。

| 选项 | 含义 | 默认 |
| --- | --- | --- |
| `--distro <name>` | 托盘要驱动的 WSL 发行版 | `$WSL_DISTRO_NAME`，取不到则 `Ubuntu` |
| `--workspace <path>` | DSH 运行所在目录（它的工作区根） | 当前目录 |
| `--command <line>` | 启动 DSH 的命令行 | `dsh web --no-open` |
| `--port <number>` | web UI 端口 | `3080` |
| `--windows-user <u>` | 探测不到时，指定安装到哪个 Windows 用户 | 自动探测 |

安装只写一个 Windows 目录 + 一个开始菜单快捷方式：

| 路径 | 内容 |
| --- | --- |
| `%USERPROFILE%\.dsh\dsh-web-tray\` | `dsh-web-tray.ps1`（托盘）、`dsh-web-tray.js`（无控制台启动器）、`start.sh`、`stop.sh`、三个 `.ico`、`tray.env`，运行时另加 `start.log`、`tray.log`、`tray-shortcut.json`、`tray-selftest.json` 与卸载握手用的 `tray-exit.flag` |
| 开始菜单 | `DeepSeek Harness (Web).lnk` → `wscript.exe //E:JScript //B "<目录>\dsh-web-tray.js"` |

不写 WSL 文件系统；除这一个 `.dsh\dsh-web-tray` 目录外，也不动 DSH 的 home 目录。

**从 0.3.0（DSH 插件）过来**：装好 1.0，然后把插件和它的旧目录一起删掉 —— 1.0 不保留任何兼容。

```sh
dsh plugin --profile web remove dsh-web-tray
rm -rf ~/.dsh/dsh-web-tray
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `install` | 把托盘复制进安装目录、写 `tray.env`、创建桌面快捷方式（只启动一个 Windows 进程，没有安装脚本） |
| `uninstall` | 先请运行中的托盘退出，再删除快捷方式与所有安装文件；DSH 本体不动 |
| `status` | 安装目录、配置项、快捷方式是否存在、地址是否应答、最后几行日志 |
| `open` | 实例没应答就启动它，然后打印带授权的 URL |
| `stop` | 停掉 DSH web 实例 —— 与托盘「退出」项做的事相同 |

`uninstall` 通过一个标记文件（`tray-exit.flag`）与托盘对话：托盘 5 秒一次的 tick 消费它并退出，
所以图标会在文件被删之前消失；十秒内没有反应则用一次 PowerShell 调用把它结束。

## 配置

`tray.env` 就是全部配置，托盘与 `start.sh` 都读它：

```
DISTRO='Debian'
WSL_DIR='/mnt/c/Users/me/.dsh/dsh-web-tray'
WEB_URL='http://127.0.0.1:3080'
WORKSPACE='/home/me/work'
DSH_COMMAND='dsh web --no-open'
SHORTCUT_NAME='DSH Web'
```

值用单引号包裹、逐字读取；含单引号或换行的值在安装时就被拒绝，而不是被悄悄改写。改完用
`dsh-web-tray status` 检查；在 Windows 上编辑时请保持 LF 行尾。

从源码 checkout 运行 DSH 只是换一条命令行：

```
WORKSPACE='/home/me/harness'
DSH_COMMAND='pnpm --dir /home/me/harness run dsh:web'
```

`start.sh` 会在 `WORKSPACE` 里 `exec` 这条命令，输出追加到同目录的 `start.log`；工作区不存在时
它会明确报错。`~/.dsh/dsh-web-tray.env`（每行 `KEY=VALUE`）会先被 source —— 需要给 MCP server
传 token 就走这里。

## 工作原理

```
DSH Web.lnk
 └─ wscript.exe //E:JScript //B dsh-web-tray.js        GUI 宿主：不分配控制台
     └─ powershell.exe -WindowStyle Hidden -File dsh-web-tray.ps1
         ├─ 读 tray.env → 发行版、/mnt 路径、URL、快捷方式名
         ├─ 构建复刻菜单、按主题选图标墨色、必要时修复桌面快捷方式
         ├─ 打开流程：复用已显示该页面的窗口，否则用
         │  wsl.exe -d <发行版> -- bash -lc "exec '<目录>/start.sh'" 拉起 DSH，
         │  地址应答后刷新原窗口或开一个 --app 应用窗口
         └─ Application.Run()：左键/菜单，外加每 5 秒一次的 tick（管图标墨色与卸载标记）
```

退出项让 `stop.sh` 停实例并关闭显示该页面的窗口；两个调用都是隐藏且不等待的 —— 在 UI 线程上
等待 `wsl.exe` 正是过去把托盘卡死的原因。单实例互斥按**安装目录**划分，所以同一个快捷方式再
双击只会显示 DSH。

## 它对 DSH 的全部依赖

1. 用配置的命令启动（默认 `dsh web --no-open`）。
2. 把带授权的地址 `http://<host>:<port>/?token=…` 打到 stdout；托盘从 `start.log` 读取它，
   以便打开已授权的页面。若拿不到 token（实例是别人启动的），就按普通地址打开，页面可能要求
   你登录。
3. `stop.sh` 通过检查 `/proc/<pid>/cmdline` 里的 `dsh web` 找实例，因此陈旧的 PID 文件不会误杀
   无关进程；它会停掉**所有**能找到的 `dsh web` 实例。

## 已知限制

- 发行版名字里带空格的无法寻址：`wsl.exe` 读的是原始命令行，任何引号都会被它留下。
- 运行时必须存在 `/mnt/<盘符>`：两个 shell 脚本住在 Windows 侧、从那里执行。关掉自动挂载
  （`automount = false`）的发行版仍能显示/刷新已打开的窗口，但托盘无法启动 DSH。
- shell 脚本与 `tray.env` 由 bash 使用，必须保持 LF 行尾；被编辑器改成 CRLF 会让 `start.sh`
  失效，`dsh-web-tray status` 会就此告警。
- `start.log` 与 `tray.log` 只追加、不轮转。
- 一个 Windows 用户一份安装；快捷方式名字来自 `SHORTCUT_NAME`。

## 开发

```sh
npm test                                  # 34 项：安装器规则、图标资产、托盘互操作
npm run typecheck
DSH_WEB_TRAY_REQUIRE_INTEROP=1 npm test   # Windows 不可达时失败而不是跳过
```

`tests/tray.spec.ts` 用 `-SelfTest` 跑真正的助手：它构建真实的 NotifyIcon 与
ContextMenuStrip，把契约以 JSON 打印出来而不显示任何 UI —— 实测配色、菜单尺寸与两个按键和弦
都钉在那里。`tests/installer.spec.ts` 以注入方式（无需 Windows）覆盖路径、环境文件与文件集合；
`tests/icons.spec.ts` 解析随包的 `.ico` 并钉住帧结构与几何。
规则。

## 与上游同步

```sh
git remote -v                                 # upstream = liyu34/dsh-wsl-tray
git fetch upstream && git log --oneline upstream/master ^master
```

## License

MIT —— 见 [LICENSE](LICENSE)。上游的原始版权声明保留。
