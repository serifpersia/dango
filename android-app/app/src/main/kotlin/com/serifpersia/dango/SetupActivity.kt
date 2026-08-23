package com.serifpersia.dango

import android.annotation.SuppressLint
import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
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
        const val NPM_REGISTRY = "https://registry.npmjs.org/@serifpersia/dango/latest"
        const val DANGO_PACKAGE = "@serifpersia/dango"
    }

    private lateinit var prefs: SharedPreferences
    private lateinit var statusTitle: TextView
    private lateinit var statusSubtitle: TextView
    private lateinit var versionText: TextView
    private lateinit var updateBtn: Button
    private lateinit var launchBtn: Button
    private lateinit var progressBar: ProgressBar
    private lateinit var progressText: TextView
    private lateinit var logContainer: LinearLayout
    private lateinit var logScroll: ScrollView
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var latestVersion: String? = null
    private var nodeProcess: Process? = null

    @SuppressLint("SetTextI18n")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)

        Log.i(TAG, "=== SetupActivity onCreate ===")

        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)

        statusTitle = findViewById(R.id.statusTitle)
        statusSubtitle = findViewById(R.id.statusSubtitle)
        versionText = findViewById(R.id.versionText)
        updateBtn = findViewById(R.id.updateBtn)
        launchBtn = findViewById(R.id.launchBtn)
        progressBar = findViewById(R.id.progressBar)
        progressText = findViewById(R.id.progressText)
        logContainer = findViewById(R.id.logContainer)
        logScroll = findViewById(R.id.logScroll)

        updateBtn.setOnClickListener {
            Log.i(TAG, "Update button clicked")
            startInstall(true)
        }
        launchBtn.setOnClickListener {
            Log.i(TAG, "Launch button clicked")
            startActivity(Intent(this, MainActivity::class.java))
        }

        scope.launch {
            Log.i(TAG, "Starting checkState coroutine")
            checkState()
        }
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
            withContext(Dispatchers.IO) {
                if (!File(payloadDir, "npm/bin/npm-cli.js").exists()) {
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
                arrayOf("install", "-g", "$DANGO_PACKAGE@latest")
            } else {
                arrayOf("install", "-g", DANGO_PACKAGE)
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
                    withContext(Dispatchers.Main) { appendLog(line) }
                    if (lineCount % 50 == 0) {
                        Log.i(TAG, "npm output lines: $lineCount, last: $line")
                    }
                }
                val remaining = reader.readText()
                if (remaining.isNotEmpty()) {
                    withContext(Dispatchers.Main) { appendLog(remaining) }
                }
            }

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

    private fun extractPayload(targetDir: File) {
        targetDir.mkdirs()

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

        Log.i(TAG, "extractPayload: ${files.size} files to extract")
        var extracted = 0
        for (assetPath in files) {
            try {
                val rel = assetPath.removePrefix("payload/")
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
        Log.i(TAG, "extractPayload: extracted $extracted/${files.size} files")
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

    @SuppressLint("SetTextI18n")
    private fun showLoading(text: String) {
        statusTitle.text = text
        statusSubtitle.text = ""
        versionText.visibility = View.GONE
        updateBtn.visibility = View.GONE
        launchBtn.visibility = View.GONE
        progressBar.visibility = View.VISIBLE
        progressText.visibility = View.VISIBLE
        progressText.text = ""
        logScroll.visibility = View.GONE
    }

    @SuppressLint("SetTextI18n")
    private fun showInstalled(version: String) {
        statusTitle.text = "dango"
        statusSubtitle.text = "Installed"
        versionText.text = "v$version"
        versionText.visibility = View.VISIBLE
        updateBtn.visibility = View.GONE
        launchBtn.text = "Launch"
        launchBtn.visibility = View.VISIBLE
        progressBar.visibility = View.GONE
        progressText.visibility = View.GONE
        logScroll.visibility = View.GONE
    }

    @SuppressLint("SetTextI18n")
    private fun showUpdateAvailable(current: String, latest: String) {
        statusTitle.text = "Update Available"
        statusSubtitle.text = "v$current -> v$latest"
        versionText.visibility = View.GONE
        updateBtn.text = "Update to v$latest"
        updateBtn.visibility = View.VISIBLE
        launchBtn.text = "Continue with v$current"
        launchBtn.visibility = View.VISIBLE
        progressBar.visibility = View.GONE
        progressText.visibility = View.GONE
        logScroll.visibility = View.GONE
    }

    @SuppressLint("SetTextI18n")
    private fun showProgress(text: String) {
        statusTitle.text = "dango"
        statusSubtitle.text = ""
        versionText.visibility = View.GONE
        updateBtn.visibility = View.GONE
        launchBtn.visibility = View.GONE
        progressBar.visibility = View.VISIBLE
        progressText.visibility = View.VISIBLE
        progressText.text = text
        logScroll.visibility = View.VISIBLE
    }

    private fun appendLog(line: String) {
        val tv = TextView(this).apply {
            text = line
            textSize = 11f
            setTextColor(0xFF888888.toInt())
            setPadding(0, 2, 0, 2)
            typeface = android.graphics.Typeface.MONOSPACE
        }
        logContainer.addView(tv)
        logScroll.post { logScroll.fullScroll(View.FOCUS_DOWN) }
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

    override fun onDestroy() {
        nodeProcess?.destroy()
        scope.cancel()
        super.onDestroy()
    }
}
