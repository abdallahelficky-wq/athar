package com.athar.pos

import android.content.Context

/** تخزين رابط خادم أثر الذي يُدخله المستخدم — بلا أي قيمة افتراضية مدمجة بالكود إطلاقاً؛ التطبيق
 * يطلبه صراحةً في أول تشغيل (راجع MainActivity) ولا يعمل بلا رابط محفوظ. */
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
