package com.serifpersia.dango

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

class SetupActivity : AppCompatActivity() {

    companion object {
        const val TAG = "DangoSetup"
        const val PREFS_NAME = "dango_prefs"
        const val KEY_INSTALLED_VERSION = "installed_version"
        const val KEY_WEBVIEW_ENABLED = "webview_enabled"
        const val NPM_REGISTRY = "https://registry.npmjs.org/@serifpersia/dango/latest"
        const val DANGO_PACKAGE = "@serifpersia/dango"
        const val RELEASE_API = "https://api.github.com/repos/serifpersia/dango/releases/latest"
        const val RELEASE_DOWNLOADS =
            "https://github.com/serifpersia/dango/releases/latest/download"
        val APK_ASSET =
            Regex("com\\.serifpersia\\.dango-v(\\d+)\\.(\\d+)\\.(\\d+)-(?:universal|arm64-v8a|armeabi-v7a)\\.apk")
    }

    private lateinit var prefs: SharedPreferences
    private lateinit var statusTitle: TextView
    private lateinit var statusSubtitle: TextView
    private lateinit var versionText: TextView
    private lateinit var devServerUrlInput: android.widget.EditText
    private lateinit var updateBtn: Button
    private lateinit var appUpdateBtn: Button
    private lateinit var launchBtn: Button
    private lateinit var browserSwitch: android.widget.Switch
    private lateinit var swipeHintText: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var progressText: TextView
    private lateinit var logContainer: LinearLayout
    private lateinit var logScroll: ScrollView
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var latestVersion: String? = null
    private var latestAppVersion: String? = null
    private var pendingInstall: File? = null
    private var nodeProcess: Process? = null
    private val logBuffer = mutableListOf<String>()
    private var logFlushJob: Job? = null
    private val maxLogViews = 300

    @SuppressLint("SetTextI18n")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)

        Log.i(TAG, "=== SetupActivity onCreate ===")

        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        cleanupStaleApkDownloads()

        statusTitle = findViewById(R.id.statusTitle)
        statusSubtitle = findViewById(R.id.statusSubtitle)
        versionText = findViewById(R.id.versionText)
        devServerUrlInput = findViewById(R.id.devServerUrlInput)
        updateBtn = findViewById(R.id.updateBtn)
        appUpdateBtn = findViewById(R.id.appUpdateBtn)
        launchBtn = findViewById(R.id.launchBtn)
        browserSwitch = findViewById(R.id.browserSwitch)
        browserSwitch.isChecked = prefs.getBoolean(KEY_WEBVIEW_ENABLED, true)
        browserSwitch.setOnCheckedChangeListener { _, checked ->
            prefs.edit().putBoolean(KEY_WEBVIEW_ENABLED, checked).apply()
        }
        swipeHintText = findViewById(R.id.swipeHintText)
        progressBar = findViewById(R.id.progressBar)
        progressText = findViewById(R.id.progressText)
        logContainer = findViewById(R.id.logContainer)
        logScroll = findViewById(R.id.logScroll)

        updateBtn.setOnClickListener {
            Log.i(TAG, "Update button clicked")
            startInstall(true)
        }
        appUpdateBtn.setOnClickListener {
            latestAppVersion?.let(::startAppUpdate)
        }
        requestBatteryExemption()
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        launchBtn.setOnClickListener {
            Log.i(TAG, "Launch button clicked")
            if (DevConfig.isEnabled(this)) {
                DevConfig.setDevUrl(this, devServerUrlInput.text.toString())
            }
            startActivity(Intent(this, MainActivity::class.java))
        }

        scope.launch {
            Log.i(TAG, "Starting checkState coroutine")
            if (DevConfig.isEnabled(this@SetupActivity)) {
                showDevServerMode()
                return@launch
            }
            checkState()
        }
    }

    override fun onResume() {
        super.onResume()
        val file = pendingInstall ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !packageManager.canRequestPackageInstalls()
        ) {
            return
        }
        launchInstaller(file)
    }

    private fun showDevServerMode() {
        statusTitle.text = "dango"
        statusSubtitle.text = "Dev server mode"
        versionText.visibility = View.GONE
        swipeHintText.visibility = View.GONE
        updateBtn.visibility = View.GONE
        appUpdateBtn.visibility = View.GONE
        devServerUrlInput.setText(DevConfig.getDevUrl(this))
        devServerUrlInput.visibility = View.VISIBLE
        browserSwitch.visibility = View.GONE
        launchBtn.text = "Launch (dev server)"
        launchBtn.visibility = View.VISIBLE
        progressBar.visibility = View.GONE
        progressText.visibility = View.GONE
        logScroll.visibility = View.GONE
    }

    private suspend fun checkState() {
        Log.i(TAG, "checkState: showing loading")
        showLoading("Checking...")

        val installedVersion = prefs.getString(KEY_INSTALLED_VERSION, null)
        Log.i(TAG, "checkState: installedVersion=$installedVersion")

        if (installedVersion == null) {
            Log.i(TAG, "checkState: no version installed, starting auto-install")
            appendLog("Fetching latest version info...")
            withContext(Dispatchers.IO) { fetchLatestVersion() }
            appendLog("Latest version: ${latestVersion ?: "unknown"}")

            showProgress("Extracting payload...")
            val payloadDir = File(filesDir, "payload")
            val payloadOk = File(payloadDir, ".payload_ok").exists()
            withContext(Dispatchers.IO) {
                if (!File(payloadDir, "npm/bin/npm-cli.js").exists() || !payloadOk) {
                    withContext(Dispatchers.Main) { appendLog("Extracting files to device...") }
                    extractPayload(payloadDir)
                }
            }

            showProgress("Installing dango via npm...")
            val success = runNpmInstall(false)
            if (success) {
                val version = withContext(Dispatchers.IO) { readInstalledVersion() }
                    ?: latestVersion ?: "unknown"
                prefs.edit().putString(KEY_INSTALLED_VERSION, version).apply()
                Log.i(TAG, "Install successful, version=$version")
                showInstalled(version)
            } else {
                Log.e(TAG, "Install failed")
                statusTitle.text = "dango"
                statusSubtitle.text = "Installation failed. Restart to retry."
                progressBar.visibility = View.GONE
                progressText.visibility = View.GONE
                logScroll.visibility = View.VISIBLE
            }
            return
        }

        showInstalled(installedVersion)
        checkForUpdate(installedVersion)
        checkForAppUpdate()
    }

    private fun getDangoDir(): File {
        val prefix = File(filesDir, "payload")
        return File(prefix, "lib/node_modules/$DANGO_PACKAGE")
    }

    @SuppressLint("SetTextI18n")
    private suspend fun runNpmInstall(isUpdate: Boolean): Boolean {
        Log.i(TAG, "runNpmInstall: isUpdate=$isUpdate")

        try {
            val payloadDir = File(filesDir, "payload")
            val dataDir = File(filesDir, "data")
            dataDir.mkdirs()

            val nativeLibDir = applicationInfo.nativeLibraryDir
            val nodeBin = File(nativeLibDir, "libnode.so")
            val npmCli = File(payloadDir, "npm/bin/npm-cli.js")
            val libDir = File(payloadDir, "lib")

            Log.i(TAG, "nodeBin: ${nodeBin.absolutePath} exists=${nodeBin.exists()} size=${nodeBin.length()}")
            Log.i(TAG, "npmCli: ${npmCli.absolutePath} exists=${npmCli.exists()}")

            if (!nodeBin.exists()) {
                appendLog("ERROR: node binary not found in nativeLibraryDir")
                Log.e(TAG, "node binary not found at ${nodeBin.absolutePath}")
                return false
            }

            if (!npmCli.exists()) {
                appendLog("ERROR: npm not found at ${npmCli.absolutePath}")
                return false
            }

            val prefixDir = payloadDir
            File(prefixDir, "lib/node_modules").mkdirs()
            File(prefixDir, "bin").mkdirs()

            val cmd = if (isUpdate) {
                arrayOf("install", "-g", "--ignore-scripts", "$DANGO_PACKAGE@latest")
            } else {
                arrayOf("install", "-g", "--ignore-scripts", DANGO_PACKAGE)
            }

            appendLog("Running: node npm-cli.js ${cmd.joinToString(" ")}")

            val pb = ProcessBuilder(
                nodeBin.absolutePath,
                npmCli.absolutePath,
                *cmd
            )
            pb.directory(dataDir)
            pb.environment().apply {
                put("HOME", dataDir.absolutePath)
                put("PATH", "$nativeLibDir:${payloadDir.absolutePath}/bin:/system/bin")
                put("LD_LIBRARY_PATH", libDir.absolutePath)
                put("OPENSSL_CONF", File(payloadDir, "etc/tls/openssl.cnf").absolutePath)
                put("PREFIX", prefixDir.absolutePath)
                put("npm_config_prefix", prefixDir.absolutePath)
                put("npm_config_cache", File(dataDir, ".npm").absolutePath)
                put("npm_config_tmp", File(dataDir, "tmp").absolutePath)
                put("NODE_PATH", File(prefixDir, "lib/node_modules").absolutePath)
            }
            pb.redirectErrorStream(true)

            Log.i(TAG, "Starting ProcessBuilder: ${pb.command()}")

            val proc = withContext(Dispatchers.IO) { pb.start() }
            nodeProcess = proc
            Log.i(TAG, "Process started, pid=${proc.hashCode()}")

            withContext(Dispatchers.IO) {
                val reader = BufferedReader(InputStreamReader(proc.inputStream))
                var lineCount = 0
                while (proc.isAlive) {
                    val line = reader.readLine() ?: break
                    lineCount++
                    appendLog(line)
                    if (lineCount % 50 == 0) {
                        Log.i(TAG, "npm output lines: $lineCount, last: $line")
                    }
                }
                val remaining = reader.readText()
                if (remaining.isNotEmpty()) {
                    appendLog(remaining)
                }
            }
            withContext(Dispatchers.Main) { flushLogBuffer() }

            val exitCode = nodeProcess?.waitFor() ?: -1
            appendLog("npm exited with code $exitCode")
            Log.i(TAG, "npm exit code=$exitCode")

            if (exitCode != 0) {
                Log.e(TAG, "npm install failed with exit code $exitCode")
                return false
            }

            val serverDist = File(payloadDir, "lib/node_modules/$DANGO_PACKAGE/server/dist/server.js")
            Log.i(TAG, "server.js exists=${serverDist.exists()}")

            if (serverDist.exists()) {
                appendLog("dango installed successfully!")
                Log.i(TAG, "Installation verified")
                return true
            } else {
                appendLog("ERROR: dango server not found after install")
                return false
            }

        } catch (e: Exception) {
            Log.e(TAG, "runNpmInstall exception", e)
            appendLog("ERROR: ${e.javaClass.simpleName}: ${e.message}")
            return false
        }
    }

    private fun getDeviceAbi(): String {
        for (abi in android.os.Build.SUPPORTED_ABIS) {
            if (abi == "arm64-v8a" || abi == "armeabi-v7a") {
                return abi
            }
        }
        return "arm64-v8a"
    }

    private fun extractPayload(targetDir: File) {
        targetDir.mkdirs()

        val deviceAbi = getDeviceAbi()
        Log.i(TAG, "extractPayload: device ABI is $deviceAbi (supported: ${android.os.Build.SUPPORTED_ABIS.joinToString()})")

        val files = mutableListOf<String>()

        try {
            assets.open("payload/manifest.txt").use { stream ->
                stream.bufferedReader().readLines().filter { it.isNotBlank() }.toCollection(files)
            }
            Log.i(TAG, "extractPayload: loaded manifest with ${files.size} files")
        } catch (e: Exception) {
            Log.w(TAG, "extractPayload: manifest not found, falling back to assets.list()")
            try {
                assets.list("payload")?.forEach { top ->
                    scanAssets("payload/$top", files)
                }
            } catch (_: Exception) {}
        }

        Log.i(TAG, "extractPayload: ${files.size} total asset files indexed")
        var extracted = 0
        val abis = listOf("arm64-v8a", "armeabi-v7a")

        for (assetPath in files) {
            try {
                val rel = when {
                    assetPath.startsWith("payload/common/") ->
                        assetPath.removePrefix("payload/common/")
                    assetPath.startsWith("payload/$deviceAbi/lib/") ->
                        "lib/" + assetPath.removePrefix("payload/$deviceAbi/lib/")
                    abis.any { assetPath.startsWith("payload/$it/") } ->
                        continue
                    else ->
                        assetPath.removePrefix("payload/")
                }

                val outFile = File(targetDir, rel)
                outFile.parentFile?.mkdirs()
                assets.open(assetPath).use { input ->
                    outFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
                extracted++
            } catch (e: Exception) {
                Log.w(TAG, "extractPayload: failed to extract $assetPath: ${e.message}")
            }
        }
        recreateLibSymlinks(targetDir, deviceAbi)
        Log.i(TAG, "extractPayload: extracted $extracted files for $deviceAbi")
    }

    private fun recreateLibSymlinks(targetDir: File, deviceAbi: String): Boolean {
        val lines = try {
            assets.open("payload/aliases.txt").bufferedReader().readLines()
        } catch (_: Exception) {
            return true
        }
        val prefix = "$deviceAbi/"
        var ok = true
        for (line in lines) {
            val parts = line.trim().split(" ")
            if (parts.size != 2 || parts.any { it.isEmpty() }) continue
            if (!parts[0].startsWith(prefix) || !parts[1].startsWith(prefix)) continue
            val linkFile = File(targetDir, parts[0].removePrefix(prefix))
            val targetFile = File(targetDir, parts[1].removePrefix(prefix))
            if (!targetFile.exists()) {
                ok = false
                continue
            }
            try {
                linkFile.delete()
                android.system.Os.symlink(targetFile.absolutePath, linkFile.absolutePath)
            } catch (_: Exception) {
                try {
                    targetFile.copyTo(linkFile, overwrite = true)
                } catch (_: Exception) {
                    ok = false
                }
            }
        }
        if (ok) {
            try {
                File(targetDir, ".payload_ok").createNewFile()
            } catch (_: Exception) {}
        }
        return ok
    }

    private fun scanAssets(path: String, out: MutableList<String>) {
        val children = assets.list(path) ?: emptyArray()
        if (children.isEmpty()) out.add(path)
        else for (child in children) scanAssets("$path/$child", out)
    }

    private suspend fun fetchLatestVersion() {
        withContext(Dispatchers.IO) {
            try {
                val conn = URL(NPM_REGISTRY).openConnection() as HttpURLConnection
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                conn.connect()
                val body = conn.inputStream.bufferedReader().readText()
                conn.disconnect()
                val json = JSONObject(body)
                latestVersion = json.getString("version")
                Log.i(TAG, "fetchLatestVersion: $latestVersion")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to fetch latest version: ${e.message}")
            }
        }
    }

    private fun readInstalledVersion(): String? {
        return try {
            val pkgJson = File(getDangoDir(), "package.json")
            if (pkgJson.exists()) {
                val json = JSONObject(pkgJson.readText())
                json.optString("version", null)
            } else null
        } catch (e: Exception) {
            Log.w(TAG, "Failed to read installed version: ${e.message}")
            null
        }
    }

    private suspend fun checkForUpdate(currentVersion: String) {
        withContext(Dispatchers.IO) { fetchLatestVersion() }

        if (latestVersion != null && latestVersion != currentVersion) {
            showUpdateAvailable(currentVersion, latestVersion!!)
        }
    }

    private suspend fun checkForAppUpdate() {
        val installed = installedAppVersion() ?: return
        val latest = withContext(Dispatchers.IO) { fetchLatestAppVersion() } ?: return
        if (isNewerVersion(latest, installed)) {
            showAppUpdateAvailable(latest)
        }
    }

    private fun installedAppVersion(): String? {
        return try {
            @Suppress("DEPRECATION")
            val info = packageManager.getPackageInfo(packageName, 0)
            info.versionName
        } catch (e: Exception) {
            Log.w(TAG, "Failed to read app version: ${e.message}")
            null
        }
    }

    private fun isNewerVersion(candidate: String, current: String): Boolean {
        val a = candidate.split(".").map { it.toIntOrNull() ?: 0 }
        val b = current.split(".").map { it.toIntOrNull() ?: 0 }
        for (i in 0 until 3) {
            val diff = (a.getOrNull(i) ?: 0) - (b.getOrNull(i) ?: 0)
            if (diff != 0) return diff > 0
        }
        return false
    }

    private fun fetchLatestAppVersion(): String? {
        return try {
            val conn = URL(RELEASE_API).openConnection() as HttpURLConnection
            conn.connectTimeout = 5000
            conn.readTimeout = 5000
            conn.setRequestProperty("Accept", "application/vnd.github+json")
            conn.connect()
            val body = conn.inputStream.bufferedReader().readText()
            conn.disconnect()
            val assets = JSONObject(body).getJSONArray("assets")
            var version: String? = null
            for (i in 0 until assets.length()) {
                val match = APK_ASSET.find(assets.getJSONObject(i).optString("name")) ?: continue
                val candidate =
                    "${match.groupValues[1]}.${match.groupValues[2]}.${match.groupValues[3]}"
                val current = version
                if (current == null || isNewerVersion(candidate, current)) {
                    version = candidate
                }
            }
            Log.i(TAG, "fetchLatestAppVersion: $version")
            version
        } catch (e: Exception) {
            Log.w(TAG, "Failed to fetch latest app version: ${e.message}")
            null
        }
    }

    @SuppressLint("SetTextI18n")
    private fun showAppUpdateAvailable(version: String) {
        latestAppVersion = version
        appUpdateBtn.text = "Update app v$version"
        appUpdateBtn.visibility = View.VISIBLE
        appendLog("App v$version is available.")
    }

    private fun startAppUpdate(version: String) {
        appUpdateBtn.isEnabled = false
        showProgress("Downloading app v$version...")
        scope.launch {
            val file = withContext(Dispatchers.IO) { downloadApk(version) }
            if (file == null) {
                appendLog("App download failed. Try again.")
                showAppUpdateAvailable(version)
                appUpdateBtn.isEnabled = true
                return@launch
            }
            appendLog("Download complete, opening installer...")
            launchInstaller(file)
            appUpdateBtn.isEnabled = true
            showAppUpdateAvailable(version)
        }
    }

    private fun downloadApk(version: String): File? {
        val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return null
        val file = File(dir, "dango-app-v$version.apk")
        val assets = listOf(
            "com.serifpersia.dango-v$version-${getDeviceAbi()}.apk",
            "com.serifpersia.dango-v$version-universal.apk",
        )
        for (asset in assets) {
            val conn = try {
                (URL("$RELEASE_DOWNLOADS/$asset").openConnection() as HttpURLConnection).apply {
                    instanceFollowRedirects = true
                    connectTimeout = 15000
                    readTimeout = 30000
                    connect()
                }
            } catch (e: Exception) {
                Log.w(TAG, "APK download failed for $asset: ${e.message}")
                continue
            }
            try {
                if (conn.responseCode !in 200..299) {
                    Log.w(TAG, "APK download $asset returned HTTP ${conn.responseCode}")
                    continue
                }
                conn.inputStream.use { input ->
                    file.outputStream().use { output -> input.copyTo(output) }
                }
                if (file.length() > 0) return file
            } catch (e: Exception) {
                Log.w(TAG, "APK download failed for $asset: ${e.message}")
            } finally {
                conn.disconnect()
            }
            file.delete()
        }
        return null
    }

    private fun cleanupStaleApkDownloads() {
        val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return
        val stale = dir.listFiles { file -> file.name.startsWith("dango-app-v") } ?: return
        stale.forEach { file ->
            Log.i(TAG, "Removing leftover APK ${file.name}")
            runCatching { file.delete() }
        }
    }

    private fun launchInstaller(file: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !packageManager.canRequestPackageInstalls()
        ) {
            pendingInstall = file
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:$packageName")
                )
            )
            return
        }
        pendingInstall = null
        try {
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            startActivity(
                Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
            )
        } catch (e: Exception) {
            Log.w(TAG, "Failed to open installer: ${e.message}")
            Toast.makeText(this, "Couldn't open the installer", Toast.LENGTH_LONG).show()
        }
    }

    @SuppressLint("SetTextI18n")
    private fun showLoading(text: String) {
        statusTitle.text = text
        statusSubtitle.text = ""
        versionText.visibility = View.GONE
        swipeHintText.visibility = View.GONE
        updateBtn.visibility = View.GONE
        appUpdateBtn.visibility = View.GONE
        launchBtn.visibility = View.GONE
        browserSwitch.visibility = View.GONE
        progressBar.visibility = View.VISIBLE
        progressText.visibility = View.VISIBLE
        progressText.text = ""
        logScroll.visibility = View.GONE
    }

    @SuppressLint("SetTextI18n")
    private fun showInstalled(version: String) {
        statusTitle.text = "dango"
        statusSubtitle.text = "Installed"
        val appVersion = installedAppVersion()
        versionText.text = if (appVersion != null) "v$version • App v$appVersion" else "v$version"
        versionText.visibility = View.VISIBLE
        updateBtn.visibility = View.GONE
        appUpdateBtn.visibility = View.GONE
        swipeHintText.visibility = View.VISIBLE
        launchBtn.text = "Launch"
        launchBtn.visibility = View.VISIBLE
        browserSwitch.visibility = View.VISIBLE
        progressBar.visibility = View.GONE
        progressText.visibility = View.GONE
        logScroll.visibility = View.GONE
    }

    @SuppressLint("SetTextI18n")
    private fun showUpdateAvailable(current: String, latest: String) {
        statusTitle.text = "Update Available"
        statusSubtitle.text = "v$current -> v$latest"
        versionText.visibility = View.GONE
        swipeHintText.visibility = View.VISIBLE
        updateBtn.text = "Update to v$latest"
        updateBtn.visibility = View.VISIBLE
        launchBtn.text = "Continue with v$current"
        launchBtn.visibility = View.VISIBLE
        browserSwitch.visibility = View.VISIBLE
        progressBar.visibility = View.GONE
        progressText.visibility = View.GONE
        logScroll.visibility = View.GONE
    }

    @SuppressLint("SetTextI18n")
    private fun showProgress(text: String) {
        statusTitle.text = "dango"
        statusSubtitle.text = ""
        versionText.visibility = View.GONE
        swipeHintText.visibility = View.GONE
        updateBtn.visibility = View.GONE
        appUpdateBtn.visibility = View.GONE
        launchBtn.visibility = View.GONE
        browserSwitch.visibility = View.GONE
        progressBar.visibility = View.VISIBLE
        progressText.visibility = View.VISIBLE
        progressText.text = text
        logScroll.visibility = View.VISIBLE
    }

    private fun appendLog(line: String) {
        val lines = line.split("\n").filter { it.isNotBlank() }
        if (lines.isEmpty()) return
        synchronized(logBuffer) {
            logBuffer.addAll(lines)
        }
        scheduleLogFlush()
    }

    private fun scheduleLogFlush() {
        if (logFlushJob?.isActive == true) return
        logFlushJob = scope.launch {
            delay(250)
            flushLogBuffer()
        }
    }

    private fun flushLogBuffer() {
        val batch: List<String>
        synchronized(logBuffer) {
            if (logBuffer.isEmpty()) return
            batch = logBuffer.toList()
            logBuffer.clear()
        }
        for (l in batch) {
            val tv = TextView(this).apply {
                text = l
                textSize = 11f
                setTextColor(0xFF888888.toInt())
                setPadding(0, 2, 0, 2)
                typeface = android.graphics.Typeface.MONOSPACE
            }
            logContainer.addView(tv)
        }
        while (logContainer.childCount > maxLogViews) {
            logContainer.removeViewAt(0)
        }
        logScroll.post { logScroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun requestBatteryExemption() {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (pm.isIgnoringBatteryOptimizations(packageName)) return
            if (prefs.getBoolean("battery_exemption_asked", false)) return
            prefs.edit().putBoolean("battery_exemption_asked", true).apply()
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
            }
            try {
                startActivity(intent)
            } catch (_: Exception) {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
        } catch (_: Exception) {
        }
    }

    private fun startInstall(isUpdate: Boolean) {
        updateBtn.visibility = View.GONE
        launchBtn.visibility = View.GONE
        showProgress(if (isUpdate) "Updating..." else "Installing...")

        scope.launch {
            val success = runNpmInstall(isUpdate)
            if (success) {
                val version = withContext(Dispatchers.IO) { readInstalledVersion() }
                    ?: latestVersion ?: "unknown"
                prefs.edit().putString(KEY_INSTALLED_VERSION, version).apply()
                showInstalled(version)
                checkForUpdate(version)
            } else {
                statusTitle.text = "dango"
                statusSubtitle.text = "Update failed. Restart to retry."
                progressBar.visibility = View.GONE
                progressText.visibility = View.GONE
                logScroll.visibility = View.VISIBLE
            }
        }
    }

    private suspend fun isServerHealthy(): Boolean = withContext(Dispatchers.IO) {
        if (!NodeService.isRunning) return@withContext false
        var conn: HttpURLConnection? = null
        try {
            conn = URL(NodeService.healthUrl(this@SetupActivity)).openConnection() as HttpURLConnection
            conn.connectTimeout = 2000
            conn.readTimeout = 2000
            conn.connect()
            conn.responseCode == 200
        } catch (_: Exception) {
            false
        } finally {
            try {
                conn?.disconnect()
            } catch (_: Exception) {
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (DevConfig.isEnabled(this) || isFinishing) return
        scope.launch {
            if (!isServerHealthy()) return@launch
            startActivity(Intent(this@SetupActivity, MainActivity::class.java))
        }
    }

    override fun onDestroy() {
        nodeProcess?.destroy()
        scope.cancel()
        super.onDestroy()
    }
}
