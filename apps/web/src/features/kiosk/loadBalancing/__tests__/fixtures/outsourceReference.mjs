/*
 * 仕様の曖昧な点についての判断:
 * - 同じ月の allocations が複数ある場合、候補判定と並べ替えでも合算する。
 * - priority が同じ rule は入力順、同条件の資源は指定された比較順を使う。
 * - 上限回数は手順2から6までの反復回数として数える。
 * - rowId、resourceCd、vendor.id はそれぞれ一意で、入力は指定の型に従う。
 *   手動 actions も1行1操作を満たすものとする。
 */

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const machineKey = (s) => s.trim().replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ').toUpperCase();
const normalize = (s) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();

export function referenceAutoSelect(input) {
  const { rows, months, resources, rules, settings, machine, today } = input;
  const actions = [...input.actions];
  const blocked = new Set();
  const displayed = (bucket) => bucket === 'late' || months.includes(bucket);

  function displayedAmounts(row) {
    const amounts = new Map();
    for (const { bucket, minutes } of row.allocations) {
      if (displayed(bucket)) amounts.set(bucket, (amounts.get(bucket) ?? 0) + minutes);
    }
    return amounts;
  }

  function isCandidate(row) {
    return !blocked.has(row.rowId) && row.plannedStartDate !== '' && row.effectiveDueDate !== ''
      && Number.isFinite(row.totalMinutes) && row.totalMinutes > 0
      && (!machine || normalize(row.machineName) === normalize(machine))
      && row.allocations.some(({ bucket, minutes }) =>
        displayed(bucket) && Number.isFinite(minutes) && minutes > 0);
  }

  function matches(row, vendor) {
    return vendor.conditions.some((condition) =>
      (condition.resourceCds.length === 0 || condition.resourceCds.some((cd) =>
        cd.trim().toUpperCase() === row.resourceCd.trim().toUpperCase()))
      && normalize(row.fhincd).startsWith(normalize(condition.partPrefix))
      && normalize(row.fhinmei).includes(normalize(condition.partName))
      && (condition.maxMinutes === null || row.totalMinutes <= condition.maxMinutes));
  }

  function partKey(row) {
    const key = [row.fseiban.trim(), row.fhincd.trim()];
    if (key[0] === '********') key.push(row.productNo.trim());
    return JSON.stringify(key);
  }

  function usageAmounts(row) {
    const amounts = new Map();
    for (const { bucket, minutes } of row.allocations) {
      const month = bucket === 'late' ? today.slice(0, 7) : bucket;
      if (bucket === 'late' || months.includes(bucket)) {
        amounts.set(month, (amounts.get(month) ?? 0) + minutes);
      }
    }
    return amounts;
  }

  function capacity(resourceCd, bucket) {
    if (bucket === 'late') return undefined;
    return resources.find((resource) => resource.resourceCd === resourceCd)
      ?.capacityByMonth[bucket];
  }

  // 状態は毎回、全 actions と全行から作り直す。
  function rebuild() {
    const operated = new Map(actions.map((action) => [action.rowId, action]));
    const load = new Map();
    const usage = new Map();
    function addLoad(resourceCd, bucket, minutes) {
      if (!load.has(resourceCd)) load.set(resourceCd, new Map());
      const amounts = load.get(resourceCd);
      amounts.set(bucket, (amounts.get(bucket) ?? 0) + minutes);
    }
    for (const row of rows) {
      const action = operated.get(row.rowId);
      if (action?.type === 'outsource') {
        if (action.vendorId !== undefined && action.vendorId !== null) {
          if (!usage.has(action.vendorId)) usage.set(action.vendorId, new Map());
          const amounts = usage.get(action.vendorId);
          for (const [month, minutes] of usageAmounts(row)) {
            amounts.set(month, (amounts.get(month) ?? 0) + minutes);
          }
        }
        continue;
      }
      for (const { bucket, minutes } of row.allocations) {
        if (!displayed(bucket)) continue;
        if (action?.type === 'transfer') {
          addLoad(action.toResourceCd, bucket, minutes / action.efficiencyRatio);
        } else if (action?.type === 'defer' && bucket === action.fromBucket) {
          const next = bucket === 'late' ? months[0] : months[months.indexOf(bucket) + 1];
          if (next !== undefined) addLoad(row.resourceCd, next, minutes);
        } else {
          addLoad(row.resourceCd, bucket, minutes);
        }
      }
    }
    const loadAt = (resourceCd, bucket) => load.get(resourceCd)?.get(bucket) ?? 0;
    const excess = [];
    for (const resource of resources) {
      for (const month of months) {
        const cap = capacity(resource.resourceCd, month);
        if (cap === null || cap === undefined) continue;
        const over = loadAt(resource.resourceCd, month) - cap;
        if (over > 0.5) excess.push({ resourceCd: resource.resourceCd, month, over });
      }
    }
    excess.sort((a, b) => b.over - a.over
      || compare(a.resourceCd, b.resourceCd) || compare(a.month, b.month));
    return { operated, usage, loadAt, excess };
  }

  function cellCandidates(cell, state) {
    return rows.filter((row) => row.resourceCd === cell.resourceCd
      && !state.operated.has(row.rowId) && isCandidate(row)
      && (displayedAmounts(row).get(cell.month) ?? 0) > 0);
  }

  function outsourceUnit(row, vendor, state) {
    if (!isCandidate(row) || state.operated.has(row.rowId) || !matches(row, vendor)) return null;
    const unit = settings.mode === 'part'
      ? rows.filter((other) => partKey(other) === partKey(row) && isCandidate(other)
        && !state.operated.has(other.rowId) && matches(other, vendor))
      : [row];
    const needed = new Map();
    for (const member of unit) {
      for (const [month, minutes] of usageAmounts(member)) {
        needed.set(month, (needed.get(month) ?? 0) + minutes);
      }
    }
    if (vendor.monthlyCapacityMinutes !== null) {
      const allMonths = new Set([...needed.keys(), ...(state.usage.get(vendor.id)?.keys() ?? [])]);
      for (const month of allMonths) {
        const minutes = needed.get(month) ?? 0;
        const used = state.usage.get(vendor.id)?.get(month) ?? 0;
        if (!(used + minutes <= vendor.monthlyCapacityMinutes)) return null;
      }
    }
    return unit.slice().sort((a, b) => compare(a.rowId, b.rowId));
  }

  function transferDestination(row, month, state) {
    const from = resources.find((resource) => resource.resourceCd === row.resourceCd);
    if (!from) return undefined;
    const matchingRules = rules.filter((rule) => rule.fromClassCode === from.classCode
      && Number.isFinite(rule.efficiencyRatio) && rule.efficiencyRatio > 0)
      .slice().sort((a, b) => a.priority - b.priority);
    const seen = new Set();
    const candidates = [];
    const amounts = displayedAmounts(row);
    for (const rule of matchingRules) {
      for (const resource of resources) {
        if (resource.classCode !== rule.toClassCode || resource.resourceCd === row.resourceCd
          || seen.has(resource.resourceCd)) continue;
        seen.add(resource.resourceCd);
        const cap = capacity(resource.resourceCd, month);
        if (cap === null || cap === undefined) continue;
        const spare = cap - state.loadAt(resource.resourceCd, month);
        const fits = spare >= (amounts.get(month) ?? 0) / rule.efficiencyRatio
          && [...amounts].every(([bucket, minutes]) => {
            const bucketCap = capacity(resource.resourceCd, bucket);
            return bucketCap !== null && bucketCap !== undefined
              && state.loadAt(resource.resourceCd, bucket) + minutes / rule.efficiencyRatio <= bucketCap;
          });
        candidates.push({ resourceCd: resource.resourceCd, rule, spare, fits });
      }
    }
    candidates.sort((a, b) => Number(b.fits) - Number(a.fits)
      || a.rule.priority - b.rule.priority || b.spare - a.spare
      || compare(a.resourceCd, b.resourceCd));
    return candidates.find((candidate) => candidate.fits);
  }

  // Stage zero, independently expressed from the named-target specification.
  const reserved = [];
  const initialState = rebuild();
  for (const row of rows) {
    if (!isCandidate(row) || initialState.operated.has(row.rowId)) continue;
    let chosen;
    for (const kind of ['part', 'seiban', 'machine']) {
      const key = kind === 'part' ? partKey(row) : kind === 'seiban' ? row.fseiban.trim() : machineKey(row.machineName);
      chosen = (settings.namedTargets ?? []).find((target) => target.kind === kind && target.key === key);
      if (chosen) break;
    }
    if (!chosen) continue;
    const vendor = settings.vendors.find((item) => item.id === chosen.vendorId);
    if (vendor) reserved.push({ row, vendor });
  }
  reserved.sort((a, b) => a.vendor.priority - b.vendor.priority || compare(a.row.effectiveDueDate, b.row.effectiveDueDate) || compare(a.row.rowId, b.row.rowId));
  for (const { row, vendor } of reserved) {
    const state = rebuild();
    let enough = true;
    for (const [month, minutes] of usageAmounts(row)) {
      if (vendor.monthlyCapacityMinutes !== null && (state.usage.get(vendor.id)?.get(month) ?? 0) + minutes > vendor.monthlyCapacityMinutes) enough = false;
    }
    if (enough) actions.push({ rowId: row.rowId, type: 'outsource', vendorId: vendor.id });
    else blocked.add(row.rowId);
  }

  const cellKey = (cell) => JSON.stringify([cell.resourceCd, cell.month]);
  const processed = new Set();
  let currentKey = null;
  const limit = rows.length + resources.length * months.length + 1;
  for (let iteration = 0; iteration < limit; iteration += 1) {
    const state = rebuild();
    const cell = state.excess.find((item) => cellKey(item) === currentKey)
      ?? state.excess.find((item) => !processed.has(cellKey(item)));
    if (!cell) break;
    currentKey = cellKey(cell);
    const candidates = cellCandidates(cell, state);
    const transferRows = candidates.slice().sort((a, b) => {
      const am = displayedAmounts(a).get(cell.month);
      const bm = displayedAmounts(b).get(cell.month);
      const aEnough = am >= cell.over;
      const bEnough = bm >= cell.over;
      return Number(bEnough) - Number(aEnough)
        || (aEnough ? am - bm : bm - am) || compare(a.rowId, b.rowId);
    });
    let transferred = false;
    for (const row of transferRows) {
      const destination = transferDestination(row, cell.month, state);
      if (destination) {
        actions.push({ rowId: row.rowId, type: 'transfer',
          toResourceCd: destination.resourceCd, efficiencyRatio: destination.rule.efficiencyRatio });
        transferred = true;
        break;
      }
    }
    if (transferred) continue;

    const pairs = [];
    for (const row of candidates) {
      for (const vendor of settings.vendors) {
        if (matches(row, vendor)) pairs.push({ row, vendor });
      }
    }
    pairs.sort((a, b) => {
      for (const key of settings.order) {
        const difference = key === 'due'
          ? compare(a.row.effectiveDueDate, b.row.effectiveDueDate)
          : key === 'minutes' ? b.row.totalMinutes - a.row.totalMinutes
            : a.vendor.priority - b.vendor.priority;
        if (difference) return difference;
      }
      return compare(a.row.rowId, b.row.rowId) || compare(a.vendor.id, b.vendor.id);
    });
    let outsourced = false;
    for (const { row, vendor } of pairs) {
      const unit = outsourceUnit(row, vendor, state);
      if (unit) {
        const groupId = JSON.stringify([vendor.id, unit.map((member) => member.rowId)]);
        for (const member of unit) {
          actions.push({ rowId: member.rowId, type: 'outsource', vendorId: vendor.id, groupId });
        }
        outsourced = true;
        break;
      }
    }
    if (outsourced) continue;
    processed.add(currentKey);
    currentKey = null;
  }

  const finalState = rebuild();
  const noTakerByRow = new Map([...blocked].map((rowId) => [rowId, { rowId, reason: '上限' }]));
  const dueOrder = (a, b) => compare(a.effectiveDueDate, b.effectiveDueDate) || compare(a.rowId, b.rowId);
  for (const cell of finalState.excess) {
    let remaining = cell.over;
    for (const row of cellCandidates(cell, finalState).sort(dueOrder)) {
      if (remaining <= 0.5) break;
      if (settings.vendors.some((vendor) => outsourceUnit(row, vendor, finalState))) continue;
      const reason = settings.vendors.some((vendor) => matches(row, vendor)) ? '上限' : '条件';
      noTakerByRow.set(row.rowId, { rowId: row.rowId, reason });
      remaining -= displayedAmounts(row).get(cell.month);
    }
  }
  const noTaker = [...noTakerByRow.values()].sort((a, b) =>
    dueOrder(rows.find((row) => row.rowId === a.rowId), rows.find((row) => row.rowId === b.rowId)));
  return { actions, noTaker };
}
