// ترميز أوامر ESC/POS القياسية لطابعات الإيصالات الحرارية الرخيصة (البروتوكول المستخدم فعلياً
// في أغلب الطابعات الصينية/شاومي المتوافقة). التنسيق هنا مبني على المرجع القياسي المُوثَّق لأوامر
// ESC/POS (init/align/bold/cut) وهو نفسه ما تستخدمه أشهر مكتبات JS مفتوحة المصدر لهذا الغرض —
// لكن **لم يُختبَر فعلياً على طابعة حقيقية** (لا يوجد جهاز متاح في بيئة التطوير هذه). النقطتان
// اللي غالباً تحتاجان ضبطاً دقيقاً بعد اختبار حقيقي:
//   ١) ترميز النص العربي: يُرسَل هنا كـ UTF-8 خام بالترتيب المنطقي (logical order) — أغلب
//      الطابعات الحديثة المدَّعية دعم لغات متعددة تفهم UTF-8 مباشرة، لكن بعض الطابعات الأقدم
//      تحتاج جدول ترميز مختلف (CP864/CP1256) أو حتى قلب اتجاه النص يدوياً (RTL reshaping) لأن
//      المتحكم الداخلي للطابعة لا يعالج ثنائية الاتجاه (BIDI) بنفسه.
//   ٢) خدمة/خاصية البلوتوث (service/characteristic UUID): لا يوجد معيار موحّد بين الشركات
//      المصنّعة لطابعات BLE الرخيصة؛ الكود أدناه يجرّب أشهر المعرّفات المُلاحَظة فعلياً في هذه
//      الفئة من الطابعات بالترتيب، ويستخدم أول قناة كتابة (write/writeWithoutResponse) يجدها.
//   ٣) رمز QR (GS v 0 صورة نقطية، راجع qrImage أدناه) — أمر قياسي مدعوم على نطاق واسع، لكن نفس
//      تحفّظ عدم الاختبار الفعلي أعلاه ينطبق عليه: حجم/دقة الطباعة (moduleScale) قد يحتاج ضبطاً
//      بعد اختبار حقيقي للتأكد من قابلية مسح الرمز ضوئياً على الورق الفعلي.
import QRCode from "qrcode";

const ESC = 0x1b;
const GS = 0x1d;

class EscPosBuilder {
  constructor() {
    this.chunks = [byte(ESC, 0x40)]; // ESC @ — إعادة ضبط الطابعة لحالتها الافتراضية
  }

  align(mode) {
    // 0 يسار، 1 وسط، 2 يمين
    this.chunks.push(byte(ESC, 0x61, mode));
    return this;
  }

  bold(on) {
    this.chunks.push(byte(ESC, 0x45, on ? 1 : 0));
    return this;
  }

  doubleSize(on) {
    this.chunks.push(byte(GS, 0x21, on ? 0x11 : 0x00));
    return this;
  }

  text(str) {
    this.chunks.push(new TextEncoder().encode(str));
    return this;
  }

  line(str = "") {
    return this.text(str).text("\n");
  }

  divider(width) {
    return this.line("-".repeat(width));
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

    // GS v 0 m xL xH yL yH d1...dk — m=0 (وضع عادي)، عرض الصورة بالبايتات (xL/xH) وارتفاعها
    // بالنقاط (yL/yH) بترتيب little-endian 16-بت، ثم بيانات الصورة صفاً صفاً (كل بت = نقطة).
    this.chunks.push(byte(GS, 0x76, 0x30, 0x00, widthBytes & 0xff, (widthBytes >> 8) & 0xff, dotSize & 0xff, (dotSize >> 8) & 0xff));
    this.chunks.push(rows);
    return this;
  }

  cut() {
    this.feed(3);
    // GS V 66 0 — قص جزئي مع تغذية ورق، الشكل الأكثر توافقاً عبر طرازات ESC/POS المختلفة
    this.chunks.push(byte(GS, 0x56, 0x42, 0x00));
    return this;
  }

  toBytes() {
    const total = this.chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

function byte(...vals) {
  return Uint8Array.from(vals);
}

/**
 * يبني بايتات ESC/POS كاملة لإيصال بيع من بيانات الفاتورة — عرض العمود (بالأحرف) يعتمد على
 * مقاس الورق: 32 حرفاً تقريباً لـ 58مم، 48 حرفاً لـ 80مم (بخط قياسي على أغلب الطابعات الحرارية).
 */
export function buildReceiptEscPos({ company, invoice, lastEmailOrNote }, paperWidthMm) {
  const width = paperWidthMm === 58 ? 32 : 48;
  const b = new EscPosBuilder();

  b.align(1).doubleSize(true).bold(true).line(company?.name || "").doubleSize(false).bold(false);
  if (company?.vatNumber) b.align(1).line(`الرقم الضريبي: ${company.vatNumber}`);
  b.align(1).divider(width);

  b.align(0);
  b.line(`فاتورة رقم: ${invoice.invoiceNumber}`);
  b.line(`التاريخ: ${new Date(invoice.date).toLocaleString("ar-SA")}`);
  b.line(`العميل: ${invoice.customer?.name || "عميل نقدي"}`);
  b.divider(width);

  for (const line of invoice.lines || []) {
    const name = line.description || line.account?.name || "";
    b.line(name);
    const qty = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    const total = Number(line.total);
    b.line(`  ${qty} × ${unitPrice.toFixed(2)} = ${total.toFixed(2)}`);
  }
  b.divider(width);

  b.align(2).bold(true).doubleSize(true).line(`الإجمالي: ${Number(invoice.grandTotal).toFixed(2)}`).doubleSize(false).bold(false);
  b.align(0);

  if (lastEmailOrNote) b.line(lastEmailOrNote);

  // رمز زاتكا (QR) للفاتورة الضريبية المبسّطة — إلزامي على الإيصال المطبوع (متطلب امتثال، وليس
  // شكلياً)، ونفس qrPayload المخزَّن على الفاتورة والمعروض أصلاً في شاشة عرض الفاتورة العادية.
  if (invoice.qrPayload) {
    const moduleScale = paperWidthMm === 58 ? 4 : 5;
    b.align(1).feed(1).qrImage(invoice.qrPayload, { moduleScale }).feed(1);
  }

  b.align(1).feed(1).line("شكراً لتعاملكم معنا");
  b.cut();
  return b.toBytes();
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
// الخاص بها — راجع تقرير الميزة). لا تغيير إطلاقاً على أي جهاز آخر لا يحقن هذا الكائن.
//
// العقد المتوقَّع من التطبيق الأصلي (يُبنى مقابله بشكل منفصل):
//   window.AtharPrinter.printEscPos(base64Data: string): string
//     base64Data: بايتات ESC/POS الكاملة (نفس مخرَج buildReceiptEscPos) مُرمَّزة Base64 قياسي.
//     المُخرَج: نص JSON متزامن — إما {"success": true} أو {"success": false, "error": "..."}
//     (رسالة الخطأ بالعربية إن أمكن؛ ستُعرَض للمستخدم كما هي).
export function hasNativePrinterBridge() {
  return typeof window !== "undefined" && typeof window.AtharPrinter?.printEscPos === "function";
}

/** يحوّل بايتات خام إلى Base64 على دفعات (بلا نشر المصفوفة بالكامل كوسائط لـ String.fromCharCode
 * دفعة واحدة، الذي يفشل على مصفوفات كبيرة نسبياً كصورة QR النقطية). */
export function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** يُرسِل عبر الجسر الأصلي إن وُجد، ويرمي خطأً واضحاً من نص الخطأ الذي يعيده التطبيق عند الفشل. */
export function printViaNativeBridge(bytes) {
  const resultJson = window.AtharPrinter.printEscPos(bytesToBase64(bytes));
  let result;
  try {
    result = JSON.parse(resultJson);
  } catch {
    throw new Error("رد غير متوقَّع من تطبيق الطباعة");
  }
  if (!result?.success) throw new Error(result?.error || "تعذّرت الطباعة عبر تطبيق أثر");
}
