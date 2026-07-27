# Android 真机 Smoke Test 清单

使用 GitHub Actions 产出的 `clash-node-pilot-android-debug-apk` artifact。

## 安装

1. 在 GitHub Actions 对应 CI run 里下载 APK artifact。
2. 把 APK 安装到 Android 真机。
3. 首次启动时允许通知权限。
4. 不启用 root、ADB 自动化、AccessibilityService、私有文件访问或同签名/shared UID 假设。

## 配对

1. 在手机上启动兼容的 Clash/Mihomo 客户端。Clash Verge Rev 官方是桌面端；Android 侧优先测试 Clash Meta for Android 或其它明确暴露 Controller API 的客户端。
2. 打开 Clash Node Pilot。
3. 在 Client 区域点击 Refresh。若检测到 Clash Meta，可以点击 Open/Start/Stop 验证官方外部控制 intent。
4. 注意：Clash Meta 的外部控制 intent 只代表可启动/停止客户端服务，不代表已经开放 Controller API。
5. 对 Clash Meta for Android，源码里 `external-controller` 是 Override Settings 里的配置项。进入 Clash Meta 的 Settings / Override，找到 External Controller。
6. 建议先填 `127.0.0.1:9097`；如需鉴权，再在 Secret 里填一个你自己设置的值。
7. 保存后重启 Clash 服务。注意订阅 YAML 里的 `external-controller` 会被 Clash Meta 先清空，必须通过 Override Settings 生效。
8. 回到 Node Pilot，点击 Probe。若提示 secret required，把 Clash Meta 里的 Secret 输入到 Node Pilot。
9. 如果自动探测失败，再手动尝试 `http://127.0.0.1:9097` 或 `http://127.0.0.1:9090`。
10. 点击 Pair。
11. 点击 Start Pilot。

期望结果：应用提示配对成功，并出现一个常驻前台服务通知。

## 必测项

- Controller 可达：通知显示 Controller reachable。
- Controller 停止：关闭 Clash/Mihomo 客户端后，通知显示不可达，并且不执行任何切换。
- 撤销配对：点击 Revoke pairing 后，通知消失，本地配对状态被清除。
- 进程死亡：划掉应用或让系统回收进程后，再次启动应继续使用已保存配对，不需要重新输入 secret。
- 手机重启：如果已有配对，重启后前台服务应能恢复；如果没有配对，不应自动运行。
- 电池限制：如果系统限制后台运行，记录厂商提示或实际行为。

## 需要记录的证据

- 手机型号、Android 版本、Clash/Mihomo 客户端名称和版本。
- 是否授予通知权限。
- Controller URL 形式，不要记录 secret。
- 每个必测项的通过/失败结果。
- 电池优化、前台服务、通知权限相关的系统提示文本。

不要分享 Controller secret、订阅 URL、APK 签名材料或客户端私有配置文件。
