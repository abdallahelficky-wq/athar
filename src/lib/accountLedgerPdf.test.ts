import { describe, it, expect, vi } from "vitest";
vi.mock("./zatca/pdf/renderPdf",()=>({renderHtmlToPdf:vi.fn()}));
import { buildAccountLedgerHtml } from "./accountLedgerPdf";

describe("account ledger PDF",()=>{
  it("uses real totals, credit normal side, escaped memos, and group account detail",()=>{
    const ledger = {account:{code:"211",name:"<Supplier>",nameEn:"Suppliers",isPosting:false},normalSide:"credit",openingBalance:100,closingBalance:350,rows:[{date:new Date("2026-10-01"),journalEntryId:"one",entryNumber:"J1",entryMemo:'<img src="https://invalid.test">',lineDescription:"memo & detail",debit:50,credit:300,balance:350,accountCode:"21101",accountName:"Vendor"}]} as Parameters<typeof buildAccountLedgerHtml>[0];
    const html=buildAccountLedgerHtml(ledger,{name:"Company",vatNumber:null},{lang:"en",from:"2026-01-01"});
    expect(html).toContain("Closing balance (Credit)");
    expect(html).toContain("350.00");expect(html).toContain("300.00");expect(html).toContain("50.00");
    expect(html).toContain("21101 — Vendor");expect(html).toContain("&lt;img");expect(html).not.toContain('<img src="https://invalid.test">');
    ledger.closingBalance=-25;
    expect(buildAccountLedgerHtml(ledger,null,{lang:"en"})).toContain("Closing balance (Debit)");
  });
});
