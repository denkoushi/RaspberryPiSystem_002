import { describe, expect, it } from 'vitest';

import { autoSelect, aggregateScenario, readLoad, vendorMatches, type ScenarioAction } from '../loadBalancingScenario';

// @ts-expect-error The independent JavaScript fixture intentionally has no type declarations.
import { referenceAutoSelect } from './fixtures/outsourceReference.mjs';

const MONTHS = ['2026-11', '2026-12', '2027-01'];
const TODAY = '2026-11-07';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

function gen(seed: number, big = false) {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const classes = ['C1', 'C2', 'C3'];
  const nRes = int(2, 6);
  const resources = Array.from({ length: nRes }, (_, i) => {
    const cap: Record<string, number | null> = {};
    for (const m of MONTHS) {
      const x = r();
      cap[m] = x < 0.08 ? null : x < 0.13 ? 0 : seed % 2 === 1 ? int(10, big ? 600 : 120) * 10 + (r() < 0.3 ? 0.5 : 0) : int(100, big ? 6000 : 1200);
    }
    return { resourceCd: `R${i}`, classCode: r() < 0.1 ? null : pick(classes), workCalendarMode: 'weekdays' as const, baseCapacityMinutes: null, capacityByMonth: cap };
  });
  const rules = Array.from({ length: int(0, 4) }, () => ({
    fromClassCode: pick(classes), toClassCode: pick(classes), priority: int(1, 3), efficiencyRatio: pick([0.5, 0.8, 1, 1.25, 2, 0, -1])
  }));
  const machines = ['NVD', 'ＮＶＤ', ' nvd ', 'HX', 'DT-1'];
  const nRows = big ? int(80, 220) : int(4, 30);
  const rows = Array.from({ length: nRows }, (_, i) => {
    const kind = r();
    const total = int(1, 900) + (r() < 0.2 ? 0.25 : 0);
    const resourceCd = pick(resources).resourceCd;
    let allocations: Array<{ bucket: string; minutes: number }> = [];
    let late = false, planned = '2026-11-01', due = `2026-${pick(['11', '12'])}-${String(int(1, 28)).padStart(2, '0')}`;
    if (kind < 0.05) { planned = ''; }
    else if (kind < 0.08) { due = ''; }
    else if (kind < 0.18) { late = true; due = '2026-10-15'; allocations = [{ bucket: 'late', minutes: total }]; }
    else {
      const spans = pick([[0], [1], [0, 1], [1, 2], [0, 1, 2], [2], [2, 3]]);
      const weights = spans.map(() => r() + 0.01); const sum = weights.reduce((a, b) => a + b, 0);
      allocations = spans.map((k, j) => ({ bucket: k === 3 ? '2027-02' : MONTHS[k]!, minutes: total * weights[j]! / sum }));
      if (r() < 0.04) allocations = allocations.map((a) => ({ ...a, minutes: 0 }));
      if (seed % 2 === 1) { allocations = allocations.map((a) => ({ ...a, minutes: Math.round(a.minutes / 10) * 10 })); }
    }
    const fseiban = r() < 0.25 ? '********' : `S${int(1, 4)}`;
    return {
      rowId: `row${String(i).padStart(3, '0')}`, fseiban, productNo: `${int(1, 3)}`, fhincd: pick(['P1-A', 'p1-b', 'Ｐ２', 'Q9', 'P10']),
      fhinmei: pick(['シャフト', 'カバー板', 'シャフトカバー', 'ﾌﾞﾗｹｯﾄ', 'ブラケット']), machineName: pick(machines), resourceCd,
      totalMinutes: kind < 0.03 ? 0 : total, plannedStartDate: planned, effectiveDueDate: due, late, allocations
    };
  });
  const nV = int(0, 4);
  const vendors = Array.from({ length: nV }, (_, i) => ({
    id: `v${i}`, name: `業者${i}`, priority: int(1, 3),
    monthlyCapacityMinutes: r() < 0.25 ? null : r() < 0.1 ? 0 : seed % 2 === 1 ? int(5, big ? 800 : 150) * 10 : int(50, big ? 8000 : 1500),
    conditions: Array.from({ length: int(0, 3) }, () => ({
      resourceCds: r() < 0.5 ? [] : [pick(resources).resourceCd, ...(r() < 0.3 ? [pick(resources).resourceCd.toLowerCase()] : [])],
      partPrefix: pick(['', '', 'P1', 'p', 'Ｐ', 'Q']), partName: pick(['', '', 'シャフト', 'ブラケット', 'カバー']),
      maxMinutes: r() < 0.6 ? null : int(50, 700)
    }))
  }));
  const orders: Array<Array<'due' | 'minutes' | 'vendor'>> = [['due', 'minutes', 'vendor'], ['due', 'vendor', 'minutes'], ['minutes', 'due', 'vendor'], ['minutes', 'vendor', 'due'], ['vendor', 'due', 'minutes'], ['vendor', 'minutes', 'due']];
  const settings = { vendors, mode: (r() < 0.5 ? 'part' : 'process') as 'part' | 'process', order: pick(orders) };
  const machine = r() < 0.4 ? pick(['', 'NVD', 'ｎｖｄ', 'HX']) : undefined;
  // a few pre-existing manual actions
  const actions: ScenarioAction[] = [];
  for (const row of rows) {
    const x = r();
    if (x < 0.04) actions.push({ rowId: row.rowId, type: 'defer', fromBucket: row.allocations[0]?.bucket ?? MONTHS[0]! });
    else if (x < 0.06 && resources.length > 1) actions.push({ rowId: row.rowId, type: 'transfer', toResourceCd: pick(resources).resourceCd, efficiencyRatio: 1 });
  }
  return { rows, months: MONTHS, resources, rules, settings, machine, today: TODAY, actions };
}

function checkInvariants(input: ReturnType<typeof gen>, result: ReturnType<typeof autoSelect>) {
  const added = result.actions.slice(input.actions.length);
  const before = aggregateScenario(input);
  const after = aggregateScenario({ ...input, actions: result.actions });
  // vendor caps
  for (const v of input.settings.vendors) {
    if (v.monthlyCapacityMinutes === null) continue;
    for (const [, used] of after.vendorUsage.get(v.id) ?? new Map()) expect(used).toBeLessThanOrEqual(v.monthlyCapacityMinutes + 1e-9);
  }
  // outsourced rows match vendor
  for (const a of added) {
    const row = input.rows.find((x) => x.rowId === a.rowId)!;
    if (a.type === 'outsource') expect(vendorMatches(input.settings.vendors.find((v) => v.id === a.vendorId)!, row)).toBe(true);
  }
  // transfer creates no new overflow on capacity cells
  for (const res of input.resources) for (const m of MONTHS) {
    const cap = res.capacityByMonth[m];
    if (cap == null) continue;
    const b = readLoad(before.matrix, res.resourceCd, m), a2 = readLoad(after.matrix, res.resourceCd, m);
    if (a2 > b + 1e-9) expect(a2).toBeLessThanOrEqual(cap + 1e-9);
  }
}

const norm = (actions: unknown[]) => JSON.stringify(actions);

describe('differential vs independent reference', () => {
  const failures: string[] = [];
  for (let c = 0; c < 2000; c += 1) {
    it(`case ${c}`, () => {
      const input = gen(0xabc000 + c, c % 10 === 9);
      const got = autoSelect(structuredClone(input) as never);
      const ref: ReturnType<typeof autoSelect> = referenceAutoSelect(structuredClone(input));
      if (norm(got.actions) !== norm(ref.actions) || norm(got.noTaker) !== norm(ref.noTaker)) failures.push(String(c));
      expect({ actions: got.actions, noTaker: got.noTaker }).toEqual({ actions: ref.actions, noTaker: ref.noTaker });
      checkInvariants(input, got);
    });
  }
});
