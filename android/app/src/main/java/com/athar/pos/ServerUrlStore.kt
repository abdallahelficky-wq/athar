package com.athar.pos

import android.content.Context

/** تخزين رابط خادم أثر الحالي — يُحفَظ هنا سواء أُدخِل يدوياً من شاشة الإعدادات أو كان الافتراضي
 * (DEFAULT_SERVER_URL في MainActivity) المحفوظ تلقائياً في أول تشغيل بلا رابط سابق. */
object ServerUrlStore {
    private const val PREFS_NAME = "athar_pos_prefs"
    private const val KEY_SERVER_URL = "server_url"

    fun get(context: Context): String? =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_SERVER_URL, null)

    fun set(context: Context, url: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER_URL, url)
            .apply()
    }
}
