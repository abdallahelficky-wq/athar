import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseDate, guessColumns, guessHeaderRow, buildStatementLines, summarizeLines } from "./bankStatementParse.js";

test("amounts: thousands, parentheses, trailing minus, Arabic-Indic digits", () => {
  assert.equal(parseAmount("1,234.50"), 1234.5);
  assert.equal(parseAmount("(250.00)"), -250);
  assert.equal(parseAmount("250.00-"), -250);
  assert.equal(parseAmount("١٬٢٣٤٫٥٠"), 1234.5);
  assert.equal(parseAmount("SAR 1,000"), 1000);
  assert.equal(parseAmount(""), 0);
  assert.equal(parseAmount(99.9), 99.9);
});

test("dates: Excel serial, dd/mm/yyyy, yyyy-mm-dd, invalid", () => {
  assert.equal(parseDate(46087), "2026-03-06");
  assert.equal(parseDate("06/03/2026"), "2026-03-06");
  assert.equal(parseDate("2026-03-06 10:22"), "2026-03-06");
  assert.equal(parseDate("٠٦/٠٣/٢٠٢٦"), "2026-03-06");
  assert.equal(parseDate("31/02/2026"), null);
  assert.equal(parseDate("Opening balance"), null);
});

test("an Al Rajhi-style export: two amount columns, header guessed, junk rows skipped", () => {
  const matrix = [
    ["كشف حساب", "", "", "", ""],
    ["التاريخ", "البيان", "رقم العملية", "مدين", "دائن", "الرصيد"],
    ["", "رصيد افتتاحي", "", "", "", "10,000.00"],
    ["06/03/2026", "إيداع نقدي", "R1", "", "1,000.00", "11,000.00"],
    ["10/03/2026", "حوالة صادرة", "R2", "250.00", "", "10,750.00"],
    ["31/03/2026", "عمولة", "R3", "15.00", "", "10,735.00"],
    ["", "الإجمالي", "", "265.00", "1,000.00", ""],
  ];
  const headerRow = guessHeaderRow(matrix);
  assert.equal(headerRow, 1);
  const cols = guessColumns(matrix[headerRow]);
  assert.deepEqual({ date: cols.date, description: cols.description, reference: cols.reference, debit: cols.debit, credit: cols.credit }, { date: 0, description: 1, reference: 2, debit: 3, credit: 4 });
  const { lines, skipped, errors } = buildStatementLines(matrix, { headerRow, ...cols });
  assert.deepEqual(lines.map((l) => l.amount), [1000, -250, -15]);
  assert.equal(lines[1].reference, "R2");
  assert.equal(skipped, 2);
  assert.equal(errors.length, 0);
  assert.deepEqual(summarizeLines(lines), { periodStart: "2026-03-06", periodEnd: "2026-03-31", movement: 735 });
});

test("a single signed amount column, withdrawals positive", () => {
  const matrix = [["Date", "Details", "Amount"], ["2026-03-06", "Deposit", "-1000"], ["2026-03-10", "Transfer", "250"]];
  const { lines } = buildStatementLines(matrix, { headerRow: 0, date: 0, description: 1, amount: 2, amountSign: "withdrawalPositive" });
  assert.deepEqual(lines.map((l) => l.amount), [1000, -250]);
});
