package com.ilker.demir;

/*
 * Demir — Antrenman Defteri (Android kabuğu)
 *
 * Uygulamanın arayüzü APK içine gömülü web varlıklarıdır (assets/web/).
 * Bu aktivite onları bir WebView'de gösterir. Dikkat edilen noktalar:
 *
 *  - Dosyalar file:// yerine sahte bir https origin'i (appassets.androidplatform.net)
 *    üzerinden servis edilir. Böylece localStorage güvenilir biçimde çalışır ve
 *    veriler kalıcı olur. İstekler shouldInterceptRequest ile assets'ten karşılanır.
 *  - Dış bağlantılar (YouTube) sistem tarayıcısında/uygulamasında açılır.
 *  - Geri tuşu önce açık panelleri kapatır; antrenman sürerken uygulamadan çıkmaz.
 *  - Antrenman sırasında ekranın kapanmaması JS köprüsüyle Java tarafında yapılır.
 *  - Yedek dosyası MediaStore ile İndirilenler klasörüne yazılır (izin gerekmez).
 */

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String BASLANGIC = "https://" + HOST + "/index.html";
    private static final String ZEMIN = "#0A0A0B";
    private static final int DOSYA_SEC = 1001;

    private WebView web;
    private ValueCallback<Uri[]> dosyaGeri;

    private static final Map<String, String> MIME = new HashMap<String, String>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("gif", "image/gif");
        MIME.put("svg", "image/svg+xml");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("ttf", "font/ttf");
        MIME.put("txt", "text/plain");
    }

    @Override
    protected void onCreate(Bundle kayit) {
        super.onCreate(kayit);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0E0F11"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);      // localStorage — verilerin saklandığı yer
        s.setDatabaseEnabled(true);
        s.setUseWideViewPort(true);        // sayfadaki viewport meta etiketine uy
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);                // sistem yazı ölçeği düzeni bozmasın
        s.setAllowFileAccess(false);       // gerek yok; kapalı olması daha güvenli
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE); // varlıklar zaten yerelde

        web.addJavascriptInterface(new Kopru(), "Android");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest istek) {
                Uri u = istek.getUrl();
                if (u != null && HOST.equals(u.getHost())) return varlikVer(u);
                return null;
            }

            // API 24+
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest istek) {
                Uri u = istek.getUrl();
                if (u != null && HOST.equals(u.getHost())) return false;
                disAc(u);
                return true;
            }

            // API 21-23
            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                Uri u = Uri.parse(url);
                if (HOST.equals(u.getHost())) return false;
                disAc(u);
                return true;
            }
        });

        // Yedek geri yükleme: <input type="file"> için dosya seçici
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> geri, FileChooserParams p) {
                if (dosyaGeri != null) dosyaGeri.onReceiveValue(null);
                dosyaGeri = geri;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Yedek dosyasını seç"), DOSYA_SEC);
                } catch (ActivityNotFoundException e) {
                    dosyaGeri = null;
                    return false;
                }
                return true;
            }
        });

        FrameLayout kok = new FrameLayout(this);
        kok.setBackgroundColor(Color.parseColor(ZEMIN));
        kok.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Durum çubuğu / gezinme çubuğu altında kalmasın diye kenar boşluklarını uygula
        kok.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets ins) {
                int l, t, r, b;
                if (Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets i = ins.getInsets(
                            WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    l = i.left; t = i.top; r = i.right; b = i.bottom;
                } else {
                    l = ins.getSystemWindowInsetLeft();
                    t = ins.getSystemWindowInsetTop();
                    r = ins.getSystemWindowInsetRight();
                    b = ins.getSystemWindowInsetBottom();
                }
                v.setPadding(l, t, r, b);
                return ins;
            }
        });

        setContentView(kok);

        if (Build.VERSION.SDK_INT < 35) {
            // Yeni sürümlerde bu çağrılar etkisiz; eski sürümlerde çubukları koyulaştırır
            getWindow().setStatusBarColor(Color.parseColor(ZEMIN));
            getWindow().setNavigationBarColor(Color.parseColor(ZEMIN));
        }

        // Durum geri yüklenemezse boş sayfada kalmamak için baştan yükle
        boolean geriYuklendi = (kayit != null) && (web.restoreState(kayit) != null);
        if (!geriYuklendi) web.loadUrl(BASLANGIC);
    }

    /** İstenen yolu APK içindeki assets/web/ klasöründen karşılar */
    private WebResourceResponse varlikVer(Uri u) {
        String yol = u.getPath();
        if (yol == null || yol.equals("/") || yol.isEmpty()) yol = "/index.html";
        if (yol.startsWith("/")) yol = yol.substring(1);

        String uzanti = "";
        int nokta = yol.lastIndexOf('.');
        if (nokta >= 0 && nokta < yol.length() - 1) {
            uzanti = yol.substring(nokta + 1).toLowerCase(Locale.US);
        }
        String mime = MIME.containsKey(uzanti) ? MIME.get(uzanti) : "application/octet-stream";
        String kodlama = (mime.startsWith("text/") || mime.contains("json") || mime.contains("svg"))
                ? "utf-8" : null;

        try {
            InputStream girdi = getAssets().open("web/" + yol);
            return new WebResourceResponse(mime, kodlama, girdi);
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Bulunamadi",
                    Collections.<String, String>emptyMap(),
                    new ByteArrayInputStream(new byte[0]));
        }
    }

    private void disAc(Uri u) {
        if (u == null) return;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Bu bağlantıyı açacak uygulama yok", Toast.LENGTH_SHORT).show();
        }
    }

    /* JavaScript'ten çağrılan köprü — window.Android.*
       Sınıf public olmalı: WebView, @JavascriptInterface metotlarını yansıma (reflection)
       ile çağırır ve metodu tanımlayan sınıf public değilse çağrı başarısız olur. */
    public class Kopru {
        /** Antrenman sırasında ekran kapanmasın */
        @JavascriptInterface
        public void ekranAcikTut(final boolean acik) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    if (acik) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }

        /** Yedeği İndirilenler klasörüne yazar. Başarılıysa gösterilecek yolu döner. */
        @JavascriptInterface
        public String dosyaKaydet(String ad, String icerik) {
            if (ad == null || icerik == null) return null;
            byte[] veri;
            try {
                veri = icerik.getBytes("UTF-8");
            } catch (java.io.UnsupportedEncodingException e) {
                return null;
            }
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, ad);
                    cv.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                    cv.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri hedef = getContentResolver()
                            .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (hedef == null) return null;
                    OutputStream cikti = getContentResolver().openOutputStream(hedef);
                    if (cikti == null) return null;
                    cikti.write(veri);
                    cikti.close();
                    cv.clear();
                    cv.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(hedef, cv, null, null);
                    return "İndirilenler/" + ad;
                } else {
                    File klasor = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (klasor == null) klasor = getFilesDir();
                    if (!klasor.exists() && !klasor.mkdirs()) return null;
                    File dosya = new File(klasor, ad);
                    FileOutputStream cikti = new FileOutputStream(dosya);
                    cikti.write(veri);
                    cikti.close();
                    return dosya.getAbsolutePath();
                }
            } catch (Exception e) {
                return null;
            }
        }
    }

    @Override
    protected void onActivityResult(int istek, int sonuc, Intent veri) {
        if (istek == DOSYA_SEC) {
            if (dosyaGeri != null) {
                Uri[] secilen = null;
                if (sonuc == RESULT_OK && veri != null && veri.getData() != null) {
                    secilen = new Uri[]{ veri.getData() };
                }
                dosyaGeri.onReceiveValue(secilen);
                dosyaGeri = null;
            }
            return;
        }
        super.onActivityResult(istek, sonuc, veri);
    }

    /* Geri tuşu: JS tarafına sorar.
       "kapatildi" → panel kapandı, bir şey yapma
       "antrenman" → antrenman sürüyor, çıkma; kullanıcıyı bilgilendir
       "cikis"     → uygulamadan çık */
    @Override
    public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript(
            "(function(){try{return (window.__geriTusu&&window.__geriTusu())||'cikis'}catch(e){return 'cikis'}})()",
            new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String s) {
                    String v = (s == null) ? "" : s.replace("\"", "").trim();
                    if ("cikis".equals(v)) {
                        finish();
                    } else if ("antrenman".equals(v)) {
                        Toast.makeText(MainActivity.this,
                                "Antrenman sürüyor — bitirmek için ✕ veya Bitir'e bas",
                                Toast.LENGTH_SHORT).show();
                    }
                }
            });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("Android");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
