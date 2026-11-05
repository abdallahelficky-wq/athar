const pad = (n) => String(n).padStart(2, '0');
const validMonth = (m) => (Number.isInteger(m) && m >= 1 && m <= 12 ? m : 1);

/** السنة المالية التي تبدأ في سنة startYear بشهر startMonth (1 = يناير) — نفس تعريف src/lib/fiscalYear.ts. */
export function fiscalYearRange(startYear, startMonth = 1) {
  const m = validMonth(startMonth);
  const end = new Date(Date.UTC(startYear + 1, m - 1, 0)).toISOString().slice(0, 10);
  return { from: `${startYear}-${pad(m)}-01`, to: end, label: m === 1 ? String(startYear) : `${startYear}/${startYear + 1}` };
}

export function incomeDefaults(now = new Date(), startMonth = 1) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type) => parts.find(p => p.type === type).value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const m = validMonth(startMonth);
  // بداية السنة المالية الحالية: هذه السنة إن كان شهر اليوم ≥ شهر البداية، وإلا السنة السابقة
  const fiscalStartYear = Number(part('month')) >= m ? Number(part('year')) : Number(part('year')) - 1;
  return { mode: 'period', dateFrom: fiscalYearRange(fiscalStartYear, m).from, dateTo: today, endMonth: today.slice(0, 7), endYear: fiscalStartYear, count: 3, level: 4, accountId: '', includeDetails: false, search: '', branchId: '' };
}

export function incomePeriods(filters, now = new Date(), startMonth = 1) {
  const today = incomeDefaults(now).dateTo;
  if (filters.mode === 'period') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo) || filters.dateFrom > filters.dateTo) throw new Error('INVALID_PERIOD');
    return [{ from: filters.dateFrom, to: filters.dateTo, label: `${filters.dateFrom} — ${filters.dateTo}` }];
  }
  if (filters.mode === 'month') return [{ from: `${today.slice(0, 7)}-01`, to: today, label: today.slice(0, 7) }];
  if (filters.mode === 'yoy') {
    // الفترة المختارة ومقابلها من السنة السابقة (29 فبراير يصبح 28 فبراير)
    const [current] = incomePeriods({ ...filters, mode: 'period' }, now, startMonth);
    const shift = (d) => {
      const [y, m, day] = d.split('-').map(Number);
      const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
      return `${y - 1}-${pad(m)}-${pad(Math.min(day, last))}`;
    };
    const previous = { from: shift(current.from), to: shift(current.to) };
    return [{ ...previous, label: `${previous.from} — ${previous.to}` }, current];
  }
  const count = Number(filters.count);
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error('INVALID_PERIOD');
  if (filters.mode === 'months') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(filters.endMonth)) throw new Error('INVALID_PERIOD');
    const [year, month] = filters.endMonth.split('-').map(Number);
    return Array.from({ length: count }, (_, i) => {
      const start = new Date(Date.UTC(year, month - count + i, 1));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
      const from = start.toISOString().slice(0, 10);
      return { from, to: end.toISOString().slice(0, 10), label: from.slice(0, 7) };
    });
  }
  if (filters.mode === 'quarters') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(filters.endMonth)) throw new Error('INVALID_PERIOD');
    // أرباع السنة المالية: تبدأ بشهر بداية السنة المالية للشركة كل ثلاثة أشهر؛ آخرها الربع الذي يقع فيه endMonth
    const m0 = validMonth(startMonth);
    const [year, month] = filters.endMonth.split('-').map(Number);
    const offset = (month - m0 + 12) % 12;
    const lastStart = Date.UTC(year, month - 1 - (offset % 3), 1);
    return Array.from({ length: count }, (_, i) => {
      const start = new Date(lastStart);
      start.setUTCMonth(start.getUTCMonth() - 3 * (count - 1 - i));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0));
      const sm = start.getUTCMonth() + 1;
      const q = Math.floor(((sm - m0 + 12) % 12) / 3) + 1;
      const fyStart = sm >= m0 ? start.getUTCFullYear() : start.getUTCFullYear() - 1;
      return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), label: `Q${q} ${fiscalYearRange(fyStart, m0).label}` };
    });
  }
  const year = Number(filters.endYear);
  if (filters.mode !== 'years' || !Number.isInteger(year) || year < 1900 + count - 1 || year > 9999) throw new Error('INVALID_PERIOD');
  // كل عمود سنة مالية كاملة (تبدأ بشهر بداية السنة المالية للشركة)، آخرها التي تبدأ في endYear
  return Array.from({ length: count }, (_, i) => fiscalYearRange(year - count + 1 + i, startMonth));
}

// Merge by immutable account ID, keeping a row when ANY displayed period has a balance.
// Retain zero-net parents with nonzero children so the hierarchy remains meaningful.
export function incomeComparisonTree(statements, key) {
  const merge = (lists) => {
    const nodes = new Map();
    lists.forEach((list, index) => list.forEach(node => {
      if (!nodes.has(node.accountId)) nodes.set(node.accountId, { ...node, amounts: Array(lists.length).fill(0), childLists: Array.from({ length: lists.length }, () => []) });
      const entry = nodes.get(node.accountId);
      entry.amounts[index] = Number(node.amount) || 0;
      entry.childLists[index] = node.children || [];
    }));
    return [...nodes.values()].map(({ childLists, ...node }) => ({ ...node, children: merge(childLists) }))
      .filter(node => node.amounts.some(amount => Math.round(Math.abs(amount) * 100) > 0) || node.children.length)
      .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  };
  return merge(statements.map(s => s[key] || []));
}
