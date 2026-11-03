package com.netwatch.agent;

import android.util.Base64;

import java.nio.charset.StandardCharsets;

/**
 * Kode perangkat yang ditempel pengguna. Isinya:
 *   base64url("https://server|KUNCI|Nama")
 * Dibuat otomatis oleh halaman /join supaya tidak ada yang perlu diketik manual.
 */
final class DeviceCode {
    final String baseUrl;
    final String key;
    final String name;

    private DeviceCode(String baseUrl, String key, String name) {
        this.baseUrl = baseUrl;
        this.key = key;
        this.name = name;
    }

    static DeviceCode parse(String raw) {
        if (raw == null) return null;
        String text = raw.trim().replaceAll("\\s+", "");
        if (text.isEmpty()) return null;

        byte[] bytes;
        try {
            bytes = Base64.decode(text, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        } catch (IllegalArgumentException first) {
            try {
                bytes = Base64.decode(text, Base64.URL_SAFE | Base64.NO_WRAP);
            } catch (IllegalArgumentException second) {
                try {
                    bytes = Base64.decode(text, Base64.DEFAULT);
                } catch (IllegalArgumentException third) {
                    return null;
                }
            }
        }

        String decoded = new String(bytes, StandardCharsets.UTF_8);
        String[] parts = decoded.split("\\|", 3);
        if (parts.length < 2) return null;

        String url = parts[0].trim();
        String key = parts[1].trim();
        String name = parts.length > 2 ? parts[2].trim() : "HP";

        if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
        if (!key.matches("[A-Za-z0-9_-]{8,128}")) return null;

        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        if (name.isEmpty()) name = "HP";
        if (name.length() > 40) name = name.substring(0, 40);

        return new DeviceCode(url, key, name);
    }
}
