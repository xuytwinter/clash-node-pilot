# Android 真机 Smoke Test 清单

使用 GitHub Actions 产出的 `clash-node-pilot-android-debug-apk` artifact。

## 安装

1. 在 GitHub Actions 对应 CI run 里下载 APK artifact。
2. 把 APK 安装到 Android 真机。
3. 首次启动时允许通知权限。
4. 不启用 root、ADB 自动化、AccessibilityService、私有文件访问或同签名/shared UID 假设。

## 配对

1. 在手机上启动兼容的 Clash/Mihomo 客户端，并开启本地 Controller API。
2. 打开 Clash Node Pilot。
3. 输入明确的本地 Controller URL，例如 `http://127.0.0.1:9097`。
4. 如果客户端要求 secret，再输入 Controller secret。
5. 点击 Pair and start。

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
