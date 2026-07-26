# Clash Node Pilot

Clash Node Pilot 是一个运行在 Windows 本机的 Clash/Mihomo 节点优选工具。它只监听 `127.0.0.1`，通过本机 Mihomo Controller 读取代理组并执行测速/切换，Controller secret 只留在本地 Node 后端，不会发送到浏览器、日志或发布包说明中。

> 非官方工具。本项目与 Clash Verge Rev、Clash for Windows、Mihomo、v2rayN 官方项目均无隶属关系。

## 普通用户下载和启动

适用范围：Windows 10/11 x64，已安装并正在运行 Clash Verge Rev、Clash for Windows 或其他 Clash/Mihomo 客户端。

1. 到 GitHub Release 下载 `clash-node-pilot-v0.1.0-windows-x64-portable.zip`。
2. 解压到任意英文或中文目录。
3. 双击 `start-clash-node-pilot.cmd`，浏览器会打开 `http://127.0.0.1:3210`。

v0.1.0 便携包已内置官方 Node.js 22.x Windows x64 runtime。普通用户不需要安装 Git、不需要执行 `npm install`，也不需要预装 Node.js。

升级时，关闭旧窗口后用新版目录覆盖或解压到新目录即可。运行状态和日志默认保存在 `%LOCALAPPDATA%\ClashNodePilot`，不会因为更换程序目录而丢失。若你显式设置了 `CLASH_PILOT_STATE`，该路径始终优先。

## 功能

- 自动读取 Clash Verge 当前选择的代理组。
- 支持 Clash Verge Rev、Clash for Windows 和自定义 Clash/Mihomo 配置。
- 根据国旗、国家名和常见城市名识别节点地区。
- 通过 Mihomo Controller API 并发测试真实节点。
- 当前地区还有健康节点时不跨区切换，整区失败后才使用其他地区兜底。
- 只切换用户选择的手动 `Selector` 代理组，不修改订阅文件。
- 支持手动保护、仅监控模式、最近历史、健康分和延迟趋势。
- 提供 Windows 开机启动、看门狗恢复和卸载脚本。

## Windows 开机启动

便携包启动后可以在页面里开启当前用户启动项。也可以在程序目录运行：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-pilot-autostart.ps1
```

管理员任务计划程序版本：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-autostart-admin.ps1
```

卸载开机启动：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\uninstall-pilot-autostart.ps1
```

日志默认写入 `%LOCALAPPDATA%\ClashNodePilot`。脚本会优先使用程序目录里的 `runtime\node.exe`，开发源码运行时才回退到 PATH 中的 `node.exe`。

## 配置

| 环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `PORT` | 本地控制台端口 | `3210` |
| `CLASH_CONFIG` | Clash/Mihomo 运行时配置路径 | 自动识别本机客户端 |
| `CLASH_TARGET_GROUP` | 读不到 UI 当前选择时使用的备用代理组 | 内置默认组名 |
| `CLASH_PILOT_STATE` | 自定义持久状态文件路径 | `%LOCALAPPDATA%\ClashNodePilot\state.json` |
| `SWITCH_THRESHOLD_MS` | 初始切换最低延迟改善 | `25` |
| `MANUAL_PAUSE_MINUTES` | 检测到手动切换后的保护时间 | `15` |
| `V2RAYN_HOME` | 手动指定 v2rayN 程序目录 | 自动读取运行中的 v2rayN 进程 |

首次升级到 v0.1.0 时，如果新状态文件不存在且旧版 `data\state.json` 存在，程序会复制一次旧状态到 `%LOCALAPPDATA%\ClashNodePilot\state.json`，不会删除旧文件。

## 开发者运行

源码开发仍可直接使用系统 Node.js：

```powershell
git clone https://github.com/xuytwinter/clash-node-pilot.git
cd clash-node-pilot
npm test
npm start
```

项目只使用 Node.js 内置模块，没有第三方 npm 依赖。

## 发布打包

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\release.ps1
```

脚本会生成：

- `outputs\clash-node-pilot-v0.1.0-windows-x64-portable.zip`
- `outputs\clash-node-pilot-v0.1.0-windows-x64-portable.zip.sha256`

## License

[MIT](LICENSE)

## Cross-platform Preview Branch

This branch keeps the Windows v0.1.0 local API boundary while extracting shared Controller and optimizer code for macOS and Android.

- Shared core: `src/core` contains Controller requests, Selector inventory parsing, region matching, latency measurement, health scoring, capability states, and diagnostics.
- Platform adapters: `src/platform` separates Windows discovery/startup behavior from macOS adapters, Keychain storage, LaunchAgent preview support, and manual local Controller pairing.
- macOS Preview: see `docs/macos-preview.md`. Build signed/notarized distribution is not part of the first Preview; GitHub artifacts are unsigned portable zips for Apple Silicon and Intel.
- Android companion: see `android/README.md`. The Android app is non-root, uses explicit pairing, stores secrets with Android Keystore-backed encryption, and runs automation only through a foreground service notification.
- Compatibility: see `docs/compatibility-matrix.md`.

Development and tests must use fake or isolated Controllers. Do not point automated tests at the user's active Windows Clash/Mihomo Controller.
