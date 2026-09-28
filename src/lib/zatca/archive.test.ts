import { spawnSync } from "child_process";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { spawn } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDocumentXml } from "./xmlBuilder";
import { signDocument } from "./signing";
import { ZATCA_FIRST_INVOICE_PIH, ZatcaDocumentInput } from "./types";
import { annex1FileName, buildZip, crc32, csvCell, decodeClearedXml, sellerVatFromXml, ZipLimitError, ZIP_MAX_ENTRIES } from "./archive";

/**
 * الأرشيف على مخرجات حقيقية لا XML مصنوع يدوياً: المستند الموقَّع يبدأ بـ<ext:UBLExtensions> التي تحمل
 * cbc:ID="urn:oasis:names:specification:ubl:signature:1" قبل رقم المستند — كان اسم كل ملف مُصدَّر يُبنى منه.
 * وملف ZIP يُفحَص بأداة مستقلة (python zipfile)، لا بقارئنا نحن.
 */
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => (code === 0 ? resolve("") : reject(new Error(err))));
  });
}

let workDir: string;
let privateKeyPem: string;
let certificatePem: string;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "zatca-archive-test-"));
  const keyFile = path.join(workDir, "key.pem");
  const certFile = path.join(workDir, "cert.pem");
  await run("openssl", ["ecparam", "-name", "secp256k1", "-genkey", "-noout", "-out", keyFile]);
  await run("openssl", ["req", "-x509", "-key", keyFile, "-sha256", "-days", "1", "-subj", "/CN=zatca-test", "-out", certFile]);
  privateKeyPem = await readFile(keyFile, "utf8");
  certificatePem = await readFile(certFile, "utf8");
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function doc(over: Partial<ZatcaDocumentInput> = {}): ZatcaDocumentInput {
  return {
    kind: "invoice",
    subtype: "standard",
    id: "INV-2026/0042",
    uuid: "3cf5ddbe-1391-449f-b8a3-0ee7b1a92b45",
    issueDate: "2026-08-01",
    issueTime: "10:00:00",
    icv: 7,
    previousInvoiceHash: ZATCA_FIRST_INVOICE_PIH,
    seller: {
      vatNumber: "300000000000003", crNumber: "1010101010", registrationName: "شركة أثر التجريبية", street: "طريق الملك فهد",
      buildingNumber: "1234", citySubdivision: "العليا", city: "الرياض", postalZone: "12345",
    },
    buyer: {
      vatNumber: "311111111111113", registrationName: "عميل قياسي", street: "شارع", buildingNumber: "1111", citySubdivision: "حي", city: "جدة", postalZone: "22222",
    },
    lines: [{ id: "1", name: "خدمة", quantity: 1, unitPrice: 100, lineSubtotal: 100, lineVat: 15, taxCategoryCode: "S", taxPercent: 15 }],
    ...over,
  } as ZatcaDocumentInput;
}

describe("Annex 1 file name from a real signed document", () => {
  it("uses the document number from the root, not the signature ID inside UBLExtensions", () => {
    const { signedXml } = signDocument({ xml: buildDocumentXml(doc()), certificatePem, privateKeyPem });
    expect(signedXml.indexOf("urn:oasis:names:specification:ubl:signature:1")).toBeLessThan(signedXml.indexOf("INV-2026/0042"));
    const name = annex1FileName(signedXml, { sellerVatNumber: null, issuedAt: new Date(), documentNumber: "FALLBACK" });
    expect(name).toBe("300000000000003_20260801T100000_INV-2026-0042.xml");
    expect(sellerVatFromXml(signedXml)).toBe("300000000000003");
  });

  it("same for a credit note", () => {
    const creditNote = doc({ kind: "credit_note", id: "CN-0009", billingReferenceId: "INV-2026/0042", issuanceReason: "مرتجع" } as never);
    const { signedXml } = signDocument({ xml: buildDocumentXml(creditNote), certificatePem, privateKeyPem });
    expect(annex1FileName(signedXml, { sellerVatNumber: null, issuedAt: new Date(), documentNumber: "FALLBACK" })).toBe("300000000000003_20260801T100000_CN-0009.xml");
  });
});

describe("decodeClearedXml — strict, unlike Buffer.from(…, 'base64')", () => {
  const xml = '<?xml version="1.0"?><Invoice/>';
  it("accepts valid base64 of XML, with whitespace/newlines and a BOM", () => {
    const b64 = Buffer.from(xml).toString("base64");
    expect(decodeClearedXml(b64)?.toString()).toBe(xml);
    expect(decodeClearedXml(b64.replace(/(.{8})/g, "$1\n"))?.toString()).toBe(xml);
    expect(decodeClearedXml(Buffer.from("﻿  " + xml).toString("base64"))).not.toBeNull();
  });
  it.each([
    ["garbage", "!!!@@@###not base64"],
    ["empty", ""],
    ["bad length", "PEludm9pY2U"],
    ["non-canonical tail bits", "PA=="  .replace("A", "B")],
    ["decodes to non-XML", Buffer.from([0xff, 0xfe, 0x00, 0xc3]).toString("base64")],
    ["url-safe alphabet", Buffer.from("<a>??>>").toString("base64").replace(/\+/g, "-").replace(/\//g, "_")],
    ["not a string", 12345 as unknown as string],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(decodeClearedXml(value as string | null)).toBeNull();
  });
});

describe("CRC32 against published test vectors", () => {
  it("matches the standard check value and edge cases", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
    expect(crc32(Buffer.from("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });
});

const hasPython = spawnSync("python3", ["--version"]).status === 0;

describe.skipIf(!hasPython)("ZIP validated by an independent reader (python zipfile)", () => {
  it("round-trips Arabic names, an entry over 64 KiB, duplicates, and zero entries", async () => {
    const big = Buffer.alloc(200_000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 7919) & 0xff;
    const files = [
      { name: "manifest.csv", data: Buffer.from("﻿a,b\n"), date: new Date("2026-01-05T20:59:06Z") },
      { name: "فاتورة_١.xml", data: Buffer.from("<a>مرحبا</a>"), date: new Date("2026-01-05T20:59:06Z") },
      { name: "big.bin", data: big, date: new Date("1970-01-01T00:00:00Z") },
      { name: "big.bin", data: Buffer.from("dup"), date: new Date("2200-01-01T00:00:00Z") },
    ];
    const zipPath = path.join(workDir, "t.zip");
    const emptyPath = path.join(workDir, "e.zip");
    await writeFile(zipPath, buildZip(files));
    await writeFile(emptyPath, buildZip([]));
    const script = `
import zipfile, sys, json, hashlib
z = zipfile.ZipFile(sys.argv[1]); bad = z.testzip()
out = [{"n": i.filename, "sha": hashlib.sha256(z.read(i)).hexdigest(), "dt": list(i.date_time), "utf8": bool(i.flag_bits & 0x800)} for i in z.infolist()]
e = zipfile.ZipFile(sys.argv[2])
print(json.dumps({"bad": bad, "files": out, "empty": len(e.infolist())}))`;
    const r = spawnSync("python3", ["-c", script, zipPath, emptyPath], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const res = JSON.parse(r.stdout);
    expect(res.bad).toBeNull();
    expect(res.empty).toBe(0);
    const { createHash } = await import("crypto");
    expect(res.files.map((f: { n: string }) => f.n)).toEqual(files.map((f) => f.name));
    res.files.forEach((f: { sha: string; utf8: boolean }, i: number) => {
      expect(f.sha).toBe(createHash("sha256").update(files[i].data).digest("hex"));
      expect(f.utf8).toBe(true);
    });
    // وقت الملف بتوقيت السعودية (UTC+3) كما يعرضه ويندوز؛ السنوات خارج نطاق DOS تُحصَر بدل أن ترمي
    expect(res.files[1].dt).toEqual([2026, 1, 5, 23, 59, 6]);
    expect(res.files[2].dt).toEqual([1980, 1, 1, 0, 0, 0]);
    expect(res.files[3].dt[0]).toBe(2107);
  });
});

describe("ZIP limits fail loudly, never a corrupt archive", () => {
  it("refuses more entries than classic ZIP can index", () => {
    const files = Array.from({ length: ZIP_MAX_ENTRIES + 1 }, (_, i) => ({ name: `${i}`, data: Buffer.alloc(0), date: new Date() }));
    expect(() => buildZip(files)).toThrow(ZipLimitError);
  });
});

describe("manifest cells", () => {
  it("neutralises spreadsheet formulas and quotes CR/LF/commas", () => {
    expect(csvCell('=HYPERLINK("http://x","a")\rX')).toBe(`"'=HYPERLINK(""http://x"",""a"")\rX"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@a")).toBe("'@a");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("INV-1")).toBe("INV-1");
  });
});
