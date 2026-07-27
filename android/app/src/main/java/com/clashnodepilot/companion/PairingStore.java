package com.clashnodepilot.companion;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class PairingStore {
    static final String ACTION_START = "com.clashnodepilot.companion.START";
    static final String ACTION_STOP = "com.clashnodepilot.companion.STOP";
    static final String ACTION_REVOKE = "com.clashnodepilot.companion.REVOKE";
    private static final String PREFS = "pairing";
    private static final String KEY_ALIAS = "clash-node-pilot-controller";
    private final SharedPreferences prefs;

    PairingStore(Context context) {
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    void save(String controllerUrl, String secret, String targetGroup, String nodeFilter) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] iv = cipher.getIV();
        byte[] ciphertext = cipher.doFinal(secret.getBytes(StandardCharsets.UTF_8));
        prefs.edit()
                .putString("controllerUrl", controllerUrl)
                .putString("targetGroup", targetGroup == null ? "" : targetGroup.trim())
                .putString("nodeFilter", nodeFilter == null ? "" : nodeFilter.trim())
                .putString("secretIv", Base64.getEncoder().encodeToString(iv))
                .putString("secretCiphertext", Base64.getEncoder().encodeToString(ciphertext))
                .putBoolean("paired", true)
                .apply();
    }

    String controllerUrl() {
        return prefs.getString("controllerUrl", "");
    }

    String targetGroup() {
        return prefs.getString("targetGroup", "");
    }

    String nodeFilter() {
        return prefs.getString("nodeFilter", "");
    }

    String secret() throws Exception {
        String iv = prefs.getString("secretIv", "");
        String ciphertext = prefs.getString("secretCiphertext", "");
        if (iv.isEmpty() || ciphertext.isEmpty()) return "";
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, Base64.getDecoder().decode(iv)));
        return new String(cipher.doFinal(Base64.getDecoder().decode(ciphertext)), StandardCharsets.UTF_8);
    }

    boolean isPaired() {
        return prefs.getBoolean("paired", false) && !controllerUrl().isEmpty();
    }

    void revoke() {
        prefs.edit().clear().apply();
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return (SecretKey) store.getKey(KEY_ALIAS, null);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }
}
