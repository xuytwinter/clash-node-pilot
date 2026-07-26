package com.clashnodepilot.companion;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

final class ControllerClient {
    private final String controllerUrl;
    private final String secret;

    ControllerClient(String controllerUrl, String secret) {
        this.controllerUrl = controllerUrl.replaceAll("/+$", "");
        this.secret = secret == null ? "" : secret;
    }

    String get(String path) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(controllerUrl + path).openConnection();
        connection.setConnectTimeout(2000);
        connection.setReadTimeout(3000);
        connection.setRequestProperty("Accept", "application/json");
        if (!secret.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + secret);
        int status = connection.getResponseCode();
        BufferedReader reader = new BufferedReader(new InputStreamReader(
                status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream()));
        StringBuilder body = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) body.append(line);
        if (status < 200 || status >= 300) throw new IllegalStateException("Controller returned HTTP " + status);
        return body.toString();
    }
}
