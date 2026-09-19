package com.serifpersia.dango

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.ValueCallback
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.URLUtil
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.abs

class MainActivity : AppCompatActivity() {

    companion object {
        const val TAG = "DangoMain"
        const val SERVER_URL = "http://localhost:3000"
        const val HEALTH_URL = "$SERVER_URL/api/health"
        const val SHUTDOWN_URL = "$SERVER_URL/api/internal/shutdown"
    }

    private var devMode = false
    private var startUrl = SERVER_URL

    private lateinit var webView: WebView
    private lateinit var swipeRefreshLayout: DangoSwipeRefreshLayout
    private lateinit var progressBar: ProgressBar
    private lateinit var statusText: TextView
    private lateinit var bootOverlay: View
    private lateinit var fullscreenContainer: FrameLayout
    private lateinit var shutdownOverlay: View
    private lateinit var serverPanel: View
    private lateinit var serverUrlText: TextView
    private lateinit var webViewSwitch: android.widget.Switch
    private lateinit var webViewSwitchConfirm: android.widget.Switch
    private lateinit var stopServerBtn: Button
    private lateinit var shutdownConfirmOverlay: View
    private lateinit var shutdownConfirmArrow: TextView
    private lateinit var shutdownConfirmText: TextView
    private lateinit var shutdownConfirmSubtext: TextView
    private lateinit var shutdownConfirmAccept: Button
    private lateinit var shutdownConfirmCancel: Button

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var savedSystemUiVisibility: Int = 0
    private var savedOrientation: Int = 0
    private var swipeEdgeTriggered = false
    private var swipeStartX = 0f
    private var swipeStartY = 0f
    private var swipeActive = false
    private var swipeFromLeftEdge = true
    private var shutdownConfirmVisible = false
    private var serverReady = false
    private var shuttingDown = false
    private var webviewEnabled = true
    private var webViewLoaded = false
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var pendingDownloadUrl: String? = null
    private var pendingDownloadFileName: String = "dango-backup.db"

    private var fileChooserLauncher: ActivityResultLauncher<Intent>? = null
    private var createDocumentLauncher: ActivityResultLauncher<Intent>? = null

    private val edgeSwipeThresholdPx by lazy { resources.displayMetrics.density * 18f }
    private val swipeTriggerDistancePx by lazy {
        maxOf(
            resources.displayMetrics.density * 260f,
            resources.displayMetrics.widthPixels * 0.45f
        )
    }
    private val swipeMaxVerticalDriftPx by lazy { resources.displayMetrics.density * 24f }
    private val refreshTriggerDistancePx by lazy { (resources.displayMetrics.density * 160f).toInt() }

    inner class DangoBridge {
        @JavascriptInterface
        fun isDangoApp(): Boolean = true

        @JavascriptInterface
        fun downloadFile(url: String, fileName: String) {
            runOnUiThread {
                val resolved = resolveUrl(url)
                if (resolved.isBlank()) {
                    Toast.makeText(this@MainActivity, "Export failed.", Toast.LENGTH_LONG).show()
                    return@runOnUiThread
                }
                startDownloadSave(
                    resolved,
                    fileName.ifBlank { "dango-backup.db" },
                    guessMimeType(fileName.ifBlank { "dango-backup.db" })
                )
            }
        }
    }

    private fun resolveUrl(url: String): String {
        if (url.isBlank()) return ""
        if (url.startsWith("http://") || url.startsWith("https://")) return url
        val base = try {
            val current = webView.url ?: startUrl
            URL(current)
        } catch (_: Exception) {
            return startUrl.trimEnd('/') + "/" + url.trimStart('/')
        }
        return try {
            URL(base, url).toString()
        } catch (_: Exception) {
            ""
        }
    }

    private fun guessMimeType(fileName: String): String {
        val lower = fileName.lowercase()
        return when {
            lower.endsWith(".db") -> "application/octet-stream"
            lower.endsWith(".xml") -> "application/xml"
            lower.endsWith(".json") -> "application/json"
            else -> "application/octet-stream"
        }
    }

    private fun concreteCreateMimeType(mimeType: String?, fileName: String): String {
        if (!mimeType.isNullOrBlank() && mimeType != "*/*") return mimeType
        return guessMimeType(fileName)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val debuggable =
            (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (debuggable) {
            try {
                WebView.setWebContentsDebuggingEnabled(true)
            } catch (_: Exception) {
            }
        }

        webView = findViewById(R.id.webView)
        swipeRefreshLayout = findViewById(R.id.swipeRefreshLayout)
        progressBar = findViewById(R.id.progressBar)
        statusText = findViewById(R.id.statusText)
        bootOverlay = findViewById(R.id.bootOverlay)
        fullscreenContainer = findViewById(R.id.fullscreenContainer)
        shutdownOverlay = findViewById(R.id.shutdownOverlay)
        shutdownConfirmOverlay = findViewById(R.id.shutdownConfirmOverlay)
        shutdownConfirmArrow = findViewById(R.id.shutdownConfirmArrow)
        shutdownConfirmText = findViewById(R.id.shutdownConfirmText)
        shutdownConfirmSubtext = findViewById(R.id.shutdownConfirmSubtext)
        shutdownConfirmAccept = findViewById(R.id.shutdownConfirmAccept)
        shutdownConfirmCancel = findViewById(R.id.shutdownConfirmCancel)
        serverPanel = findViewById(R.id.serverPanel)
        serverUrlText = findViewById(R.id.serverUrlText)
        webViewSwitch = findViewById(R.id.webViewSwitch)
        webViewSwitchConfirm = findViewById(R.id.webViewSwitchConfirm)
        stopServerBtn = findViewById(R.id.stopServerBtn)

        webviewEnabled = getSharedPreferences(
            SetupActivity.PREFS_NAME,
            MODE_PRIVATE
        ).getBoolean(SetupActivity.KEY_WEBVIEW_ENABLED, true)
        webViewSwitch.isChecked = webviewEnabled
        webViewSwitchConfirm.isChecked = webviewEnabled
        webViewSwitch.setOnCheckedChangeListener { _, checked ->
            setWebViewEnabled(checked)
        }
        webViewSwitchConfirm.setOnCheckedChangeListener { _, checked ->
            setWebViewEnabled(checked)
        }
        stopServerBtn.setOnClickListener {
            gracefulShutdown()
        }

        fileChooserLauncher =
            registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
                val callback = fileChooserCallback ?: return@registerForActivityResult
                fileChooserCallback = null
                if (result.resultCode != RESULT_OK || result.data == null) {
                    callback.onReceiveValue(null)
                    return@registerForActivityResult
                }
                val data = result.data!!
                val uris = mutableListOf<Uri>()
                val clipData = data.clipData
                if (clipData != null) {
                    for (i in 0 until clipData.itemCount) {
                        clipData.getItemAt(i)?.uri?.let { uris.add(it) }
                    }
                } else {
                    data.data?.let { uris.add(it) }
                }
                for (uri in uris) {
                    try {
                        contentResolver.takePersistableUriPermission(
                            uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                        )
                    } catch (_: Exception) {
                    }
                }
                callback.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
            }

        createDocumentLauncher =
            registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
                val downloadUrl = pendingDownloadUrl
                pendingDownloadUrl = null
                if (result.resultCode != RESULT_OK || result.data?.data == null || downloadUrl == null) {
                    return@registerForActivityResult
                }
                saveDownloadToUri(downloadUrl, result.data!!.data!!)
            }

        swipeRefreshLayout.setColorSchemeColors(0xFF8B5CF6.toInt())
        swipeRefreshLayout.setDistanceToTriggerSync(refreshTriggerDistancePx)
        swipeRefreshLayout.setOnChildScrollUpCallback { _, _ ->
            customView != null || webView.canScrollVertically(-1)
        }
        swipeRefreshLayout.setOnRefreshListener {
            if (!webviewEnabled) {
                swipeRefreshLayout.isRefreshing = false
            } else if (customView == null) {
                webView.reload()
            } else {
                swipeRefreshLayout.isRefreshing = false
            }
        }

        shutdownConfirmAccept.setOnClickListener {
            if (shutdownConfirmVisible) {
                hideShutdownConfirm()
                gracefulShutdown()
            }
        }

        shutdownConfirmCancel.setOnClickListener {
            hideShutdownConfirm()
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            javaScriptCanOpenWindowsAutomatically = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportMultipleWindows(false)
        }
        webView.addJavascriptInterface(DangoBridge(), "DangoBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString().orEmpty()
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    return false
                }
                if (url.isNotBlank()) {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    } catch (_: Exception) {
                    }
                    return true
                }
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                swipeRefreshLayout.isRefreshing = false
                if (serverReady && webviewEnabled) {
                    bootOverlay.visibility = View.GONE
                    progressBar.visibility = View.GONE
                    statusText.visibility = View.GONE
                    webView.visibility = View.VISIBLE
                }
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    swipeRefreshLayout.isRefreshing = false
                    if (!serverReady) {
                        scope.launch {
                            delay(2000)
                            if (!serverReady && !shuttingDown) pollHealthOnce()
                        }
                    } else if (!shuttingDown) {
                        progressBar.visibility = View.GONE
                        Toast.makeText(
                            this@MainActivity,
                            "Failed to load page. Pull down to retry.",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                }
            }
        }

        webView.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            if (url.isNullOrBlank()) return@setDownloadListener
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                Toast.makeText(
                    this,
                    "Use the in-page backup button for downloads.",
                    Toast.LENGTH_LONG
                ).show()
                return@setDownloadListener
            }

            val fileName = URLUtil.guessFileName(
                url,
                contentDisposition,
                mimeType
            ).ifBlank { "dango-backup.db" }
            startDownloadSave(url, fileName, mimeType)
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (!serverReady) {
                    return
                }
                if (newProgress >= 100) {
                    progressBar.visibility = View.GONE
                } else {
                    statusText.visibility = View.GONE
                    progressBar.visibility = View.VISIBLE
                }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = null

                if (filePathCallback == null || fileChooserParams == null) {
                    return false
                }
                fileChooserCallback = filePathCallback

                val intent = try {
                    buildFileChooserIntent(fileChooserParams)
                } catch (_: Exception) {
                    Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        type = "*/*"
                    }
                }

                return try {
                    fileChooserLauncher?.launch(intent)
                    true
                } catch (_: Exception) {
                    fileChooserCallback?.onReceiveValue(null)
                    fileChooserCallback = null
                    false
                }
            }

            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customView != null) {
                    callback.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                swipeRefreshLayout.isEnabled = false

                savedSystemUiVisibility = window.decorView.systemUiVisibility
                savedOrientation = requestedOrientation

                window.decorView.systemUiVisibility = (
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                        View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                        View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                        View.SYSTEM_UI_FLAG_FULLSCREEN or
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                )

                fullscreenContainer.addView(
                    view,
                    ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                )
                fullscreenContainer.visibility = View.VISIBLE
                webView.visibility = View.GONE

                try {
                    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                } catch (_: Exception) {
                }

                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }

            override fun onHideCustomView() {
                if (customView == null) return

                webView.visibility = View.VISIBLE
                fullscreenContainer.visibility = View.GONE
                fullscreenContainer.removeAllViews()

                window.decorView.systemUiVisibility = savedSystemUiVisibility
                try {
                    requestedOrientation = savedOrientation
                } catch (_: Exception) {
                }

                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                swipeRefreshLayout.isEnabled = true

                customViewCallback?.onCustomViewHidden()
                customViewCallback = null
                customView = null
            }

            override fun getDefaultVideoPoster(): android.graphics.Bitmap? {
                return android.graphics.Bitmap.createBitmap(
                    1,
                    1,
                    android.graphics.Bitmap.Config.ARGB_8888
                )
            }
        }

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        webView.setOnTouchListener { _, event -> handleEdgeSwipe(event) }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    shutdownConfirmVisible -> hideShutdownConfirm()
                    customView != null -> hideFullscreen()
                    serverPanel.visibility == View.VISIBLE -> gracefulShutdown()
                    webView.canGoBack() -> webView.goBack()
                    else -> gracefulShutdown()
                }
            }
        })

        devMode = DevConfig.isEnabled(this)
        startUrl = if (devMode) DevConfig.getDevUrl(this) else SERVER_URL
        webView.visibility = View.INVISIBLE
        if (devMode) {
            webViewSwitchConfirm.visibility = View.GONE
            Log.i(TAG, "Dev server mode: loading $startUrl, node install skipped")
            waitForServer(startUrl, "$startUrl/api/health")
        } else {
            NodeService.onStatusChange = null
            NodeService.start(this)
            waitForServer(SERVER_URL, HEALTH_URL)
        }
    }

    private fun buildFileChooserIntent(params: WebChromeClient.FileChooserParams): Intent {
        val base = try {
            params.createIntent()
        } catch (_: Exception) {
            Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
            }
        }
        base.addCategory(Intent.CATEGORY_OPENABLE)
        base.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

        val acceptTypes = params.acceptTypes ?: emptyArray()
        val extensionOnly = acceptTypes.isEmpty() || acceptTypes.any { it.startsWith(".") }
        if (extensionOnly) {
            base.type = "*/*"
            val hints = mutableListOf<String>()
            for (accept in acceptTypes) {
                when {
                    accept.equals(".db", ignoreCase = true) -> {
                        hints.add("application/octet-stream")
                        hints.add("application/x-sqlite3")
                    }
                    accept.equals(".xml", ignoreCase = true) -> {
                        hints.add("text/xml")
                        hints.add("application/xml")
                    }
                    accept.isNotBlank() -> hints.add(accept)
                }
            }
            if (hints.isNotEmpty()) {
                base.putExtra(Intent.EXTRA_MIME_TYPES, hints.distinct().toTypedArray())
            }
        } else if (base.type.isNullOrBlank()) {
            base.type = "*/*"
        }

        if (params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            base.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        return base
    }

    private fun startDownloadSave(url: String, fileName: String, mimeType: String?) {
        pendingDownloadUrl = url
        pendingDownloadFileName = fileName.ifBlank { "dango-backup.db" }

        val saveIntent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = concreteCreateMimeType(mimeType, pendingDownloadFileName)
            putExtra(Intent.EXTRA_TITLE, pendingDownloadFileName)
        }

        try {
            createDocumentLauncher?.launch(saveIntent)
        } catch (_: Exception) {
            pendingDownloadUrl = null
            Toast.makeText(
                this,
                "Export failed.",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    private fun saveDownloadToUri(downloadUrl: String, destinationUri: Uri) {
        scope.launch {
            val saved = withContext(Dispatchers.IO) {
                var conn: HttpURLConnection? = null
                try {
                    conn = URL(downloadUrl).openConnection() as HttpURLConnection
                    conn.connectTimeout = 15000
                    conn.readTimeout = 30000
                    conn.instanceFollowRedirects = true
                    try {
                        val cookie = CookieManager.getInstance().getCookie(downloadUrl)
                        if (!cookie.isNullOrBlank()) {
                            conn.setRequestProperty("Cookie", cookie)
                        }
                    } catch (_: Exception) {
                    }
                    try {
                        conn.setRequestProperty("User-Agent", webView.settings.userAgentString)
                    } catch (_: Exception) {
                    }
                    conn.connect()
                    if (conn.responseCode !in 200..299) {
                        Log.w(TAG, "Download failed: HTTP ${conn.responseCode} for $downloadUrl")
                        return@withContext false
                    }
                    conn.inputStream.use { input ->
                        contentResolver.openOutputStream(destinationUri)?.use { output ->
                            input.copyTo(output)
                            true
                        } ?: false
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Download failed for $downloadUrl: ${e.message}")
                    false
                } finally {
                    try {
                        conn?.disconnect()
                    } catch (_: Exception) {
                    }
                }
            }
            Toast.makeText(
                this@MainActivity,
                if (saved) "Exported successfully." else "Export failed.",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    private fun handleEdgeSwipe(event: MotionEvent): Boolean {
        if (customView != null || shutdownConfirmVisible) return shutdownConfirmVisible

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                swipeEdgeTriggered = false
                swipeFromLeftEdge = event.x <= edgeSwipeThresholdPx
                swipeActive = swipeFromLeftEdge || event.x >= webView.width - edgeSwipeThresholdPx
                swipeStartX = event.x
                swipeStartY = event.y
            }

            MotionEvent.ACTION_MOVE -> {
                if (swipeEdgeTriggered) return true

                val dx = event.x - swipeStartX
                val dy = event.y - swipeStartY
                val horizontalDistance = if (swipeFromLeftEdge) dx else -dx
                val mostlyHorizontal = abs(dx) > abs(dy) * 1.5f
                val movingOutward = horizontalDistance > resources.displayMetrics.density * 20f
                val movingWrongWay = horizontalDistance < 0f

                if (!swipeActive) {
                    if (mostlyHorizontal && movingOutward && !movingWrongWay) {
                        swipeActive = true
                    } else {
                        return false
                    }
                }

                val driftTooLarge = abs(dy) > swipeMaxVerticalDriftPx
                val directionWrong = horizontalDistance < 0f
                val swipedOutward = horizontalDistance >= swipeTriggerDistancePx

                if (swipedOutward && mostlyHorizontal && !driftTooLarge && !directionWrong) {
                    swipeEdgeTriggered = true
                    showShutdownConfirm()
                    return true
                }

                if (driftTooLarge || !mostlyHorizontal) {
                    swipeActive = false
                    return false
                }
            }

            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                swipeActive = false
                swipeEdgeTriggered = false
            }
        }

        return false
    }

    private fun showShutdownConfirm() {
        shutdownConfirmVisible = true
        swipeRefreshLayout.isEnabled = false
        shutdownConfirmOverlay.visibility = View.VISIBLE
        shutdownConfirmArrow.text = if (swipeFromLeftEdge) ">" else "<"
        shutdownConfirmArrow.gravity = if (swipeFromLeftEdge) Gravity.START else Gravity.END
        shutdownConfirmText.text = "Shut down dango?"
        shutdownConfirmSubtext.text = if (swipeFromLeftEdge) {
            "You swiped in from the left edge."
        } else {
            "You swiped in from the right edge."
        }
    }

    private fun hideShutdownConfirm() {
        shutdownConfirmVisible = false
        shutdownConfirmOverlay.visibility = View.GONE
        swipeRefreshLayout.isEnabled = true
        swipeEdgeTriggered = false
        swipeActive = false
    }

    private fun waitForServer(pageUrl: String, healthUrl: String) {
        statusText.text = if (devMode) "Connecting to dev server..." else "Starting dango..."
        bootOverlay.visibility = View.VISIBLE
        statusText.visibility = View.VISIBLE
        progressBar.visibility = View.VISIBLE
        webView.visibility = View.INVISIBLE

        scope.launch {
            val ready = withContext(Dispatchers.IO) {
                for (i in 1..120) {
                    if (isHealthReady(healthUrl)) {
                        return@withContext true
                    }
                    delay(1000)
                }
                false
            }

            if (ready) {
                onServerReady(pageUrl)
            } else {
                statusText.text = if (devMode) {
                    "Dev server unreachable at $pageUrl"
                } else {
                    "Server failed to start."
                }
            }
        }
    }

    private fun pollHealthOnce() {
        scope.launch {
            val ready = withContext(Dispatchers.IO) { isHealthReady(HEALTH_URL) }
            if (ready) {
                onServerReady(startUrl)
            }
        }
    }

    private fun isHealthReady(healthUrl: String): Boolean {
        var conn: HttpURLConnection? = null
        return try {
            conn = URL(healthUrl).openConnection() as HttpURLConnection
            conn.connectTimeout = 2000
            conn.readTimeout = 2000
            conn.connect()
            if (conn.responseCode != 200) {
                return false
            }
            val body = try {
                conn.inputStream.bufferedReader().readText()
            } catch (_: Exception) {
                ""
            }
            body.contains("\"ready\":true") || body.contains("\"ready\": true")
        } catch (_: Exception) {
            false
        } finally {
            try {
                conn?.disconnect()
            } catch (_: Exception) {
            }
        }
    }

    private fun onServerReady(pageUrl: String) {
        if (serverReady || shuttingDown) return
        serverReady = true
        bootOverlay.visibility = View.GONE
        statusText.visibility = View.GONE
        progressBar.visibility = View.GONE
        if (webviewEnabled) {
            enterWebViewMode(pageUrl)
        } else {
            enterServerMode()
        }
    }

    private fun setWebViewEnabled(enabled: Boolean) {
        if (devMode) return
        if (enabled == webviewEnabled) {
            syncWebViewSwitches()
            return
        }
        webviewEnabled = enabled
        getSharedPreferences(SetupActivity.PREFS_NAME, MODE_PRIVATE).edit()
            .putBoolean(SetupActivity.KEY_WEBVIEW_ENABLED, enabled).apply()
        syncWebViewSwitches()
        if (shuttingDown) return
        if (enabled) {
            hideShutdownConfirm()
            enterWebViewMode()
        } else {
            hideShutdownConfirm()
            enterServerMode()
        }
    }

    private fun syncWebViewSwitches() {
        if (webViewSwitch.isChecked != webviewEnabled) {
            webViewSwitch.isChecked = webviewEnabled
        }
        if (webViewSwitchConfirm.isChecked != webviewEnabled) {
            webViewSwitchConfirm.isChecked = webviewEnabled
        }
    }

    private fun enterWebViewMode(url: String = startUrl) {
        serverPanel.visibility = View.GONE
        webView.visibility = View.VISIBLE
        if (serverReady && !webViewLoaded) {
            webViewLoaded = true
            webView.loadUrl(url)
        }
    }

    private fun enterServerMode() {
        webView.stopLoading()
        webView.visibility = View.GONE
        bootOverlay.visibility = View.GONE
        updateServerUrlText()
        serverPanel.visibility = View.VISIBLE
    }

    private fun updateServerUrlText() {
        val lanIp = getLanIp()
        serverUrlText.text = if (lanIp != null) {
            "On this device:\nhttp://localhost:3000\n\nOn your network:\nhttp://$lanIp:3000"
        } else {
            "On this device:\nhttp://localhost:3000"
        }
    }

    private fun getLanIp(): String? {
        try {
            val interfaces = java.util.Collections.list(
                java.net.NetworkInterface.getNetworkInterfaces()
            )
            for (intf in interfaces) {
                if (!intf.isUp || intf.isLoopback) continue
                for (addr in java.util.Collections.list(intf.inetAddresses)) {
                    if (addr is java.net.Inet4Address &&
                        !addr.isLoopbackAddress &&
                        addr.isSiteLocalAddress
                    ) {
                        return addr.hostAddress
                    }
                }
            }
        } catch (_: Exception) {
        }
        return null
    }

    private fun gracefulShutdown() {
        if (devMode) {
            finishAndRemoveTask()
            return
        }
        if (shuttingDown) return
        shuttingDown = true
        webView.stopLoading()
        webView.visibility = View.GONE
        bootOverlay.visibility = View.GONE
        serverPanel.visibility = View.GONE
        shutdownOverlay.visibility = View.VISIBLE

        scope.launch {
            withContext(Dispatchers.IO) {
                try {
                    val conn = URL(SHUTDOWN_URL).openConnection() as HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.connectTimeout = 3000
                    conn.readTimeout = 3000
                    conn.connect()
                    try {
                        conn.inputStream.use { it.readBytes() }
                    } catch (_: Exception) {
                    }
                    conn.disconnect()
                } catch (_: Exception) {
                }
            }
            val serverDown = withContext(Dispatchers.IO) {
                for (i in 1..20) {
                    var conn: HttpURLConnection? = null
                    try {
                        conn = URL(HEALTH_URL).openConnection() as HttpURLConnection
                        conn.connectTimeout = 1500
                        conn.readTimeout = 1500
                        conn.connect()
                        val code = conn.responseCode
                        if (code == 503) {
                            return@withContext waitForPortClosed(15000)
                        }
                    } catch (_: Exception) {
                        return@withContext true
                    } finally {
                        try {
                            conn?.disconnect()
                        } catch (_: Exception) {
                        }
                    }
                    delay(1000)
                }
                waitForPortClosed(5000)
            }
            Log.i(TAG, "Shutdown requested, server down: $serverDown")
            NodeService.stop(this@MainActivity)
            finishAndRemoveTask()
        }
    }

    private fun waitForPortClosed(timeoutMs: Long): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            var conn: HttpURLConnection? = null
            try {
                conn = URL(HEALTH_URL).openConnection() as HttpURLConnection
                conn.connectTimeout = 1000
                conn.readTimeout = 1000
                conn.connect()
                conn.responseCode
            } catch (_: Exception) {
                return true
            } finally {
                try {
                    conn?.disconnect()
                } catch (_: Exception) {
                }
            }
            Thread.sleep(500)
        }
        return false
    }

    private fun hideFullscreen() {
        if (customView == null) return

        webView.visibility = View.VISIBLE
        fullscreenContainer.visibility = View.GONE
        fullscreenContainer.removeAllViews()

        window.decorView.systemUiVisibility = savedSystemUiVisibility
        try {
            requestedOrientation = savedOrientation
        } catch (_: Exception) {
        }

        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        swipeRefreshLayout.isEnabled = true

        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        customView = null
    }

    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        NodeService.onStatusChange = null
        if (!devMode) {
            NodeService.stop(this)
        }
        try {
            webView.stopLoading()
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.destroy()
        } catch (_: Exception) {
        }
        scope.cancel()
        super.onDestroy()
    }
}
