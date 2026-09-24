package com.athar.pos

import android.Manifest
import android.app.DownloadManager
import android.content.ComponentName
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.IBinder
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.view.Menu
import android.view.MenuItem
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.Toolbar
import androidx.core.content.ContextCompat
import org.json.JSONObject
import woyou.aidlservice.jiuiv5.ICallback
import woyou.aidlservice.jiuiv5.IWoyouService
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * غلاف WebView كامل الشاشة حول تطبيق أثر لنقطة البيع (POS) على جهاز Sunmi V2 اليدوي — بلا أي منطق
 * أعمال هنا، فقط: تحميل رابط الخادم المُعَدّ من المستخدم، صلاحية الكاميرا لمسح الباركود، معالجة
 * تنزيل ملفات (زر تحميل PDF الفاتورة)، وجسر طباعة أصلي (window.AtharPrinter) يطابق العقد المُعلَن
 * في PR الطباعة على مستودع أثر الرئيسي (athar) — راجع README.md المجاور لتفاصيل هذا العقد.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    // --- ربط خدمة طابعة Sunmi المدمجة (woyou.aidlservice.jiuiv5) ---
    private var printerService: IWoyouService? = null
    private var printerLatch = CountDownLatch(1)

    private val printerConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            printerService = IWoyouService.Stub.asInterface(binder)
            printerLatch.countDown()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            printerService = null
            printerLatch = CountDownLatch(1)
        }
    }

    private val printerCallback = object : ICallback.Stub() {
        override fun onRunResult(isSuccess: Boolean) {
            if (!isSuccess) {
                Log.w(TAG, "الطابعة أعادت onRunResult(false) بعد قبول البيانات")
                runOnUiThread { Toast.makeText(this@MainActivity, R.string.printer_run_failed, Toast.LENGTH_LONG).show() }
            }
        }

        override fun onReturnString(result: String?) {
            Log.d(TAG, "printer onReturnString: $result")
        }

        override fun onRaiseException(code: Int, msg: String?) {
            Log.e(TAG, "printer onRaiseException code=$code msg=$msg")
            runOnUiThread {
                Toast.makeText(this@MainActivity, getString(R.string.printer_exception, code, msg), Toast.LENGTH_LONG).show()
            }
        }
    }

    // --- صلاحية الكاميرا (WebChromeClient.onPermissionRequest ← صلاحية أندرويد الفعلية) ---
    private var pendingWebPermissionRequest: PermissionRequest? = null
    private val cameraPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val request = pendingWebPermissionRequest
        pendingWebPermissionRequest = null
        if (request == null) return@registerForActivityResult
        if (granted) request.grant(request.resources) else request.deny()
    }

    // --- صلاحية التخزين (أندرويد 9 وأقدم فقط — راجع writeToDownloads) ---
    private var pendingStorageAction: (() -> Unit)? = null
    private val storagePermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val action = pendingStorageAction
        pendingStorageAction = null
        // يُستأنَف التنفيذ دائماً على خيط خلفي — قد يتضمن كتابة ملف فعلية (writeToDownloads)، وهذا
        // الاستدعاء بالذات (رد فعل ActivityResultLauncher) يعمل على الخيط الرئيسي دائماً.
        if (granted && action != null) Thread { action() }.start()
        else if (!granted) Toast.makeText(this, R.string.download_permission_denied, Toast.LENGTH_LONG).show()
    }

    // --- شاشة الإعدادات (أول تشغيل إجبارياً، بعدها اختيارياً من القائمة) ---
    private val settingsLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == RESULT_OK) {
            // حُفِظ رابط جديد فعلياً — أعِد تحميل الصفحة به
            ServerUrlStore.get(this)?.let { loadServerUrl(it) }
        } else if (ServerUrlStore.get(this) == null) {
            // لا رابط محفوظ إطلاقاً وأُغلقت شاشة الإعدادات بلا حفظ (أول تشغيل) — لا معنى للاستمرار
            finish()
        }
        // وإلا: رابط محفوظ بالفعل وأُلغيَت الشاشة بلا تغيير — لا داعي لإعادة تحميل الصفحة وفقدان
        // حالة الجلسة الحالية (سلة بيع مفتوحة مثلاً) بلا أي سبب فعلي.
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        setSupportActionBar(findViewById<Toolbar>(R.id.toolbar))

        webView = findViewById(R.id.webView)
        setupWebView()
        bindPrinterService()

        onBackPressedDispatcher.addCallback(this) {
            if (webView.canGoBack()) webView.goBack() else {
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
            }
        }

        val savedUrl = ServerUrlStore.get(this)
        if (savedUrl.isNullOrBlank()) {
            settingsLauncher.launch(Intent(this, SettingsActivity::class.java))
        } else {
            loadServerUrl(savedUrl)
        }
    }

    private fun loadServerUrl(url: String) {
        webView.loadUrl(url)
    }

    private fun setupWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        // IndexedDB يعمل تلقائياً في WebView الحديثة (Chromium) بمجرد تفعيل domStorageEnabled —
        // لا خاصية WebSettings منفصلة له.

        webView.webViewClient = WebViewClient()

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { handleWebPermissionRequest(request) }
            }
        }

        webView.setDownloadListener { url, userAgent, contentDisposition, mimetype, _ ->
            handleDownload(url, userAgent, contentDisposition, mimetype)
        }

        webView.addJavascriptInterface(AtharPrinterBridge(), "AtharPrinter")
        webView.addJavascriptInterface(AtharDownloaderBridge(), "AtharDownloaderNative")
    }

    private fun handleWebPermissionRequest(request: PermissionRequest) {
        val needsCamera = request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
        if (!needsCamera) {
            request.deny()
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(request.resources)
        } else {
            pendingWebPermissionRequest = request
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    // =========================================================================================
    // تنزيل الملفات (زر "تحميل PDF" في شاشة الفاتورة)
    //
    // واجهة أثر تُنزِّل الملفات دائماً عبر blob: (fetch للـPDF ثم URL.createObjectURL + نقر رابط
    // تنزيل اصطناعي — راجع downloadBlob في legacy/shared.jsx على المستودع الرئيسي)، وWebView لا
    // يمرّر محتوى روابط blob: الفعلي عبر DownloadListener (فقط اسم الرابط نفسه بلا بيانات) — الحل
    // القياسي: نحقن جافاسكربت يقرأ نفس الـblob من صفحة الويب ذاتها (fetch(url).then(blob) حيث لا
    // يزال صالحاً داخل نفس السياق) كنص Base64 عبر FileReader، ثم يُعيده لجسر أصلي يكتبه فعلياً على
    // القرص. تنزيلات http(s) العادية (نادرة هنا، لكن مدعومة لبقية الروابط) تمرّ عبر DownloadManager
    // القياسي مباشرة.
    // =========================================================================================
    private fun handleDownload(url: String, userAgent: String, contentDisposition: String, mimetype: String) {
        val filename = URLUtil.guessFileName(url, contentDisposition, mimetype)
        if (url.startsWith("blob:")) {
            val script = """
                (function() {
                  fetch(${JSONObject.quote(url)})
                    .then(function(res) { return res.blob(); })
                    .then(function(blob) {
                      var reader = new FileReader();
                      reader.onloadend = function() {
                        AtharDownloaderNative.saveBase64DataUrl(reader.result, ${JSONObject.quote(filename)});
                      };
                      reader.readAsDataURL(blob);
                    })
                    .catch(function(err) { console.error('athar-pos: blob download fetch failed', err); });
                })();
            """.trimIndent()
            webView.evaluateJavascript(script, null)
        } else {
            ensureStoragePermissionThen {
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    addRequestHeader("User-Agent", userAgent)
                    setMimeType(mimetype)
                    setTitle(filename)
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
                }
                (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
                Toast.makeText(this, getString(R.string.download_started, filename), Toast.LENGTH_SHORT).show()
            }
        }
    }

    /** آمنة الاستدعاء من أي خيط — @JavascriptInterface (مثل saveBase64DataUrl) يعمل دائماً على خيط
     * خلفي في WebView لا الرئيسي، بينما DownloadListener.onDownloadStart يعمل على الخيط الرئيسي؛
     * فقط استدعاء ActivityResultLauncher.launch نفسه يتطلب الخيط الرئيسي تحديداً فنُحوِّله إليه. */
    private fun ensureStoragePermissionThen(action: () -> Unit) {
        val granted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            action()
        } else {
            pendingStorageAction = action
            runOnUiThread { storagePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE) }
        }
    }

    /** جسر داخلي بحت (ليس جزءاً من عقد window.AtharPrinter المُعلَن للتطبيق الويب) يستقبل نص data
     * URL من الجافاسكربت المُحقَن أعلاه ويكتبه فعلياً في مجلد التنزيلات. */
    inner class AtharDownloaderBridge {
        @JavascriptInterface
        fun saveBase64DataUrl(dataUrl: String, suggestedName: String) {
            ensureStoragePermissionThen {
                try {
                    val commaIndex = dataUrl.indexOf(',')
                    if (commaIndex < 0) throw IllegalArgumentException("data URL غير صالح")
                    val meta = dataUrl.substring(0, commaIndex)
                    val base64Part = dataUrl.substring(commaIndex + 1)
                    val bytes = Base64.decode(base64Part, Base64.DEFAULT)
                    val mime = Regex("data:(.*?);base64").find(meta)?.groupValues?.get(1) ?: "application/octet-stream"
                    writeToDownloads(bytes, suggestedName, mime)
                    runOnUiThread {
                        Toast.makeText(this@MainActivity, getString(R.string.download_saved, suggestedName), Toast.LENGTH_SHORT).show()
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "فشل حفظ الملف المُنزَّل", e)
                    runOnUiThread { Toast.makeText(this@MainActivity, R.string.download_failed, Toast.LENGTH_LONG).show() }
                }
            }
        }
    }

    private fun writeToDownloads(bytes: ByteArray, filename: String, mime: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, filename)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("تعذّر إنشاء ملف في مجلد التنزيلات")
            resolver.openOutputStream(uri)?.use { it.write(bytes) }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } else {
            @Suppress("DEPRECATION")
            val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            if (!dir.exists()) dir.mkdirs()
            File(dir, filename).writeBytes(bytes)
        }
    }

    // =========================================================================================
    // جسر الطباعة — يطابق العقد المُعلَن في PR طابعة نقطة البيع على مستودع أثر الرئيسي:
    //   window.AtharPrinter.printEscPos(base64Data: string): string
    // يعيد نص JSON متزامن {"success": true} أو {"success": false, "error": "..."}. راجع README.md
    // لشرح كامل لمعنى "success" هنا بالضبط (قبول البيانات من الخدمة، لا تأكيد الطباعة الفعلية).
    // =========================================================================================
    inner class AtharPrinterBridge {
        @JavascriptInterface
        fun printEscPos(base64Data: String): String {
            return try {
                val service = awaitPrinterService(PRINTER_BIND_TIMEOUT_MS)
                    ?: return errorJson(getString(R.string.printer_service_unavailable))
                val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                service.sendRAWData(bytes, printerCallback)
                successJson()
            } catch (e: Exception) {
                Log.e(TAG, "فشل إرسال بيانات ESC/POS لخدمة الطابعة", e)
                errorJson(e.message ?: getString(R.string.printer_send_failed))
            }
        }
    }

    private fun bindPrinterService() {
        try {
            val intent = Intent().apply {
                setPackage(PRINTER_SERVICE_PACKAGE)
                setAction(PRINTER_SERVICE_ACTION)
            }
            val bound = bindService(intent, printerConnection, Context.BIND_AUTO_CREATE)
            if (!bound) {
                Log.w(TAG, "bindService أعاد false — على الأرجح خدمة طابعة Sunmi غير مثبَّتة على هذا الجهاز")
                printerLatch.countDown()
            }
        } catch (e: Exception) {
            Log.e(TAG, "تعذّر ربط خدمة طابعة Sunmi (woyou.aidlservice.jiuiv5)", e)
            printerLatch.countDown()
        }
    }

    /** يُستدعى من خيط جسر جافاسكربت في WebView (خيط خلفي دائماً، لا الرئيسي) — انتظار محدود المدة
     * يغطي فقط السباق النادر بين أول طباعة وبين onServiceConnected غير المكتمل بعد؛ الطباعات
     * التالية تعود فوراً لأن القفل يكون قد فُتح مسبقاً. */
    private fun awaitPrinterService(timeoutMs: Long): IWoyouService? {
        printerLatch.await(timeoutMs, TimeUnit.MILLISECONDS)
        return printerService
    }

    private fun successJson(): String = JSONObject().put("success", true).toString()

    private fun errorJson(message: String): String = JSONObject().put("success", false).put("error", message).toString()

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == R.id.action_settings) {
            settingsLauncher.launch(Intent(this, SettingsActivity::class.java))
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    override fun onDestroy() {
        try {
            unbindService(printerConnection)
        } catch (_: IllegalArgumentException) {
            // لم تُربَط الخدمة أصلاً (مثلاً bindService فشل من البداية) — لا شيء لفكّه
        }
        super.onDestroy()
    }

    companion object {
        private const val TAG = "AtharPos"
        private const val PRINTER_SERVICE_PACKAGE = "woyou.aidlservice.jiuiv5"
        private const val PRINTER_SERVICE_ACTION = "woyou.aidlservice.jiuiv5.IWoyouService"
        private const val PRINTER_BIND_TIMEOUT_MS = 3000L
    }
}
