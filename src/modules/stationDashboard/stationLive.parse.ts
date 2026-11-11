/**
 * قراءة حالة المحطة اللحظية من آخر رسالة UploadStatus أرسلها متحكم PTS-2 (مواصفة jsonPTS R140 ص331–336) — دالة نقية بلا قاعدة
 * بيانات، تُختبر برسالة الجهاز نفسها. المضخات تأتي في أربع مجموعات (IdleStatus / FillingStatus / EndOfTransactionStatus /
 * OfflineStatus)، وكل مجموعة مصفوفات متوازية مفهرسة بموضع رقم المضخة في Ids. المسابير في Probes.OnlineStatus بمصفوفة
 * Measurements: [رقم المسبار، ارتفاع المنتج مم، ارتفاع الماء مم، الحرارة، حجم المنتج لتر، حجم الماء، الفراغ، الحجم المعوَّض،
 * الكثافة، الكتلة، نسبة الامتلاء] — والقيمة الغائبة null (الحجم والنسبة يغيبان حتى يُضبط جدول معايرة الخزان في الجهاز).
 */

export type PumpState = "idle" | "filling" | "end_of_transaction" | "offline";

export interface LivePump {
  ptsPump: number;
  state: PumpState;
  /** الفوهة المرفوعة الآن (الخاملة) أو الفوهة التي تعبّئ (التعبئة/نهاية العملية) — null إن لم تُرفَع فوهة */
  nozzle: number | null;
  volume: number | null;
  amount: number | null;
  price: number | null;
  flowRate: number | null;
  transaction: number | null;
  lastNozzle: number | null;
  lastVolume: number | null;
  lastAmount: number | null;
  lastPrice: number | null;
  totalVolume: number | null;
  totalAmount: number | null;
  /** طلب يُنفَّذ الآن على المضخة (مثل PumpAuthorize) ومن أرسله */
  request: string | null;
  user: string | null;
}

export interface LiveProbe {
  probe: number;
  online: boolean;
  productHeightMm: number | null;
  waterHeightMm: number | null;
  temperatureC: number | null;
  productLiters: number | null;
  waterLiters: number | null;
  ullageLiters: number | null;
  fillPct: number | null;
  alarms: string[];
  error: boolean;
}

export interface LiveStatus {
  deviceDateTime: string | null;
  batteryVoltageMv: number | null;
  cpuTemperatureC: number | null;
  pumps: LivePump[];
  probes: LiveProbe[];
  fuelGrades: { id: number; name: string; price: number | null }[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const int = (v: unknown): number | null => {
  const n = num(v);
  return n != null && Number.isInteger(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
/** القيمة في موضع i من مصفوفة متوازية — 0 في حقل "الفوهة" يعني لا فوهة */
const at = (group: Obj, key: string, i: number) => arr(group[key])[i];

const PROBE_ALARMS: [string, string][] = [
  ["CriticalHighProductAlarms", "critical_high_product"],
  ["HighProductAlarms", "high_product"],
  ["LowProductAlarms", "low_product"],
  ["CriticalLowProductAlarms", "critical_low_product"],
  ["HighWaterAlarms", "high_water"],
  ["TankLeakageAlarms", "tank_leakage"],
];

function pumpsOf(pumps: Obj): LivePump[] {
  const users = arr(pumps.Users);
  const out = new Map<number, LivePump>();
  const base = (ptsPump: number, state: PumpState): LivePump => ({
    ptsPump, state, nozzle: null, volume: null, amount: null, price: null, flowRate: null, transaction: null,
    lastNozzle: null, lastVolume: null, lastAmount: null, lastPrice: null, totalVolume: null, totalAmount: null,
    request: null, user: str(users[ptsPump - 1]),
  });

  const idle = obj(pumps.IdleStatus);
  arr(idle.Ids).forEach((id, i) => {
    const ptsPump = int(id);
    if (!ptsPump) return;
    out.set(ptsPump, {
      ...base(ptsPump, "idle"),
      nozzle: int(at(idle, "NozzlesUp", i)) || null,
      lastNozzle: int(at(idle, "LastNozzles", i)) || null,
      transaction: int(at(idle, "LastTransactions", i)) || null,
      lastVolume: num(at(idle, "LastVolumes", i)),
      lastAmount: num(at(idle, "LastAmounts", i)),
      lastPrice: num(at(idle, "LastPrices", i)),
      flowRate: num(at(idle, "LastFlowRates", i)),
      // الجهاز يرسل 0 للعداد التراكمي حين لا يعرفه بعد — لا يُعرَض صفراً كأنه قراءة
      totalVolume: num(at(idle, "LastTotalVolumes", i)) || null,
      totalAmount: num(at(idle, "LastTotalAmounts", i)) || null,
      request: str(at(idle, "Requests", i)),
    });
  });

  for (const [key, state] of [["FillingStatus", "filling"], ["EndOfTransactionStatus", "end_of_transaction"]] as const) {
    const group = obj(pumps[key]);
    arr(group.Ids).forEach((id, i) => {
      const ptsPump = int(id);
      if (!ptsPump) return;
      out.set(ptsPump, {
        ...base(ptsPump, state),
        nozzle: int(at(group, "Nozzles", i)) || null,
        transaction: int(at(group, "Transactions", i)) || null,
        volume: num(at(group, "Volumes", i)),
        amount: num(at(group, "Amounts", i)),
        price: num(at(group, "Prices", i)),
        flowRate: num(at(group, "FlowRates", i)),
      });
    });
  }

  arr(obj(pumps.OfflineStatus).Ids).forEach((id) => {
    const ptsPump = int(id);
    if (ptsPump && !out.has(ptsPump)) out.set(ptsPump, base(ptsPump, "offline"));
  });

  return [...out.values()].sort((a, b) => a.ptsPump - b.ptsPump);
}

function probesOf(probes: Obj): LiveProbe[] {
  const online = obj(probes.OnlineStatus);
  const ids = arr(online.Ids).map(int);
  const measurements = arr(online.Measurements).map(arr);
  const out = new Map<number, LiveProbe>();
  ids.forEach((probe, i) => {
    if (!probe) return;
    const m = measurements.find((row) => int(row[0]) === probe) ?? [];
    out.set(probe, {
      probe, online: true,
      productHeightMm: num(m[1]), waterHeightMm: num(m[2]), temperatureC: num(m[3]),
      productLiters: num(m[4]), waterLiters: num(m[5]), ullageLiters: num(m[6]), fillPct: num(m[10]),
      alarms: PROBE_ALARMS.filter(([key]) => num(at(online, key, i)) === 1).map(([, name]) => name),
      error: num(at(online, "Errors", i)) === 1,
    });
  });
  arr(obj(probes.OfflineStatus).Ids).forEach((id) => {
    const probe = int(id);
    if (probe && !out.has(probe)) {
      out.set(probe, {
        probe, online: false, productHeightMm: null, waterHeightMm: null, temperatureC: null, productLiters: null, waterLiters: null,
        ullageLiters: null, fillPct: null, alarms: [], error: false,
      });
    }
  });
  return [...out.values()].sort((a, b) => a.probe - b.probe);
}

export function parseLiveStatus(status: unknown): LiveStatus {
  const s = obj(status);
  return {
    deviceDateTime: str(s.DateTime),
    batteryVoltageMv: num(s.BatteryVoltage),
    cpuTemperatureC: num(s.CpuTemperature),
    pumps: pumpsOf(obj(s.Pumps)),
    probes: probesOf(obj(s.Probes)),
    fuelGrades: arr(s.FuelGrades).map(obj).flatMap((g) => {
      const id = int(g.Id);
      return id ? [{ id, name: str(g.Name) ?? "", price: num(g.Price) }] : [];
    }),
  };
}
