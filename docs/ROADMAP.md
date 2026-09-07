# Delivery Roadmap

[English](#english) | [中文](#中文)

## English

This roadmap separates published features from work in progress. Versions for future milestones are assigned after acceptance, not promised dates.

### Published: 0.2.0

- [x] Windows x64 portable ZIP with bundled Node.js 22, source metadata and SHA256.
- [x] Local API sessions, redacted diagnostics and selector PUT readback.
- [x] Job coordination, state recovery and explicit post-write persistence errors.
- [x] Isolated bilingual demo and reproducible synthetic policy benchmarks.
- [x] Windows, macOS and Linux core CI. This is not macOS/Linux desktop support.

Evidence: [v0.2.0 release](https://github.com/xuytwinter/clash-node-pilot/releases/tag/v0.2.0), [main CI](https://github.com/xuytwinter/clash-node-pilot/actions/workflows/ci.yml), [benchmarks](benchmarks.md).

### Windows Installer: 0.3.0 Preview

Implementation and acceptance details: [Windows installer](windows-installer.md).

- [x] Build a per-user `Setup.exe` from the verified portable payload using Inno Setup.
- [x] Provide Start Menu and optional desktop shortcuts, with no implicit autostart.
- [x] Preserve user state during same-version reinstall and uninstall; refuse live-runtime replacement.
- [x] Verify installation, reinstall, uninstall, desktop integration and Chinese/spaced paths in isolated Windows environments.
- [x] Verify the published 0.3.0 installer upgrades to 0.4.0 while preserving external and unmanaged portable state: [upgrade acceptance](https://github.com/xuytwinter/clash-node-pilot/actions/runs/34156504909).
- [ ] Verify installer downgrades and historical runtime-state migrations with matching backups.
- [x] Publish the installer alongside the portable ZIP with checksums and source metadata after acceptance: [v0.3.0](https://github.com/xuytwinter/clash-node-pilot/releases/tag/v0.3.0).

The installed application retains the local-browser UI. A standalone desktop window is a separate milestone. Initial builds may be unsigned; distribution must state signing status accurately.

### Cross-platform Packages: 0.4.0

Audited reuse plan and platform gates: [macOS delivery](macos-delivery.md).

- [x] Review reusable macOS work against the current controller and session APIs.
- [x] Adapt configuration discovery, application state paths and owned-process lifecycle.
- [x] Package native `.app` bundles inside Apple Silicon and Intel `.dmg` files with runtime and source metadata.
- [x] Exercise both architecture-specific DMGs: mount/copy, Unicode paths, sessions, selector readback, repeated launch, state retention, quit and occupied-port handling. [Initial acceptance](https://github.com/xuytwinter/clash-node-pilot/actions/runs/34155768071).
- [x] Gate combined Windows/macOS release publication on package acceptance for all architectures.
- [ ] Verify launch, quit, port conflicts, upgrade and rollback on a real Mac.
- [ ] Record Developer ID signing, notarization and Gatekeeper results before general-release claims.

A DMG alone does not establish macOS compatibility. Packages use ad-hoc signing without Developer ID or notarization. Physical-device acceptance and real-client compatibility remain open; see [release notes](../RELEASE_NOTES.md) for the distribution's limits.

### Later

- [ ] Evaluate a tray and standalone window with Electron or Tauri only after defining process ownership and maintenance costs.
- [ ] Consider signed updates with failure recovery; retain manual downloads and rollback.
- [ ] Expand real-client compatibility evidence, user trials, contribution guidance and workflow tests.

## 中文

路线图按“已发布、正在推进、后续”区分状态；未来版本号在验收后确定，不把计划当成已交付功能。

| 阶段 | 产物与目标 | 验收标准 |
| --- | --- | --- |
| 已发布 0.2.0 | Windows x64 便携 ZIP、双语 Demo、安全会话、诊断与实验 | 已有 Release、CI、包内 API 与隔离启动验收 |
| 0.3.0 预览验收通过 | Windows `Setup.exe`，保留便携 ZIP | 每用户安装、快捷方式、同版本重装与卸载保留配置、运行中实例拒绝覆盖、中文路径、内部链接拒绝；跨版本升级另验 |
| 0.4.0 跨平台包 | macOS Apple Silicon/Intel `.dmg` 与 Windows 安装版、便携版 | 两种 Mac 架构的包内生命周期 CI 已通过；实际设备、真实客户端、跨版本升级与公证仍待验收 |
| 再后续 | 托盘、独立窗口、可信更新 | 明确进程归属、退出行为、更新失败恢复与长期维护成本 |

Windows 安装程序首先沿用现有浏览器界面。独立桌面窗口属于另一项改造，不因出现 `Setup.exe` 就宣称已经具备。

macOS 的 Node 测试通过，不等于桌面程序兼容性已经完成。没有真实设备验证、签名或公证时会明确标记，不将预览包描述为成熟的跨平台发行版。

每个阶段都需要可追踪的提交、测试与发行证据；未完成条目保持未勾选。私人规划和面试材料不属于此公开路线图。
