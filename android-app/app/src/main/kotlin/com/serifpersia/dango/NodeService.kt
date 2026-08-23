package com.serifpersia.dango

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.*
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit

class NodeService : Service() {

    companion object {
        const val TAG = "DangoNode"
        const val CHANNEL_ID = "dango_node"
        const val NOTIFICATION_ID = 1
        const val NODE_PORT = 3000
        const val DANGO_PACKAGE = "@serifpersia/dango"

        var isRunning = false
            private set
        var onStatusChange: ((Boolean) -> Unit)? = null
        var onLogLine: ((String) -> Unit)? = null

        fun start(context: Context) {
            context.startForegroundService(Intent(context, NodeService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, NodeService::class.java))
        }
    }

    private var nodeProcess: Process? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            "STOP" -> {
                stopNode()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                startForeground(NOTIFICATION_ID, buildNotification("Starting server..."))
                scope.launch { startDango() }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopNode()
        scope.cancel()
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        stopNode()
        super.onTaskRemoved(rootIntent)
    }

    private fun startDango() {
        try {
            val payloadDir = File(filesDir, "payload")
            val dataDir = File(filesDir, "data")
            dataDir.mkdirs()

            val nativeLibDir = applicationInfo.nativeLibraryDir
            val nodeBin = File(nativeLibDir, "libnode.so")
            val libDir = File(payloadDir, "lib")
            val dangoDir = File(payloadDir, "lib/node_modules/$DANGO_PACKAGE")

            if (!dangoDir.exists()) {
                Log.e(TAG, "Dango not installed at ${dangoDir.absolutePath}")
                return
            }

            val orchestrator = File(dangoDir, "orchestrator.js")
            val serverJs = File(dangoDir, "server/dist/server.js")
            val entryPoint = if (serverJs.exists()) serverJs else orchestrator

            if (!entryPoint.exists()) {
                Log.e(TAG, "No entry point found at ${entryPoint.absolutePath}")
                return
            }

            Log.i(TAG, "Starting dango: ${entryPoint.absolutePath}")
            updateNotification("Starting dango server...")

            val args = mutableListOf(nodeBin.absolutePath, entryPoint.absolutePath)
            if (entryPoint.name == "orchestrator.js") {
                args.add("prod")
            }

            val pb = ProcessBuilder(args)
            pb.directory(dangoDir)
            pb.environment().apply {
                put("HOME", dataDir.absolutePath)
                put("PATH", "$nativeLibDir:${payloadDir.absolutePath}/bin:/system/bin")
                put("LD_LIBRARY_PATH", libDir.absolutePath)
                put("OPENSSL_CONF", File(payloadDir, "etc/tls/openssl.cnf").absolutePath)
                put("PORT", NODE_PORT.toString())
                put("PREFIX", payloadDir.absolutePath)
                put("npm_config_prefix", payloadDir.absolutePath)
                put("NODE_PATH", File(payloadDir, "lib/node_modules").absolutePath)
            }
            pb.redirectErrorStream(true)

            nodeProcess = pb.start()
            isRunning = true
            onStatusChange?.invoke(true)

            val reader = BufferedReader(InputStreamReader(nodeProcess!!.inputStream))
            while (nodeProcess?.isAlive == true) {
                val line = reader.readLine() ?: break
                Log.i(TAG, line)
                onLogLine?.invoke(line)
                if (line.contains("running at") || line.contains("Listening on")) {
                    updateNotification("dango running on port $NODE_PORT")
                }
            }

            val exitCode = nodeProcess?.waitFor() ?: -1
            Log.w(TAG, "Dango exited with code $exitCode")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start dango", e)
        } finally {
            isRunning = false
            onStatusChange?.invoke(false)
        }
    }

    fun stopNode() {
        nodeProcess?.let { proc ->
            try {
                proc.destroy()
                if (!proc.waitFor(5, TimeUnit.SECONDS)) {
                    proc.destroyForcibly()
                }
            } catch (_: Exception) {}
        }
        nodeProcess = null
        isRunning = false
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "dango server",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "dango server status"
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(text: String) =
        androidx.core.app.NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("dango")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_send)
            .setOngoing(true)
            .build()

    private fun updateNotification(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification(text))
    }
}
