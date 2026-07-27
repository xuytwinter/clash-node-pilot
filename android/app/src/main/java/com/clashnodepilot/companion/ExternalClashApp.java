package com.clashnodepilot.companion;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;

final class ExternalClashApp {
    private static final String[] PACKAGE_CANDIDATES = new String[]{
            "com.github.metacubex.clash.meta",
            "com.github.metacubex.clash",
            "com.github.kr328.clash"
    };
    private static final String EXTERNAL_CONTROL_ACTIVITY = "com.github.kr328.clash.ExternalControlActivity";

    final String packageName;
    final String label;

    private ExternalClashApp(String packageName, String label) {
        this.packageName = packageName;
        this.label = label;
    }

    static ExternalClashApp detect(Context context) {
        PackageManager manager = context.getPackageManager();
        for (String packageName : PACKAGE_CANDIDATES) {
            try {
                CharSequence label = manager.getApplicationLabel(manager.getApplicationInfo(packageName, 0));
                return new ExternalClashApp(packageName, label == null ? packageName : label.toString());
            } catch (PackageManager.NameNotFoundException ignored) {
                /* try the next known package */
            }
        }
        return null;
    }

    Intent launchIntent(Context context) {
        return context.getPackageManager().getLaunchIntentForPackage(packageName);
    }

    Intent serviceIntent(String actionName) {
        return new Intent(packageName + ".action." + actionName)
                .setClassName(packageName, EXTERNAL_CONTROL_ACTIVITY)
                .addCategory(Intent.CATEGORY_DEFAULT);
    }
}
