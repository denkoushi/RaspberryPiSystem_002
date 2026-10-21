package jp.raspisystem.haizen.shell

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Looper
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.FutureTask

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var scanning = false
    private var pageGeneration = 0
    private var scanGeneration = 0
    private var cameraRequest: PermissionRequest? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val scanLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        scanning = false
        if (scanGeneration != pageGeneration || !trustedPage()) return@registerForActivityResult
        val data = result.data
        val fseiban = data?.getStringExtra("fseiban")
        val payload = if (result.resultCode == RESULT_OK && data != null && fseiban != null) {
            JSONObject().put("status", "ok").put("fseiban", fseiban)
                .put("tokens", JSONArray(data.getStringArrayListExtra("tokens") ?: emptyList<String>()))
                .put("text", data.getStringExtra("text") ?: "")
        } else JSONObject().put("status", "cancelled")
        deliverResult(payload)
    }
    private val fileLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }
    private val cameraLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val request = cameraRequest
        cameraRequest = null
        if (request != null) {
            if (granted && trustedPage() && trusted(request.origin.toString())) {
                request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
            } else request.deny()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true // File chooser uploads.
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (trusted(request.url.toString())) return false
                if (request.isForMainFrame) openExternal(request.url)
                return true
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                pageGeneration++
                cameraRequest?.deny()
                cameraRequest = null
                // Also guard navigations that do not invoke shouldOverrideUrlLoading (e.g. POST).
                if (!trusted(url)) {
                    view.stopLoading()
                    openExternal(Uri.parse(url))
                    view.loadUrl(BuildConfig.HAIZEN_ORIGIN + BuildConfig.HAIZEN_START_PATH)
                }
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                if (!trustedPage() || !trusted(request.origin.toString()) ||
                    !request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                    request.deny()
                    return
                }
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                } else if (cameraRequest == null) {
                    cameraRequest = request
                    cameraLauncher.launch(Manifest.permission.CAMERA)
                } else request.deny()
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (cameraRequest === request) cameraRequest = null
            }

            override fun onShowFileChooser(
                view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams
            ): Boolean {
                if (!trustedPage()) return false
                // Keep one outstanding activity result associated with one callback.
                if (fileCallback != null) {
                    callback.onReceiveValue(null)
                    return true
                }
                fileCallback = callback
                try {
                    fileLauncher.launch(params.createIntent())
                } catch (_: ActivityNotFoundException) {
                    fileCallback = null
                    callback.onReceiveValue(null)
                }
                return true
            }
        }
        webView.addJavascriptInterface(NativeBridge(), "HaizenNative")
        setContentView(webView)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack()
            }
        })
        webView.loadUrl(BuildConfig.HAIZEN_ORIGIN + BuildConfig.HAIZEN_START_PATH)
    }

    private fun trusted(url: String?) = HaizenOrigin.matches(url, BuildConfig.HAIZEN_ORIGIN)
    private fun trustedPage() = !isDestroyed && trusted(webView.url)

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: ActivityNotFoundException) {
            // No installed handler; keep the shell open.
        }
    }

    private fun deliverResult(payload: JSONObject) {
        // Activity results and bridge dispatch run on the UI thread. JSON is a quoted
        // string parsed by JS, so OCR quotes/newlines can never become executable code.
        if (trustedPage()) webView.evaluateJavascript(
            "window.__haizenNativeScanResult && window.__haizenNativeScanResult(JSON.parse(${JSONObject.quote(payload.toString())}));",
            null
        )
    }

    private inner class NativeBridge {
        @JavascriptInterface
        fun isAvailable(): Boolean {
            // JS interfaces run on WebView's bridge thread; WebView.url is UI-thread-only.
            if (Looper.myLooper() == Looper.getMainLooper()) return trustedPage()
            val task = FutureTask { trustedPage() }
            runOnUiThread(task)
            return task.get()
        }

        @JavascriptInterface
        fun scanFseiban() {
            runOnUiThread {
                if (!trustedPage() || scanning) return@runOnUiThread
                scanning = true
                scanGeneration = pageGeneration
                try {
                    scanLauncher.launch(Intent(this@MainActivity, ScanActivity::class.java))
                } catch (_: ActivityNotFoundException) {
                    scanning = false
                    deliverResult(JSONObject().put("status", "cancelled"))
                }
            }
        }
    }

    override fun onDestroy() {
        cameraRequest?.deny()
        cameraRequest = null
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        webView.removeJavascriptInterface("HaizenNative")
        webView.destroy()
        super.onDestroy()
    }
}
