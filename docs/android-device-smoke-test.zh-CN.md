# Android 真机 Smoke Test 清单

使用 GitHub Actions 产出的 `clash-node-pilot-android-debug-apk` artifact。

## 安装

1. 从对应 CI run 下载 APK artifact。
2. 安装到 Android 真机。
3. 首次启动时允许通知权限。
4. 不启用 root、ADB 自动化、AccessibilityService、私有文件访问或 same-signature/shared-UID 假设。

## Clash Meta 设置

1. 打开 Clash Meta for Android。
2. 进入 Settings / Override。
3. 找到 External Controller，建议先填 `127.0.0.1:9097`。
4. 如需鉴权，在 Clash Meta 的 Secret 里填一个你自己设置的值。
5. 保存后重启 Clash 服务。
6. 注意：Clash Meta 源码会先清空订阅 YAML 里的 `external-controller`，必须通过 Override Settings 生效。

## Node Pilot 配对

1. 打开 Clash Node Pilot。
2. 在 Client 区域点“刷新”，确认识别到 Clash Meta for Android。
3. 可用“打开 / 启动 / 停止”验证 Clash Meta 官方 intent；这只代表能开关服务，不代表能切节点。
4. 在 Controller 区域填 `http://127.0.0.1:9097`。
5. 如果 Clash Meta 设置了 Secret，在 Node Pilot 里填同一个 Secret；不要截图分享 Secret。
6. 点“探测”。
7. 期望看到：已找到 Controller，并显示 Selector 组数量、当前使用的组、候选节点数量。
8. 如果代理组名为空，探测成功后会自动填入一个可切换 Selector。
9. 点“配对”。

## 自动切换测试

1. 节点关键词可空。为空时在目标 Selector 的全部真实节点里测速。
2. 如果只想测某个地区，可填关键词，例如 `HK`、`香港`、`US`、`Japan`。
3. 点“立即优化”。
4. 期望看到：已切换到最快节点，或提示当前已是最快节点。
5. 打开 Clash Meta，确认对应 Selector 当前节点已经变化。
6. 点“启动自动”，通知栏应出现 Node Pilot 前台服务。
7. 默认每 3 分钟自动优化一次。
8. 点“停止自动”应停止前台服务，但保留配对。
9. 点“撤销配对”应清空本地配对状态并停止服务。

## 必测项

- Controller 可达：探测能读到 `/version` 和 `/proxies`。
- Secret 错误：应提示需要 Secret 或优化失败，不输出 Secret。
- 没有 Controller API：只能开关 Clash，不能切节点，并给出明确诊断。
- 全部测速失败：不切换节点。
- 进程死亡：重新打开后可继续使用已保存配对，不需要重新输入 Secret。
- 手机重启：仅在已有配对时尝试恢复前台服务。
- 电池限制：记录厂商系统是否限制后台前台服务。

## 记录证据

- 手机型号、Android 版本、Clash Meta 版本。
- 是否授予通知权限。
- Controller URL 形式，不记录 Secret。
- 探测结果、候选节点数量、立即优化结果。
- Clash Meta 中 Selector 是否真的变更。

不要分享 Controller Secret、订阅 URL、APK 签名材料或客户端私有配置文件。
