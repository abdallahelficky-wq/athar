package com.athar.station

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.Menu
import android.view.MenuItem
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.Toolbar
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File

/**
 * غلاف WebView كامل الشاشة حول بوابة الموظف في أثر (mobile.html) لعمّال محطات الوقود على هواتف
 * عادية — بلا أي منطق أعمال هنا، فقط: تحميل رابط الخادم، وتنفيذ حقول رفع الصور في صفحة الويب
 * (<input type="file" accept="image/…" capture="environment">) التي لا تفعل شيئاً إطلاقاً داخل WebView
 * ما لم يُنفِّذ التطبيق WebChromeClient.onShowFileChooser بنفسه — وهذا سبب وجود هذا التطبيق أصلاً
 * (تصوير عدّادات المضخات وإيصالات المصروفات). بلا طابعة Sunmi ولا جسر تنزيل (البوابة لا تنزِّل ملفات).
 *
 * قاعدة واحدة لا استثناء لها: كل استدعاء لـ onShowFileChooser يجب أن ينتهي بـ onReceiveValue على
 * callback الخاص به (قيمة أو null) — سواء التُقطت صورة، أو ألغى العامل، أو رُفضت صلاحية الكاميرا، أو
 * لم يوجد تطبيق كاميرا، أو فُتح اختيار جديد قبل انتهاء السابق. WebView لا يفتح أي اختيار ملفات جديد
 * طالما بقي callback سابق بلا رد، فتفشل كل محاولة تصوير لاحقة بصمت تام.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    // --- اختيار الملفات / الكاميرا ---
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPhotoUri: Uri? = null
    private var pendingPhotoFile: File? = null

    private val takePictureLauncher = registerForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        val uri = pendingPhotoUri
        val file = pendingPhotoFile
        pendingPhotoUri = null
        pendingPhotoFile = null
        // saved=false يعني إلغاء (أو فشل تطبيق الكاميرا) — يُرَد null صراحةً، لا يُترك الـcallback معلّقاً.
        // بعض تطبيقات الكاميرا تُعيد نجاحاً دون كتابة أي بايت — ملف فارغ يُعامَل كإلغاء لا كصورة.
        val photoWritten = saved && uri != null && file != null && file.length() > 0
        if (!photoWritten) file?.delete()
        deliverFileResult(if (photoWritten) arrayOf(uri!!) else null)
    }

    private val pickContentLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        deliverFileResult(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
    }

    private val cameraPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            launchCamera()
        } else {
            Toast.makeText(this, R.string.camera_permission_denied, Toast.LENGTH_LONG).show()
            deliverFileResult(null)
        }
    }

    // --- شاشة الإعدادات (اختيارية دائماً من القائمة) ---
    private val settingsLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == RESULT_OK) {
            ServerUrlStore.get(this)?.let { webView.loadUrl(it) }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        setSupportActionBar(findViewById<Toolbar>(R.id.toolbar))

        webView = findViewById(R.id.webView)
        setupWebView()

        // نفس سلوك زر الرجوع في تطبيق نقطة البيع: يرجع في تاريخ الـWebView، ولا يخرج من التطبيق إلا
        // حين لا يبقى تاريخ للرجوع إليه.
        onBackPressedDispatcher.addCallback(this) {
            if (webView.canGoBack()) webView.goBack() else {
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
            }
        }

        val savedUrl = ServerUrlStore.get(this)
        if (savedUrl.isNullOrBlank()) {
            ServerUrlStore.set(this, DEFAULT_SERVER_URL)
            webView.loadUrl(DEFAULT_SERVER_URL)
        } else {
            webView.loadUrl(savedUrl)
        }
    }

    private fun setupWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true

        webView.webViewClient = WebViewClient()
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams,
            ): Boolean {
                handleFileChooser(filePathCallback, fileChooserParams)
                return true // تعهّد بالرد على filePathCallback (وهو ما يضمنه deliverFileResult دائماً)
            }

            // البوابة لا تطلب كاميرا حيّة (getUserMedia) ولا ميكروفوناً — يُرفض أي طلب صريحاً بدل تركه معلّقاً
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { request.deny() }
            }
        }
    }

    private fun handleFileChooser(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams) {
        // اختيار سابق لم يُرد عليه بعد (نادر: نقرتان سريعتان) — يُغلَق بـnull أولاً قبل استبداله
        deliverFileResult(null)
        pendingFileCallback = callback

        if (wantsCameraCapture(params)) {
            // تطبيق يُصرِّح بصلاحية CAMERA في Manifest لا يستطيع إطلاق ACTION_IMAGE_CAPTURE قبل منحها فعلياً
            // (SecurityException) — لذا يُطلب منحها أولاً في وقت التشغيل
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                launchCamera()
            } else {
                cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            }
        } else {
            try {
                pickContentLauncher.launch(params.createIntent())
            } catch (e: ActivityNotFoundException) {
                Log.w(TAG, "لا يوجد تطبيق لاختيار الملفات", e)
                deliverFileResult(null)
            }
        }
    }

    /** capture="..." على حقل يقبل صوراً (أو لا يحدّد نوعاً) — تصوير مباشر بالكاميرا لا معرض الصور. */
    private fun wantsCameraCapture(params: WebChromeClient.FileChooserParams): Boolean {
        if (!params.isCaptureEnabled) return false
        val types = params.acceptTypes.filter { it.isNotBlank() }
        return types.isEmpty() || types.any { it.startsWith("image/") }
    }

    private fun launchCamera() {
        try {
            val dir = File(cacheDir, CAMERA_CACHE_DIR).apply { mkdirs() }
            val file = File.createTempFile("photo_", ".jpg", dir)
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            pendingPhotoUri = uri
            pendingPhotoFile = file
            takePictureLauncher.launch(uri)
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "لا يوجد تطبيق كاميرا على هذا الجهاز", e)
            Toast.makeText(this, R.string.camera_unavailable, Toast.LENGTH_LONG).show()
            pendingPhotoUri = null
            pendingPhotoFile = null
            deliverFileResult(null)
        } catch (e: Exception) {
            Log.e(TAG, "تعذّر تجهيز ملف الصورة للكاميرا", e)
            Toast.makeText(this, R.string.camera_unavailable, Toast.LENGTH_LONG).show()
            pendingPhotoUri = null
            pendingPhotoFile = null
            deliverFileResult(null)
        }
    }

    /** الطريق الوحيد للرد على callback الصفحة — يضمن ردّاً واحداً بالضبط ثم يُفرِّغه. */
    private fun deliverFileResult(uris: Array<Uri>?) {
        val callback = pendingFileCallback ?: return
        pendingFileCallback = null
        callback.onReceiveValue(uris)
    }

    override fun onDestroy() {
        // النشاط يُغلَق والصفحة معه — لا يُترك callback بلا رد
        deliverFileResult(null)
        super.onDestroy()
    }

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

    companion object {
        private const val TAG = "AtharStation"
        private const val CAMERA_CACHE_DIR = "camera"

        // بوابة الموظف صفحة دخول مستقلة (mobile.html)، لا مسار داخل التطبيق الرئيسي — الملف الفعلي
        // نفسه يعمل على أي خادم ساكن، وهو نفسه start_url/scope في manifest-employee.webmanifest.
        const val DEFAULT_SERVER_URL = "https://www.atharerp.com/mobile.html"
    }
}
