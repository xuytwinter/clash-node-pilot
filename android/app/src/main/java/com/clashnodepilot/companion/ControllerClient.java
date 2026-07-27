package com.clashnodepilot.companion;

import java.io.BufferedReader;
import java.io.OutputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class ControllerHttpException extends Exception {
    final int statusCode;

    ControllerHttpException(int statusCode) {
        super("Controller returned HTTP " + statusCode);
        this.statusCode = statusCode;
    }
}

final class ControllerClient {
    private final String controllerUrl;
    private final String secret;

    ControllerClient(String controllerUrl, String secret) {
        this.controllerUrl = controllerUrl.replaceAll("/+$", "");
        this.secret = secret == null ? "" : secret;
    }

    String get(String path) throws Exception {
        return request("GET", path, null);
    }

    String putJson(String path, String body) throws Exception {
        return request("PUT", path, body);
    }

    private String request(String method, String path, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(controllerUrl + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(2000);
        connection.setReadTimeout(7000);
        connection.setRequestProperty("Accept", "application/json");
        if (!secret.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + secret);
        if (body != null) {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }
        }
        int status = connection.getResponseCode();
        if (status == HttpURLConnection.HTTP_NO_CONTENT) return "";
        if (status >= 200 && status < 300 && connection.getInputStream() == null) return "";
        if (status < 200 || status >= 300) {
            if (connection.getErrorStream() == null) throw new ControllerHttpException(status);
        }
        BufferedReader reader = new BufferedReader(new InputStreamReader(status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream()));
        StringBuilder response = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) response.append(line);
        if (status < 200 || status >= 300) throw new ControllerHttpException(status);
        return response.toString();
    }
}
