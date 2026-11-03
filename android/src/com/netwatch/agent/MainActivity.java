package com.netwatch.agent;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final int REQ_PERMISSIONS = 1001;

    private static final int BG = Color.parseColor("#0B1218");
    private static final int PANEL = Color.parseColor("#131C26");
    private static final int BORDER = Color.parseColor("#1F2A36");
    private static final int TEXT = Color.parseColor("#E6EDF5");
    private static final int MUTED = Color.parseColor("#8B9BB0");
    private static final int CYAN = Color.parseColor("#22D3EE");

    private EditText codeInput;
    private TextView statusText;
    private Button startButton;
    private Button stopButton;
    private DeviceCode pendingCode;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable refresh = new Runnable() {
        @Override
        public void run() {
            showStatus();
            handler.postDelayed(this, 2000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildLayout());
        prefs().edit().putBoolean("seen", true).apply();

        // Isi otomatis kalau kode dikirim lewat intent (mis. dari tautan atau pengujian).
        String shared = null;
        if (getIntent() != null) {
            shared = getIntent().getStringExtra("code");
            if (shared == null && getIntent().getData() != null) {
                shared = getIntent().getData().getQueryParameter("code");
            }
        }
        if (shared != null && DeviceCode.parse(shared) != null) {
            codeInput.setText(shared.trim());
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.post(refresh);
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(refresh);
    }

    /* ------------------------------------------------------------------ */

    private ScrollView buildLayout() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        root.setPadding(pad, pad, pad, pad);
        scroll.addView(root, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = new TextView(this);
        title.setText("NetWatch Agent");
        title.setTextColor(TEXT);
        title.setTextSize(24);
        root.addView(title);

        TextView lead = new TextView(this);
        lead.setText("Mengirim daftar Wi-Fi di sekitar HP ini ke dashboard NetWatch. "
                + "Tanpa Termux, tanpa root.");
        lead.setTextColor(MUTED);
        lead.setTextSize(13);
        lead.setPadding(0, dp(6), 0, dp(18));
        root.addView(lead);

        TextView label = new TextView(this);
        label.setText("1. Tempel kode perangkat");
        label.setTextColor(TEXT);
        label.setTextSize(14);
        root.addView(label);

        TextView hint = new TextView(this);
        hint.setText("Buka halaman /join di browser HP, isi nama, lalu salin \"Kode aplikasi\".");
        hint.setTextColor(MUTED);
        hint.setTextSize(12);
        hint.setPadding(0, dp(4), 0, dp(8));
        root.addView(hint);

        codeInput = new EditText(this);
        codeInput.setHint("Tempel kode di sini");
        codeInput.setTextColor(TEXT);
        codeInput.setHintTextColor(Color.parseColor("#5B6B7C"));
        codeInput.setTextSize(13);
        codeInput.setBackgroundColor(PANEL);
        codeInput.setPadding(dp(12), dp(10), dp(12), dp(10));
        codeInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        codeInput.setMinLines(2);
        codeInput.setMaxLines(4);
        codeInput.setText(prefs().getString("lastCode", ""));
        root.addView(codeInput, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        startButton = new Button(this);
        startButton.setText("Mulai memantau");
        startButton.setAllCaps(false);
        startButton.setTextColor(Color.parseColor("#04212A"));
        startButton.setBackgroundColor(CYAN);
        LinearLayout.LayoutParams startParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        startParams.topMargin = dp(14);
        root.addView(startButton, startParams);
        startButton.setOnClickListener(v -> onStartClicked());

        stopButton = new Button(this);
        stopButton.setText("Hentikan");
        stopButton.setAllCaps(false);
        stopButton.setTextColor(TEXT);
        stopButton.setBackgroundColor(PANEL);
        LinearLayout.LayoutParams stopParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        stopParams.topMargin = dp(8);
        root.addView(stopButton, stopParams);
        stopButton.setOnClickListener(v -> onStopClicked());

        TextView statusLabel = new TextView(this);
        statusLabel.setText("2. Status");
        statusLabel.setTextColor(TEXT);
        statusLabel.setTextSize(14);
        statusLabel.setPadding(0, dp(22), 0, dp(6));
        root.addView(statusLabel);

        statusText = new TextView(this);
        statusText.setTextColor(MUTED);
        statusText.setTextSize(13);
        statusText.setBackgroundColor(PANEL);
        statusText.setPadding(dp(12), dp(10), dp(12), dp(10));
        statusText.setMinHeight(dp(64));
        root.addView(statusText, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView foot = new TextView(this);
        foot.setText("\nData yang dikirim hanya nama Wi-Fi (SSID), sinyal, channel, band, "
                + "dan jenis keamanan. Tidak ada isi trafik, kata sandi, atau data pribadi.\n\n"
                + "Biarkan notifikasi NetWatch tetap aktif supaya Android tidak mematikan pemantauan.");
        foot.setTextColor(Color.parseColor("#64748B"));
        foot.setTextSize(11);
        foot.setGravity(Gravity.START);
        root.addView(foot);

        return scroll;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    /* ------------------------------------------------------------------ */

    private void onStartClicked() {
        DeviceCode code = DeviceCode.parse(codeInput.getText().toString());
        if (code == null) {
            toast("Kode tidak valid. Salin ulang dari halaman /join.");
            return;
        }
        pendingCode = code;
        prefs().edit().putString("lastCode", codeInput.getText().toString().trim()).apply();

        if (!hasPermissions()) {
            requestPermissions();
            return;
        }
        if (!locationEnabled()) {
            askLocation();
            return;
        }
        startAgent(code);
    }

    private void onStopClicked() {
        Intent intent = new Intent(this, AgentService.class);
        intent.setAction(AgentService.ACTION_STOP);
        startService(intent);
        prefs().edit().putBoolean(AgentService.PREF_RUNNING, false).apply();
        toast("Pemantauan dihentikan.");
        showStatus();
    }

    private void startAgent(DeviceCode code) {
        Intent intent = new Intent(this, AgentService.class);
        intent.setAction(AgentService.ACTION_START);
        intent.putExtra(AgentService.EXTRA_URL, code.baseUrl);
        intent.putExtra(AgentService.EXTRA_KEY, code.key);
        intent.putExtra(AgentService.EXTRA_NAME, code.name);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent);
        } else {
            startService(intent);
        }
        prefs().edit().putBoolean(AgentService.PREF_RUNNING, true).apply();
        toast("Mulai memantau sebagai \"" + code.name + "\".");
        showStatus();
    }

    private boolean hasPermissions() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    private void requestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.NEARBY_WIFI_DEVICES,
                    Manifest.permission.POST_NOTIFICATIONS
            }, REQ_PERMISSIONS);
        } else {
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION
            }, REQ_PERMISSIONS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_PERMISSIONS) return;

        boolean locationGranted = false;
        for (int i = 0; i < permissions.length; i++) {
            if (Manifest.permission.ACCESS_FINE_LOCATION.equals(permissions[i])
                    && grantResults[i] == PackageManager.PERMISSION_GRANTED) {
                locationGranted = true;
            }
        }

        if (!locationGranted) {
            toast("Izin Lokasi wajib diberikan agar Wi-Fi bisa dipindai.");
            return;
        }
        if (pendingCode == null) return;
        if (!locationEnabled()) {
            askLocation();
            return;
        }
        startAgent(pendingCode);
    }

    private boolean locationEnabled() {
        LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return lm.isLocationEnabled();
        }
        return lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
                || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }

    private void askLocation() {
        new AlertDialog.Builder(this)
                .setTitle("Nyalakan GPS")
                .setMessage("Android hanya mengizinkan pemindaian Wi-Fi saat Lokasi (GPS) aktif. "
                        + "Nyalakan Lokasi, lalu tekan Mulai lagi.")
                .setPositiveButton("Buka Pengaturan", (dialog, which) -> {
                    try {
                        startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
                    } catch (Exception ignored) {
                    }
                })
                .setNegativeButton("Nanti", null)
                .show();
    }

    /* ------------------------------------------------------------------ */

    private void showStatus() {
        SharedPreferences prefs = prefs();
        boolean running = prefs.getBoolean(AgentService.PREF_RUNNING, false);
        String status = prefs.getString(AgentService.PREF_STATUS, "");
        long at = prefs.getLong(AgentService.PREF_STATUS_AT, 0);

        StringBuilder text = new StringBuilder();
        text.append(running ? "● Berjalan" : "○ Berhenti");
        if (at > 0) {
            long seconds = Math.max(0, (System.currentTimeMillis() - at) / 1000);
            text.append("  ·  ").append(ago(seconds));
        }
        text.append("\n");
        text.append(status.isEmpty() ? "Belum ada data terkirim." : status);
        statusText.setText(text.toString());
        statusText.setTextColor(running ? CYAN : MUTED);
    }

    private static String ago(long seconds) {
        if (seconds < 10) return "baru saja";
        if (seconds < 60) return seconds + " detik lalu";
        long minutes = seconds / 60;
        if (minutes < 60) return minutes + " menit lalu";
        return (minutes / 60) + " jam lalu";
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(AgentService.PREFS, Context.MODE_PRIVATE);
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }
}
