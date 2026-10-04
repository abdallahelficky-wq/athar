export function saveLedgerBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportAccountLedgerExcel({ledger, company, periodLabel, t, lang}) {
  const {default: ExcelJS} = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Account Ledger", {views:[{rightToLeft:lang !== "en"}]});
  sheet.columns = [14,18,55,40,18,18,20].map(width => ({width}));
  for (const value of [company?.name || "أثر المحاسبي", `${ledger.account.code} — ${ledger.account.name}`, periodLabel]) {const row=sheet.addRow([value]);sheet.mergeCells(row.number,1,row.number,7);row.font={bold:true,size:12};}
  sheet.addRow([t("statementOfAccount.table.date"),t("accountLedger.table.entryNumber"),t("statementOfAccount.table.memo"),t("accountLedger.table.postingAccount"),t("statementOfAccount.table.debit"),t("statementOfAccount.table.credit"),t("statementOfAccount.table.balance")]);
  sheet.addRow(["","",t("statementOfAccount.openingBalance"),"",null,null,Number(ledger.openingBalance)]);
  for(const r of ledger.rows) sheet.addRow([r.date.slice(0,10),r.entryNumber || r.journalEntryId,[r.entryMemo,r.lineDescription].filter(Boolean).join(" — "),`${r.accountCode || ledger.account.code} — ${r.accountName || ledger.account.name}`,Number(r.debit),Number(r.credit),Number(r.balance)]);
  sheet.addRow(["","",t("statementOfAccount.closingBalance"),"",ledger.rows.reduce((a,r)=>a+Number(r.debit),0),ledger.rows.reduce((a,r)=>a+Number(r.credit),0),Number(ledger.closingBalance)]);
  sheet.eachRow((row,i)=>{row.alignment={vertical:"middle",wrapText:true}; for(let c=5;c<=7;c++)row.getCell(c).numFmt='#,##0.00;[Red]-#,##0.00';if(i===4 || i===sheet.rowCount){row.font={bold:true,color:{argb:"FFFFFFFF"}};row.eachCell(c=>c.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF20252D"}});}});
  saveLedgerBlob(new Blob([await workbook.xlsx.writeBuffer()],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),`Account-Ledger-${ledger.account.code}.xlsx`);
}
