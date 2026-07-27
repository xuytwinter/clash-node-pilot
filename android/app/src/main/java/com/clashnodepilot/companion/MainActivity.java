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
    private TextView resultSummary;
    private LinearLayout resultsList;
    private Button regionAll;
    private Button regionHk;
    private Button regionJp;
    private Button regionSg;
    private Button regionUs;
    private ExternalClashApp clashApp;

    @Override
    protected void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        store = new PairingStore(this);
        clashApp = ExternalClashApp.detect(this);
        requestNotifications();
        buildUi();
        refreshClientSummary();
        updateStatus(store.isPaired() ? "已配对。选择地区后，可以开始测速并优选节点。" : "未配对。先打开 Clash Meta，启用 External Controller，然后点探测。");
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
        Ui.add(layout, Ui.body(this, "Android 节点优选伴侣"));

        status = Ui.status(this);
        Ui.add(layout, status);

        LinearLayout clientCard = Ui.card(this);
        Ui.add(clientCard, Ui.sectionTitle(this, "客户端"));
        clientSummary = Ui.body(this, "");
        Ui.add(clientCard, clientSummary);
        LinearLayout clientRow = Ui.row(this);
        Button refreshClient = Ui.secondaryButton(this, "刷新");
        Button openClient = Ui.secondaryButton(this, "打开");
        Button startClient = Ui.secondaryButton(this, "启动");
        Button stopClient = Ui.secondaryButton(this, "停止");
        Ui.addWeighted(clientRow, refreshClient);
        Ui.addWeighted(clientRow, openClient);
        Ui.addWeighted(clientRow, startClient);
        Ui.addWeighted(clientRow, stopClient);
        Ui.add(clientCard, clientRow);
        Ui.add(layout, clientCard);

        LinearLayout controllerCard = Ui.card(this);
        Ui.add(controllerCard, Ui.sectionTitle(this, "Controller 配对"));
        Ui.add(controllerCard, Ui.body(this, "在 Clash Meta 的 Override Settings 里开启 External Controller，例如 127.0.0.1:9097；如设置 Secret，这里也填同一个。保存后重启 Clash 服务再探测。"));
        controller = Ui.input(this, "http://127.0.0.1:9097");
        controller.setText(store.controllerUrl());
        secret = Ui.input(this, "Controller secret，可空");
        Ui.add(controllerCard, controller);
        Ui.add(controllerCard, secret);
        LinearLayout controllerRow = Ui.row(this);
        Button probe = Ui.secondaryButton(this, "探测");
        Button pair = Ui.primaryButton(this, "配对");
        Ui.addWeighted(controllerRow, probe);
        Ui.addWeighted(controllerRow, pair);
        Ui.add(controllerCard, controllerRow);
        Ui.add(layout, controllerCard);

        LinearLayout optimizerCard = Ui.card(this);
        Ui.add(optimizerCard, Ui.sectionTitle(this, "节点优选"));
        Ui.add(optimizerCard, Ui.body(this, "和 Windows 版一样：先选目标地区，再点“开始测速并优选”。应用会测速候选节点，并通过标准 Controller API 切到最快节点。"));
        targetGroup = Ui.input(this, "代理组名，可空，例如 Proxy / Selector / 节点选择");
        targetGroup.setText(store.targetGroup());
        nodeFilter = Ui.input(this, "节点关键词，可空；也可直接点下方地区");
        nodeFilter.setText(store.nodeFilter());
        Ui.add(optimizerCard, targetGroup);
        Ui.add(optimizerCard, nodeFilter);
        LinearLayout regionRowA = Ui.row(this);
        regionAll = Ui.chipButton(this, "全部");
        regionHk = Ui.chipButton(this, "香港");
        regionJp = Ui.chipButton(this, "日本");
        Ui.addWeighted(regionRowA, regionAll);
        Ui.addWeighted(regionRowA, regionHk);
        Ui.addWeighted(regionRowA, regionJp);
        Ui.add(optimizerCard, regionRowA);
        LinearLayout regionRowB = Ui.row(this);
        regionSg = Ui.chipButton(this, "新加坡");
        regionUs = Ui.chipButton(this, "美国");
        Button clearResults = Ui.secondaryButton(this, "清空结果");
        Ui.addWeighted(regionRowB, regionSg);
        Ui.addWeighted(regionRowB, regionUs);
        Ui.addWeighted(regionRowB, clearResults);
        Ui.add(optimizerCard, regionRowB);
        LinearLayout serviceRow = Ui.row(this);
        Button optimizeNow = Ui.primaryButton(this, "开始测速并优选");
        Button startPilot = Ui.primaryButton(this, "开启后台优选");
        Ui.addWeighted(serviceRow, optimizeNow);
        Ui.addWeighted(serviceRow, startPilot);
        Ui.add(optimizerCard, serviceRow);
        LinearLayout stopRow = Ui.row(this);
        Button stopPilot = Ui.secondaryButton(this, "停止后台优选");
        Button revoke = Ui.secondaryButton(this, "撤销配对");
        Ui.addWeighted(stopRow, stopPilot);
        Ui.addWeighted(stopRow, revoke);
        Ui.add(optimizerCard, stopRow);
        Ui.add(optimizerCard, Ui.caption(this, "节点优选只通过标准 Clash/Mihomo Controller API 切换 Selector，不使用 root、ADB 或修改 Clash Meta 私有文件。"));
        Ui.add(layout, optimizerCard);

        LinearLayout resultCard = Ui.card(this);
        Ui.add(resultCard, Ui.sectionTitle(this, "测速结果"));
        resultSummary = Ui.body(this, "还没有测速。探测 Controller 后会显示各地区候选数量。");
        Ui.add(resultCard, resultSummary);
        resultsList = Ui.column(this, 0);
        Ui.add(resultCard, resultsList);
        Ui.add(layout, resultCard);

        refreshClient.setOnClickListener(view -> {
            clashApp = ExternalClashApp.detect(this);
            refreshClientSummary();
        });
        openClient.setOnClickListener(view -> openClient());
        startClient.setOnClickListener(view -> sendClashAction("START_CLASH", "已发送 Clash Meta 启动请求。"));
        stopClient.setOnClickListener(view -> sendClashAction("STOP_CLASH", "已发送 Clash Meta 停止请求。"));
        probe.setOnClickListener(view -> probe());
        pair.setOnClickListener(view -> pair(controller.getText().toString(), secret.getText().toString(), targetGroup.getText().toString(), nodeFilter.getText().toString()));
        regionAll.setOnClickListener(view -> setRegionFilter("", "全部节点"));
        regionHk.setOnClickListener(view -> setRegionFilter("hk", "香港"));
        regionJp.setOnClickListener(view -> setRegionFilter("jp", "日本"));
        regionSg.setOnClickListener(view -> setRegionFilter("sg", "新加坡"));
        regionUs.setOnClickListener(view -> setRegionFilter("us", "美国"));
        clearResults.setOnClickListener(view -> clearResults());
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

    private void setRegionFilter(String filter, String label) {
        nodeFilter.setText(filter);
        clearResults();
        updateStatus("目标地区已切换为：" + label + "。点击“开始测速并优选”即可测速并切到最快节点。");
    }

    private void clearResults() {
        if (resultsList != null) resultsList.removeAllViews();
        if (resultSummary != null) resultSummary.setText("还没有新的测速结果。");
    }

    private void renderInspection(AndroidOptimizer.Inspection inspection) {
        StringBuilder summary = new StringBuilder();
        summary.append("当前代理组：").append(inspection.groupName.isEmpty() ? "未识别" : inspection.groupName);
        if (!inspection.current.isEmpty()) summary.append("，当前节点：").append(inspection.current);
        summary.append("。候选节点 ").append(inspection.candidateCount).append(" 个。");
        resultSummary.setText(summary.toString());
        for (AndroidOptimizer.RegionSummary region : inspection.regions) {
            Button button = regionButton(region.id);
            if (button != null) button.setText(region.label + " " + region.count);
        }
    }

    private Button regionButton(String id) {
        switch (id) {
            case "hk": return regionHk;
            case "jp": return regionJp;
            case "sg": return regionSg;
            case "us": return regionUs;
            default: return null;
        }
    }

    private void renderResults(AndroidOptimizer.Result result) {
        resultsList.removeAllViews();
        resultSummary.setText(
                "代理组：" + result.groupName
                        + "；已测速 " + result.tested + " 个，失败 " + result.failed + " 个；最快 "
                        + result.bestName + "（" + result.bestDelay + " ms）。"
                        + (result.switched ? " 已自动切换。" : " 当前已是最快。"));
        int index = 1;
        for (AndroidOptimizer.NodeResult item : result.rankings) {
            LinearLayout row = Ui.row(this);
            TextView rank = Ui.metric(this, item.best ? "最佳" : String.valueOf(index));
            LinearLayout nodeText = Ui.column(this, 0);
            Ui.add(nodeText, Ui.resultName(this, item.name, item.best));
            Ui.add(nodeText, Ui.caption(this, item.activeBefore ? "测速前正在使用" : (item.ok ? "测速成功" : "测速失败")));
            TextView delay = Ui.delay(this, item.ok ? item.delay + " ms" : "失败", item.ok, item.best);
            Ui.addWeighted(row, rank, 0.9f);
            Ui.addWeighted(row, nodeText, 3.8f);
            Ui.addWeighted(row, delay, 1.4f);
            Ui.add(resultsList, row);
            index++;
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
            store.save(controllerUrl, secretValue, groupValue, filterValue);
            updateStatus("已配对。Secret 使用 Android Keystore 加密保存。");
        } catch (IllegalArgumentException error) {
            updateStatus("Controller 必须是手机本机地址，例如 http://127.0.0.1:9097。");
        } catch (Exception error) {
            updateStatus("配对失败：" + error.getMessage());
        }
    }

    private void startPilotService() {
        try {
            store.save(controller.getText().toString(), secret.getText().toString(), targetGroup.getText().toString(), nodeFilter.getText().toString());
        } catch (Exception error) {
            updateStatus("保存节点优选设置失败：" + error.getMessage());
            return;
        }
        Intent intent = new Intent(this, PilotForegroundService.class).setAction(PairingStore.ACTION_START);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent);
        else startService(intent);
        updateStatus("已开启后台节点优选。系统通知会显示运行状态。");
    }

    private void stopPilotService() {
        startService(new Intent(this, PilotForegroundService.class).setAction(PairingStore.ACTION_STOP));
        updateStatus("已请求停止后台节点优选。");
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
                        renderInspection(inspection);
                        updateStatus("已找到 Controller：" + candidate + "；识别到 Selector 组 " + inspection.groupCount + " 个，可以开始节点优选。");
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
                updateStatus("保存节点优选设置失败：" + error.getMessage());
                return;
            }
        }
        clearResults();
        updateStatus("正在测速并优选节点...");
        new Thread(() -> {
            try {
                ControllerClient client = new ControllerClient(store.controllerUrl(), store.secret());
                AndroidOptimizer.Result result = AndroidOptimizer.optimize(client, store.targetGroup(), store.nodeFilter());
                runOnUiThread(() -> {
                    renderResults(result);
                    updateStatus(result.switched
                            ? "节点优选完成：已切换到 " + result.bestName + "，延迟 " + result.bestDelay + " ms。"
                            : "节点优选完成：当前已是最快节点 " + result.bestName + "，延迟 " + result.bestDelay + " ms。");
                });
            } catch (Exception error) {
                runOnUiThread(() -> updateStatus("节点优选失败：" + error.getMessage()));
            }
        }).start();
    }

    private void updateStatus(String text) {
        status.setText(text);
    }
}
