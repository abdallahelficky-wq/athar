package com.athar.station

import android.Manifest
import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.provider.MediaStore
import android.util.Base64
import android.webkit.WebView
import androidx.core.content.IntentCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.intent.Intents
import androidx.test.espresso.intent.Intents.intended
import androidx.test.espresso.intent.Intents.intending
import androidx.test.espresso.intent.matcher.IntentMatchers.hasAction
import androidx.test.espresso.intent.VerificationModes.times
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import androidx.test.uiautomator.UiDevice
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * يختبر المسار الفعلي الذي يستخدمه عامل المحطة: صفحة ويب داخل WebView التطبيق فيها نفس الحقل
 * <input type="file" accept="image/…" capture="environment"> المستخدم في StationShiftScreen.jsx، يُنقَر
 * بلمسة حقيقية على الشاشة (UiAutomator — لا نقر برمجي بجافاسكربت، فالمتصفح لا يفتح اختيار ملفات إلا عن
 * تفاعل مستخدم حقيقي)، ثم يُعترَض طلب الكاميرا (ACTION_IMAGE_CAPTURE) بـEspresso-Intents بدل تطبيق كاميرا
 * حقيقي — يكتب "المُصوِّر" البديل صورة JPEG فعلية في نفس EXTRA_OUTPUT الذي جهّزه التطبيق عبر FileProvider،
 * بالضبط كما يفعل أي تطبيق كاميرا. الصفحة تكتب ما استلمته فعلاً في document.title فيقرؤه الاختبار.
 */
@RunWith(AndroidJUnit4::class)
class CameraCaptureTest {

    @get:Rule
    val cameraPermission: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.CAMERA)

    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val device = UiDevice.getInstance(instrumentation)

    /** ما يفعله "تطبيق الكاميرا" البديل في الاستدعاء التالي. */
    private enum class CameraBehaviour { TAKE_PHOTO, CANCEL, OK_BUT_WRITE_NOTHING }

    private val nextBehaviour = AtomicReference(CameraBehaviour.TAKE_PHOTO)
    private val lastOutputUri = AtomicReference<Uri?>(null)
    private val cameraLaunches = AtomicInteger(0)

    @Before
    fun setUp() {
        Intents.init()
        intending(hasAction(MediaStore.ACTION_IMAGE_CAPTURE)).respondWithFunction { intent ->
            cameraLaunches.incrementAndGet()
            val output = IntentCompat.getParcelableExtra(intent, MediaStore.EXTRA_OUTPUT, Uri::class.java)
            lastOutputUri.set(output)
            when (nextBehaviour.get()) {
                CameraBehaviour.TAKE_PHOTO -> {
                    writeJpeg(output!!)
                    Instrumentation.ActivityResult(Activity.RESULT_OK, null)
                }
                CameraBehaviour.CANCEL -> Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null)
                CameraBehaviour.OK_BUT_WRITE_NOTHING -> Instrumentation.ActivityResult(Activity.RESULT_OK, null)
            }
        }
        ServerUrlStore.set(context, TEST_PAGE)
    }

    @After
    fun tearDown() {
        Intents.release()
        context.getSharedPreferences("athar_station_prefs", android.content.Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test
    fun takingAPhotoDeliversTheJpegToThePage() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitForTitle(scenario) { it == "ready" }
            nextBehaviour.set(CameraBehaviour.TAKE_PHOTO)

            tapPhotoInput()
            val title = waitForTitle(scenario) { it.startsWith("got:1:") }

            // got:<عدد الملفات>:<الحجم>:<النوع>
            val parts = title.split(":")
            assertEquals("exactly one file delivered", "1", parts[1])
            assertTrue("delivered file is not empty (size=${parts[2]})", parts[2].toLong() > 0)
            assertEquals("image/jpeg", parts[3])

            val uri = lastOutputUri.get()!!
            assertEquals("${context.packageName}.fileprovider", uri.authority)
            intended(hasAction(MediaStore.ACTION_IMAGE_CAPTURE), times(1))
        }
    }

    @Test
    fun cancellingTheCameraStillLetsTheNextCaptureWork() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitForTitle(scenario) { it == "ready" }

            // 1) العامل يفتح الكاميرا ثم يلغي — يجب أن يُرَد null على callback الصفحة
            nextBehaviour.set(CameraBehaviour.CANCEL)
            tapPhotoInput()
            waitUntil("first camera launch") { cameraLaunches.get() == 1 }
            device.waitForIdle()

            // 2) يحاول مجدداً — لو بقي callback الإلغاء معلّقاً، لن يفتح WebView أي اختيار جديد إطلاقاً
            nextBehaviour.set(CameraBehaviour.TAKE_PHOTO)
            tapPhotoInput()
            val title = waitForTitle(scenario) { it.startsWith("got:1:") }

            assertEquals("a second camera launch happened after the cancel", 2, cameraLaunches.get())
            assertTrue("photo delivered on the retry: $title", title.split(":")[2].toLong() > 0)
        }
    }

    @Test
    fun aCameraThatReportsSuccessWithoutWritingIsTreatedAsCancelled() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitForTitle(scenario) { it == "ready" }

            nextBehaviour.set(CameraBehaviour.OK_BUT_WRITE_NOTHING)
            tapPhotoInput()
            waitUntil("camera launch") { cameraLaunches.get() == 1 }
            device.waitForIdle()

            // لم تُسلَّم أي صورة فارغة للصفحة، والمحاولة التالية لا تزال تعمل
            nextBehaviour.set(CameraBehaviour.TAKE_PHOTO)
            tapPhotoInput()
            val title = waitForTitle(scenario) { it.startsWith("got:1:") }
            assertEquals(2, cameraLaunches.get())
            assertEquals("the only delivery was the real photo", "1", title.split(":")[4])
        }
    }

    // ---------------------------------------------------------------------------------------------

    /** الحقل مغلّف بـlabel يملأ منطقة المحتوى كاملة (مثل أزرار "تصوير" في شاشة العامل) — لمسة في منتصف
     * الجزء السفلي من الشاشة (أسفل شريط الأدوات دائماً) تقع عليه. */
    private fun tapPhotoInput() {
        device.waitForIdle()
        device.click(device.displayWidth / 2, device.displayHeight * 2 / 3)
    }

    private fun readTitle(scenario: ActivityScenario<MainActivity>): String {
        val ref = AtomicReference("")
        scenario.onActivity { ref.set(it.findViewById<WebView>(R.id.webView).title ?: "") }
        return ref.get()
    }

    private fun waitForTitle(scenario: ActivityScenario<MainActivity>, predicate: (String) -> Boolean): String {
        val deadline = System.currentTimeMillis() + TIMEOUT_MS
        var last = ""
        while (System.currentTimeMillis() < deadline) {
            last = readTitle(scenario)
            if (predicate(last)) return last
            Thread.sleep(200)
        }
        throw AssertionError("page title never matched; last title was '$last'")
    }

    private fun waitUntil(what: String, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return
            Thread.sleep(100)
        }
        throw AssertionError("timed out waiting for $what")
    }

    private fun writeJpeg(uri: Uri) {
        val bitmap = Bitmap.createBitmap(64, 48, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.rgb(200, 100, 40)) }
        context.contentResolver.openOutputStream(uri)!!.use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
        }
    }

    companion object {
        private const val TIMEOUT_MS = 20_000L

        // deliveries يَعُدّ كل تسليم فعلي لملف (change بملف غير فارغ) — للتحقق من عدم تسليم صورة فارغة
        private val PAGE_HTML = """
            <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>loading</title></head>
            <body style="margin:0">
              <label style="display:block;width:100vw;height:100vh;background:#eee;font-size:32px">
                TAP TO CAPTURE
                <input id="photo" type="file" accept="image/*" capture="environment" hidden>
              </label>
              <script>
                var deliveries = 0;
                document.getElementById('photo').addEventListener('change', function (e) {
                  var f = e.target.files;
                  if (f.length && f[0].size > 0) deliveries++;
                  document.title = 'got:' + f.length + ':' + (f.length ? f[0].size : 0) + ':' + (f.length ? f[0].type : '') + ':' + deliveries;
                  e.target.value = '';
                });
                window.onload = function () { document.title = 'ready'; };
              </script>
            </body></html>
        """.trimIndent()

        val TEST_PAGE = "data:text/html;base64," + Base64.encodeToString(PAGE_HTML.toByteArray(), Base64.NO_WRAP)
    }
}
