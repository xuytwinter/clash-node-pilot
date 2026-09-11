<p align="center">
  <img src="packaging/icons/cat-sunglasses.png" alt="Clash Node Pilot — sunglasses cat" width="128" height="128">
</p>
<h1 align="center">Clash Node Pilot</h1>
<p align="center">運行在本機的 Clash/Mihomo 節點健康監測與優選控制檯。</p>
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <strong>繁體中文</strong> · <a href="https://github.com/xuytwinter/clash-node-pilot/releases/latest">下載安裝包</a> · <a href="docs/ROADMAP.md">路線圖</a> · <a href="packaging/icons/README.md">圖標使用</a></p>
<p align="center">
  <a href="https://github.com/xuytwinter/clash-node-pilot/releases/latest"><img src="https://img.shields.io/github/v/release/xuytwinter/clash-node-pilot" alt="Latest release"></a>
  <a href="https://github.com/xuytwinter/clash-node-pilot/actions/workflows/ci.yml"><img src="https://github.com/xuytwinter/clash-node-pilot/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
</p>

Clash Node Pilot 是一個運行在 Windows 和 macOS 本機的 Clash/Mihomo 節點優選控制檯。它只監聽 `127.0.0.1`，通過本機 Mihomo external controller 讀取代理組、測速並切換 `Selector`，Controller secret 只保留在本地 Node.js 後端，不返回瀏覽器、不寫入日誌、不寫入發佈說明。

> 非官方項目。本項目與 Clash Verge Rev、Clash for Windows、Mihomo、v2rayN、OpenAI 或任何代理服務商均無隸屬關係。

## 支持範圍

![隔離模擬 Controller 的英文演示界面](docs/images/demo-desktop.png)

- Windows 10/11 x64 每用戶安裝程序和便攜包。
- macOS 13+ Apple Silicon、Intel DMG，內含原生菜單欄啓動器；見 [Mac 安裝與驗收限制](docs/macos-delivery.md)。
- 已安裝並正在運行 Clash Verge Rev、Clash for Windows，或其他啓用了本機 external controller 的 Clash/Mihomo 客戶端。
- v2rayN 7.x 在 Windows 中仍僅做只讀檢測。
- 源碼與 CI 支持 Node.js 22.x；各平臺發佈包內置對應架構的官方 Node.js runtime。

不包含 Linux 桌面包、Android、iOS、Electron、瀏覽器擴展或 ChatGPT/OpenAI 集成。Mac 包使用 ad-hoc 簽名，尚無 Developer ID 簽名和 Apple 公證；Windows 安裝程序未簽名。

## 快速開始

0.4.2 提供 Windows `Setup.exe`、便攜 ZIP，以及 Mac `arm64.dmg`（Apple Silicon）和 `x64.dmg`（Intel）。Windows 安裝版包含開始菜單啓動與停止入口，詳見[安裝程序說明](docs/windows-installer.md)。Mac 掛載對應 DMG，將應用拖到 Applications 後打開，使用菜單欄 **CN > Quit** 停止服務；配置選擇與 Gatekeeper 限制見 [Mac 指南](docs/macos-delivery.md)。正式附件與校驗文件見 [Releases](https://github.com/xuytwinter/clash-node-pilot/releases)。

1. 使用 Windows 便攜版時，從 [GitHub Releases](https://github.com/xuytwinter/clash-node-pilot/releases) 獲取 `clash-node-pilot-v0.4.2-windows-x64-portable.zip` 及校驗文件。發佈產物以已打標籤的 Release 爲準。
2. 解壓到任意本地目錄，支持空格和中文路徑。
3. 雙擊 `start-clash-node-pilot.cmd`。
4. 如果瀏覽器沒有自動打開，手動訪問 `http://127.0.0.1:3210`。

便攜包內置 `runtime\node.exe`。普通用戶不需要安裝 Git、不需要執行 `npm install`，也不需要預裝 Node.js。

## 功能

- 讀取 Mihomo 手動 `Selector` 代理組和當前節點。
- 儘可能跟隨 Clash Verge UI 當前選擇的代理組；讀取不到時使用備用組名。
- 通過 Mihomo `/delay` API 使用可信 HTTPS 探測地址測試真實節點。
- 根據延遲、近期失敗、抖動、切換冷卻和閾值計算綜合評分。
- 當前地區仍有健康節點時不跨區；當前地區失敗後，會先用另一個可信探測地址複查同地區，避免目標探測服務故障導致誤跨區。
- 寫入 `PUT /proxies/:selector` 後再次讀回控制器狀態，只有確認成功才報告已切換。
- 持久保存手動保護、僅監控模式、歷史、最近結果和節點健康狀態。

程序不會編輯訂閱、provider 文件或真實 Clash/Mihomo YAML；只讀取配置中的 controller 地址和 secret。

## 控制檯模式

- 手動測速：選擇代理組和地區，執行一次測速並可選切換。
- 自動優化：使用歷史健康評分、多次採樣、閾值與冷卻定期複查當前地區。手動測速按單次延遲排序，不使用自動優化的同一套排名策略。
- 保通檢查：對 AI 或通用代理組做固定目標探測，僅在真實節點路徑異常時切換。
- 僅監控：只記錄推薦結果，不寫入代理組。
- 演示模式：啓動隔離的假 Mihomo controller 和臨時狀態目錄，不觸碰真實客戶端配置。

## 源碼開發

```powershell
git clone https://github.com/xuytwinter/clash-node-pilot.git
cd clash-node-pilot
npm test
npm start
```

常用腳本：

```powershell
npm run demo
npm run benchmark
npm run benchmark -- --json
npm run smoke:package
```

項目運行時不依賴第三方 npm 包。

## 配置

| 環境變量 | 用途 | 默認值 |
| --- | --- | --- |
| `PORT` | 本地控制檯端口 | `3210` |
| `CLASH_CONFIG` | 顯式指定 Clash/Mihomo 運行時配置路徑 | 自動識別本機客戶端 |
| `CLASH_TARGET_GROUP` | 讀不到 UI 當前選擇時使用的備用代理組 | 內置備用組名 |
| `CLASH_PILOT_STATE` | 顯式指定運行狀態文件路徑 | `%LOCALAPPDATA%\ClashNodePilot\state.json` |
| `CLASH_PILOT_DEMO` | 使用演示安全的 controller 發現模式 | 未設置 |
| `CLASH_PILOT_DISABLE_AUTO_LOOP` | 禁用內置自動輪詢 | 未設置 |
| `CLASH_PILOT_DISABLE_OS_INTEGRATION` | 禁用開機啓動和系統集成 | 未設置 |
| `SWITCH_THRESHOLD_MS` | 初始切換最低評分改善 | `25` |
| `SWITCH_COOLDOWN_MINUTES` | 初始切換冷卻時間 | `5` |
| `HEALTH_HALF_LIFE_MINUTES` | 初始歷史健康半衰期 | `60` |
| `MANUAL_PAUSE_MINUTES` | 檢測到外部手動切換後的保護時間 | `15` |
| `V2RAYN_HOME` | 顯式指定 v2rayN 目錄用於只讀檢測 | 自動讀取進程路徑 |

控制檯裏的設置也會持久保存到本地狀態文件。

## 開機啓動

在便攜包目錄運行：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-pilot-autostart.ps1
```

管理員任務計劃版本：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-autostart-admin.ps1
```

卸載啓動項：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\uninstall-pilot-autostart.ps1
```

守護腳本僅檢查本項目 `/api/health`，控制器斷連不會觸發 Clash 重啓，也不會終止 Clash 進程。自動調度由 Node 服務負責，舊 PowerShell 循環入口不再重複調度優化。`PORT` 或 `-Port` 統一指定啓動、健康檢查及啓動項端口，默認 `3210`。腳本優先使用便攜包內的 `runtime\node.exe`，源碼開發時纔回退到 `PATH` 中的 `node.exe`。

## 升級與回退

升級時，先停止舊 Node Pilot 實例，備份狀態文件及其 `.bak`，再將便攜包解壓到獨立目錄。自定義 `CLASH_PILOT_STATE` 時保持路徑一致，並從新目錄重新安裝 Windows 啓動項。默認狀態位於應用目錄之外，升級時保留。macOS 狀態路徑爲 `~/Library/Application Support/ClashNodePilot/state.json`。

兼容的舊狀態會經過校驗和遷移；損壞文件先保留，再嘗試恢復有效備份。遇到較新的未知 schema 時，禁止狀態寫入及修改操作。回退需使用舊程序與配套的升級前狀態副本，勿讓舊程序覆蓋新版狀態。隔離遷移和恢復測試不等於用戶真實機器上的升級已經驗證，詳見 [兼容性](docs/compatibility.md)。

## 本地 API 與診斷

先請求 `GET /api/session` 獲取 `{token}`；除 `/api/health` 和會話獲取端點外，其餘 `/api/` 請求均需攜帶 `x-pilot-session: <token>`。JSON POST 還需 `Content-Type: application/json`。瀏覽器自動處理會話。Host/Origin 檢查與進程級令牌不防同一用戶身份運行的惡意本地進程。

診斷導出只保留白名單字段，刪除名稱、路徑、端點和自由文本；標識符替換爲僅在當前報告內有效的匿名索引。時間戳、時間統計、計數和固定狀態碼仍會保留，分享前請審閱。詳見 [安全說明](SECURITY.md)。

合成基準使用模擬步驟指標，各策略探測預算不相等，不代表實測網絡恢復時間或生產優勢。結果及取捨見 [基準方法](docs/benchmarks.md)。

## 發佈打包

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\release.ps1
npm run smoke:package
```

版本默認讀取 `package.json`。打包保留舊 ZIP，拒絕覆蓋同版本已有產物；包內 `BUILD-INFO.json` 記錄來源 SHA、工作樹狀態。原生命令失敗會阻止構建和發佈流程繼續。

候選輸出：

- `outputs\clash-node-pilot-v0.4.2-windows-x64-portable.zip`
- `outputs\clash-node-pilot-v0.4.2-windows-x64-portable.zip.sha256`

macOS 使用 `bash scripts/build-macos.sh` 構建、`bash scripts/smoke-macos.sh` 驗收，詳見 [Mac 構建指南](docs/macos-delivery.md)。

## 文檔

- [Architecture](docs/architecture.md)
- [Compatibility](docs/compatibility.md)
- [Demo Mode](docs/demo.md)
- [Benchmarks](docs/benchmarks.md)
- [Security Policy](SECURITY.md)

## License

[MIT](LICENSE)
