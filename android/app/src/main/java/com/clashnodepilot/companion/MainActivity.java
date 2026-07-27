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
    private ExternalClashApp clashApp;

    @Override
    protected void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        store = new PairingStore(this);
        clashApp = ExternalClashApp.detect(this);
        requestNotifications();
        buildUi();
        refreshClientSummary();
        updateStatus(store.isPaired() ? "Paired. Foreground service can run." : "Not paired. Detect the client, then probe Controller.");
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

        Ui.add(layout, Ui.sectionTitle(this, "Client"));
        clientSummary = Ui.body(this, "");
        Ui.add(layout, clientSummary);
        LinearLayout clientRow = Ui.row(this);
        Button refreshClient = Ui.secondaryButton(this, "Refresh");
        Button openClient = Ui.secondaryButton(this, "Open");
        Button startClient = Ui.secondaryButton(this, "Start");
        Button stopClient = Ui.secondaryButton(this, "Stop");
        Ui.addWeighted(clientRow, refreshClient);
        Ui.addWeighted(clientRow, openClient);
        Ui.addWeighted(clientRow, startClient);
        Ui.addWeighted(clientRow, stopClient);
        Ui.add(layout, clientRow);

        Ui.add(layout, Ui.sectionTitle(this, "Controller"));
        Ui.add(layout, Ui.body(this, "Clash Meta source defines this in Override settings: external-controller and secret. Set External Controller to 127.0.0.1:9097, then restart Clash service before probing."));
        controller = Ui.input(this, "http://127.0.0.1:9097");
        controller.setText(store.controllerUrl());
        secret = Ui.input(this, "Controller secret");
        Ui.add(layout, controller);
        Ui.add(layout, secret);
        LinearLayout controllerRow = Ui.row(this);
        Button probe = Ui.secondaryButton(this, "Probe");
        Button pair = Ui.primaryButton(this, "Pair");
        Ui.addWeighted(controllerRow, probe);
        Ui.addWeighted(controllerRow, pair);
        Ui.add(layout, controllerRow);

        Ui.add(layout, Ui.sectionTitle(this, "Automation"));
        LinearLayout serviceRow = Ui.row(this);
        Button startPilot = Ui.primaryButton(this, "Start Pilot");
        Button revoke = Ui.secondaryButton(this, "Revoke");
        Ui.addWeighted(serviceRow, startPilot);
        Ui.addWeighted(serviceRow, revoke);
        Ui.add(layout, serviceRow);
        Ui.add(layout, Ui.body(this, "Clash Meta exposes start/stop intents. Node switching still requires a reachable Clash/Mihomo Controller API."));

        refreshClient.setOnClickListener(view -> {
            clashApp = ExternalClashApp.detect(this);
            refreshClientSummary();
        });
        openClient.setOnClickListener(view -> openClient());
        startClient.setOnClickListener(view -> sendClashAction("START_CLASH", "Clash Meta start request was sent."));
        stopClient.setOnClickListener(view -> sendClashAction("STOP_CLASH", "Clash Meta stop request was sent."));
        probe.setOnClickListener(view -> probe());
        pair.setOnClickListener(view -> pair(controller.getText().toString(), secret.getText().toString()));
        startPilot.setOnClickListener(view -> startPilotService());
        revoke.setOnClickListener(view -> revokePairing());

        setContentView(root);
    }

    private void refreshClientSummary() {
        if (clashApp == null) {
            clientSummary.setText("Clash Meta for Android was not detected. Clash Verge Rev is a desktop app; Android needs a compatible Clash/Mihomo client with Controller API access.");
        } else {
            clientSummary.setText("Detected " + clashApp.label + " (" + clashApp.packageName + ")");
        }
    }

    private void openClient() {
        if (clashApp == null) {
            updateStatus("No known Clash Meta client was detected.");
            return;
        }
        Intent intent = clashApp.launchIntent(this);
        if (intent == null) {
            updateStatus("Client was detected, but Android did not expose a launch Activity.");
            return;
        }
        startActivity(intent);
    }

    private void sendClashAction(String action, String success) {
        if (clashApp == null) {
            updateStatus("No Clash Meta client was detected, so the official external-control intent cannot be sent.");
            return;
        }
        try {
            startActivity(clashApp.serviceIntent(action));
            updateStatus(success);
        } catch (ActivityNotFoundException error) {
            updateStatus("The client did not export ExternalControlActivity for " + action + ".");
        } catch (Exception error) {
            updateStatus("External control failed: " + error.getMessage());
        }
    }

    private void pair(String controllerUrl, String secretValue) {
        try {
            if (!controllerUrl.matches("https?://(127\\.0\\.0\\.1|localhost|\\[::1\\])(:\\d{2,5})?")) {
                updateStatus("Controller must be a phone-local URL, such as http://127.0.0.1:9097.");
                return;
            }
            store.save(controllerUrl, secretValue);
            updateStatus("Paired. Secret is stored with Android Keystore-backed encryption.");
        } catch (Exception error) {
            updateStatus("Pairing failed: " + error.getMessage());
        }
    }

    private void startPilotService() {
        Intent intent = new Intent(this, PilotForegroundService.class).setAction(PairingStore.ACTION_START);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent);
        else startService(intent);
        updateStatus("Node Pilot foreground service start requested.");
    }

    private void revokePairing() {
        store.revoke();
        startService(new Intent(this, PilotForegroundService.class).setAction(PairingStore.ACTION_REVOKE));
        controller.setText("");
        secret.setText("");
        updateStatus("Pairing revoked. Local state was cleared.");
    }

    private void probe() {
        updateStatus("Probing common local Controller ports...");
        String secretValue = secret.getText().toString();
        new Thread(() -> {
            for (String candidate : LOCAL_CONTROLLER_CANDIDATES) {
                try {
                    new ControllerClient(candidate, secretValue).get("/version");
                    runOnUiThread(() -> {
                        controller.setText(candidate);
                        updateStatus("Found Controller: " + candidate);
                    });
                    return;
                } catch (ControllerHttpException error) {
                    if (error.statusCode == 401) {
                        runOnUiThread(() -> {
                            controller.setText(candidate);
                            updateStatus("Found Controller, but a secret is required: " + candidate);
                        });
                        return;
                    }
                } catch (Exception ignored) {
                    /* try the next common local port */
                }
            }
            runOnUiThread(() -> updateStatus("No Controller found. Confirm that your Android Clash/Mihomo client supports and enables External Controller/API. Starting VPN by intent is not the same as exposing Controller API."));
        }).start();
    }

    private void updateStatus(String text) {
        status.setText(text);
    }
}
