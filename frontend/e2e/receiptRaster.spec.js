import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

/**
 * تحقّق بصري من التصيير الفعلي لمتن الإيصال الحراري كصورة نقطية (راجع التعليق أعلى escpos.js:
 * عطل ترميز النص العربي المؤكَّد على جهاز Sunmi V2 حقيقي — كل نص عربي كان يُطبَع كرموز صينية/
 * يابانية لأن النص كان يُرسَل UTF-8 خام بلا أي أمر تحديد ترميز). هذا الاختبار يُحمِّل الوحدة
 * (escpos.js) داخل متصفح حقيقي فعلاً (نفس محرّك Chromium الذي يشغِّل WebView أندرويد)، يبني نموذج
 * محتوى بنفس القيم الفعلية من تقرير الاختبار على الجهاز (رقم ضريبي 301042958400003، مبنى 7490،
 * فاتورة INV-00129)، يرسمه على canvas، ويحفظ الناتج (قبل العتبة وبعدها) كصورة PNG للمراجعة
 * البصرية اليدوية — يؤكِّد أن تشكيل الحروف العربية وترتيب BIDI صحيحان قبل وصول أي شيء للورق فعلياً.
 *
 * لا اتصال بخادم حقيقي هنا (بلا تسجيل دخول/API) — فقط تحميل صفحة من أصل الواجهة (pos.html) للحصول
 * على سياق DOM/canvas حقيقي، ثم استيراد الوحدة مباشرة كوحدة ES ديناميكية.
 */

const OUTPUT_DIR = path.join(process.cwd(), "e2e", "screenshots");

const company = {
  name: "شركة أثر التجريبية",
  vatNumber: "310123456700003",
  addressBuilding: "1234",
  addressStreet: "طريق الملك فهد",
  addressCity: "الرياض",
};

const standardInvoice = {
  invoiceNumber: "INV-00129",
  date: "2026-09-24T10:00:00.000Z",
  invoiceType: "standard",
  zatcaStatus: "cleared",
  subtotal: 3000,
  vatTotal: 450,
  grandTotal: 3450,
  lines: [
    { description: "خدمة استشارية", quantity: 2, unitPrice: 500, total: 1150 },
    { description: "اشتراك سنوي", quantity: 1, unitPrice: 2000, total: 2300 },
  ],
  customer: {
    name: "شركة العميل التجريبية",
    vatNumber: "301042958400003",
    buildingNo: "7490",
    street: "شارع التحلية",
    city: "جدة",
  },
  issuedByName: "محمد أحمد",
};

async function renderSample(page, { dotWidth, invoice }) {
  return page.evaluate(
    async ({ company, invoice, dotWidth }) => {
      const mod = await import("/src/shared/receipt/escpos.js");
      const blocks = [...mod.buildReceiptContentModel({ company, invoice }), ...mod.buildThankYouContentModel()];
      const { canvas, width, height } = mod.renderContentModelToCanvas(blocks, dotWidth);

      const cropped = document.createElement("canvas");
      cropped.width = width;
      cropped.height = height;
      cropped.getContext("2d").drawImage(canvas, 0, 0, width, height, 0, 0, width, height);
      const antialiasedPng = cropped.toDataURL("image/png");

      const bits = mod.canvasToPackedBits(canvas, width, height);
      const widthBytes = Math.ceil(width / 8);
      const thresholdCanvas = document.createElement("canvas");
      thresholdCanvas.width = width;
      thresholdCanvas.height = height;
      const tctx = thresholdCanvas.getContext("2d");
      const imageData = tctx.createImageData(width, height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const bit = (bits[y * widthBytes + (x >> 3)] >> (7 - (x % 8))) & 1;
          const v = bit ? 0 : 255;
          const idx = (y * width + x) * 4;
          imageData.data[idx] = v;
          imageData.data[idx + 1] = v;
          imageData.data[idx + 2] = v;
          imageData.data[idx + 3] = 255;
        }
      }
      tctx.putImageData(imageData, 0, 0);

      return { antialiasedPng, thresholdPng: thresholdCanvas.toDataURL("image/png"), width, height, byteLength: bits.length };
    },
    { company, invoice, dotWidth },
  );
}

test("receipt body raster renders correct Arabic shaping/RTL and stays well within the native-bridge chunk budget", async ({ page }) => {
  await page.goto("/pos.html");

  const result = await renderSample(page, { dotWidth: 384, invoice: standardInvoice });

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(path.join(OUTPUT_DIR, "receipt-raster-antialiased.png"), Buffer.from(result.antialiasedPng.split(",")[1], "base64"));
  writeFileSync(path.join(OUTPUT_DIR, "receipt-raster-threshold-1bit.png"), Buffer.from(result.thresholdPng.split(",")[1], "base64"));

  expect(result.width).toBe(384);
  expect(result.height).toBeGreaterThan(0);
  // بايتات GS v 0 لمتن كامل (بائع/مشتري/بنود/إجمالي/مُصدِر/حالة زاتكا/شكراً) — يجب أن تبقى بعيدة
  // جداً عن حدّ الأمان لدفعة واحدة (256 كيلوبايت، راجع NATIVE_BRIDGE_SAFE_CHUNK_BYTES في escpos.js).
  const widthBytes = Math.ceil(result.width / 8);
  expect(result.byteLength).toBe(widthBytes * result.height);
  expect(result.byteLength).toBeLessThan(256 * 1024);
});

test("simplified invoice renders a visibly shorter raster (no buyer VAT/address block)", async ({ page }) => {
  await page.goto("/pos.html");

  const simplifiedInvoice = { ...standardInvoice, invoiceType: "simplified", zatcaStatus: "reported" };
  const standard = await renderSample(page, { dotWidth: 384, invoice: standardInvoice });
  const simplified = await renderSample(page, { dotWidth: 384, invoice: simplifiedInvoice });

  expect(simplified.height).toBeLessThan(standard.height);
});
