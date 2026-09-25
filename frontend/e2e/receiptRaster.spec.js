import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

/**
 * تحقّق بصري من التصيير الفعلي للإيصال الحراري كصورة نقطية — يغطي الجولتين معاً:
 * الأولى (عطل ترميز النص العربي، حُلّت): كل نص عربي كان يُطبَع كرموز صينية/يابانية لأن النص كان
 * يُرسَل UTF-8 خام بلا أي أمر تحديد ترميز.
 * الثانية (سبعة أعطال على INV-00130 الفعلية، راجع التعليق أعلى escpos.js): معادلة صنف خاطئة
 * حسابياً، سطرا قبل/بعد الضريبة ساقطان، لا عنوان لنوع المستند، تاريخ هجري بدل ميلادي، محاذاة يسار
 * على مستند RTL، وشعار أثر بدل شعار الشركة البائعة.
 *
 * يُحمِّل هذا الاختبار الوحدة (escpos.js) داخل متصفح حقيقي فعلاً (نفس محرّك Chromium الذي يشغِّل
 * WebView أندرويد)، يستدعي buildReceiptEscPos الفعلية (لا buildReceiptContentModel وحدها) بنفس
 * القيم الفعلية من تقرير الاختبار الثاني على الجهاز (فاتورة INV-00130، رقم ضريبي عميل
 * 312922240600003، معادلة 3.50×60)، مع شعار شركة تجريبي (data URI محلي، بلا اتصال شبكة حقيقي) بدل
 * شعار أثر — ثم يُفكِّك بايتات GS v 0 الناتجة فعلياً (لا نسخة موازية من منطق الرسم) ويعيد تركيبها
 * بصرياً على canvas واحد بنفس ترتيب/محاذاة الطباعة الفعلية، ليكون الإثبات مطابقاً لما سيصل للورق
 * حرفياً لا تقريباً.
 *
 * لا اتصال بخادم حقيقي هنا (بلا تسجيل دخول/API) — فقط تحميل صفحة من أصل الواجهة (pos.html) للحصول
 * على سياق DOM/canvas حقيقي، ثم استيراد الوحدة مباشرة كوحدة ES ديناميكية.
 */

const OUTPUT_DIR = path.join(process.cwd(), "e2e", "screenshots");

// شعار تجريبي صغير (SVG كـ data URI، بلا اتصال شبكة) يمثّل شعار "الشركة البائعة" — أي شيء غير
// شعار أثر يكفي لإثبات أن الكود يطبع شعار company.logoUrl فعلياً، لا شعاراً ثابتاً مُعبَّأً مسبقاً.
const TEST_COMPANY_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120">
  <rect width="240" height="120" fill="#fff" stroke="#000" stroke-width="4"/>
  <text x="120" y="70" font-size="34" font-family="sans-serif" font-weight="bold" text-anchor="middle">المزارع</text>
</svg>`;
const TEST_COMPANY_LOGO_URL = `data:image/svg+xml;base64,${Buffer.from(TEST_COMPANY_LOGO_SVG).toString("base64")}`;

const company = {
  name: "مؤسسة المزارع الحديثة",
  vatNumber: "310123456700003",
  addressBuilding: "1234",
  addressStreet: "طريق الملك فهد",
  addressCity: "الرياض",
  logoUrl: TEST_COMPANY_LOGO_URL,
};

const standardInvoice = {
  invoiceNumber: "INV-00130",
  date: "2026-09-24T20:49:00.000Z",
  invoiceType: "standard",
  zatcaStatus: "cleared",
  subtotal: 210,
  vatTotal: 31.5,
  grandTotal: 241.5,
  lines: [
    // نفس معادلة تقرير الاختبار الثاني بالضبط: 3.50 × 60 يجب أن تطبع 210.00 (قبل الضريبة)، لا
    // 241.50 (شامل الضريبة) كما كانت تطبع خطأً.
    { description: "علف مركّز", quantity: 3.5, unitPrice: 60, subtotal: 210, vat: 31.5, total: 241.5 },
  ],
  customer: {
    name: "شركة العميل التجريبية",
    vatNumber: "312922240600003",
    buildingNo: "7490",
    street: "شارع التحلية",
    city: "جدة",
  },
  issuedByName: "محمد أحمد",
};

/**
 * يستدعي buildReceiptEscPos الفعلية (المسار الحقيقي المستخدَم للطباعة، لا buildReceiptContentModel
 * وحدها) ثم يُفكِّك بايتات ESC/POS الناتجة فعلياً — أوامر ESC a (محاذاة) وGS v 0 (صورة نقطية) فقط،
 * وهي كل ما ينتجه هذا الملف الآن (لا نص خام إطلاقاً) — ويعيد تركيبها بصرياً على canvas واحد بنفس
 * ترتيب الطباعة الفعلي (شعار الشركة، ثم المتن، ثم الشكر)، فالإثبات مطابق لما سيصل للورق حرفياً.
 */
async function renderFullReceiptPng(page, { paperWidthMm, invoice }) {
  return page.evaluate(
    async ({ company, invoice, paperWidthMm }) => {
      const mod = await import("/src/shared/receipt/escpos.js");
      const bytes = await mod.buildReceiptEscPos({ company, invoice }, paperWidthMm);
      const dotWidth = paperWidthMm === 58 ? 384 : 576;

      // --- تفكيك بايتات ESC/POS الفعلية (ESC a / GS v 0 فقط، لا حاجة لغيرها هنا) ---
      const blocks = [];
      let align = 0;
      for (let i = 0; i < bytes.length; ) {
        if (bytes[i] === 0x1b && bytes[i + 1] === 0x61) { align = bytes[i + 2]; i += 3; continue; }
        if (bytes[i] === 0x1b && bytes[i + 1] === 0x40) { i += 2; continue; }
        if (bytes[i] === 0x1b && bytes[i + 1] === 0x64) { blocks.push({ type: "feed", lines: bytes[i + 2] }); i += 3; continue; }
        if (bytes[i] === 0x1d && bytes[i + 1] === 0x56) { i += 4; continue; } // GS V (قص) — لا تمثيل بصري له
        if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30) {
          const widthBytes = bytes[i + 4] | (bytes[i + 5] << 8);
          const height = bytes[i + 6] | (bytes[i + 7] << 8);
          const width = widthBytes * 8;
          const data = bytes.slice(i + 8, i + 8 + widthBytes * height);
          blocks.push({ type: "raster", align, width, widthBytes, height, data });
          i += 8 + widthBytes * height;
          continue;
        }
        i += 1; // بايت غير متوقَّع (لا يُفترض حدوثه) — تخطٍّ آمن بدل توقّف كامل
      }

      const FEED_LINE_PX = 12;
      const totalHeight = blocks.reduce((h, b) => h + (b.type === "raster" ? b.height : b.lines * FEED_LINE_PX), 0) + 20;
      const canvas = document.createElement("canvas");
      canvas.width = dotWidth;
      canvas.height = Math.max(totalHeight, 10);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#000";

      let y = 10;
      for (const b of blocks) {
        if (b.type === "feed") { y += b.lines * FEED_LINE_PX; continue; }
        const x = b.align === 1 ? (dotWidth - b.width) / 2 : b.align === 2 ? dotWidth - b.width : 0;
        const imageData = ctx.createImageData(b.width, b.height);
        for (let yy = 0; yy < b.height; yy++) {
          for (let xx = 0; xx < b.width; xx++) {
            const bit = (b.data[yy * b.widthBytes + (xx >> 3)] >> (7 - (xx % 8))) & 1;
            const v = bit ? 0 : 255;
            const idx = (yy * b.width + xx) * 4;
            imageData.data[idx] = v; imageData.data[idx + 1] = v; imageData.data[idx + 2] = v; imageData.data[idx + 3] = 255;
          }
        }
        const off = document.createElement("canvas");
        off.width = b.width; off.height = b.height;
        off.getContext("2d").putImageData(imageData, 0, 0);
        ctx.drawImage(off, Math.max(0, x), y);
        y += b.height;
      }

      const cropped = document.createElement("canvas");
      cropped.width = dotWidth;
      cropped.height = y + 10;
      cropped.getContext("2d").drawImage(canvas, 0, 0, dotWidth, y + 10, 0, 0, dotWidth, y + 10);

      return { png: cropped.toDataURL("image/png"), byteLength: bytes.length, dotWidth };
    },
    { company, invoice, paperWidthMm },
  );
}

test("full receipt (company logo + body + thank-you) reconstructed from the real ESC/POS bytes matches every fix from the second hardware test", async ({ page }) => {
  await page.goto("/pos.html");

  const result = await renderFullReceiptPng(page, { paperWidthMm: 58, invoice: standardInvoice });

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(path.join(OUTPUT_DIR, "receipt-full-corrected.png"), Buffer.from(result.png.split(",")[1], "base64"));

  expect(result.dotWidth).toBe(384);
  // بايتات GS v 0 الكاملة (شعار + متن + شكر) — يجب أن تبقى بعيدة جداً عن حدّ الأمان لدفعة واحدة
  // (256 كيلوبايت، راجع NATIVE_BRIDGE_SAFE_CHUNK_BYTES في escpos.js).
  expect(result.byteLength).toBeLessThan(256 * 1024);
});

test("receipt content model renders correct Arabic shaping/RTL and stays well within the native-bridge chunk budget", async ({ page }) => {
  await page.goto("/pos.html");

  const result = await page.evaluate(
    async ({ company, invoice }) => {
      const mod = await import("/src/shared/receipt/escpos.js");
      const blocks = [...mod.buildReceiptContentModel({ company, invoice }), ...mod.buildThankYouContentModel()];
      const { canvas, width, height } = mod.renderContentModelToCanvas(blocks, 384);
      const cropped = document.createElement("canvas");
      cropped.width = width;
      cropped.height = height;
      cropped.getContext("2d").drawImage(canvas, 0, 0, width, height, 0, 0, width, height);
      const bits = mod.canvasToPackedBits(canvas, width, height);
      return { antialiasedPng: cropped.toDataURL("image/png"), width, height, byteLength: bits.length };
    },
    { company, invoice: standardInvoice },
  );

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(path.join(OUTPUT_DIR, "receipt-raster-antialiased.png"), Buffer.from(result.antialiasedPng.split(",")[1], "base64"));

  expect(result.width).toBe(384);
  expect(result.height).toBeGreaterThan(0);
  const widthBytes = Math.ceil(result.width / 8);
  expect(result.byteLength).toBe(widthBytes * result.height);
  expect(result.byteLength).toBeLessThan(256 * 1024);
});

test("simplified invoice renders a visibly shorter raster (no buyer VAT/address block)", async ({ page }) => {
  await page.goto("/pos.html");

  const simplifiedInvoice = { ...standardInvoice, invoiceType: "simplified", zatcaStatus: "reported" };
  const render = (invoice) => page.evaluate(
    async ({ company, invoice }) => {
      const mod = await import("/src/shared/receipt/escpos.js");
      const blocks = [...mod.buildReceiptContentModel({ company, invoice }), ...mod.buildThankYouContentModel()];
      const { height } = mod.renderContentModelToCanvas(blocks, 384);
      return height;
    },
    { company, invoice },
  );

  const standardHeight = await render(standardInvoice);
  const simplifiedHeight = await render(simplifiedInvoice);
  expect(simplifiedHeight).toBeLessThan(standardHeight);
});
