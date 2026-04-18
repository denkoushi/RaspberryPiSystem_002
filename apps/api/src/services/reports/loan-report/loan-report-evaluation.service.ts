import type { LoanAnalyticsPeriodEventRow } from '@raspi-system/shared-types';
import type {
  LoanReportCategoryKey,
  LoanReportCategoryLabelJa,
  LoanReportViewModel,
} from './loan-report.types.js';
import type { LoanReportNormalizedAnalytics } from './loan-report-aggregate.service.js';

const CATEGORY_META: Record<
  LoanReportCategoryKey,
  { label: LoanReportCategoryLabelJa; accent: string }
> = {
  measuring: { label: '計測機器', accent: '#3b82f6' },
  rigging: { label: '吊具', accent: '#8b5cf6' },
  tools: { label: '道具', accent: '#06b6d4' },
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

function shortLabel(text: string, maxLen: number): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1))}…`;
}

function buildReportId(generatedAt: Date): string {
  const pad = (x: number) => String(x).padStart(2, '0');
  const y = generatedAt.getFullYear();
  const m = pad(generatedAt.getMonth() + 1);
  const d = pad(generatedAt.getDate());
  const hh = pad(generatedAt.getHours());
  const mm = pad(generatedAt.getMinutes());
  const ss = pad(generatedAt.getSeconds());
  return `RPT-${y}${m}${d}-${hh}${mm}${ss}`;
}

function formatMetaLine(params: {
  periodFrom: string;
  periodTo: string;
  site?: string;
  author?: string;
  generatedAtIso: string;
}): string {
  const site = params.site?.trim() ? params.site.trim() : '（拠点未指定）';
  const author = params.author?.trim() ? params.author.trim() : '（作成者未指定）';
  const from = params.periodFrom.slice(0, 10);
  const to = params.periodTo.slice(0, 10);
  const at = params.generatedAtIso.replace('T', ' ').slice(0, 19);
  return `${from} ～ ${to} / ${site} / 作成: ${author} / ${at}`;
}

/**
 * 需給・遵守スコアおよびレポート用ビューモデルを組み立てる。
 */
export class LoanReportEvaluationService {
  buildViewModel(params: {
    category: LoanReportCategoryKey;
    normalized: LoanReportNormalizedAnalytics;
    site?: string;
    author?: string;
  }): LoanReportViewModel {
    const { category, normalized } = params;
    const meta = CATEGORY_META[category];

    const summary =
      normalized.kind === 'measuring'
        ? {
            openLoanCount: normalized.response.summary.openLoanCount,
            overdueOpenCount: normalized.response.summary.overdueOpenCount,
            totalActive: normalized.response.summary.totalInstrumentsActive,
            periodBorrowCount: normalized.response.summary.periodBorrowCount,
            periodReturnCount: normalized.response.summary.periodReturnCount,
          }
        : normalized.kind === 'rigging'
          ? {
              openLoanCount: normalized.response.summary.openLoanCount,
              overdueOpenCount: normalized.response.summary.overdueOpenCount,
              totalActive: normalized.response.summary.totalRiggingGearsActive,
              periodBorrowCount: normalized.response.summary.periodBorrowCount,
              periodReturnCount: normalized.response.summary.periodReturnCount,
            }
          : {
              openLoanCount: normalized.response.summary.openLoanCount,
              overdueOpenCount: normalized.response.summary.overdueOpenCount,
              totalActive: normalized.response.summary.totalItemsActive,
              periodBorrowCount: normalized.response.summary.periodBorrowCount,
              periodReturnCount: normalized.response.summary.periodReturnCount,
            };

    const generatedAt = new Date(normalized.response.meta.generatedAt);
    const reportId = buildReportId(generatedAt);

    const returnRate =
      summary.periodBorrowCount > 0
        ? clamp((summary.periodReturnCount / summary.periodBorrowCount) * 100, 0, 100)
        : 100;

    const utilization =
      summary.totalActive > 0 ? clamp((summary.openLoanCount / summary.totalActive) * 100, 0, 100) : 0;

    const overdueRate =
      summary.openLoanCount > 0 ? clamp((summary.overdueOpenCount / summary.openLoanCount) * 100, 0, 100) : 0;

    const demandIntensity =
      summary.totalActive > 0
        ? clamp((summary.periodBorrowCount / summary.totalActive) * 100, 0, 200)
        : 0;
    const availableCount = Math.max(0, summary.totalActive - summary.openLoanCount);

    // 需給は合成スコアではなく、現時点の利用率を主指標とする。
    const supplyScore = utilization;

    let supplyState: string;
    let supplyTag: LoanReportViewModel['supply']['tagClass'];
    if (supplyScore < 35) {
      supplyState = '余裕あり';
      supplyTag = 'tag-ok';
    } else if (supplyScore < 60) {
      supplyState = '概ね適正';
      supplyTag = 'tag-ok';
    } else if (supplyScore < 80) {
      supplyState = 'やや逼迫';
      supplyTag = 'tag-warn';
    } else {
      supplyState = '逼迫';
      supplyTag = 'tag-bad';
    }

    // 遵守は期間内の返却完了率を主指標とし、超過率は別チップで明示する。
    const complianceScore = returnRate;

    let complianceState: string;
    let complianceTag: LoanReportViewModel['compliance']['tagClass'];
    if (complianceScore >= 86) {
      complianceState = '良好';
      complianceTag = 'tag-ok';
    } else if (complianceScore >= 72) {
      complianceState = '注意';
      complianceTag = 'tag-warn';
    } else {
      complianceState = '要改善';
      complianceTag = 'tag-bad';
    }

    const periodMs = Math.max(
      1,
      new Date(normalized.response.meta.periodTo).getTime() -
        new Date(normalized.response.meta.periodFrom).getTime()
    );
    const periodDays = periodMs / (24 * 60 * 60 * 1000);
    const avgDailyBorrow = summary.periodBorrowCount / periodDays;
    const safetyCoverDays = avgDailyBorrow > 0 ? availableCount / avgDailyBorrow : availableCount;

    const monthly = normalized.response.monthlyTrend;
    const borrowSeries = monthly.map((m) => m.borrowCount);
    const avgBorrow =
      borrowSeries.length > 0 ? borrowSeries.reduce((a, b) => a + b, 0) / borrowSeries.length : 0;
    const peakBorrow = borrowSeries.length > 0 ? Math.max(...borrowSeries) : 0;
    const peakLoadPct = avgBorrow > 0 ? clamp((peakBorrow / avgBorrow) * 100, 0, 150) : 0;

    const assetRows =
      normalized.kind === 'measuring'
        ? normalized.response.byInstrument.map((r) => ({
            id: r.instrumentId,
            groupLabel: r.name.trim() || r.managementNumber.trim() || '計測機器',
            detailLabel: `${r.managementNumber} ${r.name}`.trim(),
            periodBorrowCount: r.periodBorrowCount,
            isOutNow: r.isOutNow,
            openIsOverdue: r.openIsOverdue,
          }))
        : normalized.kind === 'rigging'
          ? normalized.response.byGear.map((r) => ({
              id: r.gearId,
              groupLabel: r.name.trim() || r.managementNumber.trim() || '吊具',
              detailLabel: `${r.managementNumber} ${r.name}`.trim(),
              periodBorrowCount: r.periodBorrowCount,
              isOutNow: r.isOutNow,
              openIsOverdue: r.openIsOverdue,
            }))
          : normalized.response.byItem.map((r) => ({
              id: r.itemId,
              groupLabel: r.name.trim() || r.itemCode.trim() || '道具',
              detailLabel: `${r.itemCode} ${r.name}`.trim(),
              periodBorrowCount: r.periodBorrowCount,
              isOutNow: r.isOutNow,
              openIsOverdue: r.openIsOverdue,
            }));

    const groupedAssets = Array.from(
      assetRows.reduce((map, row) => {
        const existing = map.get(row.groupLabel) ?? {
          label: row.groupLabel,
          assetIds: [] as string[],
          assetCount: 0,
          availableCount: 0,
          overdueCount: 0,
          periodBorrowCount: 0,
          detailLabels: [] as string[],
        };
        existing.assetIds.push(row.id);
        existing.assetCount += 1;
        existing.availableCount += row.isOutNow ? 0 : 1;
        existing.overdueCount += row.openIsOverdue ? 1 : 0;
        existing.periodBorrowCount += row.periodBorrowCount;
        if (existing.detailLabels.length < 3) {
          existing.detailLabels.push(row.detailLabel);
        }
        map.set(row.groupLabel, existing);
        return map;
      }, new Map<string, {
        label: string;
        assetIds: string[];
        assetCount: number;
        availableCount: number;
        overdueCount: number;
        periodBorrowCount: number;
        detailLabels: string[];
      }>())
    ).map(([, value]) => value);

    const topItems = [...groupedAssets]
      .sort((a, b) => b.periodBorrowCount - a.periodBorrowCount || b.assetCount - a.assetCount)
      .slice(0, 5);

    const totalBorrowForShare = groupedAssets.reduce((s, r) => s + r.periodBorrowCount, 0);
    const top5Share =
      totalBorrowForShare > 0
        ? (topItems.reduce((s, r) => s + r.periodBorrowCount, 0) / totalBorrowForShare) * 100
        : 0;

    const itemAxis = topItems.map((row) => {
      return {
        name: shortLabel(row.label, 22),
        demand: row.periodBorrowCount,
        stock: row.availableCount,
      };
    });

    const employeeRows =
      normalized.kind === 'measuring'
        ? normalized.response.byEmployee.map((e) => ({
            employeeId: e.employeeId,
            displayName: e.displayName,
            open: e.openInstrumentCount,
            overdue: e.overdueOpenInstrumentCount,
            periodBorrowCount: e.periodBorrowCount,
            periodReturnCount: e.periodReturnCount,
          }))
        : normalized.kind === 'rigging'
          ? normalized.response.byEmployee.map((e) => ({
              employeeId: e.employeeId,
              displayName: e.displayName,
              open: e.openRiggingCount,
              overdue: e.overdueOpenRiggingCount,
              periodBorrowCount: e.periodBorrowCount,
              periodReturnCount: e.periodReturnCount,
            }))
          : normalized.response.byEmployee.map((e) => ({
              employeeId: e.employeeId,
              displayName: e.displayName,
              open: e.openItemCount,
              overdue: e.overdueOpenItemCount,
              periodBorrowCount: e.periodBorrowCount,
              periodReturnCount: e.periodReturnCount,
            }));

    const topForPeople = [...employeeRows].sort((a, b) => b.periodBorrowCount - a.periodBorrowCount).slice(0, 5);
    const topPeople = topForPeople.map((p) => ({
      name: shortLabel(p.displayName, 10),
      borrowed: p.periodBorrowCount,
      returned: p.periodReturnCount,
      open: p.open,
      overdue: p.overdue,
    }));

    const cross = this.buildCrossHeatmap({
      events: normalized.response.periodEvents,
      itemLabels: itemAxis.map((i) => shortLabel(i.name, 6)),
      personNames: topPeople.map((p) => p.name),
      periodFrom: normalized.response.meta.periodFrom,
      periodTo: normalized.response.meta.periodTo,
      topAssetGroups: topItems.map((t) => ({ label: t.label, assetIds: t.assetIds })),
      topEmployeeIds: topForPeople.map((e) => e.employeeId),
    });

    const trend = this.buildTrend(monthly, supplyScore, complianceScore);

    const findings = this.buildFindings({
      supplyState,
      supplyScore,
      complianceState,
      complianceScore,
      trendLabel: trend.labels,
      returnRate,
      overdueRate,
      utilization,
      overdueOpenCount: summary.overdueOpenCount,
      openLoanCount: summary.openLoanCount,
      availableCount,
    });

    return {
      key: category,
      category: meta.label,
      accent: meta.accent,
      pageLabel: `単票レポート — ${meta.label}`,
      reportId,
      meta: formatMetaLine({
        periodFrom: normalized.response.meta.periodFrom,
        periodTo: normalized.response.meta.periodTo,
        site: params.site,
        author: params.author,
        generatedAtIso: normalized.response.meta.generatedAt,
      }),
      metrics: {
        assets: summary.totalActive,
        out: summary.periodBorrowCount,
        returned: summary.periodReturnCount,
        open: summary.openLoanCount,
        overdue: summary.overdueOpenCount,
        returnRate: Math.round(returnRate),
      },
      supply: {
        score: Math.round(supplyScore),
        state: supplyState,
        tagClass: supplyTag,
        chips: [
          { k: '安全在庫カバー', v: `${safetyCoverDays.toFixed(1)}日` },
          { k: '即時利用可能', v: `${availableCount}点` },
          { k: '需要密度', v: pct(demandIntensity) },
          { k: 'ピーク負荷', v: pct(peakLoadPct) },
          { k: 'TOP5集中度', v: pct(top5Share) },
        ],
      },
      compliance: {
        score: Math.round(complianceScore),
        state: complianceState,
        tagClass: complianceTag,
        chips: [
          { k: '期限遵守率', v: pct(100 - overdueRate) },
          { k: '超過件数', v: `${summary.overdueOpenCount}件` },
          { k: '返却/持出', v: `${summary.periodReturnCount}/${summary.periodBorrowCount}` },
        ],
      },
      itemAxis,
      personAxis: topPeople,
      cross,
      trend,
      findings,
    };
  }

  private buildTrend(
    monthly: Array<{ yearMonth: string; borrowCount: number; returnCount: number }>,
    lastSupplyScore: number,
    lastComplianceScore: number
  ): LoanReportViewModel['trend'] {
    const demand = monthly.map((m) => m.borrowCount);
    const compliance = monthly.map((m) => {
      if (m.borrowCount <= 0) return 100;
      return clamp((m.returnCount / m.borrowCount) * 100, 0, 100);
    });

    const labels = monthly.map((m) => shortLabel(m.yearMonth.replace('-', '/'), 7));

    const d = demand.length > 0 ? demand : [Math.round(lastSupplyScore)];
    const c = compliance.length > 0 ? compliance : [Math.round(lastComplianceScore)];
    const l = labels.length > 0 ? labels : ['今'];

    return { demand: d, compliance: c, labels: l };
  }

  private buildFindings(params: {
    supplyState: string;
    supplyScore: number;
    complianceState: string;
    complianceScore: number;
    trendLabel: string[];
    returnRate: number;
    overdueRate: number;
    utilization: number;
    overdueOpenCount: number;
    openLoanCount: number;
    availableCount: number;
  }): LoanReportViewModel['findings'] {
    const overallCls: LoanReportViewModel['findings']['overall']['cls'] =
      params.supplyScore >= 80 || params.complianceScore < 72 || params.overdueRate > 20
        ? 'bad'
        : params.supplyScore >= 60 || params.overdueRate > 0
          ? 'warn'
          : 'good';

    const overallText =
      params.complianceScore < 72 || params.overdueRate > 20
        ? '遵守面に課題'
        : params.supplyScore >= 80
          ? '需給が逼迫'
          : params.supplyScore >= 60
            ? '需給はやや逼迫'
            : '需給は安定';

    const last = params.trendLabel[params.trendLabel.length - 1] ?? '';
    const trendCls: LoanReportViewModel['findings']['trend']['cls'] =
      params.supplyScore >= 80 && params.complianceScore < 80 ? 'bad' : params.supplyScore >= 60 ? 'warn' : 'good';
    const trendText =
      params.supplyScore >= 80 && params.returnRate < 85
        ? '高負荷で要監視'
        : params.supplyScore >= 60
          ? 'やや高負荷'
          : '安定';

    const body = [
      `利用率は ${Math.round(params.utilization)}% で、即時利用可能は ${params.availableCount} 点です。`,
      `返却完了率は ${Math.round(params.returnRate)}%、未返却 ${params.openLoanCount} 件のうち期限超過は ${params.overdueOpenCount} 件です。`,
      `月次系列（${last} まで）は持出件数と返却率の実測推移を表示しています。`,
    ].join('');

    return {
      overall: { text: overallText, cls: overallCls },
      trend: { text: trendText, cls: trendCls },
      body,
    };
  }

  private buildCrossHeatmap(params: {
    events: LoanAnalyticsPeriodEventRow[];
    itemLabels: string[];
    personNames: string[];
    periodFrom: string;
    periodTo: string;
    topAssetGroups: Array<{ label: string; assetIds: string[] }>;
    topEmployeeIds: string[];
  }): LoanReportViewModel['cross'] {
    const from = new Date(params.periodFrom).getTime();
    const to = new Date(params.periodTo).getTime();
    const rows = params.topEmployeeIds.length;
    const cols = params.topAssetGroups.length;
    const values = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));

    const assetIndex = new Map<string, number>();
    params.topAssetGroups.forEach((group, i) => {
      group.assetIds.forEach((assetId) => {
        assetIndex.set(assetId, i);
      });
    });
    const personIndex = new Map(params.topEmployeeIds.map((id, i) => [id, i]));

    for (const ev of params.events) {
      if (ev.kind !== 'BORROW') continue;
      const t = new Date(ev.eventAt).getTime();
      if (t < from || t > to) continue;
      const ci = assetIndex.get(ev.assetId);
      const ri = ev.actorEmployeeId ? personIndex.get(ev.actorEmployeeId) : undefined;
      if (ci === undefined || ri === undefined) continue;
      values[ri][ci] += 1;
    }

    return {
      x: params.itemLabels.slice(0, cols),
      y: params.personNames.slice(0, rows),
      values,
    };
  }
}
