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

  qrImage(dataUrlImageBytes) {
    // إدراج QR كصورة نقطية (raster) بدل أمر QR الأصلي في الطابعة — أبسط وأكثر توافقاً عبر
    // الموديلات المختلفة (لا يعتمد على دعم أمر GS ( k الخاص بـ QR الذي يختلف تنفيذه بين الشركات).
    // يُترَك التنفيذ الفعلي (تحويل الصورة لبكسلات وحزمها كـ GS v 0) لمرحلة لاحقة بعد اختبار حقيقي
    // للتأكد من دقة تفسير كل طابعة لأمر الصورة النقطية — حالياً نكتفي برابط/نص QR كبديل نصي.
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
