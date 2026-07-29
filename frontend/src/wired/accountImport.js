import * as XLSX from "xlsx";

const TYPE_MAP = {
  asset: "asset", assets: "asset", "أصول": "asset",
  liability: "liability", liabilities: "liability", "التزامات": "liability", "خصوم": "liability",
  equity: "equity", royalty: "equity", "حقوق ملكية": "equity",
  revenue: "revenue", revenues: "revenue", "إيرادات": "revenue",
  expense: "expense", expenses: "expense", cost: "expense", "مصروفات": "expense", "تكلفة": "expense",
};

const FALLBACK_TYPE = { "1": "asset", "2": "liability", "3": "equity", "4": "revenue", "5": "revenue" };

const text = (value) => {
  if (value == null) return "";
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  return String(value).trim().replace(/\s+/g, " ");
};
const header = (value) => text(value).toLowerCase().replace(/[\s_\-]+/g, "");
const findColumn = (headers, names) => headers.findIndex((value) => names.includes(header(value)));

function mapType(value, code) {
  const raw = text(value);
  const normalized = raw.toLowerCase();
  return TYPE_MAP[raw] || TYPE_MAP[normalized] || FALLBACK_TYPE[code?.[0]] || "";
}

export function parseAccountWorkbook(arrayBuffer, existingAccounts = []) {
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName =
    workbook.SheetNames.find((name) => name.trim() === "الحسابات") ||
    workbook.SheetNames.find((name) => name.trim() === "الميزان") ||
    workbook.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });
  const headerRowIndex = matrix.findIndex((row) => {
    const normalized = row.map(header);
    return normalized.some((value) => ["المستوى", "level"].includes(value)) &&
      normalized.some((value) => value.includes("accountname") || value.includes("اسمالحساب"));
  });
  if (headerRowIndex < 0) throw new Error("لم يتم العثور على عناوين شجرة الحسابات داخل الملف");

  const headers = matrix[headerRowIndex];
  const normalizedHeaders = headers.map(header);
  const levelIndex = findColumn(headers, ["المستوى", "level"]);
  const arabicNameIndex = findColumn(headers, ["accountnamearabic", "اسمالحساببالعربية", "اسمالحسابالعربي", "اسمالحساب"]);
  const englishNameIndex = findColumn(headers, ["accountnameenglish", "اسمالحساببالإنجليزية", "اسمالحسابالانجليزي"]);
  const importNameIndex = findColumn(headers, ["الاسمالمقترحللاستيراد", "name"]);
  const typeIndex = findColumn(headers, ["accounttype", "التصنيففيأثر", "التصنيف", "type"]);
  const parentIndex = findColumn(headers, ["كودالحسابالأب", "كودالحسابالاب", "parentcode"]);
  const flagIndexFromHeader = findColumn(headers, ["رمزالمصدر", "h/+", "نوعالحساب"]);

  let codeIndex = findColumn(headers, ["كودالحساب", "الكود", "code"]);
  if (codeIndex < 0) {
    const accountNumberColumns = normalizedHeaders
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => value === "accno." || value === "accno" || value === "accountno")
      .map(({ index }) => index);
    codeIndex = accountNumberColumns.filter((index) => arabicNameIndex < 0 || index < arabicNameIndex).at(-1) ?? -1;
  }
  const flagIndex = flagIndexFromHeader >= 0
    ? flagIndexFromHeader
    : (levelIndex >= 0 && codeIndex === levelIndex + 2 ? levelIndex + 1 : -1);

  if (codeIndex < 0 || levelIndex < 0) throw new Error("أعمدة كود الحساب أو المستوى غير موجودة");

  const existingCodes = new Set(existingAccounts.map((account) => account.code));
  const levelStack = new Map();
  const parsed = [];

  matrix.slice(headerRowIndex + 1).forEach((sourceRow, offset) => {
    const code = text(sourceRow[codeIndex]).replace(/\.0+$/, "");
    if (!code) return;
    if (!/^\d{1,9}$/.test(code)) return;

    const level = Number(text(sourceRow[levelIndex]));
    const arabicName = arabicNameIndex >= 0 ? text(sourceRow[arabicNameIndex]) : "";
    const englishName = englishNameIndex >= 0 ? text(sourceRow[englishNameIndex]) : "";
    const preferredName = importNameIndex >= 0 ? text(sourceRow[importNameIndex]) : "";
    const name = arabicName || preferredName;
    const nameEn = englishName;
    const sourceType = typeIndex >= 0 ? sourceRow[typeIndex] : "";
    const accountType = mapType(sourceType, code);
    const flag = flagIndex >= 0 ? text(sourceRow[flagIndex]) : "";
    const explicitParent = parentIndex >= 0 ? text(sourceRow[parentIndex]).replace(/\.0+$/, "") : "";
    const parentCode = level > 1 ? (explicitParent || levelStack.get(level - 1) || "") : "";
    const isPosting = flag === "+" || level === 6;
    const errors = [];

    if (!Number.isInteger(level) || level < 1 || level > 6) errors.push("المستوى غير صحيح");
    if (!name || name.length < 2) errors.push("اسم الحساب العربي مفقود");
    if (!nameEn || nameEn.length < 2) errors.push("اسم الحساب الإنجليزي مفقود");
    if (!accountType) errors.push("التصنيف غير معروف");
    if (level === 6 && code.length !== 9) errors.push("كود المستوى السادس يجب أن يكون 9 خانات");
    if (level > 1 && !parentCode) errors.push("الحساب الأب مفقود");
    if (code === "999999999" || header(sourceType) === "balance") errors.push("رصيد افتتاحي وليس حساب شجرة");
    if (existingCodes.has(code)) errors.push("الكود موجود بالفعل في الشجرة الحالية");

    if (Number.isInteger(level) && level >= 1 && level <= 6) {
      levelStack.set(level, code);
      for (let deeper = level + 1; deeper <= 6; deeper += 1) levelStack.delete(deeper);
    }

    parsed.push({
      sourceRow: headerRowIndex + offset + 2,
      code, name, nameEn, arabicName, englishName, type: accountType, level,
      flag, isPosting, parentCode: parentCode || null, isBankOrCash: false, errors,
    });
  });

  const counts = new Map();
  parsed.forEach((row) => counts.set(row.code, (counts.get(row.code) || 0) + 1));
  const availableCodes = new Set([...existingCodes, ...parsed.map((row) => row.code)]);
  parsed.forEach((row) => {
    if (counts.get(row.code) > 1) row.errors.push("كود مكرر داخل الملف");
    if (row.level > 1 && row.parentCode && !availableCodes.has(row.parentCode)) row.errors.push("الحساب الأب غير موجود");
  });

  return {
    sheetName,
    rows: parsed,
    errorCount: parsed.filter((row) => row.errors.length > 0).length,
  };
}
