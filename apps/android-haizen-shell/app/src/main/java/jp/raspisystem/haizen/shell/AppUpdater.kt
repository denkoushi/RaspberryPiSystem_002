package jp.raspisystem.haizen.shell

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.TextView
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class AppUpdater(private val activity: MainActivity, private val banner: TextView) {
    private val executor = Executors.newSingleThreadExecutor()
    private var lastCheck: Long? = null
    private var checking = false
    private var downloading = false
    private var available: AppUpdate.Version? = null
    private var pendingInstall: File? = null
    private var closed = false

    init {
        banner.text = "新しい版があります"
        banner.setSingleLine(true)
        banner.gravity = Gravity.CENTER
        banner.setTextColor(0xff111827.toInt())
        banner.setBackgroundColor(0xfffef3c7.toInt())
        banner.visibility = View.GONE
        banner.setOnClickListener { download() }
    }

    private fun onUi(action: () -> Unit) {
        activity.runOnUiThread { if (!closed && !activity.isDestroyed) action() }
    }

    fun check() {
        if (closed || downloading || checking) return
        val key = LocalDataPrefetchWorker.clientKey(activity)?.takeIf { it.isNotBlank() } ?: return
        val now = SystemClock.elapsedRealtime()
        if (lastCheck?.let { now - it < 10 * 60 * 1000 } == true) return
        lastCheck = now
        checking = true
        executor.execute {
            val version = try {
                request("version", key) { connection ->
                    val json = connection.inputStream.bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
                    AppUpdate.parse(listOf("versionCode", "versionName", "sha256", "size").associateWith { json.opt(it) })
                }
            } catch (_: Exception) { null }
            onUi {
                checking = false
                available = version?.takeIf { AppUpdate.isNewer(it.versionCode, BuildConfig.VERSION_CODE) }
                banner.visibility = if (available != null) View.VISIBLE else View.GONE
            }
        }
    }

    private fun download() {
        if (closed || downloading) return
        pendingInstall?.let { install(it); return }
        val version = available ?: return
        val key = LocalDataPrefetchWorker.clientKey(activity)?.takeIf { it.isNotBlank() } ?: return
        downloading = true
        banner.isEnabled = false
        banner.alpha = 0.5f
        executor.execute {
            val directory = File(activity.filesDir, "updates")
            val partial = File(directory, "haizen-${version.versionCode}.apk.part")
            val target = File(directory, "haizen-${version.versionCode}.apk")
            val downloaded = try {
                if (!directory.isDirectory && !directory.mkdirs()) throw IOException("Cannot create updates")
                directory.listFiles()?.forEach { if (!it.delete()) throw IOException("Cannot clear updates") }
                request("apk", key) { connection ->
                    connection.inputStream.use { input ->
                        partial.outputStream().use { output ->
                            val buffer = ByteArray(8192)
                            var total = 0L
                            while (true) {
                                val count = input.read(buffer)
                                if (count < 0) break
                                total += count
                                if (total > version.size) throw IOException("APK size mismatch")
                                output.write(buffer, 0, count)
                            }
                        }
                    }
                }
                if (!AppUpdate.matches(partial, version) || !partial.renameTo(target)) throw IOException("Invalid APK")
                target
            } catch (_: Exception) {
                partial.delete()
                null
            }
            onUi {
                downloading = false
                banner.isEnabled = true
                banner.alpha = 1f
                if (downloaded != null) {
                    pendingInstall = downloaded
                    install(downloaded)
                }
            }
        }
    }

    fun onResume() {
        val file = pendingInstall
        if (file != null && (Build.VERSION.SDK_INT < 26 || activity.packageManager.canRequestPackageInstalls())) {
            install(file)
        }
        check()
    }

    private fun install(file: File) {
        try {
            if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}")))
                return
            }
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", file)
            activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
            pendingInstall = null
        } catch (_: Exception) { /* Retry on the next tap. */ }
    }

    private fun <T> request(route: String, key: String, read: (HttpURLConnection) -> T): T {
        val connection = URL("${BuildConfig.HAIZEN_ORIGIN}/api/kiosk/mobile-app/$route").openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 10_000
            connection.readTimeout = 180_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("x-client-key", key)
            if (connection.responseCode != 200) throw IOException("Update unavailable")
            return read(connection)
        } finally { connection.disconnect() }
    }

    fun close() {
        closed = true
        executor.shutdownNow()
    }
}
