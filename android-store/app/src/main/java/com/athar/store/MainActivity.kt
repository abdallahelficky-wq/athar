package com.athar.store

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.addCallback
import androidx.appcompat.app.AppCompatActivity

/**
 * «أثر المتجر الإلكتروني» — تطبيق العملاء العام لمتاجر أثر: غلاف WebView حول دليل المتاجر العام والمتاجر نفسها
 * (frontend/src/store، يُخدَم من أثر على BuildConfig.STORE_URL). ليس خاصاً بشركة: يفتح الدليل، ومنه أي متجر
 * مُدرَج. لا منطق أعمال هنا: السلة والحساب والطلبات كلها في صفحة المتجر نفسها.
 *  - يبقى داخل التطبيق كل ما هو تحت مسار المتاجر (/store) على مضيفه؛ وأي رابط آخر (واتساب wa.me، اتصال، بريد، موقع
 *    خارجي) يُفتَح في تطبيقه — فلا تتحول نافذة المتجر إلى متصفح عام، ولا يُفتَح نظام أثر المحاسبي داخلها.
 *  - localStorage مفعَّل: فيه السلة ورمز دخول العميل، فيبقيان بين مرات فتح التطبيق.
 *  - بلا جسر JavaScript ولا صلاحيات غير الإنترنت.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var progress: ProgressBar
    private lateinit var offline: View
    private val storeUri: Uri = Uri.parse(BuildConfig.STORE_URL)
    private var failed = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webView)
        progress = findViewById(R.id.progress)
        offline = findViewById(R.id.offline)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // روابط target=_blank (زر واتساب) تُحمَّل في النافذة نفسها فتمرّ على shouldOverrideUrlLoading
            setSupportMultipleWindows(false)
            allowFileAccess = false
            allowContentAccess = false
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (isStorePage(uri)) return false
                openExternally(uri)
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                failed = false
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (!failed) {
                    offline.visibility = View.GONE
                    webView.visibility = View.VISIBLE
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                // فشل الصفحة نفسها فقط (لا صورة أو طلب فرعي) يُظهر شاشة "تعذّر الاتصال"
                if (!request.isForMainFrame) return
                failed = true
                webView.visibility = View.INVISIBLE
                offline.visibility = View.VISIBLE
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progress.progress = newProgress
                progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
            }
        }

        findViewById<Button>(R.id.retry).setOnClickListener {
            if (webView.url.isNullOrEmpty() || webView.url == "about:blank") webView.loadUrl(BuildConfig.STORE_URL) else webView.reload()
        }

        // زر الرجوع يرجع في تاريخ الصفحة أولاً، ويخرج من التطبيق عند أول صفحة فقط
        onBackPressedDispatcher.addCallback(this) {
            if (webView.canGoBack()) webView.goBack() else finish()
        }

        if (savedInstanceState == null) webView.loadUrl(BuildConfig.STORE_URL) else webView.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    /** صفحة من المتجر نفسه: https، المضيف نفسه (مع أو بلا www)، وتحت مسار المتجر — لا أي صفحة أخرى على أثر. */
    private fun isStorePage(uri: Uri): Boolean {
        if (uri.scheme != "https") return false
        val host = uri.host?.removePrefix("www.") ?: return false
        if (host != storeUri.host?.removePrefix("www.")) return false
        val base = storeUri.path?.trimEnd('/') ?: return false
        val path = uri.path ?: return false
        return path == base || path.startsWith("$base/")
    }

    private fun openExternally(uri: Uri) {
        val intent = when (uri.scheme) {
            "tel" -> Intent(Intent.ACTION_DIAL, uri)
            "http", "https", "mailto", "whatsapp" -> Intent(Intent.ACTION_VIEW, uri)
            // أي مخطط آخر (intent:، javascript:، file:…) لا يُفتَح
            else -> return
        }
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show()
        }
    }
}
