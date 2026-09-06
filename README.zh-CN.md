# Clash Node Pilot

Clash Node Pilot 是一个运行在 Windows 本机的 Clash/Mihomo 节点优选控制台。它只监听 `127.0.0.1`，通过本机 Mihomo external controller 读取代理组、测速并切换 `Selector`，Controller secret 只保留在本地 Node.js 后端，不返回浏览器、不写入日志、不写入发布说明。

> 非官方项目。本项目与 Clash Verge Rev、Clash for Windows、Mihomo、v2rayN、OpenAI 或任何代理服务商均无隶属关系。

## 支持范围

- Windows 10/11 x64 便携包。
- 已安装并正在运行 Clash Verge Rev、Clash for Windows，或其他启用了本机 external controller 的 Clash/Mihomo 客户端。
- v2rayN 7.x 在 v0.1.0 中仅做只读检测。
- 源码开发需要 Node.js 18 或更新版本；发布包内置官方 Node.js 22.x Windows x64 runtime。

v0.1.0 不包含 macOS、Linux、Android、iOS、Electron、浏览器扩展或 ChatGPT/OpenAI 集成。

## 快速开始

1. 到 GitHub Releases 下载 `clash-node-pilot-v0.1.0-windows-x64-portable.zip`。
2. 解压到任意本地目录，支持空格和中文路径。
3. 双击 `start-clash-node-pilot.cmd`。
4. 如果浏览器没有自动打开，手动访问 `http://127.0.0.1:3210`。

便携包内置 `runtime\node.exe`。普通用户不需要安装 Git、不需要执行 `npm install`，也不需要预装 Node.js。

## 功能

- 读取 Mihomo 手动 `Selector` 代理组和当前节点。
- 尽可能跟随 Clash Verge UI 当前选择的代理组；读取不到时使用备用组名。
- 通过 Mihomo `/delay` API 使用可信 HTTPS 探测地址测试真实节点。
- 根据延迟、近期失败、抖动、切换冷却和阈值计算综合评分。
- 当前地区仍有健康节点时不跨区；当前地区失败后，会先用另一个可信探测地址复查同地区，避免目标探测服务故障导致误跨区。
- 写入 `PUT /proxies/:selector` 后再次读回控制器状态，只有确认成功才报告已切换。
- 持久保存手动保护、仅监控模式、历史、最近结果和节点健康状态。

程序不会编辑订阅、provider 文件或真实 Clash/Mihomo YAML；只读取配置中的 controller 地址和 secret。

## 控制台模式

- 手动测速：选择代理组和地区，执行一次测速并可选切换。
- 自动优化：定期复查当前地区，使用同一套决策策略。
- 保通检查：对 AI 或通用代理组做固定目标探测，仅在真实节点路径异常时切换。
- 仅监控：只记录推荐结果，不写入代理组。
- 演示模式：启动隔离的假 Mihomo controller 和临时状态目录，不触碰真实客户端配置。

## 源码开发

```powershell
git clone https://github.com/xuytwinter/clash-node-pilot.git
cd clash-node-pilot
npm test
npm start
```

常用脚本：

```powershell
npm run demo
npm run benchmark
npm run benchmark -- --json
```

项目运行时不依赖第三方 npm 包。

## 配置

| 环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `PORT` | 本地控制台端口 | `3210` |
| `CLASH_CONFIG` | 显式指定 Clash/Mihomo 运行时配置路径 | 自动识别本机客户端 |
| `CLASH_TARGET_GROUP` | 读不到 UI 当前选择时使用的备用代理组 | 内置备用组名 |
| `CLASH_PILOT_STATE` | 显式指定运行状态文件路径 | `%LOCALAPPDATA%\ClashNodePilot\state.json` |
| `CLASH_PILOT_DEMO` | 使用演示安全的 controller 发现模式 | 未设置 |
| `CLASH_PILOT_DISABLE_AUTO_LOOP` | 禁用内置自动轮询 | 未设置 |
| `CLASH_PILOT_DISABLE_OS_INTEGRATION` | 禁用开机启动和系统集成 | 未设置 |
| `SWITCH_THRESHOLD_MS` | 初始切换最低评分改善 | `25` |
| `SWITCH_COOLDOWN_MINUTES` | 初始切换冷却时间 | `5` |
| `HEALTH_HALF_LIFE_MINUTES` | 初始历史健康半衰期 | `60` |
| `MANUAL_PAUSE_MINUTES` | 检测到外部手动切换后的保护时间 | `15` |
| `V2RAYN_HOME` | 显式指定 v2rayN 目录用于只读检测 | 自动读取进程路径 |

控制台里的设置也会持久保存到本地状态文件。

## 开机启动

在便携包目录运行：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-pilot-autostart.ps1
```

管理员任务计划版本：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-autostart-admin.ps1
```

卸载启动项：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\uninstall-pilot-autostart.ps1
```

日志默认写入 `%LOCALAPPDATA%\ClashNodePilot`。脚本优先使用便携包内的 `runtime\node.exe`，源码开发时才回退到 `PATH` 中的 `node.exe`。

## 发布打包

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\release.ps1
```

输出：

- `outputs\clash-node-pilot-v0.1.0-windows-x64-portable.zip`
- `outputs\clash-node-pilot-v0.1.0-windows-x64-portable.zip.sha256`

## 文档

- [Architecture](docs/architecture.md)
- [Compatibility](docs/compatibility.md)
- [Demo Mode](docs/demo.md)
- [Benchmarks](docs/benchmarks.md)
- [Security Policy](SECURITY.md)

## License

[MIT](LICENSE)
