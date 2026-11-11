import { describe, expect, it } from "vitest";
import { parseLiveStatus } from "./stationLive.parse";

/**
 * UploadStatus مُدخَل خارجي يرسله الجهاز (CLAUDE.md القاعدة 2: مسموح صنعه يدوياً). الشكل هنا مأخوذ من رسالة جهاز محطة مكة
 * الفعلية (firmware 2026-11-08، مراجعة البروتوكول 141) مختصرة إلى أربع نقاط تعبئة، مع مجموعة FillingStatus وEndOfTransactionStatus
 * بحقول المواصفة (R140 ص331–336).
 */
const STATUS = {
  ConfigurationId: "c12d93f8",
  DateTime: "2026-11-11T18:44:43",
  UTCOffset: 180,
  BatteryVoltage: 0,
  CpuTemperature: 44,
  Pumps: {
    Users: ["", "", "PTS", ""],
    IdleStatus: {
      Ids: [1, 4], Tags: ["", ""], Requests: ["", ""], NozzlesUp: [0, 1], LastPrices: [2.33, 2.18], LastAmounts: [30, 56.02], LastNozzles: [1, 1],
      LastVolumes: [12.82, 25.58], LastFlowRates: [0, 0], LastTotalAmounts: [1086426.727, 0], LastTotalVolumes: [9928390.68, 0], LastTransactions: [2840, 77],
    },
    FillingStatus: { Ids: [3], Nozzles: [1], FuelGradeIds: [1], FuelGradeNames: ["95"], Transactions: [5462], Volumes: [1.32], Amounts: [3.076], Prices: [2.33], FlowRates: [38], Tags: [""] },
    EndOfTransactionStatus: { Ids: [], Nozzles: [], Transactions: [], Volumes: [], Amounts: [], Prices: [], FlowRates: [] },
    OfflineStatus: { Ids: [2] },
  },
  Probes: {
    OnlineStatus: {
      Ids: [1, 2], Errors: [0, 0], HighWaterAlarms: [0, 1], LowProductAlarms: [], HighProductAlarms: [], TankLeakageAlarms: [],
      CriticalLowProductAlarms: [], CriticalHighProductAlarms: [],
      Measurements: [[1, 611.6, 40.5, 38.5, null, null, null, null, null, null, 20], [2, 1622.8, 38.3, 34.6, 31250, null, 28750, null, null, null, 54]],
    },
    OfflineStatus: { Ids: [3] },
  },
  FuelGrades: [{ Id: 1, Name: "95", Price: 2.33 }, { Id: 2, Name: "91", Price: 2.18 }],
};

describe("parseLiveStatus (UploadStatus → live station view)", () => {
  const live = parseLiveStatus(STATUS);

  it("reads every pump group by the position of its id in the parallel arrays", () => {
    expect(live.pumps.map((p) => [p.ptsPump, p.state])).toEqual([[1, "idle"], [2, "offline"], [3, "filling"], [4, "idle"]]);
    expect(live.pumps[2]).toMatchObject({ ptsPump: 3, nozzle: 1, volume: 1.32, amount: 3.076, price: 2.33, flowRate: 38, transaction: 5462, user: "PTS" });
    expect(live.pumps[0]).toMatchObject({ nozzle: null, lastVolume: 12.82, lastAmount: 30, lastPrice: 2.33, totalVolume: 9928390.68, transaction: 2840 });
    // نقطة 4: فوهتها مرفوعة الآن، والعداد التراكمي 0 يعني لا قيمة بعد
    expect(live.pumps[3]).toMatchObject({ nozzle: 1, lastAmount: 56.02, totalVolume: null, totalAmount: null });
  });

  it("reads probe measurements, alarms and offline probes", () => {
    expect(live.probes[0]).toMatchObject({ probe: 1, online: true, productHeightMm: 611.6, waterHeightMm: 40.5, temperatureC: 38.5, productLiters: null, fillPct: 20, alarms: [], error: false });
    expect(live.probes[1]).toMatchObject({ probe: 2, productLiters: 31250, ullageLiters: 28750, fillPct: 54, alarms: ["high_water"] });
    expect(live.probes[2]).toMatchObject({ probe: 3, online: false, productHeightMm: null });
  });

  it("keeps controller facts and fuel grades", () => {
    expect(live).toMatchObject({ deviceDateTime: "2026-11-11T18:44:43", batteryVoltageMv: 0, cpuTemperatureC: 44 });
    expect(live.fuelGrades).toEqual([{ id: 1, name: "95", price: 2.33 }, { id: 2, name: "91", price: 2.18 }]);
  });

  it("returns an empty view for a controller that never sent a status", () => {
    expect(parseLiveStatus(null)).toEqual({ deviceDateTime: null, batteryVoltageMv: null, cpuTemperatureC: null, pumps: [], probes: [], fuelGrades: [] });
  });
});
