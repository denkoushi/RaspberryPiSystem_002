import type { LoanAnalyticsPeriodEventRow } from '@raspi-system/shared-types';
import type {
  LoanReportCategoryKey,
  LoanReportCategoryLabelJa,
  LoanReportSupplyBottleneckRow,
  LoanReportSupplyGroupTimeseries,
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

/** analytics 月次バケットと揃える（meta.timeZone の IANA 名を想定） */
function isoToYearMonth(iso: string, timeZone: string): string {
  const d = new Date(iso);
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    if (!y || !m) return '';
    return `${y}-${m.padStart(2, '0')}`;
  } catch {
    const utc = new Date(iso);
    return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}`;
  }
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

    const hasPeriodBorrow = summary.periodBorrowCount > 0;
    const effectivePeriodReturnCount = hasPeriodBorrow
      ? Math.min(summary.periodReturnCount, summary.periodBorrowCount)
      : 0;
    const returnRate = hasPeriodBorrow
      ? clamp((summary.periodReturnCount / summary.periodBorrowCount) * 100, 0, 100)
      : 0;

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

    // 遵守は返却完了率と期限内率の双方を満たす必要があるため、低い方で評価する。
    const onTimeRate = clamp(100 - overdueRate, 0, 100);
    const hasOpenLoanForOnTimeRate = summary.openLoanCount > 0;
    const complianceScore = Math.min(returnRate, onTimeRate);
    const hasAnyLoanActivity = summary.periodBorrowCount > 0 || summary.openLoanCount > 0;

    let complianceState: string;
    let complianceTag: LoanReportViewModel['compliance']['tagClass'];
    if (!hasAnyLoanActivity) {
      complianceState = 'データなし';
      complianceTag = 'tag-warn';
    } else if (complianceScore >= 86) {
      complianceState = '良好';
      complianceTag = 'tag-ok';
    } else if (complianceScore >= 72) {
      complianceState = '注意';
      complianceTag = 'tag-warn';
    } else {
      complianceState = '要改善';
      complianceTag = 'tag-bad';
    }

    const periodMs =
      new Date(normalized.response.meta.periodTo).getTime() -
      new Date(normalized.response.meta.periodFrom).getTime();
    const periodDays = Math.max(1, Math.ceil(periodMs / (24 * 60 * 60 * 1000)));
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

    const assetIdToGroup = new Map(assetRows.map((r) => [r.id, r.groupLabel]));
    const timeZone = normalized.response.meta.timeZone;
    let groupTimeseries: LoanReportSupplyGroupTimeseries | null = null;
    if (monthly.length > 0 && topItems.length > 0) {
      const raw = this.buildSupplyGroupTimeseries({
        monthly,
        periodEvents: normalized.response.periodEvents,
        assetIdToGroup,
        focusLabel: topItems[0].label,
        periodFrom: normalized.response.meta.periodFrom,
        periodTo: normalized.response.meta.periodTo,
        timeZone,
      });
      groupTimeseries = this.fillSupplyGroupBorrowMonthFromTotalsWhenNoEvents({
        ts: raw,
        monthly,
        topGroupPeriodBorrows: topItems[0].periodBorrowCount,
      });
    }
    const bottleneckTop2: LoanReportSupplyBottleneckRow[] = this.buildSupplyBottleneckTop2(groupedAssets);

    const totalBorrowForShare = groupedAssets.reduce((s, r) => s + r.periodBorrowCount, 0);
    const top5Share =
      totalBorrowForShare > 0
        ? (topItems.reduce((s, r) => s + r.periodBorrowCount, 0) / totalBorrowForShare) * 100
        : 0;

    const itemAxis = topItems.map((row) => {
      const unitsTotal = row.assetCount;
      const unitsOut = Math.max(0, unitsTotal - row.availableCount);
      return {
        name: shortLabel(row.label, 22),
        demand: row.periodBorrowCount,
        stock: row.availableCount,
        unitsTotal,
        unitsOut,
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

    const safetyStrain = clamp(100 - Math.min(safetyCoverDays * (100 / 14), 100), 0, 100);
    const demandStrain = clamp(demandIntensity / 2, 0, 100);
    const peakStrain = clamp((peakLoadPct / 150) * 100, 0, 100);
    const topStrain = clamp(top5Share, 0, 100);
    const vitalsSparkPct: [number, number, number, number, number] = [
      Math.round(safetyStrain),
      Math.round(utilization),
      Math.round(demandStrain),
      Math.round(peakStrain),
      Math.round(topStrain),
    ];

    const slackPct = Math.round(
      summary.totalActive > 0 ? (availableCount / summary.totalActive) * 100 : 0
    );
    const pressurePct = Math.round(
      clamp(
        (demandIntensity / 2) * 0.4 + (peakLoadPct / 150) * 100 * 0.35 + top5Share * 0.25,
        0,
        100
      )
    );
    const balanceViz = { slackPct, pressurePct };

    const findings = this.buildFindings({
      supplyState,
      supplyScore,
      complianceState,
      complianceScore,
      trendLabel: trend.labels,
      displayReturnRate: complianceScore,
      periodBorrowCount: summary.periodBorrowCount,
      periodReturnCount: summary.periodReturnCount,
      overdueRate,
      utilization,
      overdueOpenCount: summary.overdueOpenCount,
      openLoanCount: summary.openLoanCount,
      availableCount,
      safetyCoverDays,
      demandIntensity,
      peakLoadPct,
      top5Share,
      slackPct,
      pressurePct,
      supplyFocusLabel: groupTimeseries?.groupLabel ?? null,
      bottleneckTop2,
    });
    const metricsReturnRate = Math.round(complianceScore);

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
        returned: effectivePeriodReturnCount,
        open: summary.openLoanCount,
        overdue: summary.overdueOpenCount,
        returnRate: metricsReturnRate,
      },
      supply: {
        score: Math.round(supplyScore),
        state: supplyState,
        tagClass: supplyTag,
        vitalsSparkPct,
        balanceViz,
        chips: [
          { k: '安全在庫カバー', v: `${safetyCoverDays.toFixed(1)}日` },
          { k: '即時利用可能', v: `${availableCount}点` },
          { k: '需要密度', v: pct(demandIntensity) },
          { k: 'ピーク負荷', v: pct(peakLoadPct) },
          { k: 'TOP5集中度', v: pct(top5Share) },
        ],
        groupTimeseries,
        bottleneckTop2,
      },
      compliance: {
        score: Math.round(complianceScore),
        state: complianceState,
        tagClass: complianceTag,
        chips: [
          { k: '期限遵守率', v: hasOpenLoanForOnTimeRate ? pct(onTimeRate) : 'N/A' },
          { k: '超過件数', v: `${summary.overdueOpenCount}件` },
          { k: '返却/持出', v: `${effectivePeriodReturnCount}/${summary.periodBorrowCount}` },
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
      if (m.borrowCount <= 0) return 0;
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
    displayReturnRate: number;
    periodBorrowCount: number;
    periodReturnCount: number;
    overdueRate: number;
    utilization: number;
    overdueOpenCount: number;
    openLoanCount: number;
    availableCount: number;
    safetyCoverDays: number;
    demandIntensity: number;
    peakLoadPct: number;
    top5Share: number;
    slackPct: number;
    pressurePct: number;
    supplyFocusLabel: string | null;
    bottleneckTop2: LoanReportSupplyBottleneckRow[];
  }): LoanReportViewModel['findings'] {
    const hasAnyLoanActivity = params.periodBorrowCount > 0 || params.openLoanCount > 0;
    if (!hasAnyLoanActivity) {
      const last = params.trendLabel[params.trendLabel.length - 1] ?? '';
      return {
        overall: { text: '判定保留', cls: 'warn' },
        trend: { text: 'データなし', cls: 'warn' },
        body: [
          `【需給】左ペインのツリーマップは名寄せ群ごとの即時持出/台数（セル面積は持出の強さ）。即時余力 ${params.slackPct}、需要圧 ${params.pressurePct}。利用率 ${Math.round(params.utilization)}%、即時利用可能 ${params.availableCount} 点。`,
          '【遵守】期間内に持出・返却・未返却がないため判定保留。',
          `【図表】アイテム／人／ヒート／時系列の読み方は所見のみ。月次 ${last} まで。`,
        ].join('\n\n'),
      };
    }

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
      params.supplyScore >= 80 && params.displayReturnRate < 85
        ? '高負荷で要監視'
        : params.supplyScore >= 60
          ? 'やや高負荷'
          : '安定';

    const supplyAuxParts: string[] = [];
    if (params.supplyFocusLabel) {
      supplyAuxParts.push(
        `名寄せ「${shortLabel(params.supplyFocusLabel, 14)}」は左ツリーマップでも面積が大きく出やすい（期間持出が集中しやすい群）。`
      );
    }
    if (params.bottleneckTop2.length > 0) {
      supplyAuxParts.push(
        `需給が詰まりやすい名寄せは ${params.bottleneckTop2
          .map((b) => `「${b.label}」（期間 ${b.periodBorrows} 件・即時 ${b.availableNow} 台）`)
          .join('、')}。`
      );
    }
    const supplyAux = supplyAuxParts.length > 0 ? supplyAuxParts.join('') : '';

    const body = [
      `【需給・過不足】左のツリーマップは名寄せTOPをセルで表示（各セル＝持出中/台数、面積∝深刻度）。数値の補足: 即時余力 ${params.slackPct}、需要圧 ${params.pressurePct}。利用率 ${Math.round(params.utilization)}%、即時利用可能 ${params.availableCount} 点。${supplyAux}`,
      `【遵守】スコア ${Math.round(params.complianceScore)} は期間内返却の総合。期限遵守・超過・返却/持出は右チップ。未返却 ${params.openLoanCount} 件のうち期限超過 ${params.overdueOpenCount} 件。`,
      `【図表】アイテム軸＝需要帯と即時在庫線、人軸＝借用者別実件、ヒート＝人×物の集中、時系列＝月別持出と返却率。月次は ${last} まで。`,
    ].join('\n\n');

    return {
      overall: { text: overallText, cls: overallCls },
      trend: { text: trendText, cls: trendCls },
      body,
    };
  }

  private buildSupplyGroupTimeseries(params: {
    monthly: Array<{ yearMonth: string; borrowCount: number; returnCount: number }>;
    periodEvents: LoanAnalyticsPeriodEventRow[];
    assetIdToGroup: Map<string, string>;
    focusLabel: string;
    periodFrom: string;
    periodTo: string;
    timeZone: string;
  }): LoanReportSupplyGroupTimeseries {
    const { monthly, periodEvents, assetIdToGroup, focusLabel, periodFrom, periodTo, timeZone } = params;
    const borrowByMonth = monthly.map(() => 0);
    const totalBorrowByMonth = monthly.map((m) => m.borrowCount);
    const from = new Date(periodFrom).getTime();
    const to = new Date(periodTo).getTime();

    for (const ev of periodEvents) {
      if (ev.kind !== 'BORROW') continue;
      const t = new Date(ev.eventAt).getTime();
      if (t < from || t > to) continue;
      if (assetIdToGroup.get(ev.assetId) !== focusLabel) continue;
      const ym = isoToYearMonth(ev.eventAt, timeZone);
      const idx = monthly.findIndex((m) => m.yearMonth === ym);
      if (idx >= 0) borrowByMonth[idx] += 1;
    }

    return { groupLabel: focusLabel, borrowByMonth, totalBorrowByMonth };
  }

  /**
   * periodEvents が空・または該当群の月別が取れないとき、
   * 名寄せ群の期間合計持出件数を月次全体の形（比率）に按分してミニ経時を成立させる。
   */
  private fillSupplyGroupBorrowMonthFromTotalsWhenNoEvents(params: {
    ts: LoanReportSupplyGroupTimeseries;
    monthly: Array<{ yearMonth: string; borrowCount: number; returnCount: number }>;
    topGroupPeriodBorrows: number;
  }): LoanReportSupplyGroupTimeseries {
    const sumEvents = params.ts.borrowByMonth.reduce((a, b) => a + b, 0);
    if (sumEvents > 0) return params.ts;
    const cap = Math.max(0, params.topGroupPeriodBorrows);
    if (cap === 0) return params.ts;
    const mSum = params.monthly.reduce((a, m) => a + m.borrowCount, 0);
    if (mSum <= 0) return params.ts;
    const borrowByMonth = params.monthly.map((m) => Math.round(cap * (m.borrowCount / mSum)));
    let drift = cap - borrowByMonth.reduce((a, b) => a + b, 0);
    if (drift !== 0 && borrowByMonth.length > 0) {
      borrowByMonth[borrowByMonth.length - 1] += drift;
    }
    return { ...params.ts, borrowByMonth };
  }

  private buildSupplyBottleneckTop2(
    groupedAssets: Array<{
      label: string;
      detailLabels: string[];
      periodBorrowCount: number;
      availableCount: number;
    }>
  ): LoanReportSupplyBottleneckRow[] {
    const candidates = groupedAssets.filter((g) => g.periodBorrowCount > 0);
    return [...candidates]
      .map((g) => ({
        g,
        strain: g.periodBorrowCount / Math.max(1, g.availableCount),
      }))
      .sort(
        (a, b) =>
          b.strain - a.strain ||
          b.g.periodBorrowCount - a.g.periodBorrowCount ||
          b.g.availableCount - a.g.availableCount
      )
      .slice(0, 2)
      .map(({ g }) => ({
        label: shortLabel(g.label, 16),
        detail: shortLabel(g.detailLabels[0] ?? g.label, 18),
        periodBorrows: g.periodBorrowCount,
        availableNow: g.availableCount,
      }));
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
