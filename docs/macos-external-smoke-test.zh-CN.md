# macOS 外部 Smoke Test 清单

使用 GitHub Actions 产出的 `clash-node-pilot-macos-preview-zips` artifact。

## 安装

1. 根据测试机器选择 zip：
   - Apple Silicon：`darwin-arm64`
   - Intel：`darwin-x64`
2. 校验对应 `.sha256`：

```sh
shasum -a 256 clash-node-pilot-v0.1.0-darwin-arm64-portable.zip
cat clash-node-pilot-v0.1.0-darwin-arm64-portable.zip.sha256
```

3. 解压 zip。
4. Control-click `start-clash-node-pilot.command`，选择 Open，并确认未签名 Preview 的 Gatekeeper 提示。

## 必测项

- 启动：终端能启动 Node Pilot，并打印本地 `127.0.0.1` URL。
- Web UI：浏览器能打开本地控制台。
- 手动配对：只配对到 fake Controller 或隔离 Controller。
- secret 边界：`/api/pairings` 只返回 id、名称和 Controller URL，不能返回 secret。
- 退出：关闭终端后 Node Pilot 停止，不修改 Clash/Mihomo 配置。

## 需要记录的证据

- Mac 型号、CPU 架构和 macOS 版本。
- 测试的是哪个 artifact。
- Gatekeeper 提示和打开流程。
- 每个必测项的通过/失败结果。
- Keychain 提示文本，不要记录 secret。

该 Preview 未签名、未 notarize。只有 Apple Silicon 和 Intel 真机都通过清单后，才可以声称 macOS 真机启动验证通过。
