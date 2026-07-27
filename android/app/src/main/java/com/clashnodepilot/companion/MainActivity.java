package com.clashnodepilot.companion;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
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

    @Override
    protected void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        store = new PairingStore(this);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 10);
        }

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);

        status = new TextView(this);
        EditText controller = new EditText(this);
        controller.setHint("http://127.0.0.1:9097");
        controller.setSingleLine(true);
        controller.setText(store.controllerUrl());
        EditText secret = new EditText(this);
        secret.setHint("Controller secret");
        secret.setSingleLine(true);
        Button pair = new Button(this);
        pair.setText("Pair and start");
        Button probe = new Button(this);
        probe.setText("Probe local Controller");
        Button revoke = new Button(this);
        revoke.setText("Revoke pairing");

        pair.setOnClickListener(view -> pair(controller.getText().toString(), secret.getText().toString()));
        probe.setOnClickListener(view -> probe(controller, secret.getText().toString()));
        revoke.setOnClickListener(view -> {
            store.revoke();
            startService(new Intent(this, PilotForegroundService.class).setAction(PairingStore.ACTION_REVOKE));
            updateStatus("Pairing revoked. No Controller automation will run.");
        });

        layout.addView(status);
        layout.addView(controller);
        layout.addView(secret);
        layout.addView(probe);
        layout.addView(pair);
        layout.addView(revoke);
        setContentView(layout);
        updateStatus(store.isPaired() ? "Paired. Foreground service can run." : "Not paired.");
    }

    private void pair(String controllerUrl, String secret) {
        try {
            if (!controllerUrl.matches("https?://(127\\.0\\.0\\.1|localhost|\\[::1\\])(:\\d{2,5})?")) {
                updateStatus("Use an explicit local Controller URL.");
                return;
            }
            store.save(controllerUrl, secret);
            Intent intent = new Intent(this, PilotForegroundService.class).setAction(PairingStore.ACTION_START);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent);
            else startService(intent);
            updateStatus("Paired. Secret stored with Android Keystore-backed encryption.");
        } catch (Exception error) {
            updateStatus("Pairing failed: " + error.getMessage());
        }
    }

    private void probe(EditText controller, String secret) {
        updateStatus("Probing common local Controller ports...");
        new Thread(() -> {
            for (String candidate : LOCAL_CONTROLLER_CANDIDATES) {
                try {
                    new ControllerClient(candidate, secret).get("/version");
                    runOnUiThread(() -> {
                        controller.setText(candidate);
                        updateStatus("Found Controller: " + candidate);
                    });
                    return;
                } catch (ControllerHttpException error) {
                    if (error.statusCode == 401) {
                        runOnUiThread(() -> {
                            controller.setText(candidate);
                            updateStatus("Found Controller but secret is required: " + candidate);
                        });
                        return;
                    }
                } catch (Exception ignored) {
                    /* try the next common local port */
                }
            }
            runOnUiThread(() -> updateStatus("No local Controller found. Open your Clash/Mihomo client and enable External Controller/API."));
        }).start();
    }

    private void updateStatus(String text) {
        status.setText(text);
    }
}
