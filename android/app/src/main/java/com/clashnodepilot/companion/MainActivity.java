package com.clashnodepilot.companion;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final String[] LOCAL_CONTROLLER_CANDIDATES = new String[]{
            "http://127.0.0.1:9097",
            "http://127.0.0.1:9090",
            "http://127.0.0.1:9091",
            "http://localhost:9097",
            "http://localhost:9090"
    };
    private PairingStore store;
    private TextView status;
    private TextView clientSummary;
    private EditText controller;
    private EditText secret;
    private EditText targetGroup;
    private EditText nodeFilter;
    private ExternalClashApp clashApp;

    @Override
    protected void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        store = new PairingStore(this);
        clashApp = ExternalClashApp.detect(this);
        requestNotifications();
        buildUi();
        refreshClientSummary();
        updateStatus(store.isPaired() ? "已配对，可以立即优化或启动自动优化。" : "未配对。先打开 Clash Meta，启用 External Controller，然后点探测。");
    }

    private void requestNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 10);
        }
    }

    private void buildUi() {
        ScrollView root = Ui.root(this);
        LinearLayout layout = Ui.column(this, 20);
        root.addView(layout);

        Ui.add(layout, Ui.title(this, "Clash Node Pilot"));
        Ui.add(layout, Ui.body(this, "Android companion preview"));

        status = Ui.status(this);
        Ui.add(layout, status);

        Ui.add(layout, Ui.sectionTitle(this, "客户端"));
        clientSummary = Ui.body(this, "");
        Ui.add(layout, clientSummary);
        LinearLayout clientRow = Ui.row(this);
        Button refreshClient = Ui.secondaryButton(this, "刷新");
        Button openClient = Ui.secondaryButton(this, "打开");
        Button startClient = Ui.secondaryButton(this, "启动");
        Button stopClient = Ui.secondaryButton(this, "停止");
        Ui.addWeighted(clientRow, refreshClient);
        Ui.addWeighted(clientRow, openClient);
        Ui.addWeighted(clientRow, startClient);
        Ui.addWeighted(clientRow, stopClient);
        Ui.add(layout, clientRow);

        Ui.add(layout, Ui.sectionTitle(this, "Controller"));
        Ui.add(layout, Ui.body(this, "在 Clash Meta 的 Override Settings 里设置 External Controller，例如 127.0.0.1:9097；如设置 Secret，这里也填同一个。保存后重启 Clash 服务再探测。"));
        controller = Ui.input(this, "http://127.0.0.1:9097");
        controller.setText(store.controllerUrl());
        secret = Ui.input(this, "Controller secret，可空");
        Ui.add(layout, controller);
        Ui.add(layout, secret);
        LinearLayout controllerRow = Ui.row(this);
        Button probe = Ui.secondaryButton(this, "探测");
        Button pair = Ui.primaryButton(this, "配对");
        Ui.addWeighted(controllerRow, probe);
        Ui.addWeighted(controllerRow, pair);
        Ui.add(layout, controllerRow);

        Ui.add(layout, Ui.sectionTitle(this, "自动优化"));
        Ui.add(layout, Ui.body(this, "代理组名可空，默认自动选择 Selector。节点关键词可空；例如填 HK、香港、US、Japan，就只在匹配节点里测速。"));
        targetGroup = Ui.input(this, "代理组名，可空，例如 Proxy / Selector / 节点选择");
        targetGroup.setText(store.targetGroup());
        nodeFilter = Ui.input(this, "节点关键词，可空");
        nodeFilter.setText(store.nodeFilter());
        Ui.add(layout, targetGroup);
        Ui.add(layout, nodeFilter);
        LinearLayout serviceRow = Ui.row(this);
        Button optimizeNow = Ui.primaryButton(this, "立即优化");
        Button startPilot = Ui.primaryButton(this, "启动自动");
        Ui.addWeighted(serviceRow, optimizeNow);
        Ui.addWeighted(serviceRow, startPilot);
        Ui.add(layout, serviceRow);
        LinearLayout stopRow = Ui.row(this);
        Button stopPilot = Ui.secondaryButton(this, "停止自动");
        Button revoke = Ui.secondaryButton(this, "撤销配对");
        Ui.addWeighted(stopRow, stopPilot);
        Ui.addWeighted(stopRow, revoke);
        Ui.add(layout, stopRow);
        Ui.add(layout, Ui.body(this, "自动优化只通过标准 Clash/Mihomo Controller API 切换 Selector，不使用 root、ADB 或修改 Clash Meta 私有文件。"));

        refreshClient.setOnClickListener(view -> {
            clashApp = ExternalClashApp.detect(this);
            refreshClientSummary();
        });
        openClient.setOnClickListener(view -> openClient());
        startClient.setOnClickListener(view -> sendClashAction("START_CLASH", "已发送 Clash Meta 启动请求。"));
        stopClient.setOnClickListener(view -> sendClashAction("STOP_CLASH", "已发送 Clash Meta 停止请求。"));
        probe.setOnClickListener(view -> probe());
        pair.setOnClickListener(view -> pair(controller.getText().toString(), secret.getText().toString(), targetGroup.getText().toString(), nodeFilter.getText().toString()));
        optimizeNow.setOnClickListener(view -> optimizeOnce());
        startPilot.setOnClickListener(view -> startPilotService());
        stopPilot.setOnClickListener(view -> stopPilotService());
        revoke.setOnClickListener(view -> revokePairing());

        setContentView(root);
    }

    private void refreshClientSummary() {
        if (clashApp == null) {
            clientSummary.setText("未检测到 Clash Meta for Android。Android 需要一个能开放 Controller API 的 Clash/Mihomo 客户端。");
        } else {
            clientSummary.setText("已检测到 " + clashApp.label + " (" + clashApp.packageName + ")");
        }
    }

    private void openClient() {
        if (clashApp == null) {
            updateStatus("没有检测到已知 Clash Meta 客户端。");
            return;
        }
        Intent intent = clashApp.launchIntent(this);
        if (intent == null) {
            updateStatus("检测到客户端，但 Android 没有暴露可打开的 Activity。");
            return;
        }
        startActivity(intent);
    }

    private void sendClashAction(String action, String success) {
        if (clashApp == null) {
            updateStatus("没有检测到 Clash Meta，无法发送官方外部控制 intent。");
            return;
        }
        try {
            startActivity(clashApp.serviceIntent(action));
            updateStatus(success);
        } catch (ActivityNotFoundException error) {
            updateStatus("客户端没有为 " + action + " 暴露 ExternalControlActivity。");
        } catch (Exception error) {
            updateStatus("外部控制失败：" + error.getMessage());
        }
    }

    private void pair(String controllerUrl, String secretValue, String groupValue, String filterValue) {
        try {
            if (!controllerUrl.matches("https?://(127\\.0\\.0\\.1|localhost|\\[::1\\])(:\\d{2,5})?")) {
                updateStatus("Controller 必须是手机本机地址，例如 http://127.0.0.1:9097。");
                return;
            }
            store.save(controllerUrl, secretValue, groupValue, filterValue);
            updateStatus("已配对。Secret 使用 Android Keystore 加密保存。");
        } catch (Exception error) {
            updateStatus("配对失败：" + error.getMessage());
        }
    }

    private void startPilotService() {
        try {
            store.save(controller.getText().toString(), secret.getText().toString(), targetGroup.getText().toString(), nodeFilter.getText().toString());
        } catch (Exception error) {
            updateStatus("保存自动优化设置失败：" + error.getMessage());
            return;
        }
        Intent intent = new Intent(this, PilotForegroundService.class).setAction(PairingStore.ACTION_START);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent);
        else startService(intent);
        updateStatus("已请求启动自动优化前台服务。");
    }

    private void stopPilotService() {
        startService(new Intent(this, PilotForegroundService.class).setAction(PairingStore.ACTION_STOP));
        updateStatus("已请求停止自动优化。");
    }

    private void revokePairing() {
        store.revoke();
        startService(new Intent(this, PilotForegroundService.class).setAction(PairingStore.ACTION_REVOKE));
        controller.setText("");
        secret.setText("");
        targetGroup.setText("");
        nodeFilter.setText("");
        updateStatus("已撤销配对，本地状态已清除。");
    }

    private void probe() {
        updateStatus("正在探测手机本机 Controller 端口...");
        String secretValue = secret.getText().toString();
        new Thread(() -> {
            for (String candidate : LOCAL_CONTROLLER_CANDIDATES) {
                try {
                    ControllerClient client = new ControllerClient(candidate, secretValue);
                    client.get("/version");
                    AndroidOptimizer.Inspection inspection = AndroidOptimizer.inspect(client, targetGroup.getText().toString(), nodeFilter.getText().toString());
                    runOnUiThread(() -> {
                        controller.setText(candidate);
                        if (targetGroup.getText().toString().trim().isEmpty() && !inspection.groupName.isEmpty()) {
                            targetGroup.setText(inspection.groupName);
                        }
                        updateStatus("已找到 Controller：" + candidate + "；Selector 组 " + inspection.groupCount + " 个，当前使用 " + inspection.groupName + "，候选节点 " + inspection.candidateCount + " 个。");
                    });
                    return;
                } catch (ControllerHttpException error) {
                    if (error.statusCode == 401) {
                        runOnUiThread(() -> {
                            controller.setText(candidate);
                            updateStatus("找到 Controller，但需要 Secret：" + candidate);
                        });
                        return;
                    }
                } catch (Exception ignored) {
                    /* try the next common local port */
                }
            }
            runOnUiThread(() -> updateStatus("没有找到 Controller。请确认 Clash Meta 的 Override Settings 已设置 external-controller，并重启 Clash 服务。只启动 VPN 不等于开放 Controller API。"));
        }).start();
    }

    private void optimizeOnce() {
        if (!store.isPaired()) {
            pair(controller.getText().toString(), secret.getText().toString(), targetGroup.getText().toString(), nodeFilter.getText().toString());
            if (!store.isPaired()) return;
        } else {
            try {
                store.save(controller.getText().toString(), secret.getText().toString(), targetGroup.getText().toString(), nodeFilter.getText().toString());
            } catch (Exception error) {
                updateStatus("保存优化设置失败：" + error.getMessage());
                return;
            }
        }
        updateStatus("正在测速并选择最快节点...");
        new Thread(() -> {
            try {
                ControllerClient client = new ControllerClient(store.controllerUrl(), store.secret());
                AndroidOptimizer.Result result = AndroidOptimizer.optimize(client, store.targetGroup(), store.nodeFilter());
                runOnUiThread(() -> updateStatus(result.switched
                        ? "已切换 " + result.groupName + " 到 " + result.bestName + "，延迟 " + result.bestDelay + " ms。"
                        : "当前已是最快节点：" + result.bestName + "，延迟 " + result.bestDelay + " ms。"));
            } catch (Exception error) {
                runOnUiThread(() -> updateStatus("优化失败：" + error.getMessage()));
            }
        }).start();
    }

    private void updateStatus(String text) {
        status.setText(text);
    }
}
