import test from 'node:test';
import assert from 'node:assert/strict';
import { incomeDefaults, incomePeriods } from './incomePeriods.mjs';

test('default uses the Saudi fiscal year and local day, including UTC year boundary', () => {
  const f = incomeDefaults(new Date('2025-12-31T22:00:00Z'));
  assert.equal(f.dateFrom, '2026-01-01');
  assert.equal(f.dateTo, '2026-01-01');
  assert.deepEqual(incomePeriods(f), [{ from: '2026-01-01', to: '2026-01-01', label: '2026-01-01 — 2026-01-01' }]);
});
test('this month ends today rather than including future dated entries', () => {
  assert.deepEqual(incomePeriods({ mode: 'month' }, new Date('2026-11-04T10:00:00Z')), [{ from: '2026-11-01', to: '2026-11-04', label: '2026-11' }]);
});
test('month comparison crosses year boundaries and handles leap February', () => {
  assert.deepEqual(incomePeriods({ mode: 'months', count: 3, endMonth: '2024-02' }), [
    { from: '2023-12-01', to: '2023-12-31', label: '2023-12' },
    { from: '2024-01-01', to: '2024-01-31', label: '2024-01' },
    { from: '2024-02-01', to: '2024-02-29', label: '2024-02' },
  ]);
  assert.equal(incomePeriods({ mode: 'months', count: 1, endMonth: '2025-02' })[0].to, '2025-02-28');
  const twelve = incomePeriods({ mode: 'months', count: 12, endMonth: '2026-11' });
  assert.equal(twelve.length, 12);
  assert.equal(twelve[0].from, '2025-12-01');
  assert.equal(twelve[11].to, '2026-11-30');
});
test('annual comparison consists of separate complete years', () => {
  assert.deepEqual(incomePeriods({ mode: 'years', count: 2, endYear: 2026 }), [
    { from: '2025-01-01', to: '2025-12-31', label: '2025' },
    { from: '2026-01-01', to: '2026-12-31', label: '2026' },
  ]);
});
test('reject reversed dates, invalid months, and unsupported comparison counts', () => {
  assert.throws(() => incomePeriods({ mode: 'period', dateFrom: '2026-11-02', dateTo: '2026-11-01' }));
  assert.throws(() => incomePeriods({ mode: 'months', count: 2, endMonth: '2026-13' }));
  for (const count of [0, 13, 1.5, 'bad']) assert.throws(() => incomePeriods({ mode: 'years', count, endYear: 2026 }));
});

test('fiscal year starting in April: default period, and year comparison columns', async () => {
  const { incomeDefaults: defaults, incomePeriods: periods } = await import('./incomePeriods.mjs');
  const before = defaults(new Date('2026-02-10T10:00:00Z'), 4);
  assert.equal(before.dateFrom, '2025-04-01');
  assert.equal(before.endYear, 2025);
  const after = defaults(new Date('2026-04-01T10:00:00Z'), 4);
  assert.equal(after.dateFrom, '2026-04-01');
  assert.deepEqual(periods({ mode: 'years', count: 2, endYear: 2025 }, new Date(), 4), [
    { from: '2024-04-01', to: '2025-03-31', label: '2024/2025' },
    { from: '2025-04-01', to: '2026-03-31', label: '2025/2026' },
  ]);
  assert.deepEqual(periods({ mode: 'years', count: 1, endYear: 2023 }, new Date(), 3), [{ from: '2023-03-01', to: '2024-02-29', label: '2023/2024' }]);
});

test('quarter comparison follows calendar quarters for a January fiscal year', () => {
  assert.deepEqual(incomePeriods({ mode: 'quarters', count: 2, endMonth: '2026-11' }), [
    { from: '2026-07-01', to: '2026-09-30', label: 'Q3 2026' },
    { from: '2026-10-01', to: '2026-12-31', label: 'Q4 2026' },
  ]);
});
test('quarter comparison follows fiscal quarters for an April fiscal year and crosses the year boundary', () => {
  assert.deepEqual(incomePeriods({ mode: 'quarters', count: 3, endMonth: '2026-05' }, new Date(), 4), [
    { from: '2025-10-01', to: '2025-12-31', label: 'Q3 2025/2026' },
    { from: '2026-01-01', to: '2026-03-31', label: 'Q4 2025/2026' },
    { from: '2026-04-01', to: '2026-06-30', label: 'Q1 2026/2027' },
  ]);
  // سنة مالية تبدأ في فبراير: الربع لا يطابق الربع الميلادي
  assert.equal(incomePeriods({ mode: 'quarters', count: 1, endMonth: '2026-01' }, new Date(), 2)[0].from, '2025-11-01');
});
test('same period last year pairs the chosen range with its prior-year match', () => {
  assert.deepEqual(incomePeriods({ mode: 'yoy', dateFrom: '2024-02-01', dateTo: '2024-02-29' }), [
    { from: '2023-02-01', to: '2023-02-28', label: '2023-02-01 — 2023-02-28' },
    { from: '2024-02-01', to: '2024-02-29', label: '2024-02-01 — 2024-02-29' },
  ]);
  assert.throws(() => incomePeriods({ mode: 'yoy', dateFrom: '2026-03-01', dateTo: '2026-02-01' }), /INVALID_PERIOD/);
});
