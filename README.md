# Clash Node Pilot

A local node optimizer for Clash Verge Rev and Mihomo. It follows the proxy group selected in Clash Verge, benchmarks nodes within the current region, and automatically switches to the fastest available node.

一个运行在本机的 Clash Verge Rev/Mihomo 节点优选工具：动态跟随 Clash Verge 当前代理组，优先在当前地区测速并切换到最快节点，整区失效时才跨地区故障转移。

> Unofficial companion tool. This project is not affiliated with Clash Verge Rev or Mihomo.

## Features

- Reads the active proxy group selected in the Clash Verge home page.
- Detects regions from flags, country names, and common city names.
- Tests real nodes concurrently through the Mihomo Controller API.
- Stays in the current region while at least one node remains healthy.
- Falls back to the fastest node in another region only when the entire current region fails.
- Switches only the selected manual `Selector` group and never edits subscription files.
- Keeps the Mihomo controller secret on the local backend; it is never sent to the browser.
- Includes a responsive local dashboard and Windows auto-start scripts.

## Requirements

- Windows 10/11
- Clash Verge Rev with the Mihomo core running
- Node.js 18 or newer

## Quick Start

```powershell
git clone https://github.com/xuytwinter/clash-node-pilot.git
cd clash-node-pilot
npm start
```

Open [http://127.0.0.1:3210](http://127.0.0.1:3210).

No `npm install` is required because the application uses only Node.js built-in modules.

## Windows Auto-start

For a current-user installation without administrator privileges:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

For Task Scheduler installation, open PowerShell as administrator:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-autostart-admin.ps1
```

The optimizer runs every three minutes. Logs are written to `auto-optimize.log` and are excluded from Git.

To remove the startup entries:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\uninstall-autostart.ps1
```

## Selection Strategy

```text
Read the proxy group selected in Clash Verge
  -> detect the current node region
  -> test every node in that region
  -> switch to the fastest healthy node
  -> if every node in the region fails, test other regions
  -> switch to the fastest healthy fallback
  -> if every region fails, keep the current configuration
```

The default probe is `https://www.gstatic.com/generate_204` with a 5000 ms timeout and six concurrent tests.

## Configuration

| Environment variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Local dashboard port | `3210` |
| `CLASH_CONFIG` | Clash Verge runtime config path | Auto-detected from `%APPDATA%` |
| `CLASH_TARGET_GROUP` | Fallback group if the Clash Verge UI selection cannot be read | `🐟漏网之鱼` |

## Tests

```powershell
npm test
```

## License

[MIT](LICENSE)
