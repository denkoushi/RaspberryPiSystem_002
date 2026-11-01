package jp.raspisystem.haizen.shell

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.TextView
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.util.concurrent.FutureTask

class MainActivity : ComponentActivity() {
    private lateinit var appUpdater: AppUpdater
    private lateinit var webView: WebView
    private var scanning = false
    private var pageGeneration = 0
    private var scanGeneration = 0
    private var speechRequest: Any? = null
    private var speechPermissionRequest: Any? = null
    private var speechGeneration = 0
    private var speechRecognizer: SpeechRecognizer? = null
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
        deliverResult("__haizenNativeScanResult", payload)
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
    private val speechPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val request = speechPermissionRequest
        speechPermissionRequest = null
        if (request != null && speechRequest === request) {
            if (granted && speechGeneration == pageGeneration && trustedPage()) beginSpeech(request)
            else finishSpeech(request)
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
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) = localDataResponse(request)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (trusted(request.url.toString())) return false
                if (request.isForMainFrame) openExternal(request.url)
                return true
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                pageGeneration++
                cancelSpeech()
                // The launcher result for a dialog left open across navigation is ignored.
                speechPermissionRequest = null
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
        // The page's service worker can forward fetches outside WebViewClient; serve local data on both paths.
        ServiceWorkerController.getInstance().setServiceWorkerClient(object : ServiceWorkerClient() {
            override fun shouldInterceptRequest(request: WebResourceRequest) = localDataResponse(request)
        })
        webView.addJavascriptInterface(NativeBridge(), "HaizenNative")
        val layout = FrameLayout(this)
        layout.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        val updateBanner = TextView(this)
        layout.addView(updateBanner, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,
            (40 * resources.displayMetrics.density).toInt(), Gravity.TOP))
        appUpdater = AppUpdater(this, updateBanner)
        setContentView(layout)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack()
            }
        })
        webView.loadUrl(BuildConfig.HAIZEN_ORIGIN + BuildConfig.HAIZEN_START_PATH)
        LocalDataPrefetchWorker.schedule(this)
        appUpdater.check()
    }

    override fun onResume() {
        super.onResume()
        if (::appUpdater.isInitialized) appUpdater.onResume()
    }

    private fun localDataResponse(request: WebResourceRequest): WebResourceResponse? {
        if (request.method != "GET" || !trusted(request.url.toString())) return null
        val path = request.url.encodedPath ?: return null
        val prefix = "/__haizen-native/local-data/"
        if (!path.startsWith(prefix)) return null
        val key = path.removePrefix(prefix)
        if (!LocalDataVersions.isValidKey(key)) return null
        val headers = mapOf("Cache-Control" to "no-store")
        return try {
            WebResourceResponse("application/json", "utf-8", 200, "OK", headers,
                FileInputStream(File(filesDir, "local-data/$key.json")))
        } catch (_: FileNotFoundException) {
            WebResourceResponse("application/json", "utf-8", 404, "Not Found", headers,
                ByteArrayInputStream(byteArrayOf()))
        }
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

    private fun deliverResult(callback: String, payload: JSONObject) {
        // Activity results and bridge dispatch run on the UI thread. JSON is a quoted
        // string parsed by JS, so OCR quotes/newlines can never become executable code.
        if (trustedPage()) webView.evaluateJavascript(
            "window.$callback && window.$callback(JSON.parse(${JSONObject.quote(payload.toString())}));",
            null
        )
    }

    private fun beginSpeech(request: Any) {
        try {
            val recognizer = SpeechRecognizer.createSpeechRecognizer(this)
            speechRecognizer = recognizer
            recognizer.setRecognitionListener(object : RecognitionListener {
                override fun onResults(results: Bundle?) {
                    val texts = SpeechResultRule.clean(results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION))
                    val payload = if (texts.isEmpty()) JSONObject().put("status", "cancelled")
                        else JSONObject().put("status", "ok").put("texts", JSONArray(texts))
                    finishSpeech(request, payload)
                }
                override fun onError(error: Int) { finishSpeech(request) }
                override fun onReadyForSpeech(params: Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            recognizer.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ja-JP")
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            })
        } catch (_: RuntimeException) {
            finishSpeech(request)
        }
    }

    private fun finishSpeech(
        request: Any, payload: JSONObject = JSONObject().put("status", "cancelled"), cancel: Boolean = false
    ) {
        // Clear the request first: late callbacks from a destroyed recognizer cannot
        // finish a newer request, including after a permission dialog/navigation.
        if (speechRequest !== request) return
        speechRequest = null
        val recognizer = speechRecognizer
        speechRecognizer = null
        try {
            if (cancel) recognizer?.cancel()
        } finally {
            recognizer?.destroy()
        }
        if (speechGeneration == pageGeneration) deliverResult("__haizenNativeSpeechResult", payload)
    }

    private fun cancelSpeech() {
        speechRequest?.let { finishSpeech(it, cancel = true) }
    }

    private inner class NativeBridge {
        @JavascriptInterface
        fun setClientKey(key: String) {
            if (key.isBlank() || key.length > 512) return
            val task = FutureTask {
                if (trustedPage()) LocalDataPrefetchWorker.setClientKey(this@MainActivity, key)
            }
            if (Looper.myLooper() == Looper.getMainLooper()) task.run() else runOnUiThread(task)
            task.get()
        }

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
                if (!trustedPage()) return@runOnUiThread
                // JS has already registered its callback; answer a busy shell so it never waits forever.
                if (scanning || speechRequest != null || speechPermissionRequest != null) {
                    deliverResult("__haizenNativeScanResult", JSONObject().put("status", "cancelled"))
                    return@runOnUiThread
                }
                scanning = true
                scanGeneration = pageGeneration
                try {
                    scanLauncher.launch(Intent(this@MainActivity, ScanActivity::class.java))
                } catch (_: ActivityNotFoundException) {
                    scanning = false
                    deliverResult("__haizenNativeScanResult", JSONObject().put("status", "cancelled"))
                }
            }
        }

        @JavascriptInterface
        fun isSpeechAvailable(): Boolean {
            if (Looper.myLooper() == Looper.getMainLooper()) {
                return trustedPage() && SpeechRecognizer.isRecognitionAvailable(this@MainActivity)
            }
            val task = FutureTask { trustedPage() && SpeechRecognizer.isRecognitionAvailable(this@MainActivity) }
            runOnUiThread(task)
            return task.get()
        }

        @JavascriptInterface
        fun startSpeech() {
            runOnUiThread {
                if (!trustedPage()) return@runOnUiThread
                if (scanning || speechRequest != null || speechPermissionRequest != null) {
                    deliverResult("__haizenNativeSpeechResult", JSONObject().put("status", "cancelled"))
                    return@runOnUiThread
                }
                val request = Any()
                speechRequest = request
                speechGeneration = pageGeneration
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    beginSpeech(request)
                } else {
                    speechPermissionRequest = request
                    try {
                        speechPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                    } catch (_: RuntimeException) {
                        speechPermissionRequest = null
                        finishSpeech(request)
                    }
                }
            }
        }

        @JavascriptInterface
        fun stopSpeech() {
            runOnUiThread {
                if (!trustedPage()) return@runOnUiThread
                try {
                    speechRecognizer?.stopListening()
                } catch (_: RuntimeException) {
                    cancelSpeech()
                }
            }
        }
    }

    override fun onPause() {
        // A permission dialog may pause us before a recognizer exists. Its launcher
        // owns that request; cancel only a running recognizer here.
        if (speechRecognizer != null) cancelSpeech()
        super.onPause()
    }

    override fun onDestroy() {
        if (::appUpdater.isInitialized) appUpdater.close()
        cancelSpeech()
        cameraRequest?.deny()
        cameraRequest = null
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        webView.removeJavascriptInterface("HaizenNative")
        webView.destroy()
        super.onDestroy()
    }
}
