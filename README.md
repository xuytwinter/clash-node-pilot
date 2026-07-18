# Clash Node Pilot

一个运行在本机的 Clash Verge Rev/Mihomo 节点优选工具：动态跟随代理客户端当前选择的代理组，优先在当前地区测速并切换到最快、最稳定的可用节点，只有整区失效时才跨地区故障转移。

> 非官方伴侣工具。本项目与 Clash Verge Rev、Clash for Windows、Mihomo 或 v2rayN 官方项目均无隶属关系。

## 功能特性

- 自动读取 Clash Verge 首页当前选择的代理组。
- 根据国旗、国家名称和常见城市名称识别节点地区。
- 通过 Mihomo Controller API 并发测试真实节点。
- 当前地区只要还有健康节点，就不会擅自跨区。
- 只有当前地区全部失败，才切换到其他地区中最快的健康节点。
- 只切换用户选择的手动 `Selector` 代理组，绝不修改订阅文件。
- Mihomo 控制器密钥只保留在本地后端，不会发送给浏览器。
- 提供响应式本地控制台和 Windows 开机启动脚本。
- 重启后保留优选设置、手动锁定、节点健康记录和最近 100 次运行历史。
- 支持切换迟滞、多次采样和历史失败率惩罚，避免频繁跳动和不稳定节点。
- 页面可直接查看最近一次自动测速排名和延迟趋势。

## 运行要求

- Windows 10/11
- Clash Verge Rev、Clash for Windows 或其他 Clash/Mihomo 客户端
- Node.js 18 或更高版本

## 客户端支持

| 客户端 | 自动识别 | 测速与切换 | 说明 |
| --- | --- | --- | --- |
| Clash Verge Rev | 支持 | 完整支持 | 跟随 Clash Verge UI 当前选择的代理组 |
| Clash for Windows | 支持 | 完整支持 | CFW 运行时使用标准 Clash Controller API |
| 其他 Clash/Mihomo 客户端 | 支持 | 完整支持 | 使用 `CLASH_CONFIG` 指定运行时配置路径 |
| v2rayN 7.x | 支持 | 只读检测 | 显示当前节点、历史延迟和节点数量 |

v2rayN 没有提供外部节点管理 API。它的官方切换流程会在保存 `IndexId` 后调用 GUI 进程内部的 `Reload()`；其他进程直接修改 JSON 文件不会让正在运行的 Xray 核心重新加载。因此，Clash Node Pilot 不会强制重启 v2rayN，也不会写入其数据库。完整的 v2rayN 切换需要上游提供 IPC/API，或开发专用的进程内桥接器。

## 快速开始

```powershell
git clone https://github.com/xuytwinter/clash-node-pilot.git
cd clash-node-pilot
npm start
```

打开 [http://127.0.0.1:3210](http://127.0.0.1:3210)。

项目只使用 Node.js 内置模块，不需要执行 `npm install`。

## Windows 开机启动

首次运行 `npm start` 后，打开控制台，点击页面右上角的“开机启动”即可。按钮显示“已开启”后，以后登录 Windows 不再需要手动执行 `npm start`。

该开关只管理 Clash Node Pilot 后端和三分钟优化任务，不会修改 Clash Verge、CFW 或 v2rayN 的开机设置。

也可以使用命令行安装当前用户启动项：

无需管理员权限的当前用户启动项：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-pilot-autostart.ps1
```

使用任务计划程序安装时，请以管理员身份打开 PowerShell：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-autostart-admin.ps1
```

自动优选任务每 3 分钟运行一次。日志写入 `auto-optimize.log`，该文件不会被 Git 跟踪。

运行状态保存在本地 `data/state.json`。`data` 目录不会被 Git 跟踪，其中也不会保存 Mihomo 控制器密钥。

卸载开机启动项：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\uninstall-pilot-autostart.ps1
```

## 节点选择策略

```text
读取代理客户端当前选择的代理组
  -> 识别当前节点地区
  -> 测试该地区的所有节点
  -> 选择最快且健康的节点
  -> 如果当前地区全部失败，复测其他地区
  -> 切换到最快的健康备用节点
  -> 如果所有地区都失败，保持当前配置
```

默认使用 `https://www.gstatic.com/generate_204` 进行探测，超时时间为 5000 毫秒，并发数为 6。

为了避免因几毫秒的网络抖动频繁切换，程序默认要求候选节点至少快 25 毫秒。检测到用户手动选择节点后，自动切换默认暂停 15 分钟。

## 配置

| 环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `PORT` | 本地控制台端口 | `3210` |
| `CLASH_CONFIG` | Clash/Mihomo 运行时配置路径 | 从本机客户端目录自动识别 |
| `CLASH_TARGET_GROUP` | 无法读取客户端 UI 选择时使用的备用代理组 | `🐟漏网之鱼` |
| `CLASH_PILOT_STATE` | 自定义持久化状态文件路径 | `data/state.json` |
| `SWITCH_THRESHOLD_MS` | 初始切换最低延迟改善 | `25` |
| `MANUAL_PAUSE_MINUTES` | 检测到手动选择后的初始保护时间 | `15` |
| `V2RAYN_HOME` | 手动指定 v2rayN 程序目录 | 自动读取运行中的 v2rayN 进程 |

控制台可以调整切换阈值、采样次数和手动保护时间，并提供仅监控模式、临时锁定、最近自动测速排名和延迟趋势。

## 使用教程

启动程序后访问 [http://127.0.0.1:3210/guide.html](http://127.0.0.1:3210/guide.html)，或点击控制台右上角的“文档”。

## 测试

```powershell
npm test
```

## 许可证

[MIT](LICENSE)
