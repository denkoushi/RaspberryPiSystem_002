package jp.raspisystem.haizen.shell

import android.content.Context
import android.util.JsonReader
import android.util.JsonToken
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.TimeUnit

class LocalDataPrefetchWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result = synchronized(downloadLock) {
        val key = preferences(applicationContext).getString("client-key", null)
        if (key.isNullOrBlank()) return@synchronized Result.success()
        val directory = File(applicationContext.filesDir, "local-data")
        val cached = mutableMapOf<String, LocalDataVersions.Version>()
        val downloaded = mutableMapOf<String, LocalDataVersions.Version>()
        try {
            if (!directory.isDirectory && !directory.mkdirs()) throw IOException("Cannot create local-data")
            // Recover the actual file versions even if the previous process died before publishing versions.json.
            for (file in datasetFiles(directory)) {
                try { cached[file.nameWithoutExtension] = readVersion(file, file.nameWithoutExtension == "purchase") } catch (_: Exception) { /* Fetch again. */ }
            }
            try {
                val latest = request("/versions?format=2", key) { connection ->
                    if (connection.responseCode != 200) throw IOException("Versions request failed")
                    val json = connection.inputStream.bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
                    buildMap {
                        for (name in json.keys()) {
                            if (!LocalDataVersions.isValidKey(name)) continue
                            val value = json.optJSONObject(name) ?: continue
                            put(name, LocalDataVersions.Version(value.getString("version"),
                                if (value.isNull("dataUpdatedAt")) null else value.getString("dataUpdatedAt")))
                        }
                    }
                }
                for (name in LocalDataVersions.keysToFetch(cached, latest)) {
                    if (isStopped) throw IOException("Prefetch stopped")
                    val version = URLEncoder.encode(cached[name]?.version ?: "", "UTF-8")
                    request("/${URLEncoder.encode(name, "UTF-8")}?version=$version&format=2", key) { connection ->
                        when (connection.responseCode) {
                            304 -> Unit
                            200 -> {
                                val temporary = File.createTempFile("$name-", ".tmp", directory)
                                try {
                                    connection.inputStream.use { input -> temporary.outputStream().use { input.copyTo(it) } }
                                    if (readVersion(temporary, name == "purchase").version == latest.getValue(name).version && !isStopped) {
                                        publish(temporary, File(directory, "$name.json"))
                                        downloaded[name] = latest.getValue(name)
                                    }
                                } finally { temporary.delete() }
                            }
                            else -> throw IOException("Dataset request failed")
                        }
                    }
                }
            } finally {
                val versions = LocalDataVersions.merge(cached, downloaded,
                    datasetFiles(directory).map { it.nameWithoutExtension }.toSet())
                val json = JSONObject()
                versions.forEach { (name, value) ->
                    json.put(name, JSONObject().put("version", value.version)
                        .put("dataUpdatedAt", value.dataUpdatedAt ?: JSONObject.NULL))
                }
                val temporary = File.createTempFile("versions-", ".tmp", directory)
                try {
                    temporary.writeText(json.toString(), Charsets.UTF_8)
                    publish(temporary, File(directory, "versions.json"))
                } finally { temporary.delete() }
            }
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    private fun datasetFiles(directory: File) = directory.listFiles()?.filter {
        it.isFile && it.extension == "json" && it.name != "versions.json" && LocalDataVersions.isValidKey(it.nameWithoutExtension)
    } ?: emptyList()

    // Stream over rows instead of materializing potentially large snapshots just to check their version.
    private fun readVersion(file: File, requireFormat2: Boolean): LocalDataVersions.Version = JsonReader(file.reader(Charsets.UTF_8).buffered()).use { reader ->
        var version: String? = null
        var updatedAt: String? = null
        var format2 = false
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "version" -> version = reader.nextString()
                "format" -> if (reader.peek() == JsonToken.NUMBER) format2 = reader.nextString() == "2" else reader.skipValue()
                "dataUpdatedAt" -> if (reader.peek() == JsonToken.NULL) reader.nextNull() else updatedAt = reader.nextString()
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        if (reader.peek() != JsonToken.END_DOCUMENT) throw IOException("Invalid snapshot")
        if (requireFormat2 && !format2) throw IOException("Legacy purchase snapshot")
        LocalDataVersions.Version(version ?: throw IOException("Missing snapshot version"), updatedAt)
    }

    private fun publish(temporary: File, target: File) {
        Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }

    private fun <T> request(path: String, key: String, read: (HttpURLConnection) -> T): T {
        val connection = URL("${BuildConfig.HAIZEN_ORIGIN}/kiosk/mobile-local-data$path").openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 10_000
            connection.readTimeout = 180_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("x-client-key", key)
            return read(connection)
        } finally { connection.disconnect() }
    }

    companion object {
        // Periodic and immediate work have different unique names but share the same files.
        private val downloadLock = Any()
        private fun preferences(context: Context) = context.getSharedPreferences("local-data", Context.MODE_PRIVATE)

        fun clientKey(context: Context): String? = preferences(context).getString("client-key", null)

        fun setClientKey(context: Context, key: String) {
            preferences(context).edit().putString("client-key", key).apply()
            schedule(context)
        }

        fun schedule(context: Context) {
            if (preferences(context).getString("client-key", null).isNullOrBlank()) return
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build()
            val manager = WorkManager.getInstance(context)
            manager.enqueueUniquePeriodicWork("local-data-periodic", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<LocalDataPrefetchWorker>(30, TimeUnit.MINUTES).setConstraints(constraints).build())
            manager.enqueueUniqueWork("local-data-immediate", ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<LocalDataPrefetchWorker>().setConstraints(constraints).build())
        }
    }
}
