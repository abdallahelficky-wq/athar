// إعدادات الطباعة الخاصة بهذا الجهاز تحديداً (لا الشركة/المستخدم) — كل تابلت/موبايل يحتفظ
// بإعداد طابعته المحلي في localStorage، بلا أي مزامنة مع الخادم، تماماً كما طُلب صراحةً.
const KEY = "athar.posPrinterSettings";

const DEFAULTS = {
  method: "browser", // "bluetooth" | "browser"
  paperWidthMm: 80, // 58 | 80
  autoPrint: true,
  bluetoothDeviceName: null, // للعرض فقط — Web Bluetooth لا يحفظ اتصالاً دائماً بلا بادرة مستخدم
};

export function loadPrinterSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrinterSettings(patch) {
  const next = { ...loadPrinterSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
