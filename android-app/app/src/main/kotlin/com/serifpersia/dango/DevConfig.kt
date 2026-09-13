package com.serifpersia.dango

import android.content.Context
import android.content.pm.ApplicationInfo

object DevConfig {
    fun isEnabled(context: Context): Boolean {
        return (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    }

    const val PREFS_NAME = "dango_prefs"
    const val KEY_DEV_SERVER_URL = "dev_server_url"
    const val DEFAULT_URL = "http://127.0.0.1:5173"

    fun getDevUrl(context: Context): String {
        val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_DEV_SERVER_URL, DEFAULT_URL).orEmpty()
        return normalize(raw)
    }

    fun setDevUrl(context: Context, url: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(KEY_DEV_SERVER_URL, normalize(url)).apply()
    }

    fun normalize(raw: String): String {
        var url = raw.trim().trimEnd('/')
        if (url.isEmpty()) return DEFAULT_URL
        if (!url.contains("://")) url = "http://$url"
        if (!url.substringAfter("://").contains(":")) url = "$url:5173"
        return url
    }
}
