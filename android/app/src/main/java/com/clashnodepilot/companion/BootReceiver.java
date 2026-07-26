package com.clashnodepilot.companion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        PairingStore store = new PairingStore(context);
        if (!store.isPaired()) return;
        Intent service = new Intent(context, PilotForegroundService.class).setAction(PairingStore.ACTION_START);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service);
        else context.startService(service);
    }
}
