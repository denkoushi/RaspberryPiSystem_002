import { describe, expect, it } from 'vitest';

import {
  aggregateScenario, applyOutsource, autoSelect, cancelScenarioRow, collectNoTaker, isScenarioCandidate,
  partKey, readLoad, transferOptions, vendorMatches, outsourceOption, vendorRowUsage, type ScenarioInput
} from '../loadBalancingScenario';

import type { OutsourceOrderKey, OutsourceVendor, ProductionScheduleLoadBalancingWorkspaceRow as Row, ProductionScheduleLoadBalancingWorkspaceResource as Resource } from '../../../../api/client';

const months = ['2026-11', '2026-12'];
const row = (rowId: string, minutes = 100, extra: Partial<Row> = {}): Row => ({
  rowId, fseiban: 'S1', productNo: '1', fhincd: `P-${rowId}`, fhinmei: '軸', machineName: 'NVD', resourceCd: 'A',
  totalMinutes: minutes, plannedStartDate: '2026-11-01', effectiveDueDate: '2026-11-30', late: false,
  allocations: [{ bucket: months[0]!, minutes }], ...extra
});
const resource = (resourceCd: string, cap: number | null, second = cap): Resource => ({
  resourceCd, classCode: resourceCd, workCalendarMode: 'weekdays', baseCapacityMinutes: cap,
  capacityByMonth: { [months[0]!]: cap, [months[1]!]: second }
});
const vendor = (id = 'v1', cap: number | null = null, extra: Partial<OutsourceVendor> = {}): OutsourceVendor => ({
  id, name: id, priority: 1, monthlyCapacityMinutes: cap,
  conditions: [{ resourceCds: [], partPrefix: '', partName: '', maxMinutes: null }], ...extra
});
const input = (rows: Row[], extra: Partial<ScenarioInput> = {}): ScenarioInput => ({
  rows, actions: [], months, today: '2026-11-07', resources: [resource('A', 50), resource('B', 100)], rules: [],
  settings: { mode: 'process', order: ['due', 'minutes', 'vendor'], vendors: [vendor()] }, ...extra
});

describe('vendor feasibility and final-set aggregation', () => {
  it('checks every daily-distributed month, uses whole-row condition minutes, and drops every month from internal load', () => {
    // 3 working days, 2 in November and 1 in December: 600/3 per day.
    const r = row('a', 600, { allocations: [{ bucket: months[0]!, minutes: 400 }, { bucket: months[1]!, minutes: 200 }] });
    const v = vendor('v', 399);
    expect(outsourceOption(input([r]), r, v).fits).toBe(false);
    v.monthlyCapacityMinutes = 400;
    expect(outsourceOption(input([r]), r, v).fits).toBe(true);
    v.conditions[0]!.maxMinutes = 599;
    expect(vendorMatches(v, r)).toBe(false);
    v.conditions[0]!.maxMinutes = 600;
    const start = input([r], { settings: { mode: 'process', order: ['due', 'minutes', 'vendor'], vendors: [v] } });
    const actions = applyOutsource(start, 'a', 'v');
    const final = aggregateScenario({ ...start, actions });
    expect([...final.vendorUsage.get('v')!]).toEqual([[months[0], 400], [months[1], 200]]);
    expect([...final.matrix]).toEqual([]);
    expect(aggregateScenario({ ...start, actions: cancelScenarioRow(actions, 'a') }).vendorUsage.size).toBe(0);
  });
  it('charges overdue work to JST current month, even with a later visible start; excludes outside normal months', () => {
    const late = row('late', 100, { late: true, effectiveDueDate: '2026-10-01', allocations: [{ bucket: 'late', minutes: 100 }] });
    const start = input([late], { months: ['2026-12'] });
    const actions = applyOutsource(start, 'late', 'v1');
    expect([...aggregateScenario({ ...start, actions }).vendorUsage.get('v1')!]).toEqual([['2026-11', 100]]);
    expect([...vendorRowUsage(row('outside', 999, { allocations: [{ bucket: '2026-10', minutes: 999 }, { bucket: '2026-12', minutes: 10 }] }), ['2026-12'], '2026-11-07')]).toEqual([['2026-12', 10]]);
    const limited = vendor('v1', 99);
    expect(outsourceOption({ ...start, settings: { ...start.settings!, vendors: [limited] } }, late, limited).fits).toBe(false);
  });
  it('distinguishes unlimited and zero vendor limits; requires at least one condition', () => {
    const r = row('a');
    expect(outsourceOption(input([r]), r, vendor('v', null)).fits).toBe(true);
    expect(outsourceOption(input([r]), r, vendor('v', 0)).fits).toBe(false);
    expect(vendorMatches(vendor('v', null, { conditions: [] }), r)).toBe(false);
  });
  it('uses AND within conditions, OR between conditions and vendor text normalization', () => {
    const r = row('a', 100, { fhincd: ' Ａｂ－１２ ', fhinmei: ' 軸ＳＨＡＦＴ ', resourceCd: ' a ' });
    const v = vendor();
    v.conditions = [{ resourceCds: ['A'], partPrefix: ' ab-', partName: ' shaft ', maxMinutes: 100 }];
    expect(vendorMatches(v, r)).toBe(true);
    v.conditions[0]!.maxMinutes = 99;
    expect(vendorMatches(v, r)).toBe(false);
    v.conditions.push({ resourceCds: [], partPrefix: '', partName: '', maxMinutes: null });
    expect(vendorMatches(v, r)).toBe(true);
  });
  it.each([
    { fhincd: ' ﾌﾞﾗｹｯﾄ  abc-1 ', fhinmei: ' ﾌﾞﾗｹｯﾄ　　軸 ', resourceCd: ' ａ ' },
    { fhincd: ' ブラケット　 ABC-1 ', fhinmei: ' ブラケット  軸 ', resourceCd: ' a ' }
  ])('matches NFKC kana, collapsed whitespace and case on both sides: %j', (values) => {
    const v = vendor();
    v.conditions = [{ resourceCds: [' Ａ '], partPrefix: ' ブラケット　abc ', partName: ' ﾌﾞﾗｹｯﾄ  軸 ', maxMinutes: null }];
    expect(vendorMatches(v, row('a', 100, values))).toBe(true);
    v.conditions[0]!.partName = 'ブラケット 別';
    expect(vendorMatches(v, row('a', 100, values))).toBe(false);
  });
  it.each([
    { plannedStartDate: '' }, { effectiveDueDate: '' }, { totalMinutes: 0 }, { totalMinutes: -1 }, { totalMinutes: NaN }, { allocations: [] }
  ])('does not operate on unallocated rows %j', (extra) => {
    const r = row('a', 100, extra);
    expect(isScenarioCandidate(r, input([r]))).toBe(false);
    expect(autoSelect(input([r])).actions).toEqual([]);
    expect(applyOutsource(input([r]), r.rowId, 'v1')).toEqual([]);
  });
  it('does not auto-select NULL capacity or late cells, but selects capacity zero and >0.5 excess', () => {
    const rows = [row('a')];
    expect(autoSelect(input(rows, { resources: [resource('A', null)] })).actions).toEqual([]);
    expect(autoSelect(input(rows, { resources: [resource('A', 0)] })).actions).toHaveLength(1);
    expect(autoSelect(input([row('a', 50.5)])).actions).toEqual([]);
    expect(autoSelect(input([row('a', 50.51)])).actions).toHaveLength(1);
    expect(autoSelect(input([row('late', 100, { allocations: [{ bucket: 'late', minutes: 100 }] })])).actions).toEqual([]);
  });
  it('uses rowId, not duplicate ProductNo, for distinct process actions', () => {
    const start = input([row('a'), row('b')], { resources: [resource('A', 0)] });
    expect(autoSelect(start).actions.map((action) => action.rowId)).toEqual(['a', 'b']);
  });
  it('checks all transfer months and non-unit efficiency for manual and automatic selection', () => {
    const r = row('a', 100, { allocations: [{ bucket: months[0]!, minutes: 40 }, { bucket: months[1]!, minutes: 60 }] });
    const start = input([r], { resources: [resource('A', 0), resource('B', 100, 119)], rules: [{ fromClassCode: 'A', toClassCode: 'B', priority: 1, efficiencyRatio: 0.5 }] });
    expect(transferOptions(start, r, months[0]!)[0]!.fits).toBe(false);
    start.resources[1]!.capacityByMonth[months[1]!] = 120;
    expect(transferOptions(start, r, months[0]!)[0]!.fits).toBe(true);
    const result = autoSelect(start);
    expect(result.actions[0]).toMatchObject({ type: 'transfer', efficiencyRatio: 0.5 });
    expect(readLoad(aggregateScenario({ ...start, actions: result.actions }).matrix, 'B', months[1]!)).toBe(120);
  });
  it('tries other internally transferable rows before outsourcing; prefers transfer priority', () => {
    const rows = [row('small', 60), row('big', 100)];
    const start = input(rows, { resources: [resource('A', 50), resource('B', 100), resource('C', 100)], rules: [
      { fromClassCode: 'A', toClassCode: 'B', priority: 2, efficiencyRatio: 1 },
      { fromClassCode: 'A', toClassCode: 'C', priority: 1, efficiencyRatio: 2 }
    ] });
    expect(autoSelect(start).actions[0]).toMatchObject({ rowId: 'big', type: 'transfer', toResourceCd: 'C' });
  });
  it('normalizes machine filters and never operates on other machines', () => {
    const start = input([row('a', 100, { machineName: ' Ｎｖｄ ' }), row('b', 100, { machineName: 'HX' })], { machine: 'NVD' });
    expect(autoSelect(start).actions.map((action) => action.rowId)).toEqual(['a']);
  });
});

describe('part units, order and failure reasons', () => {
  it('ignores ProductNo for assigned parts but separates ******** orders and unrelated parts', () => {
    expect(partKey(row('a', 100, { fhincd: 'P', productNo: '1' }))).toBe(partKey(row('b', 100, { fhincd: 'P', productNo: '2' })));
    expect(partKey(row('a', 100, { fseiban: '********', fhincd: 'P', productNo: '1' }))).not.toBe(partKey(row('b', 100, { fseiban: '********', fhincd: 'P', productNo: '2' })));
    const rows = [row('a', 40, { fhincd: 'P' }), row('b', 60, { fhincd: 'P', productNo: '2' }), row('c', 10, { fhincd: 'P', fseiban: '********' })];
    const start = input(rows); start.settings!.mode = 'part'; start.settings!.vendors[0]!.monthlyCapacityMinutes = 99;
    expect(applyOutsource(start, 'a', 'v1')).toEqual([]);
    start.settings!.vendors[0]!.monthlyCapacityMinutes = 100;
    const actions = applyOutsource(start, 'a', 'v1');
    expect(actions.map((action) => action.rowId)).toEqual(['a', 'b']);
    start.settings!.mode = 'process';
    expect(cancelScenarioRow(actions, 'b')).toEqual([]);
  });
  it('part grouping excludes filtered, acted, unallocated and unprocessable rows and checks combined months', () => {
    const rows = [row('a', 40, { fhincd: 'P' }), row('b', 60, { fhincd: 'P', allocations: [{ bucket: months[1]!, minutes: 60 }] }),
      row('filtered', 1, { fhincd: 'P', machineName: 'HX' }), row('unallocated', 1, { fhincd: 'P', allocations: [] }),
      row('other', 1, { fhincd: 'P', resourceCd: 'B' }), row('acted', 1, { fhincd: 'P' })];
    const start = input(rows, { machine: 'NVD', actions: [{ type: 'defer', rowId: 'acted', fromBucket: months[0]! }] });
    start.settings!.mode = 'part'; start.settings!.vendors[0]!.conditions[0]!.resourceCds = ['A'];
    start.settings!.vendors[0]!.monthlyCapacityMinutes = 59;
    expect(applyOutsource(start, 'a', 'v1')).toEqual(start.actions);
    start.settings!.vendors[0]!.monthlyCapacityMinutes = 60;
    expect(applyOutsource(start, 'a', 'v1').map((action) => action.rowId)).toEqual(['acted', 'a', 'b']);
    expect(autoSelect(start).actions.filter((action) => action.type === 'outsource').map((action) => action.rowId)).toEqual(['a', 'b']);
  });
  it.each([
    [['due', 'minutes', 'vendor'], 'urgent', 'v2'],
    [['minutes', 'vendor', 'due'], 'large', 'v1'],
    [['vendor', 'due', 'minutes'], 'large', 'v1'],
    [['minutes', 'due', 'vendor'], 'large', 'v1']
  ] as [OutsourceOrderKey[], string, string][])('honors configurable order %j', (order, rowId, vendorId) => {
    const rows = [row('urgent', 60, { fhincd: 'U', effectiveDueDate: '2026-11-10' }), row('large', 100, { fhincd: 'L', effectiveDueDate: '2026-11-20' })];
    const first = vendor('v1', null, { conditions: [{ resourceCds: [], partPrefix: 'L', partName: '', maxMinutes: null }] });
    const second = vendor('v2', null, { priority: 2 });
    const start = input(rows, { resources: [resource('A', 110)], settings: { mode: 'process', order, vendors: [first, second] } });
    expect(autoSelect(start).actions[0]).toMatchObject({ rowId, vendorId });
  });
  it('vendor-first and minutes-first can each change the winning pair', () => {
    const rows = [row('large', 100, { fhincd: 'L' }), row('small', 60, { fhincd: 'S' })];
    const v1 = vendor('v1', null, { conditions: [{ resourceCds: [], partPrefix: 'S', partName: '', maxMinutes: null }] });
    const start = input(rows, { resources: [resource('A', 110)], settings: { mode: 'process', order: ['vendor', 'due', 'minutes'], vendors: [v1, vendor('v2', null, { priority: 2 })] } });
    expect(autoSelect(start).actions[0]).toMatchObject({ rowId: 'small', vendorId: 'v1' });
    start.settings!.order = ['minutes', 'due', 'vendor'];
    expect(autoSelect(start).actions[0]).toMatchObject({ rowId: 'large', vendorId: 'v2' });
  });
  it('breaks all ties by rowId/vendorId, independent of input array order', () => {
    const start = input([row('b', 100), row('a', 100)], { resources: [resource('A', 150)], settings: { mode: 'process', order: ['due', 'minutes', 'vendor'], vendors: [vendor('z'), vendor('a')] } });
    expect(autoSelect(start).actions[0]).toMatchObject({ rowId: 'a', vendorId: 'a' });
    expect(autoSelect({ ...start, rows: [...start.rows].reverse(), settings: { ...start.settings!, vendors: [...start.settings!.vendors].reverse() } })).toEqual(autoSelect(start));
  });
  it('does not label a still-feasible vendor choice as a capacity failure after manual edits', () => {
    expect(collectNoTaker(input([row('a')]))).toEqual([]);
  });
  it('never places normal allocations outside the visible range, for every action type', () => {
    const start = input([row('a', 110, { allocations: [{ bucket: '2026-10', minutes: 100 }, { bucket: '2026-11', minutes: 10 }] })]);
    for (const actions of [[], [{ rowId: 'a', type: 'transfer' as const, toResourceCd: 'B', efficiencyRatio: 1 }], [{ rowId: 'a', type: 'defer' as const, fromBucket: '2026-11' }]]) {
      const result = aggregateScenario({ ...start, actions });
      expect([...result.matrix.values()].some((buckets) => buckets.has('2026-10'))).toBe(false);
    }
  });
  it('finishes the largest overloaded cell before choosing the next cell from recomputed totals', () => {
    const rows = [row('a1', 40, { effectiveDueDate: '2026-11-10' }), row('a2', 40, { effectiveDueDate: '2026-11-11' }),
      row('a3', 40, { effectiveDueDate: '2026-11-12' }), row('a4', 80, { effectiveDueDate: '2026-11-13' }),
      row('b1', 50, { resourceCd: 'B' }), row('b2', 40, { resourceCd: 'B' })];
    const start = input(rows, { resources: [resource('A', 100), resource('B', 0)], settings: { mode: 'process', order: ['due', 'minutes', 'vendor'], vendors: [vendor('v', 100)] } });
    expect(autoSelect(start).actions.map((action) => action.rowId)).toEqual(['a1', 'a2']);
  });
  it('recomputes all cells and consumes vendor limits across resources and months; reports conditions/capacity', () => {
    const rows = [row('a', 100), row('b', 80, { resourceCd: 'B' }), row('c', 10, { resourceCd: 'C' })];
    const start = input(rows, { resources: [resource('A', 0), resource('B', 0), resource('C', 0)], settings: { mode: 'process', order: ['due', 'minutes', 'vendor'], vendors: [vendor('v', 100, { conditions: [{ resourceCds: ['A', 'B'], partPrefix: '', partName: '', maxMinutes: null }] })] } });
    const result = autoSelect(start);
    expect(result.actions.map((action) => action.rowId)).toEqual(['a']);
    expect(result.noTaker).toEqual([{ rowId: 'b', reason: '上限' }, { rowId: 'c', reason: '条件' }]);
    expect(collectNoTaker({ ...start, actions: result.actions })).toEqual(result.noTaker);
  });
});

// Fixed seed; independent ledgers below intentionally do not use aggregateScenario/placeRow for expected totals.
describe('seeded properties (400 cases)', () => {
  for (let caseNo = 0; caseNo < 400; caseNo += 1) {
    it(`preserves time, eligibility, limits, scope and determinism #${caseNo}`, () => {
      let seed = (0x3622026 + caseNo) >>> 0;
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
      const rows: Row[] = Array.from({ length: 5 + Math.floor(random() * 10) }, (_, index) => {
        const minutes = 1 + Math.floor(random() * 400), first = minutes * random();
        const mode = random();
        const outside = mode >= 0.15 && random() < 0.2 ? minutes * 0.3 : 0;
        return row(`r${index}`, minutes + outside, {
          fseiban: random() < 0.3 ? '********' : `S${index % 3}`, productNo: `${index % 2}`, fhincd: `P${index % 3}`,
          machineName: random() < 0.25 ? 'HX' : 'ＮＶＤ', resourceCd: random() < 0.75 ? 'A' : 'B',
          plannedStartDate: mode < 0.05 ? '' : '2026-11-01',
          effectiveDueDate: mode < 0.15 ? '2026-10-01' : `2026-12-${String(1 + index).padStart(2, '0')}`,
          late: mode >= 0.05 && mode < 0.15,
          allocations: mode < 0.05 ? [] : mode < 0.15 ? [{ bucket: 'late', minutes }] : [{ bucket: months[0]!, minutes: first }, { bucket: months[1]!, minutes: minutes - first }, ...(outside > 0 ? [{ bucket: '2027-01', minutes: outside }] : [])]
        });
      });
      const vendors = [vendor('v1', random() < 0.2 ? null : Math.floor(random() * 500)), vendor('v2', Math.floor(random() * 600), {
        priority: 2, conditions: random() < 0.15 ? [] : [{ resourceCds: random() < 0.5 ? [] : ['A'], partPrefix: random() < 0.5 ? 'P1' : '', partName: '', maxMinutes: random() < 0.5 ? null : 250 }]
      })];
      const orders: OutsourceOrderKey[][] = [['due', 'minutes', 'vendor'], ['minutes', 'vendor', 'due'], ['vendor', 'due', 'minutes']];
      const start = input(rows, {
        resources: [resource('A', random() < 0.1 ? null : Math.floor(random() * 600)), resource('B', 400 + Math.floor(random() * 600))],
        settings: { mode: random() < 0.5 ? 'part' : 'process', vendors, order: orders[caseNo % orders.length]! },
        rules: [{ fromClassCode: 'A', toClassCode: 'B', priority: 1, efficiencyRatio: [0.5, 0.8, 1, 2][caseNo % 4]! }], machine: 'NVD'
      });
      // Include deferred-outside work to exercise the fourth conservation term.
      const deferred = rows.find((r) => isScenarioCandidate(r, start) && !r.late);
      if (caseNo % 3 === 0 && deferred) start.actions = [{ type: 'defer', rowId: deferred.rowId, fromBucket: months[1]! }];
      const result = autoSelect(start);
      expect(autoSelect(start)).toEqual(result);
      const byRow = new Map(result.actions.map((action) => [action.rowId, action]));
      expect(byRow.size).toBe(result.actions.length);
      let original = 0, internal = 0, transferBeforeConversion = 0, outsourced = 0, outside = 0;
      const expectedUsage = new Map<string, number>();
      const expectedLoads = new Map<string, number>();
      const addLoad = (cd: string, bucket: string, min: number) => { const key = `${cd}/${bucket}`; expectedLoads.set(key, (expectedLoads.get(key) ?? 0) + min); };
      for (const r of rows) {
        const action = byRow.get(r.rowId);
        if (action) expect(isScenarioCandidate(r, start)).toBe(true);
        for (const allocation of r.allocations) {
          original += allocation.minutes;
          if (allocation.bucket !== 'late' && !months.includes(allocation.bucket)) { outside += allocation.minutes; continue; }
          if (action?.type === 'outsource') {
            outsourced += allocation.minutes;
            const v = vendors.find((candidate) => candidate.id === action.vendorId)!;
            expect(v.conditions.some((c) => (c.resourceCds.length === 0 || c.resourceCds.includes(r.resourceCd)) &&
              r.fhincd.startsWith(c.partPrefix) && r.fhinmei.includes(c.partName) && (c.maxMinutes === null || r.totalMinutes <= c.maxMinutes))).toBe(true);
            const month = allocation.bucket === 'late' ? '2026-11' : allocation.bucket;
            const key = `${v.id}/${month}`;
            expectedUsage.set(key, (expectedUsage.get(key) ?? 0) + allocation.minutes);
          } else if (action?.type === 'transfer') {
            transferBeforeConversion += allocation.minutes;
            addLoad(action.toResourceCd, allocation.bucket, allocation.minutes / action.efficiencyRatio);
          } else if (action?.type === 'defer' && allocation.bucket === action.fromBucket) {
            outside += allocation.minutes;
          } else {
            internal += allocation.minutes;
            addLoad(r.resourceCd, allocation.bucket, allocation.minutes);
          }
        }
      }
      expect(internal + transferBeforeConversion + outsourced + outside).toBeCloseTo(original, 7);
      const final = aggregateScenario({ ...start, actions: result.actions });
      for (const [key, minutes] of expectedLoads) { const [cd, bucket] = key.split('/'); expect(readLoad(final.matrix, cd!, bucket!)).toBeCloseTo(minutes, 7); }
      for (const v of vendors) for (const month of months) {
        const used = expectedUsage.get(`${v.id}/${month}`) ?? 0;
        expect(final.vendorUsage.get(v.id)?.get(month) ?? 0).toBeCloseTo(used, 7);
        if (v.monthlyCapacityMinutes !== null) expect(used).toBeLessThanOrEqual(v.monthlyCapacityMinutes);
      }
      for (const action of result.actions.filter((a) => a.type === 'transfer')) for (const month of months) {
        const destination = start.resources.find((r) => r.resourceCd === action.toResourceCd)!;
        // Every destination actually used by a transfer fits its real monthly capacity.
        expect(readLoad(final.matrix, destination.resourceCd, month)).toBeLessThanOrEqual(destination.capacityByMonth[month]! + 1e-8);
      }
      for (const res of start.resources) for (const month of months) {
        const capacity = res.capacityByMonth[month];
        if (capacity === null || readLoad(final.matrix, res.resourceCd, month) - capacity! <= 0.5) continue;
        const remaining = rows.filter((r) => r.resourceCd === res.resourceCd && !byRow.has(r.rowId) && isScenarioCandidate(r, start) && r.allocations.some((a) => a.bucket === month && a.minutes > 0));
        expect(remaining.length === 0 || remaining.some((r) => result.noTaker.some((n) => n.rowId === r.rowId))).toBe(true);
        for (const r of remaining) for (const v of vendors) expect(outsourceOption({ ...start, actions: result.actions }, r, v).fits).toBe(false);
      }
    });
  }
});
