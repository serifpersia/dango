package com.serifpersia.dango

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
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
import androidx.activity.OnBackPressedCallback
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
        private const val FILE_CHOOSER_REQUEST_CODE = 1001
        private const val FILE_DOWNLOAD_REQUEST_CODE = 1002
    }

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
    private var pendingDownloadMimeType: String = "application/octet-stream"

    private val edgeSwipeThresholdPx by lazy { resources.displayMetrics.density * 18f }
    private val swipeTriggerDistancePx by lazy {
        maxOf(
            resources.displayMetrics.density * 260f,
            resources.displayMetrics.widthPixels * 0.45f
        )
    }
    private val swipeMaxVerticalDriftPx by lazy { resources.displayMetrics.density * 24f }
    private val refreshTriggerDistancePx by lazy { (resources.displayMetrics.density * 160f).toInt() }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

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
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            setSupportMultipleWindows(false)
        }

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

            pendingDownloadUrl = url
            pendingDownloadFileName = URLUtil.guessFileName(
                url,
                contentDisposition,
                mimeType
            ).ifBlank { "dango-backup.db" }
            pendingDownloadMimeType = if (mimeType.isNullOrBlank() || mimeType == "application/octet-stream") "*/*" else mimeType

            val saveIntent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = pendingDownloadMimeType
                putExtra(Intent.EXTRA_TITLE, pendingDownloadFileName)
            }

            try {
                startActivityForResult(saveIntent, FILE_DOWNLOAD_REQUEST_CODE)
            } catch (_: Exception) {
                pendingDownloadUrl = null
                android.widget.Toast.makeText(
                    this,
                    "No file manager is available to save this file.",
                    android.widget.Toast.LENGTH_LONG
                ).show()
            }
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
                this@MainActivity.fileChooserCallback?.onReceiveValue(null)
                this@MainActivity.fileChooserCallback = filePathCallback

                if (filePathCallback == null || fileChooserParams == null) {
                    this@MainActivity.fileChooserCallback = null
                    return false
                }

                val chooserIntent = try {
                    fileChooserParams.createIntent().apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        if (type.isNullOrBlank()) {
                            type = "*/*"
                        }
                        if (fileChooserParams.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                        }
                    }
                } catch (_: Exception) {
                    Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                    }
                }

                return try {
                    startActivityForResult(chooserIntent, FILE_CHOOSER_REQUEST_CODE)
                    true
                } catch (_: Exception) {
                    this@MainActivity.fileChooserCallback?.onReceiveValue(null)
                    this@MainActivity.fileChooserCallback = null
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

        NodeService.onStatusChange = { running ->
            if (running) retryLoad()
        }

        NodeService.start(this)
        waitForServer()
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

    private fun waitForServer() {
        statusText.text = "Starting dango..."
        statusText.visibility = View.VISIBLE
        progressBar.visibility = View.VISIBLE

        scope.launch {
            val ready = withContext(Dispatchers.IO) {
                for (i in 1..120) {
                    try {
                        val conn = URL(SERVER_URL).openConnection() as HttpURLConnection
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
                webView.loadUrl(SERVER_URL)
            } else {
                statusText.text = "Server failed to start."
            }
        }
    }

    private fun retryLoad() {
        scope.launch {
            delay(2000)
            webView.loadUrl(SERVER_URL)
        }
    }

    private fun gracefulShutdown() {
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

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_DOWNLOAD_REQUEST_CODE) {
            val downloadUrl = pendingDownloadUrl
            pendingDownloadUrl = null
            if (resultCode != RESULT_OK || data?.data == null || downloadUrl == null) return

            val destinationUri = data.data!!
            scope.launch {
                val saved = withContext(Dispatchers.IO) {
                    try {
                        URL(downloadUrl).openStream().use { input ->
                            contentResolver.openOutputStream(destinationUri)?.use { output ->
                                input.copyTo(output)
                                true
                            } ?: false
                        }
                    } catch (_: Exception) {
                        false
                    }
                }
                android.widget.Toast.makeText(
                    this@MainActivity,
                    if (saved) "File saved successfully." else "Could not save the file.",
                    android.widget.Toast.LENGTH_LONG
                ).show()
            }
            return
        }

        if (requestCode != FILE_CHOOSER_REQUEST_CODE) return

        val callback = fileChooserCallback ?: return
        fileChooserCallback = null

        val results = if (resultCode == RESULT_OK && data != null) {
            WebChromeClient.FileChooserParams.parseResult(resultCode, data)
        } else {
            null
        }
        callback.onReceiveValue(results)
    }

    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        NodeService.stop(this)
        scope.cancel()
        super.onDestroy()
    }
}
