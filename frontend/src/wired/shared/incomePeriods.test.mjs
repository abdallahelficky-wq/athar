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
