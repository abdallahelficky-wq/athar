/**
 * سكريبت تحويل قرائي بحت (بلا أي تعديل على ملفات المصدر) — يحوّل ملفات "كشف حساب" الخمسة
 * المصدَّرة من قيود (Qoyod) بصيغة Excel إلى ملفات CSV في reference/، بنفس التنسيق الذي يتوقعه
 * scripts/investigate-armi-full-reconciliation.ts تحديداً.
 *
 * لماذا هذا السكريبت موجود: ملفات reference/armi_statement_*.csv مُستبعَدة عمداً من .gitignore
 * (بيانات مالية حقيقية لعميل، لا يجب أن تدخل المستودع)، لذلك تُنشَأ محلياً على جهاز كل شخص من
 * ملفات Excel الأصلية بدل نقلها كملفات بيانات جاهزة عبر أي قناة أخرى.
 *
 * يكتشف تصنيف كل ملف تلقائياً من نص الخلية A1 (مثال: "1 - الأصول")، فلا داعي لترتيب الملفات أو
 * تسميتها يدوياً — مرّر الملفات الخمسة بأي ترتيب.
 *
 * الاستخدام (من جذر المشروع، Node عادي بلا احتياج لـ tsx):
 *   node scripts/convert-armi-excel-to-csv.js /path/to/file1.xlsx /path/to/file2.xlsx ... (كل الملفات الخمسة معاً)
 *
 * يعتمد على حزمة "xlsx" الموجودة في frontend/node_modules (تبعية frontend فقط، وليست تبعية
 * الـbackend) — يُحمَّل مساره صراحة أدناه بغض النظر عن مجلد التشغيل الحالي.
 */
const path = require("node:path");
const fs = require("node:fs");

const xlsx = require(path.join(__dirname, "..", "frontend", "node_modules", "xlsx"));

// تصنيف رقمي (1-5) -> اسم الملف الناتج، مطابق تماماً لما يقرأه investigate-armi-full-reconciliation.ts
const CLASSIFICATION_TO_FILENAME = {
  1: "armi_statement_1_assets.csv",
  2: "armi_statement_2_liabilities.csv",
  3: "armi_statement_3_equity.csv",
  4: "armi_statement_4_revenue.csv",
  5: "armi_statement_5_expenses.csv",
};

const OUTPUT_HEADER = ["التصنيف", "التاريخ", "الحساب", "النوع", "وصف العملية", "المرجع", "مدين", "دائن", "الرصيد"];

function clean(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function csvEscape(value) {
  const s = clean(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function findHeaderRowIndex(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].map((c) => clean(c));
    if (row.includes("التاريخ") && row.includes("المرجع")) return i;
  }
  throw new Error("لم يُعثَر على صف العناوين (يحتوي على التاريخ + المرجع) في هذا الملف — تحقق من التنسيق يدوياً.");
}

function convertOneFile(filePath) {
  const wb = xlsx.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });

  const classificationCell = clean(rows[0]?.[0]);
  const match = /^(\d+)\s*-/.exec(classificationCell);
  if (!match) {
    throw new Error(`تعذّر استخراج رقم التصنيف من الخلية A1: "${classificationCell}" في الملف ${filePath}`);
  }
  const classificationNum = Number(match[1]);
  const outputFileName = CLASSIFICATION_TO_FILENAME[classificationNum];
  if (!outputFileName) {
    throw new Error(`رقم تصنيف غير متوقَّع (${classificationNum}) في الملف ${filePath} — متوقَّع 1 إلى 5 فقط.`);
  }

  const headerRowIdx = findHeaderRowIndex(rows);
  const header = rows[headerRowIdx].map((c) => clean(c));
  const idx = {
    date: header.indexOf("التاريخ"),
    account: header.indexOf("الحساب"),
    type: header.indexOf("النوع"),
    desc: header.indexOf("وصف العملية"),
    ref: header.indexOf("المرجع"),
    debit: header.indexOf("مدين"),
    credit: header.indexOf("دائن"),
    balance: header.indexOf("الرصيد"),
  };

  const outLines = [OUTPUT_HEADER.map(csvEscape).join(",")];
  let dataRowCount = 0;
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const reference = clean(row[idx.ref]);
    // صفوف الرصيد الافتتاحي/الختامي/صافي الحركة الثلاثة الوحيدة بلا مرجع لكل ملف — تُستبعَد هنا،
    // بنفس القاعدة التي يعتمدها investigate-armi-full-reconciliation.ts عند القراءة.
    if (!reference) continue;
    outLines.push(
      [
        classificationCell,
        row[idx.date],
        row[idx.account],
        row[idx.type],
        row[idx.desc],
        reference,
        row[idx.debit],
        row[idx.credit],
        row[idx.balance],
      ]
        .map(csvEscape)
        .join(","),
    );
    dataRowCount++;
  }

  return { outputFileName, classificationCell, dataRowCount, csvContent: "﻿" + outLines.join("\n") + "\n" };
}

function main() {
  const inputFiles = process.argv.slice(2);
  if (inputFiles.length === 0) {
    console.error("الاستخدام: node scripts/convert-armi-excel-to-csv.js <file1.xlsx> <file2.xlsx> ... (الملفات الخمسة معاً)");
    process.exitCode = 1;
    return;
  }

  const outputDir = path.join(__dirname, "..", "reference");
  fs.mkdirSync(outputDir, { recursive: true });

  let grandTotal = 0;
  const seenOutputs = new Set();
  for (const inputFile of inputFiles) {
    const { outputFileName, classificationCell, dataRowCount, csvContent } = convertOneFile(inputFile);
    if (seenOutputs.has(outputFileName)) {
      throw new Error(`تصنيفان مختلفان يؤديان لنفس اسم الملف الناتج (${outputFileName}) — تحقق من الملفات المُمرَّرة.`);
    }
    seenOutputs.add(outputFileName);
    const outPath = path.join(outputDir, outputFileName);
    fs.writeFileSync(outPath, csvContent, "utf-8");
    console.log(`reference/${outputFileName} <- ${path.basename(inputFile)} : ${dataRowCount} صف بيانات (${classificationCell})`);
    grandTotal += dataRowCount;
  }

  if (seenOutputs.size !== 5) {
    console.warn(`\n⚠️ تحذير: تم تحويل ${seenOutputs.size} من أصل 5 تصنيفات متوقَّعة فقط — مرّر كل الملفات الخمسة معاً في نفس التشغيلة.`);
  }
  console.log(`\nالإجمالي الكلي: ${grandTotal} صف بيانات`);
}

main();
