package com.smitnk.poseme;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class MainActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private Uri camUri;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // Serve assets over https so ES modules + import maps work (file:// blocks them).
        final WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                WebResourceResponse resp = assets.shouldInterceptRequest(r.getUrl());
                if (resp != null && r.getUrl().getPath().endsWith(".wasm")) // loader may guess the wrong mime; streaming WASM compile needs this
                    resp = new WebResourceResponse("application/wasm", null, resp.getData());
                return resp;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    if (p.isCaptureEnabled() && Build.VERSION.SDK_INT >= 29) {
                        ContentValues cv = new ContentValues();
                        cv.put(MediaStore.MediaColumns.DISPLAY_NAME, "poseme_" + System.currentTimeMillis() + ".jpg");
                        cv.put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg");
                        cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Poseme");
                        camUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                        startActivityForResult(new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, camUri), 2);
                    } else startActivityForResult(p.createIntent(), 1);
                } catch (Exception e) { fileCallback = null; camUri = null; return false; }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");
        web.loadUrl("https://appassets.androidplatform.net/assets/web/index.html");
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == 1 && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCallback = null;
        } else if (req == 2 && fileCallback != null) {
            if (res != RESULT_OK && camUri != null) getContentResolver().delete(camUri, null, null);
            fileCallback.onReceiveValue(res == RESULT_OK && camUri != null ? new Uri[] { camUri } : null);
            fileCallback = null; camUri = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    class Bridge {
        /** Saves base64 data to Pictures/Poseme (images) or Downloads (other files). Returns a message for the UI. */
        @JavascriptInterface
        public String saveFile(String b64, String mime, String name) {
            try {
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                boolean image = mime.startsWith("image/");
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, image ? Environment.DIRECTORY_PICTURES + "/Poseme" : Environment.DIRECTORY_DOWNLOADS);
                    Uri col = image ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI : MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                    Uri uri = getContentResolver().insert(col, v);
                    try (OutputStream o = getContentResolver().openOutputStream(uri)) { o.write(bytes); }
                } else {
                    File dir = getExternalFilesDir(image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS);
                    try (OutputStream o = new FileOutputStream(new File(dir, name))) { o.write(bytes); }
                }
                return image ? "Saved to Pictures/Poseme" : "Saved to Downloads";
            } catch (Exception e) {
                return "Save failed: " + e.getMessage();
            }
        }
    }
}
