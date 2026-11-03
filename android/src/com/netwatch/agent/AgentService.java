package com.netwatch.agent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;

/**
 * Layanan latar depan: memindai Wi-Fi di sekitar HP lalu mengirimnya ke server
 * NetWatch setiap 30 detik. Tanpa root, tanpa Termux.
 */
public class AgentService extends Service {
    static final String ACTION_START = "com.netwatch.agent.action.START";
    static final String ACTION_STOP = "com.netwatch.agent.action.STOP";
    static final String EXTRA_URL = "url";
    static final String EXTRA_KEY = "key";
    static final String EXTRA_NAME = "name";

    static final String PREFS = "netwatch";
    static final String PREF_STATUS = "status";
    static final String PREF_STATUS_AT = "statusAt";
    static final String PREF_RUNNING = "running";
    static final String PREF_URL = "agentUrl";
    static final String PREF_KEY = "agentKey";
    static final String PREF_NAME = "agentName";

    private static final String CHANNEL_ID = "netwatch_agent";
    private static final int NOTIFICATION_ID = 4242;
    private static final int INTERVAL_MS = 30000;
    private static final String TAG = "NetWatchAgent";

    private volatile boolean running = false;
    private Thread worker;
    private String baseUrl = "";
    private String agentKey = "";
    private String deviceName = "HP";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();

        if (ACTION_STOP.equals(action)) {
            stopEverything();
            return START_NOT_STICKY;
        }

        // Tampilkan notifikasi secepat mungkin supaya Android tidak mematikan
        // service karena dianggap terlambat (batas 5 detik).
        startForeground(NOTIFICATION_ID, buildNotification("Menyiapkan…"));

        if (intent != null) {
            String url = intent.getStringExtra(EXTRA_URL);
            String key = intent.getStringExtra(EXTRA_KEY);
            String name = intent.getStringExtra(EXTRA_NAME);
            if (url != null) baseUrl = url;
            if (key != null) agentKey = key;
            if (name != null) deviceName = name;
        }

        // Kalau Android menyalakan ulang service tanpa intent (proses dimatikan
        // sistem), pakai kode terakhir yang tersimpan.
        if (baseUrl.isEmpty() || agentKey.isEmpty()) {
            SharedPreferences saved = prefs();
            baseUrl = saved.getString(PREF_URL, "");
            agentKey = saved.getString(PREF_KEY, "");
            String savedName = saved.getString(PREF_NAME, "");
            if (!savedName.isEmpty()) deviceName = savedName;
        }

        if (baseUrl.isEmpty() || agentKey.isEmpty()) {
            setStatus("Kode perangkat belum diisi.");
            stopEverything();
            return START_NOT_STICKY;
        }

        prefs().edit()
                .putString(PREF_URL, baseUrl)
                .putString(PREF_KEY, agentKey)
                .putString(PREF_NAME, deviceName)
                .putBoolean(PREF_RUNNING, true)
                .apply();

        if (running) return START_STICKY;

        running = true;
        worker = new Thread(this::loop, "netwatch-agent");
        worker.setDaemon(true);
        worker.start();

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        prefs().edit().putBoolean(PREF_RUNNING, false).apply();
        super.onDestroy();
    }

    private void stopEverything() {
        running = false;
        prefs().edit().putBoolean(PREF_RUNNING, false).apply();
        stopForeground(true);
        stopSelf();
    }

    /* ------------------------------------------------------------------ */

    private void loop() {
        while (running) {
            String result;
            try {
                result = scanAndSend();
            } catch (Throwable t) {
                result = "Gagal: " + describe(t);
            }
            setStatus(result);
            updateNotification(result);

            for (int i = 0; i < INTERVAL_MS / 1000 && running; i++) {
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException e) {
                    return;
                }
            }
        }
    }

    private String scanAndSend() {
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm == null) return "Gagal: Wi-Fi tidak tersedia";

        if (!wm.isWifiEnabled()) return "Gagal: Wi-Fi di HP mati";

        try {
            wm.startScan();
        } catch (SecurityException e) {
            return "Gagal: izin Wi-Fi/Lokasi ditolak Android";
        } catch (Throwable ignored) {
            // Android membatasi frekuensi scan; hasil terakhir tetap dipakai.
        }

        try {
            Thread.sleep(2500);
        } catch (InterruptedException e) {
            return "Dihentikan";
        }

        List<ScanResult> results;
        try {
            results = wm.getScanResults();
        } catch (SecurityException e) {
            return "Gagal: izin Wi-Fi/Lokasi ditolak Android";
        }
        if (results == null) results = new java.util.ArrayList<>();
        boolean scanEmpty = results.isEmpty();
        if (scanEmpty && currentNetwork(wm) == null) {
            return "Gagal: belum ada Wi-Fi terbaca (nyalakan GPS)";
        }

        JSONObject payload = new JSONObject();
        try {
            JSONArray nearby = new JSONArray();
            int count = 0;
            for (ScanResult r : results) {
                String ssid = cleanSsid(r.SSID);
                if (ssid.isEmpty()) continue;
                JSONObject item = new JSONObject();
                item.put("ssid", ssid);
                item.put("signal", percent(r.level));
                item.put("band", bandOf(r.frequency));
                item.put("channel", channelOf(r.frequency));
                item.put("bssid", r.BSSID == null ? "" : r.BSSID);
                item.put("security", securityOf(r.capabilities));
                nearby.put(item);
                count++;
                if (count >= 100) break;
            }

            JSONObject wifi = new JSONObject();
            JSONObject current = currentNetwork(wm);
            if (count == 0 && current != null) {
                // Tidak ada hasil scan, tapi setidaknya ada jaringan aktif.
                nearby.put(current);
                count = 1;
            }
            wifi.put("nearby", nearby);
            if (current != null) wifi.put("current", current);

            payload.put("location", deviceName);
            payload.put("source", "android");
            payload.put("wifi", wifi);
            payload.put("clients", new JSONArray());

            int code = post(payload.toString());
            if (code == 401 || code == 403) {
                return "Gagal: kunci perangkat ditolak (buat kode baru di /join)";
            }
            if (code != 200) return "Gagal: server menolak (HTTP " + code + ")";

            return "Terkirim: " + count + " jaringan";
        } catch (Exception e) {
            return "Gagal: " + describe(e);
        }
    }

    private int post(String body) throws Exception {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(baseUrl + "/api/agent/ingest");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("x-agent-key", agentKey);

            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(bytes);
            }
            return conn.getResponseCode();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private JSONObject currentNetwork(WifiManager wm) {
        try {
            WifiInfo info = wm.getConnectionInfo();
            if (info == null) return null;
            String ssid = cleanSsid(info.getSSID());
            if (ssid.isEmpty()) return null;
            JSONObject obj = new JSONObject();
            obj.put("ssid", ssid);
            obj.put("signal", percent(info.getRssi()));
            obj.put("band", bandOf(info.getFrequency()));
            obj.put("channel", channelOf(info.getFrequency()));
            obj.put("bssid", info.getBSSID() == null ? "" : info.getBSSID());
            return obj;
        } catch (Throwable t) {
            return null;
        }
    }

    /* ------------------------------------------------------------------ */

    private static String cleanSsid(String value) {
        if (value == null) return "";
        String text = value.trim();
        if (text.startsWith("\"") && text.endsWith("\"") && text.length() > 1) {
            text = text.substring(1, text.length() - 1);
        }
        if (text.equals("<unknown ssid>") || text.equals("0x")) return "";
        return text;
    }

    private static int percent(int dbm) {
        if (dbm <= -100) return 0;
        if (dbm >= -50) return 100;
        return 2 * (dbm + 100);
    }

    private static String bandOf(int freq) {
        if (freq >= 5925) return "6 GHz";
        if (freq >= 4900) return "5 GHz";
        if (freq >= 2400) return "2.4 GHz";
        return "";
    }

    private static int channelOf(int freq) {
        if (freq >= 5925) return (freq - 5950) / 5;
        if (freq >= 4900) return (freq - 5000) / 5;
        if (freq >= 2400) return (freq - 2407) / 5;
        return 0;
    }

    private static String securityOf(String capabilities) {
        if (capabilities == null) return "Terbuka";
        String caps = capabilities.toUpperCase(Locale.US);
        if (caps.contains("SAE") || caps.contains("WPA3")) return "WPA3";
        if (caps.contains("RSN") || caps.contains("WPA2")) return "WPA2";
        if (caps.contains("WPA")) return "WPA";
        if (caps.contains("WEP")) return "WEP";
        return "Terbuka";
    }

    private static String describe(Throwable t) {
        String msg = t.getMessage();
        if (msg == null || msg.isEmpty()) msg = t.getClass().getSimpleName();
        return msg;
    }

    /* ------------------------------------------------------------------ */

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private void setStatus(String text) {
        prefs().edit().putString(PREF_STATUS, text).putLong(PREF_STATUS_AT, System.currentTimeMillis()).apply();
        Log.d(TAG, text);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "NetWatch Agent", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Memantau Wi-Fi di sekitar perangkat");
        nm.createNotificationChannel(channel);
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, flags);

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }
        return builder
                .setContentTitle("NetWatch — " + deviceName)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .setContentIntent(pending)
                .build();
    }

    private void updateNotification(String text) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification(text));
        } catch (Throwable ignored) {
        }
    }
}
