import type { LoadBalancingRowCandidate, LoadBalancingSuggestionItem } from './types.js';

export type TransferRuleInput = {
  fromClassCode: string;
  toClassCode: string;
  priority: number;
  enabled: boolean;
  efficiencyRatio: number;
};

const EPS = 1e-6;

function buildResourcesByClass(classEntries: Map<string, string>): Map<string, string[]> {
  const byClass = new Map<string, string[]>();
  for (const [resourceCd, classCode] of classEntries) {
    const list = byClass.get(classCode) ?? [];
    list.push(resourceCd);
    byClass.set(classCode, list);
  }
  for (const list of byClass.values()) {
    list.sort((a, b) => a.localeCompare(b));
  }
  return byClass;
}

export function computeLoadBalancingSuggestions(params: {
  overviewResources: Array<{ resourceCd: string; requiredMinutes: number; availableMinutes: number | null }>;
  rows: LoadBalancingRowCandidate[];
  classes: Map<string, string>;
  rules: TransferRuleInput[];
  maxSuggestions: number;
  overResourceFilter?: Set<string>;
}): LoadBalancingSuggestionItem[] {
  const simReq = new Map<string, number>();
  const availEff = new Map<string, number>();
  for (const res of params.overviewResources) {
    simReq.set(res.resourceCd, res.requiredMinutes);
    availEff.set(res.resourceCd, res.availableMinutes ?? 0);
  }

  const resourcesByClass = buildResourcesByClass(params.classes);
  const enabledRules = params.rules
    .filter((rule) => rule.enabled)
    .sort((a, b) => {
      const pr = a.priority - b.priority;
      if (pr !== 0) return pr;
      const fc = a.fromClassCode.localeCompare(b.fromClassCode);
      if (fc !== 0) return fc;
      return a.toClassCode.localeCompare(b.toClassCode);
    });

  const sortedRows = [...params.rows].sort((a, b) => b.requiredMinutes - a.requiredMinutes);
  const suggestions: LoadBalancingSuggestionItem[] = [];

  for (const row of sortedRows) {
    if (suggestions.length >= params.maxSuggestions) break;

    const fromRc = row.resourceCd;
    if (params.overResourceFilter && !params.overResourceFilter.has(fromRc)) continue;

    const effAvailFrom = availEff.get(fromRc) ?? 0;
    const currentReqFrom = simReq.get(fromRc) ?? 0;
    if (currentReqFrom <= effAvailFrom + EPS) continue;

    const classFrom = params.classes.get(fromRc);
    if (!classFrom) continue;

    const applicableRules = enabledRules.filter((rule) => rule.fromClassCode === classFrom);
    let picked: { destRc: string; rule: TransferRuleInput; burden: number } | null = null;

    for (const rule of applicableRules) {
      const destCandidates = resourcesByClass.get(rule.toClassCode) ?? [];
      const sortedDest = [...destCandidates]
        .filter((rc) => rc !== fromRc)
        .sort((a, b) => {
          const spareA = (availEff.get(a) ?? 0) - (simReq.get(a) ?? 0);
          const spareB = (availEff.get(b) ?? 0) - (simReq.get(b) ?? 0);
          if (spareB !== spareA) return spareB - spareA;
          return a.localeCompare(b);
        });

      for (const destRc of sortedDest) {
        const burden = row.requiredMinutes / rule.efficiencyRatio;
        const spare = (availEff.get(destRc) ?? 0) - (simReq.get(destRc) ?? 0);
        if (spare + EPS < burden) continue;
        picked = { destRc, rule, burden };
        break;
      }
      if (picked) break;
    }

    if (!picked) continue;

    const { destRc, rule, burden } = picked;
    const reduction = row.requiredMinutes;

    simReq.set(fromRc, (simReq.get(fromRc) ?? 0) - row.requiredMinutes);
    simReq.set(destRc, (simReq.get(destRc) ?? 0) + burden);

    suggestions.push({
      rowId: row.rowId,
      fseiban: row.fseiban,
      productNo: row.productNo,
      fhincd: row.fhincd,
      fkojun: row.fkojun,
      resourceCdFrom: fromRc,
      resourceCdTo: destRc,
      rowMinutes: row.requiredMinutes,
      estimatedReductionMinutesOnSource: reduction,
      estimatedBurdenMinutesOnDestination: burden,
      simulatedSourceOverAfter: Math.max(0, (simReq.get(fromRc) ?? 0) - (availEff.get(fromRc) ?? 0)),
      simulatedDestinationOverAfter: Math.max(0, (simReq.get(destRc) ?? 0) - (availEff.get(destRc) ?? 0)),
      rulePriority: rule.priority,
      fromClassCode: rule.fromClassCode,
      toClassCode: rule.toClassCode,
      efficiencyRatio: rule.efficiencyRatio
    });
  }

  return suggestions;
}
