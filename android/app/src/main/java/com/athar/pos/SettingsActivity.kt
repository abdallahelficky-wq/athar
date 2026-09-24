package com.athar.pos

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/** شاشة صغيرة لإدخال/تعديل رابط خادم أثر — تُفتَح إجبارياً في أول تشغيل (لا رابط محفوظ بعد)، وبعدها
 * اختيارياً من قائمة MainActivity في أي وقت لتغيير الرابط. */
class SettingsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        title = getString(R.string.settings_title)

        val urlInput = findViewById<EditText>(R.id.serverUrlInput)
        val saveButton = findViewById<Button>(R.id.saveButton)

        urlInput.setText(ServerUrlStore.get(this) ?: "")

        saveButton.setOnClickListener {
            val url = urlInput.text.toString().trim()
            if (url.isEmpty() || !(url.startsWith("http://") || url.startsWith("https://"))) {
                Toast.makeText(this, R.string.settings_invalid_url, Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            ServerUrlStore.set(this, url)
            setResult(RESULT_OK)
            finish()
        }
    }
}
