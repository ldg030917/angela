package kr.angela.inventory;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.FileOutputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final int OPEN_PACKAGE = 1;
    private static final int SAVE_SURVEY = 2;
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private WebView webView;
    private String pendingResult;
    private volatile byte[] pendingPackage;
    private long exitPromptAt;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        setContentView(webView);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.addJavascriptInterface(new FileBridge(), "AngelaAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !ASSET_HOST.equals(request.getUrl().getHost());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!ASSET_HOST.equals(uri.getHost()) || !uri.getPath().startsWith("/assets/")) return null;
                String name = uri.getPath().substring("/assets/".length());
                if (name.equals("current-package.json")) {
                    byte[] content = pendingPackage;
                    if (content == null) return null;
                    pendingPackage = null;
                    return new WebResourceResponse("application/json", "UTF-8", new ByteArrayInputStream(content));
                }
                if (!name.equals("mobile.html") && !name.equals("app.js") && !name.equals("style.css") && !name.equals("normalize.mjs") && !name.equals("physical-id.mjs") && !name.equals("status.mjs")) return null;
                try {
                    String type = name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : "text/javascript";
                    return new WebResourceResponse(type, "UTF-8", getAssets().open(name));
                } catch (Exception ignored) { return null; }
            }
        });
        webView.loadUrl("https://" + ASSET_HOST + "/assets/mobile.html");
    }

    private class FileBridge {
        @JavascriptInterface public void openPackage() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.setType("*/*");
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                startActivityForResult(intent, OPEN_PACKAGE);
            });
        }
        @JavascriptInterface public void saveSurvey(String content, String filename) {
            runOnUiThread(() -> {
                try {
                    if (!"angela-survey/v2".equals(new JSONObject(content).optString("schema"))) throw new Exception("조사 결과 형식이 올바르지 않습니다.");
                    pendingResult = content;
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.setType("application/json");
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.putExtra(Intent.EXTRA_TITLE, filename.matches("[a-zA-Z0-9-]+\\.json") ? filename : "survey-result.json");
                    startActivityForResult(intent, SAVE_SURVEY);
                } catch (Exception e) { message(e.getMessage()); }
            });
        }
        @JavascriptInterface public void shareSurvey(String content) {
            runOnUiThread(() -> {
                try {
                    if (!"angela-survey/v2".equals(new JSONObject(content).optString("schema"))) throw new Exception("조사 결과 형식이 올바르지 않습니다.");
                    try (FileOutputStream output = new FileOutputStream(new File(getCacheDir(), SurveyShareProvider.FILE))) {
                        output.write(content.getBytes(StandardCharsets.UTF_8));
                    }
                    Intent intent = new Intent(Intent.ACTION_SEND);
                    intent.setType("application/json");
                    intent.putExtra(Intent.EXTRA_STREAM, SurveyShareProvider.URI);
                    intent.setClipData(ClipData.newUri(getContentResolver(), "Angela 조사 결과", SurveyShareProvider.URI));
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(intent, "조사 결과 공유"));
                } catch (Exception e) { message(e.getMessage()); }
            });
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
        try {
            if (requestCode == OPEN_PACKAGE) {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                try (InputStream input = getContentResolver().openInputStream(data.getData())) {
                    if (input == null) throw new Exception("파일을 열 수 없습니다.");
                    byte[] chunk = new byte[8192]; int n;
                    while ((n = input.read(chunk)) != -1) {
                        if (buffer.size() + n > 15 * 1024 * 1024) throw new Exception("조사 파일은 15MB 이하여야 합니다.");
                        buffer.write(chunk, 0, n);
                    }
                }
                pendingPackage = buffer.toByteArray();
                webView.evaluateJavascript("fetch('./current-package.json').then(r => r.text()).then(window.angelaOpenPackage).catch(e => window.angelaPackageError(e.message))", null);
            } else if (requestCode == SAVE_SURVEY && pendingResult != null) {
                try (OutputStream output = getContentResolver().openOutputStream(data.getData(), "w")) {
                    if (output == null) throw new Exception("저장할 파일을 열 수 없습니다.");
                    output.write(pendingResult.getBytes(StandardCharsets.UTF_8));
                }
                pendingResult = null;
                webView.evaluateJavascript("window.angelaFileSaved()", null);
            }
        } catch (Exception e) { message(e.getMessage()); }
    }

    private void message(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
    @Override public void onBackPressed() {
        webView.evaluateJavascript("window.angelaHandleBack && window.angelaHandleBack()", handled -> {
            if ("true".equals(handled)) { exitPromptAt = 0; return; }
            if (webView.canGoBack()) { webView.goBack(); exitPromptAt = 0; return; }
            long now = android.os.SystemClock.elapsedRealtime();
            if (exitPromptAt > 0 && now - exitPromptAt <= 2000) finish();
            else { exitPromptAt = now; message("한 번 더 뒤로가기를 누르면 종료됩니다."); }
        });
    }
}
