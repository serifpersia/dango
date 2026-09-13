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
        const val SERVER_URL = "http://127.0.0.1:3000"
        const val SHUTDOWN_URL = "$SERVER_URL/api/internal/shutdown"
    }

    private var devMode = false
    private var startUrl = SERVER_URL

    private lateinit var webView: WebView
    private lateinit var swipeRefreshLayout: DangoSwipeRefreshLayout
    private lateinit var progressBar: ProgressBar
    private lateinit var statusText: TextView
    private lateinit var fullscreenContainer: FrameLayout
    private lateinit var shutdownOverlay: View
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
        fullscreenContainer = findViewById(R.id.fullscreenContainer)
        shutdownOverlay = findViewById(R.id.shutdownOverlay)
        shutdownConfirmOverlay = findViewById(R.id.shutdownConfirmOverlay)
        shutdownConfirmArrow = findViewById(R.id.shutdownConfirmArrow)
        shutdownConfirmText = findViewById(R.id.shutdownConfirmText)
        shutdownConfirmSubtext = findViewById(R.id.shutdownConfirmSubtext)
        shutdownConfirmAccept = findViewById(R.id.shutdownConfirmAccept)
        shutdownConfirmCancel = findViewById(R.id.shutdownConfirmCancel)

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
            if (customView == null) {
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
            override fun onPageFinished(view: WebView?, url: String?) {
                swipeRefreshLayout.isRefreshing = false
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    swipeRefreshLayout.isRefreshing = false
                    retryLoad()
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
                if (newProgress >= 100) {
                    progressBar.visibility = View.GONE
                    statusText.visibility = View.GONE
                } else {
                    progressBar.visibility = View.VISIBLE
                    statusText.visibility = View.VISIBLE
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
                    webView.canGoBack() -> webView.goBack()
                    else -> gracefulShutdown()
                }
            }
        })

        devMode = DevConfig.isEnabled(this)
        startUrl = if (devMode) DevConfig.getDevUrl(this) else SERVER_URL
        if (devMode) {
            Log.i(TAG, "Dev server mode: loading $startUrl, node install skipped")
            waitForServer(startUrl)
        } else {
            NodeService.onStatusChange = { running ->
                if (running) retryLoad()
            }
            NodeService.start(this)
            waitForServer(SERVER_URL)
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

    private fun waitForServer(url: String) {
        statusText.text = if (devMode) "Connecting to dev server..." else "Starting dango..."
        statusText.visibility = View.VISIBLE
        progressBar.visibility = View.VISIBLE

        scope.launch {
            val ready = withContext(Dispatchers.IO) {
                for (i in 1..120) {
                    try {
                        val conn = URL(url).openConnection() as HttpURLConnection
                        conn.connectTimeout = 2000
                        conn.readTimeout = 2000
                        conn.connect()
                        if (conn.responseCode == 200) {
                            conn.disconnect()
                            return@withContext true
                        }
                        conn.disconnect()
                    } catch (_: Exception) {
                    }
                    delay(1000)
                }
                false
            }

            if (ready) {
                webView.loadUrl(url)
            } else {
                statusText.text = if (devMode) {
                    "Dev server unreachable at $url"
                } else {
                    "Server failed to start."
                }
            }
        }
    }

    private fun retryLoad() {
        val url = startUrl
        scope.launch {
            delay(2000)
            webView.loadUrl(url)
        }
    }

    private fun gracefulShutdown() {
        if (devMode) {
            finish()
            return
        }
        webView.visibility = View.GONE
        shutdownOverlay.visibility = View.VISIBLE

        scope.launch {
            withContext(Dispatchers.IO) {
                try {
                    val conn = URL(SHUTDOWN_URL).openConnection() as HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.connectTimeout = 3000
                    conn.readTimeout = 3000
                    conn.connect()
                    conn.disconnect()
                } catch (_: Exception) {
                }
            }
            delay(1500)
            NodeService.stop(this@MainActivity)
            finish()
        }
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
        if (!devMode) {
            NodeService.stop(this)
        }
        scope.cancel()
        super.onDestroy()
    }
}
