// ترميز أوامر ESC/POS القياسية لطابعات الإيصالات الحرارية الرخيصة (البروتوكول المستخدم فعلياً
// في أغلب الطابعات الصينية/شاومي المتوافقة). التنسيق هنا مبني على المرجع القياسي المُوثَّق لأوامر
// ESC/POS (init/align/cut) وهو نفسه ما تستخدمه أشهر مكتبات JS مفتوحة المصدر لهذا الغرض.
//
// ⚠️ نتائج أول اختبار فعلي على جهاز Sunmi V2 حقيقي (طابعته الحرارية المدمجة، عبر الجسر الأصلي):
//   - الشعار (GS v 0) والأرقام/الحروف اللاتينية طُبعت بشكل صحيح تماماً.
//   - **كل نص عربي طُبع كرموز تشبه الصينية/اليابانية (CJK)** — التأكيد الفعلي للتحفّظ القديم أدناه:
//     كانت النصوص (بما فيها العربية) تُرسَل كـ UTF-8 خام عبر TextEncoder بلا أي أمر تحديد ترميز
//     (ESC t / FS & / FS .)، فتُفسِّرها لوحة تحكم الطابعة عبر جدول ترميزها الافتراضي الخاص بها
//     (على الأرجح جدول DBCS صيني على هذه الفئة من لوحات التحكم) بدل UTF-8 — بايتات UTF-8 متعددة
//     لحرف عربي واحد تُقرَأ كزوج بايتات DBCS فتُظهِر حرفاً صينياً/يابانياً عشوائياً، بينما أي بايت
//     أحادي (أرقام/حروف لاتينية) يبقى صحيحاً في أي جدول ترميز تقريباً.
//   - **الحل المُطبَّق هنا** (بدل البحث عن جدول ترميز/أمر codepage مناسب لكل طابعة، حل هش يختلف من
//     طراز لآخر): مُتن الإيصال بالكامل (كل شيء عدا الشعار ورمز QR، وكلاهما يعمل فعلياً كصورة نقطية
//     أصلاً) يُرسَم الآن كصورة نقطية واحدة عبر <canvas> مخفي في نفس صفحة الويب، باستخدام محرّك
//     تنسيق النص ثنائي الاتجاه (BIDI) وتشكيل الحروف العربية المدمج في المتصفح نفسه (direction:
//     "rtl")، ثم يُحوَّل لبتات أحادية اللون ويُرسَل بنفس أمر GS v 0 الذي يعمل فعلياً للشعار — لا
//     اعتماد على تفسير الطابعة للترميز إطلاقاً بعد اليوم؛ كل بكسل مرسوم مسبقاً على مستوى البايت.
//   - راجع buildReceiptContentModel/renderContentModelToCanvas/canvasToPackedBits أدناه.
//
// نقطتان أخريان لم تُختبَرا بعد فعلياً على جهاز حقيقي:
//   ١) خدمة/خاصية البلوتوث (service/characteristic UUID): لا يوجد معيار موحّد بين الشركات
//      المصنّعة لطابعات BLE الرخيصة؛ الكود أدناه يجرّب أشهر المعرّفات المُلاحَظة فعلياً في هذه
//      الفئة من الطابعات بالترتيب، ويستخدم أول قناة كتابة (write/writeWithoutResponse) يجدها.
//   ٢) رمز QR (GS v 0 صورة نقطية، راجع qrImage أدناه) — أُبقي بلا تغيير عمداً (يعمل فعلياً على
//      حسب الاختبار الأول)، لكن moduleScale نفسه لم يُتحقَّق من قابليته للمسح الضوئي على ورق فعلي.
//
// ⚠️ نتائج الاختبار الثاني (بعد إصلاح الترميز العربي أعلاه): النص العربي طُبع مُشكَّلاً وصحيحاً —
//    الحل بالصورة النقطية نجح. سبعة أعطال أخرى ظهرت، كلها أُصلِحت في هذا التعديل عدا ما ذُكِر خلافه:
//   ١) معادلة سطر الصنف كانت تطبع "الكمية × سعر الوحدة = total"، وtotal شامل الضريبة لا ناتج
//      الضربة الفعلي — معادلة خاطئة حسابياً. أُصلِحت لاستخدام line.subtotal (قبل الضريبة، مطابق
//      فعلياً دائماً لأن نقطة البيع لا تدعم خصم سطر إطلاقاً) — راجع buildReceiptContentModel.
//   ٢) سطرا "قبل الضريبة"/"الضريبة" (كانا موجودين في مسار النص القديم ومعاينة الشاشة ReceiptView.jsx
//      دائماً) سقطا سهواً عند إعادة الكتابة كصورة نقطية — أُعيدا.
//   ٣) لا عنوان لنوع المستند إطلاقاً (فاتورة ضريبية/مبسّطة) — أُضيف عبر documentTitle.
//   ٤) التاريخ طُبع هجرياً فقط رغم طلب ميلادي صراحة ("١٤٤٦/٤/١٤ هـ") — سبب toLocaleString("ar-SA")
//      العادية: تقويمها الافتراضي في ICU/V8 هجري (أم القرى)، لا ميلادي كما قد يُفتَرض. أُصلِح عبر
//      formatGregorianDateTime (calendar: "gregory", numberingSystem: "latn" صراحة). فارق الساعة
//      المُلاحَظ بين ساعة الجهاز وتوقيت الإيصال المطبوع لم يُعثَر على أي كود يفرض إزاحة توقيت هنا —
//      راجع تعليق formatGregorianDateTime أعلاه لتفصيل هذا (على الأرجح إعداد المنطقة الزمنية على
//      الجهاز نفسه وقت الاختبار، لا كود في هذا المستودع).
//   ٥) سطر واحد أعلى الإيصال ظهر كرموز صينية (نفس عطل الترميز الأصلي) رغم أن كل النصوص هنا صور
//      نقطية الآن — لم يُعثَر على أي استدعاء نص خام متبقٍّ في هذا الملف أو MainActivity.kt (لا
//      text()، لا printText/printTextWithFont AIDL في أي مسار). الاحتمال الأقوى المدعوم بالأدلة:
//      حزمة JS قديمة مخبَّأة على الجهاز (WebView/CDN) لم تُحدَّث لآخر نشر — الحزمة النصية القديمة
//      كانت تطبع اسم الشركة كأول سطر نصي مباشرة بعد الشعار، ما يطابق الموضع المُبلَّغ عنه تماماً.
//      يحتاج تأكيداً على جهاز حقيقي بعد تفريغ ذاكرة التخزين المؤقت للـWebView/إعادة تحميل قسري.
//   ٦) كل الأسطر كانت محاذاة يساراً رغم أن المستند عربي/RTL بالكامل — بقية من محاذاة ESC/POS
//      الفعلية القديمة (0 يسار)، لا قراراً تصميمياً. أُصلِحت لـ"right" — راجع buildReceiptContentModel.
//   ٧) شعار أثر التجاري كان يُطبَع بدل شعار الشركة البائعة الفعلي. الحقل (Company.logoKey) وواجهة
//      الرفع (CompanyEditModal.jsx عبر companies.controller.ts) موجودان فعلاً في المنصة ومُستخدَمان
//      في قوالب PDF الأخرى — لم يكن ينقص سوى استخدامهما هنا. أُصلِح عبر renderCompanyLogoRaster
//      (يجلب company.logoUrl حياً وقت الطباعة، لا صورة ثابتة مُعبَّأة مسبقاً كما كان شعار أثر). هذا
//      أضاف الحاجة لتعريض company.logoUrl على استجابة getSalesInvoice أيضاً (لم تكن مُعرَّضة هناك
//      رغم وجودها في استجابة قائمة الشركات) — راجع salesInvoices.service.ts.
import QRCode from "qrcode";
import { loadPrinterSettings } from "./posLocalSettings.js";
import { formatGregorianDateTime } from "../../i18n/dateFormat.js";

const ESC = 0x1b;
const GS = 0x1d;

// عرض الورق بالنقاط — نفس التقارب الصناعي القياسي (203 نقطة/بوصة) المُستخدَم أصلاً في هذا الملف
// لعرض الأعمدة النصية القديم (32/48 حرفاً) ومقياس رمز QR (moduleScale)، لا افتراضاً جديداً.
// 58مم ≈ 48مم قابلة للطباعة × 8 نقطة/مم ≈ 384 نقطة؛ 80مم ≈ 72مم × 8 ≈ 576 نقطة.
function dotWidthForPaper(paperWidthMm) {
  return paperWidthMm === 58 ? 384 : 576;
}

class EscPosBuilder {
  constructor() {
    this.chunks = [byte(ESC, 0x40)]; // ESC @ — إعادة ضبط الطابعة لحالتها الافتراضية
  }

  align(mode) {
    // 0 يسار، 1 وسط، 2 يمين
    this.chunks.push(byte(ESC, 0x61, mode));
    return this;
  }

  feed(lines = 1) {
    this.chunks.push(byte(ESC, 0x64, lines));
    return this;
  }

  /**
   * يُدرج رمز QR (رمز زاتكا للفاتورة الضريبية المبسّطة إلزامي على الإيصال المطبوع، وليس رفاهية)
   * كصورة نقطية (raster) عبر أمر GS v 0 القياسي — أوسع توافقاً بين طرازات الطابعات من أمر GS ( k
   * الخاص برموز QR الأصلية في الطابعة (تنفيذه غير موحّد بين الشركات المصنِّعة)، ولا يعتمد على أي
   * قدرة QR مدمجة في الطابعة أصلاً. QRCode.create من نفس مكتبة qrcode المستخدمة لعرض الرمز في
   * شاشة الفاتورة العادية (legacy/shared.jsx) — نفس البيانات (qrPayload) ونفس الترميز، فقط بمخرج
   * مصفوفة وحدات خام (modules) بدل صورة DOM. هامش أبيض (marginModules) حول الرمز ضروري لقابلية
   * المسح الضوئي (منطقة هادئة/quiet zone حسب مواصفة QR)، وmoduleScale يحدد حجم كل وحدة بالنقاط.
   */
  qrImage(payload, { moduleScale = 4, marginModules = 4 } = {}) {
    const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
    const qrSize = qr.modules.size;
    const finalSize = qrSize + marginModules * 2;
    const matrix = new Uint8Array(finalSize * finalSize);
    for (let y = 0; y < qrSize; y++) {
      for (let x = 0; x < qrSize; x++) {
        matrix[(y + marginModules) * finalSize + (x + marginModules)] = qr.modules.data[y * qrSize + x];
      }
    }

    const dotSize = finalSize * moduleScale;
    const widthBytes = Math.ceil(dotSize / 8);
    const rows = new Uint8Array(widthBytes * dotSize);
    for (let row = 0; row < dotSize; row++) {
      const moduleRow = Math.floor(row / moduleScale);
      for (let col = 0; col < dotSize; col++) {
        if (matrix[moduleRow * finalSize + Math.floor(col / moduleScale)]) {
          rows[row * widthBytes + Math.floor(col / 8)] |= 0x80 >> (col % 8);
        }
      }
    }

    this.rasterBands(dotSize, dotSize, rows);
    return this;
  }

  /**
   * يُدرج صورة نقطية أحادية اللون كبيرة (متن الإيصال الكامل، راجع renderContentModelToCanvas) عبر
   * عدّة أوامر GS v 0 متتالية بلا أي فاصل بينها بدل أمر واحد ضخم — كل "حزمة" (band) بارتفاع
   * RASTER_BAND_MAX_HEIGHT كحد أقصى، فتظهر بصرياً كصورة واحدة متصلة تماماً (لا فجوة، لا قصّ ورق)
   * لأن الطابعة تستقبلها كتيار بايتات متصل. هذا يخدم غرضين: (أ) تفادي أي حدّ أقصى لارتفاع صورة
   * واحدة قد تفرضه لوحة تحكم طابعة معيّنة (الحدّ النظري لأمر GS v 0 نفسه 65535 نقطة، لكن بعض
   * التطبيقات الرخيصة تُقصِّر عملياً)، و(ب) تقسيم بايتات الإيصال إلى وحدات صغيرة متجانسة يسهل
   * تجميعها لاحقاً إلى دفعات آمنة الحجم لقناة النقل (راجع toSafeSendChunks) دون قطع أي أمر واحد
   * في منتصفه.
   */
  rasterBands(width, height, packedBits, maxBandHeight = RASTER_BAND_MAX_HEIGHT) {
    const widthBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y += maxBandHeight) {
      const bandHeight = Math.min(maxBandHeight, height - y);
      const start = y * widthBytes;
      const end = (y + bandHeight) * widthBytes;
      this.chunks.push(byte(GS, 0x76, 0x30, 0x00, widthBytes & 0xff, (widthBytes >> 8) & 0xff, bandHeight & 0xff, (bandHeight >> 8) & 0xff));
      this.chunks.push(packedBits.subarray(start, end));
    }
    return this;
  }

  cut() {
    this.feed(3);
    // GS V 66 0 — قص جزئي مع تغذية ورق، الشكل الأكثر توافقاً عبر طرازات ESC/POS المختلفة. لاحظ:
    // أجهزة Sunmi اليدوية (V2 وما شابه) عادة بلا سكين آلي إطلاقاً — هذا الأمر يُتجاهَل بأمان على
    // تلك الأجهزة (لا يفشل، لا يطبع شيئاً إضافياً)، ويُنفَّذ فعلياً على الطابعات التي تملك سكيناً.
    this.chunks.push(byte(GS, 0x56, 0x42, 0x00));
    return this;
  }

  toBytes() {
    return concatChunks(this.chunks);
  }

  /**
   * يُجمِّع chunks المبنية أصلاً (كل عنصر أمر/بيانات كامل بذاته، راجع rasterBands أعلاه) في دفعات
   * لا يتجاوز حجم أي منها maxBytes — بلا قطع أي عنصر واحد أبداً في منتصفه (حتى لو تجاوز هو نفسه
   * الحدّ، حالة نظرية لا تحدث عملياً هنا لأن كل حزمة raster محدودة الحجم أصلاً عبر
   * RASTER_BAND_MAX_HEIGHT). يُستخدَم فقط لمسار الجسر الأصلي (راجع NATIVE_BRIDGE_SAFE_CHUNK_BYTES
   * أدناه لسبب وجوده) — مسار البلوتوث له تجزئته الخاصة أصلاً على مستوى حزم BLE في
   * sendToBluetoothPrinter، ومسار المتصفح/A4 لا علاقة له بأي من هذا إطلاقاً.
   */
  toSafeSendChunks(maxBytes) {
    const groups = [];
    let current = [];
    let currentSize = 0;
    for (const chunk of this.chunks) {
      if (current.length > 0 && currentSize + chunk.length > maxBytes) {
        groups.push(current);
        current = [];
        currentSize = 0;
      }
      current.push(chunk);
      currentSize += chunk.length;
    }
    if (current.length) groups.push(current);
    return groups.map(concatChunks);
  }
}

function concatChunks(chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function byte(...vals) {
  return Uint8Array.from(vals);
}

/** عنوان بريدي مُجمَّع من أجزائه (مبنى، شارع، مدينة) بنفس الترتيب والفاصل المُستخدَمين أصلاً في
 * companyAddress/customerAddress بقالب إيميل الفاتورة (راجع salesInvoiceEmail.service.ts) — بلا
 * حي/رمز بريدي هنا لأنهما غير معروضين هناك أيضاً، حتى يبقى "العنوان الكامل" متسقاً عبر النظام. */
function joinAddressParts(parts) {
  return parts.filter(Boolean).join("، ");
}

/**
 * نص حالة زاتكا للطباعة — مُشتَقّ من invoice.zatcaStatus الفعلي المخزَّن على الفاتورة (لا نص ثابت
 * بصرف النظر عن الحالة الحقيقية): "cleared" لفاتورة قياسية خُلِّصت فعلياً، "reported" لفاتورة
 * مبسّطة أُبلِغت فعلياً (راجع تعليق enum ZatcaDocumentStatus في schema.prisma). أي حالة أخرى
 * (not_applicable/not_submitted/rejected/submission_failed/certificate_error/compliance_checked)
 * تعني أن زاتكا لم تقبل المستند فعلياً بعد — لا شيء يُطبَع، لا رسالة تخمينية مضلِّلة.
 */
function zatcaAcceptanceLine(zatcaStatus) {
  if (zatcaStatus === "cleared") return "تم تخليص الفاتورة إلكترونياً (زاتكا) — Cleared";
  if (zatcaStatus === "reported") return "تم إبلاغ الفاتورة إلكترونياً (زاتكا) — Reported";
  return null;
}

/**
 * عنوان نوع المستند — إلزامي زاتكا أن يُذكر نوع المستند على الفاتورة نفسها (اللائحة التنفيذية
 * لضريبة القيمة المضافة المادة 53، ودليل زاتكا الإرشادي التفصيلي للفوترة الإلكترونية)، وهو أمر
 * غائب تماماً عن الإيصال حتى الآن. "فاتورة ضريبية" مقابل "فاتورة ضريبية مبسطة" هما التسميتان
 * المعتمَدتان لتمييز القياسية عن المبسّطة (المادة 53(6)/(8))، و"إشعار دائن"/"إشعار مدين" نفس
 * تسميتي DOCUMENT_TITLE_EN في invoiceHtmlTemplate.ts لقالب PDF/A-3 الموقَّع — نفس الاسم حرفياً
 * حتى يتطابق مستندا نفس الفاتورة (PDF المُرسَل بالإيميل والإيصال المطبوع). kind بمعامل صريح (لا
 * افتراض دائم "invoice") لأن نقطة البيع تطبع فواتير بيع فقط حالياً؛ لو أُعيد استخدام هذا المُصيِّر
 * مستقبلاً لإشعار دائن/مدين (مردودات نقطة البيع مثلاً) يُمرَّر kind الفعلي دون تعديل هنا.
 */
function documentTitle({ kind = "invoice", subtype }) {
  if (kind === "credit_note") return "إشعار دائن";
  if (kind === "debit_note") return "إشعار مدين";
  return subtype === "standard" ? "فاتورة ضريبية" : "فاتورة ضريبية مبسطة";
}

/**
 * "نموذج المحتوى" — قائمة كتل وصفية بحتة (نص/فاصل)، بلا أي رسم أو تشفير بايتات هنا إطلاقاً. مُستقلّ
 * تماماً عن DOM/canvas عمداً حتى يبقى قابلاً للاختبار المباشر (node:test، بلا حاجة لمتصفح) — راجع
 * escpos.test.js. renderContentModelToCanvas أدناه (يحتاج متصفحاً فعلياً) يستهلك هذا الناتج فقط.
 *
 * align: "center"/"left"/"right" — لكل الأسطر عدا كتلة البائع/الإجمالي/حالة زاتكا "right" الآن (لا
 * "left" كما كانت قبل الاختبار الثاني على جهاز حقيقي): المستند عربي/RTL بالكامل، ومحاذاته يساراً
 * كانت بقية من مسار النص القديم بمحاذاة ESC/POS الفعلية (0 يسار)، لا قراراً تصميمياً. direction:
 * "rtl" في renderContentModelToCanvas يضبط ترتيب/تشكيل الحروف داخل السطر فقط، لا أي جهة يلتصق بها
 * السطر على الورق — هذا الأخير من مسؤولية textAlign هنا فعلياً.
 *
 * الحقول الإلزامية زاتكا (راجع تقرير التحقق من المصدر الذي سبق إضافتها، وتقرير الاختبار الثاني
 * على جهاز حقيقي الذي كشف غياب عنوان المستند وسطري الإجمالي قبل/بعد الضريبة):
 *   - عنوان نوع المستند (فاتورة ضريبية/مبسّطة) أعلى كل شيء — راجع documentTitle أعلاه.
 *   - بيانات البائع (اسم/رقم ضريبي/عنوان كامل) دائماً بصرف النظر عن نوع الفاتورة.
 *   - بيانات المشتري (اسم/عنوان كامل/رقم ضريبي) الثلاثة فقط لفاتورة قياسية (invoiceType
 *     === "standard")؛ المبسّطة تبقى بلا عنوان/رقم ضريبي للعميل.
 *   - الإجمالي قبل الضريبة وقيمة الضريبة كسطرين منفصلين قبل الإجمالي الكلي (كانا موجودين في مسار
 *     النص القديم ومعاينة الشاشة ReceiptView.jsx، وسقطا سهواً عند إعادة الكتابة كصورة نقطية).
 */
export function buildReceiptContentModel({ company, invoice, lastEmailOrNote }) {
  const isStandard = invoice.invoiceType === "standard";
  const blocks = [];
  const addLine = (text, align = "center") => { if (text) blocks.push({ type: "line", text: String(text), align, bold: false, large: false }); };
  const addEmphasisLine = (text, align = "center") => { if (text) blocks.push({ type: "line", text: String(text), align, bold: true, large: true }); };
  const addDivider = () => blocks.push({ type: "divider" });

  addEmphasisLine(documentTitle({ subtype: invoice.invoiceType }), "center");

  // --- كتلة البائع: اسم + رقم ضريبي + عنوان كامل، دائماً بصرف النظر عن نوع الفاتورة (وسط) ---
  addEmphasisLine(company?.name || "", "center");
  if (company?.vatNumber) addLine(`الرقم الضريبي: ${company.vatNumber}`, "center");
  const sellerAddress = joinAddressParts([company?.addressBuilding, company?.addressStreet, company?.addressCity]);
  if (sellerAddress) addLine(`العنوان: ${sellerAddress}`, "center");
  addDivider();

  addLine(`فاتورة رقم: ${invoice.invoiceNumber}`, "right");
  // تقويم ميلادي وأرقام غربية إلزامياً (BT-2) — راجع formatGregorianDateTime لسبب عدم كفاية
  // toLocaleString("ar-SA") العادية (تقويمها الافتراضي هجري في ICU/V8، كشفه الاختبار الثاني على
  // جهاز حقيقي: "١٤٤٦/٤/١٤ هـ" بدل تاريخ ميلادي). التوقيت المطبوع هنا هو توقيت نظام تشغيل الجهاز
  // نفسه (لا منطقة زمنية مفروضة صراحة) — نفس اللحظة الزمنية المُرسَلة لزاتكا فعلياً (UTC صراحة عبر
  // formatIssueTimeUtc في chain.ts)، فقط مُحوَّلة لعرضها محلياً؛ أي فرق عن ساعة الجهاز نفسها مصدره
  // إعداد المنطقة الزمنية على الجهاز، لا كود هذا الملف (راجع تقرير التحقيق المرفق لتفصيل هذا).
  addLine(`التاريخ: ${formatGregorianDateTime(invoice.date, "ar")}`, "right");

  // --- كتلة المشتري: الاسم فقط للمبسّطة؛ + عنوان كامل ورقم ضريبي إضافيين للقياسية ---
  addLine(`العميل: ${invoice.customer?.name || "عميل نقدي"}`, "right");
  if (isStandard) {
    if (invoice.customer?.vatNumber) addLine(`الرقم الضريبي للعميل: ${invoice.customer.vatNumber}`, "right");
    const buyerAddress = joinAddressParts([invoice.customer?.buildingNo, invoice.customer?.street, invoice.customer?.city]);
    if (buyerAddress) addLine(`عنوان العميل: ${buyerAddress}`, "right");
  }
  addDivider();

  for (const line of invoice.lines || []) {
    const name = line.description || line.account?.name || "";
    addLine(name, "right");
    const qty = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    // lineSubtotal (صافي السطر قبل الضريبة، عمود subtotal في SalesInvoiceLine) لا line.total (شامل
    // الضريبة) — الاختبار الثاني على جهاز حقيقي كشف معادلة خاطئة حسابياً هنا ("3.50 × 60 = 241.50"،
    // بينما 3.50×60 = 210.00 فعلياً؛ 241.50 هو الإجمالي شامل ضريبة 15%). نقطة البيع لا تدعم خصم سطر
    // إطلاقاً (discountPct دائماً صفر لمبيعاتها، راجع absence أي واجهة إدخال خصم في frontend/src/pos)
    // فالمعادلة هنا صحيحة حسابياً دائماً فعلياً، لا فقط تقريباً.
    const lineSubtotal = Number(line.subtotal);
    addLine(`  ${qty} × ${unitPrice.toFixed(2)} = ${lineSubtotal.toFixed(2)}`, "right");
  }
  addDivider();

  // الإجمالي قبل الضريبة وقيمة الضريبة — نفس تسميتي receiptView.beforeVat/vat في ar.json (المعاينة
  // على الشاشة)، حتى يتطابق نص المستندين حرفياً لا الحقول فقط.
  addLine(`قبل الضريبة: ${Number(invoice.subtotal).toFixed(2)}`, "right");
  addLine(`الضريبة: ${Number(invoice.vatTotal).toFixed(2)}`, "right");
  addEmphasisLine(`الإجمالي: ${Number(invoice.grandTotal).toFixed(2)}`, "right");

  if (lastEmailOrNote) addLine(lastEmailOrNote, "right");

  // اسم مُصدِر الفاتورة (المستخدم الذي أنشأها فعلياً) — يصل جاهزاً على invoice.issuedByName من
  // الخادم (pos.service.ts لفاتورة طازجة، getSalesInvoice لإعادة طباعة فاتورة سابقة عبر القيد
  // المحاسبي المرتبط بها)؛ لا سطر إن تعذّر تحديده (فاتورة بلا قيد محاسبي مرتبط بعد، نادر).
  if (invoice.issuedByName) addLine(`البائع: ${invoice.issuedByName}`, "right");

  // حالة زاتكا الفعلية المخزَّنة على الفاتورة — لا شيء يُطبَع إن لم تُقبَل بعد.
  const zatcaLine = zatcaAcceptanceLine(invoice.zatcaStatus);
  if (zatcaLine) addLine(zatcaLine, "center");

  return blocks;
}

/** كتلة الشكر الثابتة — منفصلة عن buildReceiptContentModel لأنها تُطبَع بعد رمز QR (نفس الترتيب
 * الأصلي)، لا قبله ضمن نفس متن الإيصال. */
export function buildThankYouContentModel() {
  return [{ type: "line", text: "شكراً لتعاملكم معنا", align: "center", bold: false, large: false }];
}

const RASTER_MARGIN_PX = 10;
const NORMAL_FONT_PX = 26;
const LARGE_FONT_PX = 34;
const LINE_HEIGHT_RATIO = 1.35;
const BLOCK_GAP_PX = 4;
const DIVIDER_GAP_PX = 8;
const DIVIDER_THICKNESS_PX = 2;
// ارتفاع سخي كافٍ لأي إيصال واقعي (عشرات البنود) — يُقتَطع للارتفاع الفعلي المُستخدَم فقط عبر
// getImageData(0, 0, width, ارتفاع فعلي)، فلا كلفة طباعة إضافية لو كان المحتوى أقصر بكثير.
const CANVAS_MAX_HEIGHT_PX = 4000;
// عتبة لومينانس (0 أسود–255 أبيض) لتحويل كل بكسل رمادي (نتيجة تنعيم الحواف الطبيعي لرسم النص)
// إلى أسود/أبيض صريح — عتبة صريحة مقصودة (لا انحياز افتراضي من أي تحويل صورة جاهز) تفضّل ظهور
// حواف حروف حادة وواضحة على حساب تدرّج ناعم، وهو الأنسب لنص صغير على طابعة حرارية 1-bit.
const RASTER_THRESHOLD = 150;
// أقصى ارتفاع (نقطة) لأمر GS v 0 واحد ضمن متن الإيصال الكبير — راجع تعليق rasterBands.
const RASTER_BAND_MAX_HEIGHT = 200;
// حدّ آمن محافظ لحجم أي استدعاء JS↔Kotlin واحد إلى printEscPos — أقل بكثير من حدّ معاملة
// Binder على أندرويد (~1 ميجابايت تقريباً لكل معاملة)، مع هامش أمان كبير. راجع
// buildReceiptEscPosChunks/printViaNativeBridge لكيفية استخدامه فعلياً.
const NATIVE_BRIDGE_SAFE_CHUNK_BYTES = 256 * 1024;

/** يقسّم نصاً إلى أسطر لا يتجاوز عرضها المقاس الفعلي (بكسل) maxWidth — عبر ctx.measureText الحقيقي
 * (لا عدّ أحرف تقريبي كما كان سابقاً)، فيتكيّف تلقائياً مع أي خط/حجم. التفاف على حدود الكلمات لا
 * بتر، وكلمة مفردة أعرض من العرض نفسه (نادر) تُقسَّم قسراً حرفاً حرفاً بدل تجاوزها لحافة الورق. */
function wrapTextByWidth(ctx, text, maxWidth) {
  if (!text) return [""];
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines = [];
  let current = "";
  for (let word of words) {
    while (ctx.measureText(word).width > maxWidth && word.length > 1) {
      let cut = word.length;
      while (cut > 1 && ctx.measureText(word.slice(0, cut)).width > maxWidth) cut--;
      if (current) { lines.push(current); current = ""; }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * يرسم نموذج المحتوى (buildReceiptContentModel/buildThankYouContentModel) على <canvas> مخفي بعرض
 * dotWidth نقطة بالضبط (لا تحجيم لاحق يُطمِّس الحواف — كل بكسل canvas يقابل نقطة طباعة واحدة
 * تماماً)، معتمداً على محرّك BIDI/تشكيل الحروف العربية المدمج في المتصفح (direction: "rtl") بدل أي
 * منطق تشكيل يدوي. يحتاج DOM حقيقياً (document.createElement("canvas")) — لا يعمل في node:test.
 */
export function renderContentModelToCanvas(blocks, dotWidth) {
  const canvas = document.createElement("canvas");
  canvas.width = dotWidth;
  canvas.height = CANVAS_MAX_HEIGHT_PX;
  const ctx = canvas.getContext("2d");
  ctx.direction = "rtl";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, dotWidth, CANVAS_MAX_HEIGHT_PX);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  const usableWidth = dotWidth - RASTER_MARGIN_PX * 2;
  let y = 6;

  for (const block of blocks) {
    if (block.type === "divider") {
      y += DIVIDER_GAP_PX;
      ctx.fillRect(RASTER_MARGIN_PX, y, usableWidth, DIVIDER_THICKNESS_PX);
      y += DIVIDER_THICKNESS_PX + DIVIDER_GAP_PX;
      continue;
    }
    const fontPx = block.large ? LARGE_FONT_PX : NORMAL_FONT_PX;
    ctx.font = `${block.bold ? "bold " : ""}${fontPx}px sans-serif`;
    const lineHeight = Math.round(fontPx * LINE_HEIGHT_RATIO);
    for (const wrapped of wrapTextByWidth(ctx, block.text, usableWidth)) {
      if (block.align === "left") { ctx.textAlign = "left"; ctx.fillText(wrapped, RASTER_MARGIN_PX, y); }
      else if (block.align === "right") { ctx.textAlign = "right"; ctx.fillText(wrapped, dotWidth - RASTER_MARGIN_PX, y); }
      else { ctx.textAlign = "center"; ctx.fillText(wrapped, dotWidth / 2, y); }
      y += lineHeight;
    }
    y += BLOCK_GAP_PX;
  }

  return { canvas, width: dotWidth, height: Math.min(y + 6, CANVAS_MAX_HEIGHT_PX) };
}

/**
 * يحوّل منطقة (0,0)-(width,height) من الـcanvas إلى بتات أحادية اللون مُعبَّأة بنفس تنسيق GS v 0
 * (صفاً صفاً، MSB أولاً) — عتبة لومينانس صريحة (RASTER_THRESHOLD) بدل الاعتماد على أي تحويل صورة
 * افتراضي، حتى تبقى حواف الحروف حادة (لا تشويش/dithering يُميِّع نصاً صغيراً أصلاً على طابعة حرارية).
 */
export function canvasToPackedBits(canvas, width, height) {
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, width, height);
  const widthBytes = Math.ceil(width / 8);
  const bits = new Uint8Array(widthBytes * height);
  for (let yy = 0; yy < height; yy++) {
    for (let xx = 0; xx < width; xx++) {
      const idx = (yy * width + xx) * 4;
      const alpha = data[idx + 3];
      const luminance = alpha === 0 ? 255 : 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (luminance < RASTER_THRESHOLD) bits[yy * widthBytes + (xx >> 3)] |= 0x80 >> (xx % 8);
    }
  }
  return bits;
}

/** يبني الصورة النقطية النهائية (canvas مرسوم + بتات مُعبَّأة) لنموذج محتوى مُعطى، بعرض ورق مُعطى. */
function renderBlocksToRaster(blocks, dotWidth) {
  const { canvas, width, height } = renderContentModelToCanvas(blocks, dotWidth);
  return { width, height, bits: canvasToPackedBits(canvas, width, height) };
}

const LOGO_MAX_WIDTH_PX = 300;
const LOGO_MAX_HEIGHT_PX = 220;

/**
 * يجلب شعار الشركة البائعة نفسها (company.logoUrl — رابط مؤقّت موقَّع مسبقاً من الخادم، راجع
 * withLogoUrl في companies.controller.ts وgetSalesInvoice في salesInvoices.service.ts) ويرسمه على
 * canvas ثم يحوّله لصورة 1-bit بنفس منطق canvasToPackedBits — لا شعار أثر التجاري مُعبَّأ مسبقاً
 * بعد اليوم (راجع تقرير الاختبار الثاني على جهاز حقيقي: هذا مستند ضريبي للعميل، لا إعلان لأثر).
 * لا يوجد شعار جاهز مسبقاً بصيغة GS v 0 لكل شركة محتملة كما كان الحال لشعار أثر الثابت، فلا بد من
 * جلب الصورة الفعلية (أي امتداد يدعمه <img> عادةً) حياً وقت الطباعة نفسها — هذا سبب تحوّل
 * populateReceiptBuilder/buildReceiptEscPos(Chunks) لدوال async.
 * يُعيد null بصمت (لا يوقف الطباعة كاملة) لو: لا شعار مرفوع للشركة أصلاً (logoUrl فارغة)، تعذّر
 * الجلب (لا اتصال إنترنت على الجهاز وقتها — وارد فعلياً على جهاز POS)، أو تعذّر فك الصورة.
 */
async function renderCompanyLogoRaster(logoUrl, dotWidth) {
  if (!logoUrl) return null;
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = logoUrl;
    await img.decode();
    const maxWidth = Math.min(LOGO_MAX_WIDTH_PX, dotWidth - RASTER_MARGIN_PX * 2);
    const scale = Math.min(1, maxWidth / img.naturalWidth, LOGO_MAX_HEIGHT_PX / img.naturalHeight);
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return { width, height, bits: canvasToPackedBits(canvas, width, height) };
  } catch {
    return null;
  }
}

/**
 * يبني بايتات ESC/POS كاملة لإيصال بيع من بيانات الفاتورة — متن الإيصال بالكامل (باستثناء الشعار
 * ورمز QR، راجع تعليق الملف أعلاه) يُرسَم الآن كصورة نقطية واحدة بدل نص خام، لتفادي مشكلة ترميز
 * النص العربي المؤكَّدة على جهاز حقيقي. يحتاج DOM حقيقياً (canvas) — غير قابل للاستدعاء من
 * node:test مباشرة؛ راجع buildReceiptContentModel للجزء القابل للاختبار بلا متصفح.
 * async (منذ الاختبار الثاني على جهاز حقيقي): شعار الشركة البائعة يُجلَب حياً عبر الشبكة الآن بدل
 * كونه بيانات ثابتة مُعبَّأة في الحزمة — راجع renderCompanyLogoRaster.
 */
export async function buildReceiptEscPos({ company, invoice, lastEmailOrNote }, paperWidthMm) {
  const b = new EscPosBuilder();
  await populateReceiptBuilder(b, { company, invoice, lastEmailOrNote }, paperWidthMm);
  return b.toBytes();
}

/**
 * نفس buildReceiptEscPos، لكن الناتج مُقسَّم مسبقاً لدفعات آمنة الحجم (راجع
 * NATIVE_BRIDGE_SAFE_CHUNK_BYTES) بدل بايتات مُسطَّحة واحدة — مخصَّصة لمسار الجسر الأصلي
 * (window.AtharPrinter.printEscPos) تحديداً، الذي يمر عبر جسر JavaScript↔Kotlin ومعاملة Binder
 * محدودة الحجم لكل استدعاء. مسار البلوتوث لا يحتاجها (له تجزئته الخاصة على مستوى BLE أصلاً)، ومسار
 * المتصفح/A4 لا يستخدم أياً من هذا الملف إطلاقاً.
 */
export async function buildReceiptEscPosChunks({ company, invoice, lastEmailOrNote }, paperWidthMm) {
  const b = new EscPosBuilder();
  await populateReceiptBuilder(b, { company, invoice, lastEmailOrNote }, paperWidthMm);
  return b.toSafeSendChunks(NATIVE_BRIDGE_SAFE_CHUNK_BYTES);
}

async function populateReceiptBuilder(b, { company, invoice, lastEmailOrNote }, paperWidthMm) {
  const dotWidth = dotWidthForPaper(paperWidthMm);

  // شعار الشركة البائعة نفسها (لا شعار أثر التجاري بعد اليوم) — يُطبَع أولاً أعلى كل شيء، ويُعطَّل
  // بالكامل عبر إعداد printLogo المحلي للجهاز (posLocalSettings.js). لا شيء يُطبَع لو لم تُحمِّل
  // الشركة شعاراً بعد أو تعذّر جلبه — راجع renderCompanyLogoRaster.
  if (loadPrinterSettings().printLogo && company?.logoUrl) {
    const logo = await renderCompanyLogoRaster(company.logoUrl, dotWidth);
    if (logo) b.align(1).rasterBands(logo.width, logo.height, logo.bits).feed(1);
  }

  // متن الإيصال الكامل (عنوان المستند/بائع/مشتري/بنود/إجمالي/مُصدِر/حالة زاتكا) — صورة نقطية واحدة،
  // راجع تعليق الملف أعلاه لسبب ذلك.
  const bodyBlocks = buildReceiptContentModel({ company, invoice, lastEmailOrNote });
  const body = renderBlocksToRaster(bodyBlocks, dotWidth);
  b.align(0).rasterBands(body.width, body.height, body.bits);

  // رمز زاتكا (QR) للفاتورة الضريبية المبسّطة — إلزامي على الإيصال المطبوع (متطلب امتثال، وليس
  // شكلياً)، ونفس qrPayload المخزَّن على الفاتورة. بلا تغيير — يعمل فعلياً على جهاز حقيقي.
  if (invoice.qrPayload) {
    const moduleScale = paperWidthMm === 58 ? 4 : 5;
    b.align(1).feed(1).qrImage(invoice.qrPayload, { moduleScale }).feed(1);
  }

  const thankYou = renderBlocksToRaster(buildThankYouContentModel(), dotWidth);
  b.align(0).feed(1).rasterBands(thankYou.width, thankYou.height, thankYou.bits);
  b.cut();
}

// معرّفات خدمة/خاصية بلوتوث شائعة على طابعات ESC/POS الرخيصة — تُجرَّب بالترتيب. راجع التعليق
// أعلى الملف: لا يوجد معيار موحّد، هذه أشهر ما لوحِظ في هذه الفئة من الأجهزة.
const CANDIDATE_SERVICE_UUIDS = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
];

export async function requestBluetoothPrinter() {
  if (!navigator.bluetooth) throw new Error("متصفحك لا يدعم Web Bluetooth — استخدم أندرويد/كروم، أو الطباعة العادية كبديل");
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: CANDIDATE_SERVICE_UUIDS,
  });
  return device;
}

/** يتصل بجهاز بلوتوث مُقترَن مسبقاً ويرسل بايتات ESC/POS إلى أول قناة كتابة يجدها. */
export async function sendToBluetoothPrinter(device, bytes) {
  const server = await device.gatt.connect();
  const services = await server.getPrimaryServices();
  for (const service of services) {
    const characteristics = await service.getCharacteristics();
    const writable = characteristics.find((c) => c.properties.writeWithoutResponse || c.properties.write);
    if (!writable) continue;
    // الحد الأقصى المعتاد لحزمة BLE واحدة صغير (غالباً حوالي 20 بايت افتراضياً، أو أكبر لو
    // فُعِّل MTU أعلى) — نُرسِل على دفعات لتفادي فشل الكتابة على حزم كبيرة.
    const chunkSize = 180;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.slice(i, i + chunkSize);
      if (writable.properties.writeWithoutResponse) await writable.writeValueWithoutResponse(chunk);
      else await writable.writeValue(chunk);
    }
    return;
  }
  throw new Error("تعذّر إيجاد قناة كتابة على هذا الجهاز — قد تحتاج تحديد بروتوكول الطابعة يدوياً بعد اختبار حقيقي");
}

// جسر طباعة أصلي اختياري (تطبيق أندرويد غلافي حول WebView لجهاز Sunmi V2 بطابعته الحرارية
// المدمجة) — يُحقَن ككائن @JavascriptInterface باسم AtharPrinter على window قبل تحميل هذه الصفحة.
// عند وجوده يُستخدَم بدل بلوتوث/window.print تماماً (طابعة Sunmi V2 المدمجة ليست جهاز Bluetooth
// يمكن لـ Web Bluetooth الوصول إليه، ولا نافذة طباعة النظام تصل إليها افتراضياً؛ تحتاج SDK أندرويد
// الخاص بها). **مؤكَّد يعمل فعلياً** (أول اختبار طباعة حقيقي على Sunmi V2).
//
// العقد المتوقَّع من التطبيق الأصلي (يُبنى مقابله بشكل منفصل، بلا تغيير هنا):
//   window.AtharPrinter.printEscPos(base64Data: string): string
//     base64Data: بايتات ESC/POS لدفعة واحدة (راجع buildReceiptEscPosChunks) مُرمَّزة Base64 قياسي.
//     المُخرَج: نص JSON متزامن — إما {"success": true} أو {"success": false, "error": "..."}
//     (رسالة الخطأ بالعربية إن أمكن؛ ستُعرَض للمستخدم كما هي).
export function hasNativePrinterBridge() {
  return typeof window !== "undefined" && typeof window.AtharPrinter?.printEscPos === "function";
}

/** يحوّل بايتات خام إلى Base64 على دفعات (بلا نشر المصفوفة بالكامل كوسائط لـ String.fromCharCode
 * دفعة واحدة، الذي يفشل على مصفوفات كبيرة نسبياً كصورة QR/متن الإيصال النقطية). */
export function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * يُرسِل كل دفعة (راجع buildReceiptEscPosChunks) عبر الجسر الأصلي بالترتيب — استدعاءات متتالية من
 * نفس خيط جسر جافاسكربت، فتُعالَج بالترتيب نفسه من خدمة طابعة Sunmi (raw بايتات مُتَّصلة منطقياً،
 * لا صلة لها بحدود استدعاءات AIDL الفردية). يتوقف عند أول فشل بدل الاستمرار بإرسال بقية الإيصال.
 * الحالة الشائعة (إيصال بحجم طبيعي) تنتج دفعة واحدة فقط أصلاً، فهذا يعمل تماماً كما كان سابقاً.
 */
export function printViaNativeBridge(chunks) {
  const list = chunks instanceof Uint8Array ? [chunks] : chunks;
  for (const chunk of list) {
    const resultJson = window.AtharPrinter.printEscPos(bytesToBase64(chunk));
    let result;
    try {
      result = JSON.parse(resultJson);
    } catch {
      throw new Error("رد غير متوقَّع من تطبيق الطباعة");
    }
    if (!result?.success) throw new Error(result?.error || "تعذّرت الطباعة عبر تطبيق أثر");
  }
}
