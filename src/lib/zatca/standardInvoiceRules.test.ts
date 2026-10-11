import { describe, expect, it, vi } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { computeInvoiceLine } from "../invoiceLine";
import { roundMoney, sumMoney } from "../money";
import { buildDocumentXml } from "./xmlBuilder";
import { buildDocumentXmlV1, computeInvoiceLineV1, mapPersistedLineToZatcaLineV1 } from "./xmlBuilderV1";
import { mapPersistedLineToZatcaLine, rebuildZatcaDocumentXml, reserveZatcaChain, standardBuyerAddressProblems, ZatcaCompanyLike, ZatcaCustomerLike } from "./chain";
import { computeDocumentHash } from "./hash";
import { decodeResponseBody } from "./apiClient";
import { ZATCA_FIRST_INVOICE_PIH, ZatcaPartyInput } from "./types";

/**
 * رفض زاتكا لفاتورة قياسية (388، تخليص) — مؤسسة المزارع الحديثة، الفاتورة 00156، 2026-09-24، الإجمالي 220 ريالاً، الرقم الضريبي
 * للمشتري 302043689600003: BR-CO-15 (خطأ) + BR-KSA-51، BR-KSA-F-07، BR-KSA-63 (تحذيرات).
 *
 * XML هنا من الكود الذي ينتجه فعلاً (CLAUDE.md القاعدة 2): computeInvoiceLine (ما يُخزَّن) ← mapPersistedLineToZatcaLine ←
 * buildDocumentXml (ما تُحسَب عليه التجزئة ويُوقَّع ويُرسَل). المُدخَل المصنوع يدوياً هو بيانات الأسطر فقط — ما يُدخله المستخدم.
 * القواعد تُفحَص بحساب عشري دقيق (BigInt) كما تفحصها زاتكا (xs:decimal)، لا بالفاصلة العائمة.
 */

// ---------- حساب عشري دقيق ----------
type Dec = { n: bigint; scale: number };
function dec(s: string): Dec {
  const t = s.trim();
  const neg = t.startsWith("-");
  const [i, f = ""] = (neg ? t.slice(1) : t).split(".");
  const n = BigInt(i + f) * (neg ? -1n : 1n);
  return { n, scale: f.length };
}
function scaleTo(a: Dec, scale: number): bigint {
  return a.n * 10n ** BigInt(scale - a.scale);
}
function add(a: Dec, b: Dec): Dec {
  const s = Math.max(a.scale, b.scale);
  return { n: scaleTo(a, s) + scaleTo(b, s), scale: s };
}
function mul(a: Dec, b: Dec): Dec {
  return { n: a.n * b.n, scale: a.scale + b.scale };
}
function eq(a: Dec, b: Dec): boolean {
  const s = Math.max(a.scale, b.scale);
  return scaleTo(a, s) === scaleTo(b, s);
}
const show = (d: Dec) => `${d.n}e-${d.scale}`;

// ---------- قراءة XML ----------
const CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";
const CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
type El = { getElementsByTagNameNS(ns: string, n: string): ArrayLike<El>; textContent: string | null; getAttribute(n: string): string | null; parentNode: unknown; childNodes: ArrayLike<{ nodeType: number; namespaceURI?: string | null; localName?: string | null }> };

function children(el: El, ns: string, name: string): El[] {
  const out: El[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i];
    if (c.nodeType === 1 && c.namespaceURI === ns && c.localName === name) out.push(c as unknown as El);
  }
  return out;
}
function child(el: El, ns: string, name: string): El {
  const c = children(el, ns, name);
  if (c.length !== 1) throw new Error(`expected one ${name}, got ${c.length}`);
  return c[0];
}
const text = (el: El) => (el.textContent ?? "").trim();

interface Facts {
  ksa2: string;
  bt109: Dec; bt110: Dec; bt112: Dec; bt106: Dec; payable: Dec;
  lines: { qty: Dec; net: Dec; vat: Dec; ksa12: Dec; price: Dec; baseQty: Dec; pct: string | null }[];
  groups: { taxable: Dec; tax: Dec; pct: string }[];
  buyerIds: { scheme: string | null; value: string }[];
  buyerVat: string | null;
  moneyValues: string[];
}

function readFacts(xml: string): Facts {
  const doc = new DOMParser().parseFromString(xml, "text/xml") as unknown as { documentElement: El };
  const root = doc.documentElement;
  const lmt = child(root, CAC, "LegalMonetaryTotal");
  const taxTotals = children(root, CAC, "TaxTotal");
  const lines = children(root, CAC, "InvoiceLine").map((l) => {
    const price = child(l, CAC, "Price");
    const base = children(price, CBC, "BaseQuantity");
    const lineTax = child(l, CAC, "TaxTotal");
    const pct = children(child(child(l, CAC, "Item"), CAC, "ClassifiedTaxCategory"), CBC, "Percent");
    return {
      qty: dec(text(child(l, CBC, "InvoicedQuantity"))),
      net: dec(text(child(l, CBC, "LineExtensionAmount"))),
      vat: dec(text(child(lineTax, CBC, "TaxAmount"))),
      ksa12: dec(text(child(lineTax, CBC, "RoundingAmount"))),
      price: dec(text(child(price, CBC, "PriceAmount"))),
      baseQty: base.length ? dec(text(base[0])) : dec("1"),
      pct: pct.length ? text(pct[0]) : null,
    };
  });
  const groups = children(taxTotals[0], CAC, "TaxSubtotal").map((g) => ({
    taxable: dec(text(child(g, CBC, "TaxableAmount"))),
    tax: dec(text(child(g, CBC, "TaxAmount"))),
    pct: text(child(child(g, CAC, "TaxCategory"), CBC, "Percent")),
  }));
  const party = child(child(root, CAC, "AccountingCustomerParty"), CAC, "Party");
  const buyerIds = children(party, CAC, "PartyIdentification").map((p) => {
    const id = child(p, CBC, "ID");
    return { scheme: id.getAttribute("schemeID"), value: text(id) };
  });
  const pts = children(party, CAC, "PartyTaxScheme");
  const moneyValues: string[] = [];
  const all = (root as unknown as { getElementsByTagNameNS(ns: string, n: string): ArrayLike<El> }).getElementsByTagNameNS("*", "*");
  for (let i = 0; i < all.length; i++) {
    const e = all[i];
    if (e.getAttribute("currencyID") && (e as unknown as { localName: string }).localName !== "PriceAmount") moneyValues.push(text(e));
  }
  return {
    ksa2: child(root, CBC, "InvoiceTypeCode").getAttribute("name") ?? "",
    bt106: dec(text(child(lmt, CBC, "LineExtensionAmount"))),
    bt109: dec(text(child(lmt, CBC, "TaxExclusiveAmount"))),
    bt110: dec(text(child(taxTotals[0], CBC, "TaxAmount"))),
    bt112: dec(text(child(lmt, CBC, "TaxInclusiveAmount"))),
    payable: dec(text(child(lmt, CBC, "PayableAmount"))),
    lines,
    groups,
    buyerIds,
    buyerVat: pts.length ? text(child(pts[0], CBC, "CompanyID")) : null,
    moneyValues,
  };
}

/** كل قاعدة تُرجِع قائمة مخالفات (فارغة = تحقّقت) */
function violations(f: Facts): string[] {
  const v: string[] = [];
  if (!eq(add(f.bt109, f.bt110), f.bt112)) v.push(`BR-CO-15: ${show(f.bt109)} + ${show(f.bt110)} ≠ ${show(f.bt112)}`);
  if (!eq(f.bt112, f.payable)) v.push("BT-115 ≠ BT-112 (no prepaid/rounding)");
  const sumNet = f.lines.reduce((s, l) => add(s, l.net), dec("0"));
  if (!eq(sumNet, f.bt106)) v.push(`BR-CO-10: Σ line net ${show(sumNet)} ≠ BT-106 ${show(f.bt106)}`);
  const sumTaxable = f.groups.reduce((s, g) => add(s, g.taxable), dec("0"));
  const sumGroupVat = f.groups.reduce((s, g) => add(s, g.tax), dec("0"));
  if (!eq(sumGroupVat, f.bt110)) v.push(`BR-CO-14: Σ BT-117 ${show(sumGroupVat)} ≠ BT-110 ${show(f.bt110)}`);
  if (!eq(sumTaxable, f.bt109)) v.push("Σ BT-116 ≠ BT-109");
  f.lines.forEach((l, i) => {
    if (!eq(add(l.net, l.vat), l.ksa12)) v.push(`BR-KSA-51 line ${i + 1}: ${show(l.net)} + ${show(l.vat)} ≠ ${show(l.ksa12)}`);
    // BR-KSA-EN16931-11: BT-131 = BT-129 × BT-146 / BT-149 ⇔ BT-131 × BT-149 = BT-129 × BT-146
    if (!eq(mul(l.net, l.baseQty), mul(l.qty, l.price))) v.push(`BR-KSA-EN16931-11 line ${i + 1}: ${show(l.qty)} × ${show(l.price)} / ${show(l.baseQty)} ≠ ${show(l.net)}`);
  });
  for (const m of f.moneyValues) if (!/^-?\d+\.\d{2}$/.test(m)) v.push(`amount not 2 decimals: ${m}`);
  return v;
}

// ---------- بناء المستند من الكود الحقيقي ----------
type Entered = { quantity: number; unitPrice: number; discountPct?: number; priceIncludesVat?: boolean; taxCategoryCode?: "S" | "Z" | "E" | "O" };

const SELLER: ZatcaPartyInput = { vatNumber: "310000000000003", crNumber: "1010000000", registrationName: "مؤسسة المزارع الحديثة", street: "طريق الملك فهد", buildingNumber: "1234", citySubdivision: "العليا", city: "الرياض", postalZone: "12211" };
const BUYER: ZatcaPartyInput = { vatNumber: "302043689600003", crNumber: null, registrationName: "المشتري", street: "شارع التحلية", buildingNumber: "2345", citySubdivision: "السليمانية", city: "الرياض", postalZone: "12245" };

/** ما يُخزَّن (computeInvoiceLine) — ثم يُبنى منه XML بالمسار نفسه الذي يسلكه الترحيل */
function persisted(entered: Entered[]) {
  return entered.map((l, i) => {
    const taxCategoryCode = l.taxCategoryCode ?? "S";
    const c = computeInvoiceLine({ ...l, taxCategoryCode });
    return { description: `صنف ${i + 1}`, quantity: l.quantity, unitPrice: l.unitPrice, subtotal: c.subtotal, vat: c.vat, total: c.total, taxCategoryCode, taxExemptionReason: taxCategoryCode === "S" ? null : "سبب الإعفاء", taxExemptionReasonCode: taxCategoryCode === "S" ? null : "VATEX-SA-32" };
  });
}

function standardInvoiceXml(entered: Entered[], buyer: ZatcaPartyInput = BUYER) {
  const rows = persisted(entered);
  const xml = buildDocumentXml({
    kind: "invoice", subtype: "standard", id: "00156", uuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
    issueDate: "2026-09-24", issueTime: "10:00:00Z", icv: 156, previousInvoiceHash: ZATCA_FIRST_INVOICE_PIH,
    seller: SELLER, buyer, lines: rows.map(mapPersistedLineToZatcaLine),
  });
  return { xml, rows };
}

/** ما كان يُرسَل قبل الإصلاح: الأسطر المحسوبة في الذاكرة بلا تقريب (salesInvoices.service.ts: zatcaLines = computed) + المُنشئ القديم */
function preFixXml(rawLines: { quantity: number; unitPrice: number; subtotal: number; vat: number }[]) {
  return buildDocumentXmlV1({
    kind: "invoice", subtype: "standard", id: "00156", uuid: "u", issueDate: "2026-09-24", issueTime: "10:00:00Z", icv: 156,
    previousInvoiceHash: ZATCA_FIRST_INVOICE_PIH, seller: SELLER, buyer: { ...BUYER, crNumber: "1010101010" },
    lines: rawLines.map((l, i) => mapPersistedLineToZatcaLineV1({ description: `صنف ${i + 1}`, ...l, taxCategoryCode: "S", taxExemptionReason: null }, i)),
  });
}

describe("invoice 00156 (220.00 SAR, 15% VAT) — the rules ZATCA reported hold by construction", () => {
  const structures: [string, Entered[]][] = [
    ["one line, 220 VAT-inclusive", [{ quantity: 1, unitPrice: 220, priceIncludesVat: true }]],
    ["one line, 191.3043 VAT-exclusive", [{ quantity: 1, unitPrice: 191.3043 }]],
    ["two lines of 110 VAT-inclusive", [{ quantity: 1, unitPrice: 110, priceIncludesVat: true }, { quantity: 1, unitPrice: 110, priceIncludesVat: true }]],
    ["3 × 73.3333 VAT-inclusive", [{ quantity: 3, unitPrice: 73.3333, priceIncludesVat: true }]],
    ["3 × 63.7681 VAT-exclusive", [{ quantity: 3, unitPrice: 63.7681 }]],
    ["200 VAT-exclusive less 4.35%", [{ quantity: 1, unitPrice: 200, discountPct: 4.35 }]],
  ];

  it.each(structures)("%s", (_name, entered) => {
    const { xml, rows } = standardInvoiceXml(entered);
    const f = readFacts(xml);
    expect(violations(f)).toEqual([]);
    expect(f.ksa2.startsWith("01")).toBe(true); // KSA-2 قياسية
    for (const l of f.lines) expect(l.pct).toBe("15.00");
    // ما يُرسَل لزاتكا = ما يُخزَّن ويُرحَّل (subtotal / vatTotal / grandTotal كما تجمعها خدمة الفاتورة)
    const subtotal = sumMoney(rows.map((r) => r.subtotal));
    const vatTotal = sumMoney(rows.map((r) => r.vat));
    expect(show(f.bt109)).toBe(show(dec(subtotal.toFixed(2))));
    expect(show(f.bt110)).toBe(show(dec(vatTotal.toFixed(2))));
    expect(show(f.bt112)).toBe(show(dec(sumMoney([subtotal, vatTotal]).toFixed(2))));
  });

  it("the 220.00 cases total exactly 220.00 with VAT 28.70", () => {
    for (const entered of [structures[0][1], structures[2][1], structures[3][1]]) {
      const f = readFacts(standardInvoiceXml(entered).xml);
      expect(f.bt112).toEqual(dec("220.00"));
      expect(f.bt110).toEqual(dec("28.70"));
      expect(f.bt109).toEqual(dec("191.30"));
    }
  });

  it("the pre-fix path reproduces exactly what ZATCA reported (so these checks catch the defect)", () => {
    // 3 × 73.3333 شاملة: الصافي غير المقرَّب 191.2999… يُقصّ إلى 191.29 في السطر ويُقرَّب KSA-12 إلى 220.00 ⇒ BR-KSA-51
    const g = 3 * 73.3333;
    const vat = Math.round((g - g / 1.15) * 100) / 100;
    const v1 = violations(readFacts(preFixXml([{ quantity: 3, unitPrice: 73.3333, subtotal: g - vat, vat }])));
    expect(v1.some((x) => x.startsWith("BR-KSA-51"))).toBe(true);
    expect(v1.some((x) => x.startsWith("BR-KSA-EN16931-11"))).toBe(true);
    // صافٍ بنصف هللة (191.105): BT-109 = 191.11 وBT-112 = 219.77 (219.775 ثنائياً 219.77499…) ⇒ BR-CO-15
    const v2 = violations(readFacts(preFixXml([{ quantity: 1, unitPrice: 191.105, subtotal: 191.105, vat: 28.67 }])));
    expect(v2.some((x) => x.startsWith("BR-CO-15"))).toBe(true);
    // والمسار الجديد للسطر نفسه سليم
    expect(violations(readFacts(standardInvoiceXml([{ quantity: 1, unitPrice: 191.105 }]).xml))).toEqual([]);
  });
});

describe("edge cases — every rule still holds by construction", () => {
  // مولّد حتمي (بلا Math.random) ليبقى الاختبار قابلاً للإعادة
  function rng(seed: number) {
    let s = seed;
    return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("seed %i: 25 lines, fractional 4-decimal prices, discounts, fractional quantities, mixed VAT-inclusive", (seed) => {
    const r = rng(seed);
    const entered: Entered[] = Array.from({ length: 25 }, () => ({
      quantity: [1, 2, 3, 7, 12, 0.5, 2.5, 1.25, 0.3333][Math.floor(r() * 9)],
      unitPrice: Math.round(r() * 5000000) / 10000,
      discountPct: [0, 0, 0, 5, 7.5, 12.35, 33.33][Math.floor(r() * 7)],
      priceIncludesVat: r() < 0.5,
    }));
    const f = readFacts(standardInvoiceXml(entered).xml);
    expect(violations(f)).toEqual([]);
    expect(f.lines).toHaveLength(25);
  });

  it("half-halala nets across many lines (the BR-CO-15 trigger) stay consistent", () => {
    const entered: Entered[] = [0.105, 1.115, 2.125, 10.005, 99.995, 191.105, 0.005].map((p) => ({ quantity: 1, unitPrice: p }));
    expect(violations(readFacts(standardInvoiceXml(entered).xml))).toEqual([]);
  });

  it("a zero-rated / exempt line alongside standard-rated lines", () => {
    const f = readFacts(standardInvoiceXml([{ quantity: 2, unitPrice: 19.995 }, { quantity: 1, unitPrice: 50, taxCategoryCode: "Z" }]).xml);
    expect(violations(f)).toEqual([]);
    expect(f.groups.map((g) => g.pct).sort()).toEqual(["0.00", "15.00"]);
  });

  it("a tiny line declares 15%, not the ratio of rounded amounts (0.02 / 0.13 = 15.38%)", () => {
    const f = readFacts(standardInvoiceXml([{ quantity: 1, unitPrice: 0.13 }]).xml);
    expect(f.lines[0].pct).toBe("15.00");
    expect(f.groups[0].pct).toBe("15.00");
  });

  it("a quantity whose unit net price has no 4-decimal form uses BT-149 (base quantity) to stay exact", () => {
    const f = readFacts(standardInvoiceXml([{ quantity: 3, unitPrice: 73.3333, priceIncludesVat: true }]).xml);
    expect(violations(f)).toEqual([]);
    const l = f.lines[0];
    expect(eq(l.baseQty, dec("3"))).toBe(true);
    expect(eq(l.price, l.net)).toBe(true);
    // والحالة الشائعة تبقى سعر وحدة عادياً بلا BT-149
    const simple = readFacts(standardInvoiceXml([{ quantity: 4, unitPrice: 12.5 }]).xml).lines[0];
    expect(eq(simple.baseQty, dec("1"))).toBe(true);
    expect(eq(simple.price, dec("12.50"))).toBe(true);
  });
});

describe("BR-KSA-15 / BR-KSA-F-07 — transaction code and buyer identification", () => {
  it("a standard invoice (388) carries KSA-2 = 0100000", () => {
    const { xml } = standardInvoiceXml([{ quantity: 1, unitPrice: 220, priceIncludesVat: true }]);
    expect(readFacts(xml).ksa2).toBe("0100000");
    expect(xml).toMatch(/<cbc:InvoiceTypeCode name="0100000">388<\/cbc:InvoiceTypeCode>/);
  });

  it("the buyer VAT number is BT-48 only; BT-46 is absent without a CRN and is the CRN when one exists", () => {
    const noCrn = readFacts(standardInvoiceXml([{ quantity: 1, unitPrice: 100 }]).xml);
    expect(noCrn.buyerVat).toBe("302043689600003");
    expect(noCrn.buyerIds).toEqual([]);
    const withCrn = readFacts(standardInvoiceXml([{ quantity: 1, unitPrice: 100 }], { ...BUYER, crNumber: "1010101010" }).xml);
    expect(withCrn.buyerVat).toBe("302043689600003");
    expect(withCrn.buyerIds).toEqual([{ scheme: "CRN", value: "1010101010" }]);
    expect(withCrn.buyerIds.some((i) => i.scheme === "TIN")).toBe(false);
  });
});

describe("BR-KSA-63 — a standard invoice is not sent while the buyer's national address is incomplete", () => {
  const complete = { street: "شارع التحلية", buildingNo: "2345", postalCode: "12245", city: "الرياض", district: "السليمانية" };

  it("lists every missing or malformed field, in Arabic", () => {
    expect(standardBuyerAddressProblems(complete)).toEqual([]);
    expect(standardBuyerAddressProblems({ street: " ", buildingNo: null, postalCode: null, city: "", district: null })).toEqual(["اسم الشارع", "رقم المبنى", "الرمز البريدي", "المدينة", "الحي"]);
    expect(standardBuyerAddressProblems({ ...complete, buildingNo: "12", postalCode: "1224" })).toEqual(["رقم المبنى (يجب أن يكون 4 أرقام)", "الرمز البريدي (يجب أن يكون 5 أرقام)"]);
  });

  const company: ZatcaCompanyLike = {
    id: "co", zatcaOnboardingStatus: "production", zatcaEnvironment: "production", zatcaLastInvoiceHash: null, name: "مؤسسة المزارع الحديثة",
    vatNumber: "310000000000003", crNumber: "1010000000", addressStreet: "s", addressBuilding: "1234", addressDistrict: "d", addressCity: "c", addressPostalCode: "12211",
  };
  const customer = (over: Partial<ZatcaCustomerLike>): ZatcaCustomerLike => ({ customerType: "business", vatNumber: "302043689600003", crNumber: null, name: "المشتري", street: complete.street, buildingNo: complete.buildingNo, district: complete.district, city: complete.city, postalCode: complete.postalCode, ...over });

  it("refuses before reserving an ICV (no chain number consumed), with a message naming the fields", async () => {
    const tx = { $queryRaw: vi.fn(), company: { update: vi.fn() } };
    await expect(
      reserveZatcaChain(tx as never, { company, customer: customer({ buildingNo: "12", district: null }), kind: "invoice", documentNumber: "00156", documentUuid: "u", lines: persisted([{ quantity: 1, unitPrice: 100 }]) }),
    ).rejects.toThrow(/عنوان العميل "المشتري" ناقص — رقم المبنى \(يجب أن يكون 4 أرقام\)، الحي/);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.company.update).not.toHaveBeenCalled();
  });

  it("does not apply to a simplified invoice (no buyer block)", async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ zatcaNextIcv: 7 }]), company: { update: vi.fn() } };
    const r = await reserveZatcaChain(tx as never, { company, customer: customer({ customerType: "individual", street: null }), kind: "invoice", documentNumber: "1", documentUuid: "u", lines: persisted([{ quantity: 1, unitPrice: 10 }]) });
    expect(r?.icv).toBe(7);
  });
});

describe("resubmitting a document reserved before this fix keeps its exact bytes (ICV/PIH chain intact)", () => {
  const company: ZatcaCompanyLike = {
    id: "co", zatcaOnboardingStatus: "production", zatcaEnvironment: "production", zatcaLastInvoiceHash: null, name: "مؤسسة المزارع الحديثة",
    vatNumber: "310000000000003", crNumber: "1010000000", addressStreet: "s", addressBuilding: "1234", addressDistrict: "d", addressCity: "c", addressPostalCode: "12211",
  };
  const customer: ZatcaCustomerLike = { customerType: "business", vatNumber: "302043689600003", crNumber: null, name: "المشتري", street: "s", buildingNo: "2345", district: "d", city: "c", postalCode: "12245" };
  const lines = persisted([{ quantity: 1, unitPrice: 220, priceIncludesVat: true }]);
  const issuedAt = new Date("2026-09-24T10:00:00Z");
  const common = { company, customer, kind: "invoice" as const, documentNumber: "00156", documentUuid: "u", lines, icv: 156, previousInvoiceHash: ZATCA_FIRST_INVOICE_PIH, issuedAt };

  it("rebuilds with the frozen builder when the stored hash came from it", () => {
    const legacyXml = buildDocumentXmlV1({
      kind: "invoice", subtype: "standard", id: "00156", uuid: "u", issueDate: "2026-09-24", issueTime: "10:00:00Z", icv: 156, previousInvoiceHash: ZATCA_FIRST_INVOICE_PIH,
      seller: { vatNumber: company.vatNumber, crNumber: company.crNumber, registrationName: company.name, street: "s", buildingNumber: "1234", citySubdivision: "d", city: "c", postalZone: "12211" },
      buyer: { vatNumber: customer.vatNumber, crNumber: null, registrationName: customer.name, street: "s", buildingNumber: "2345", citySubdivision: "d", city: "c", postalZone: "12245" },
      lines: lines.map(mapPersistedLineToZatcaLineV1),
    });
    const storedHash = computeDocumentHash(legacyXml);
    const rebuilt = rebuildZatcaDocumentXml({ ...common, expectedInvoiceHash: storedHash });
    expect(rebuilt.builder).toBe("v1");
    expect(rebuilt.invoiceHash).toBe(storedHash);
    expect(rebuilt.xml).toBe(legacyXml);
  });

  it("uses the current builder for documents reserved after the fix", () => {
    const fresh = rebuildZatcaDocumentXml(common);
    const again = rebuildZatcaDocumentXml({ ...common, expectedInvoiceHash: fresh.invoiceHash });
    expect(again.builder).toBe("v2");
    expect(again.invoiceHash).toBe(fresh.invoiceHash);
  });
});

describe("ZATCA response text is decoded with its declared charset (Arabic messages, not ???)", () => {
  const message = "مجموع القيمة المضافة غير متطابق";
  const body = JSON.stringify({ validationResults: { errorMessages: [{ code: "BR-CO-15", message }] } });

  it("UTF-8, declared or not", async () => {
    for (const ct of ["application/json; charset=utf-8", "application/json"]) {
      const res = new Response(new TextEncoder().encode(body), { headers: { "content-type": ct } });
      expect(JSON.parse(await decodeResponseBody(res)).validationResults.errorMessages[0].message).toBe(message);
    }
  });

  it("windows-1256 declared in Content-Type — what response.text() turns into replacement characters", async () => {
    // بايتات الرسالة بترميز windows-1256 (رد خارجي — مسموح صنعه يدوياً، CLAUDE.md القاعدة 2)
    const table = new Map<string, number>();
    const dec1256 = new TextDecoder("windows-1256");
    for (let b = 0x80; b <= 0xff; b++) table.set(dec1256.decode(Uint8Array.of(b)), b);
    const bytes = Uint8Array.from([...body].map((ch) => (ch.charCodeAt(0) < 0x80 ? ch.charCodeAt(0) : table.get(ch)!)));
    const res = () => new Response(bytes, { headers: { "content-type": "application/json; charset=windows-1256" } });
    expect(await res().text()).toContain("�"); // السلوك السابق
    expect(JSON.parse(await decodeResponseBody(res())).validationResults.errorMessages[0].message).toBe(message);
  });
});

describe("Codex P1 on #148 — rebuilding a document posted directly before the fix (hashed from raw in-memory amounts)", () => {
  const company: ZatcaCompanyLike = {
    id: "co", zatcaOnboardingStatus: "production", zatcaEnvironment: "production", zatcaLastInvoiceHash: null, name: "مؤسسة المزارع الحديثة",
    vatNumber: "310000000000003", crNumber: "1010000000", addressStreet: "s", addressBuilding: "1234", addressDistrict: "d", addressCity: "c", addressPostalCode: "12211",
  };
  const customer: ZatcaCustomerLike = { customerType: "business", vatNumber: "302043689600003", crNumber: null, name: "المشتري", street: "s", buildingNo: "2345", district: "d", city: "c", postalCode: "12245" };
  const issuedAt = new Date("2026-09-24T10:00:00Z");

  // ما أدخله المستخدم (3 × 73.3333 شاملة) — ثم ما فعله الكود القديم حرفياً: computeInvoiceLineV1 في الذاكرة ⇒ buildDocumentXmlV1
  const entered = { description: "صنف 1", quantity: 3, unitPrice: 73.3333, discountPct: 0, priceIncludesVat: true, taxCategoryCode: "S", taxExemptionReason: null };
  const raw = computeInvoiceLineV1(entered);
  const originalXml = buildDocumentXmlV1({
    kind: "invoice", subtype: "standard", id: "00156", uuid: "u", issueDate: "2026-09-24", issueTime: "10:00:00Z", icv: 156, previousInvoiceHash: ZATCA_FIRST_INVOICE_PIH,
    seller: { vatNumber: company.vatNumber, crNumber: company.crNumber, registrationName: company.name, street: "s", buildingNumber: "1234", citySubdivision: "d", city: "c", postalZone: "12211" },
    buyer: { vatNumber: customer.vatNumber, crNumber: null, registrationName: customer.name, street: "s", buildingNumber: "2345", citySubdivision: "d", city: "c", postalZone: "12245" },
    lines: [mapPersistedLineToZatcaLineV1({ ...entered, subtotal: raw.subtotal, vat: raw.vat }, 0)],
  });
  const storedHash = computeDocumentHash(originalXml);
  // ما خزّنه Postgres في Decimal(18, 2) من تلك القيم الخام
  const storedLine = { ...entered, subtotal: roundMoney(raw.subtotal), vat: roundMoney(raw.vat) };
  const common = { company, customer, kind: "invoice" as const, documentNumber: "00156", documentUuid: "u", icv: 156, previousInvoiceHash: ZATCA_FIRST_INVOICE_PIH, issuedAt, expectedInvoiceHash: storedHash };

  it("the stored (rounded) amounts alone cannot reproduce the hash — the case Codex found", () => {
    expect(raw.subtotal).not.toBe(storedLine.subtotal);
    const { discountPct: _d, priceIncludesVat: _p, ...withoutInputs } = storedLine;
    const rebuilt = rebuildZatcaDocumentXml({ ...common, lines: [withoutInputs] });
    expect(rebuilt.invoiceHash).not.toBe(storedHash);
  });

  it("recomputing the raw amounts from the stored line inputs rebuilds it byte-for-byte", () => {
    const rebuilt = rebuildZatcaDocumentXml({ ...common, lines: [storedLine] });
    expect(rebuilt.builder).toBe("v1");
    expect(rebuilt.invoiceHash).toBe(storedHash);
    expect(rebuilt.xml).toBe(originalXml);
  });

  it("a draft-then-post document (hashed from the stored 2-decimal amounts) still rebuilds from the stored values", () => {
    const draftXml = buildDocumentXmlV1({
      kind: "invoice", subtype: "standard", id: "00157", uuid: "u2", issueDate: "2026-09-24", issueTime: "10:00:00Z", icv: 157, previousInvoiceHash: storedHash,
      seller: { vatNumber: company.vatNumber, crNumber: company.crNumber, registrationName: company.name, street: "s", buildingNumber: "1234", citySubdivision: "d", city: "c", postalZone: "12211" },
      buyer: { vatNumber: customer.vatNumber, crNumber: null, registrationName: customer.name, street: "s", buildingNumber: "2345", citySubdivision: "d", city: "c", postalZone: "12245" },
      lines: [mapPersistedLineToZatcaLineV1(storedLine, 0)],
    });
    const rebuilt = rebuildZatcaDocumentXml({ ...common, documentNumber: "00157", documentUuid: "u2", icv: 157, previousInvoiceHash: storedHash, expectedInvoiceHash: computeDocumentHash(draftXml), lines: [storedLine] });
    expect(rebuilt.builder).toBe("v1");
    expect(rebuilt.xml).toBe(draftXml);
  });
});

describe("Codex P1 on #148 — the decoding diagnostic never logs raw bytes of a certificate response", () => {
  // جسم برموز لا تُفكّ UTF-8 (0xFF) ويحمل حقلي الشهادة — رد خارجي، مسموح صنعه يدوياً (CLAUDE.md القاعدة 2)
  const secretBody = Uint8Array.from([...new TextEncoder().encode('{"binarySecurityToken":"TOKEN-SECRET","secret":"S3CRET","x":"'), 0xff, ...new TextEncoder().encode('"}')]);
  const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");

  it.each(["/compliance", "/production/csids", undefined])("path %s: logs charset/length/count, no bytes", async (path) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await decodeResponseBody(new Response(secretBody, { headers: { "content-type": "application/json" } }), { path });
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).toContain("رموز بديلة=1");
      expect(line).not.toContain("hex");
      expect(line).not.toContain(hex("TOKEN-SECRET"));
      expect(line).not.toContain(hex("S3CRET"));
      expect(line).not.toContain("TOKEN-SECRET");
    } finally {
      warn.mockRestore();
    }
  });

  it("an invoice submission path still logs the leading bytes as evidence", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const body = Uint8Array.from([...new TextEncoder().encode('{"validationResults":{"x":"'), 0xff, ...new TextEncoder().encode('"}}')]);
      await decodeResponseBody(new Response(body, { headers: { "content-type": "application/json" } }), { path: "/invoices/clearance/single" });
      expect(String(warn.mock.calls[0][0])).toContain("أول البايتات (hex)");
    } finally {
      warn.mockRestore();
    }
  });
});
