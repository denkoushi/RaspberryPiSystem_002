/**
 * Load reconciliation vs production (multi-pattern).
 * Env: RECONCILE_RESOURCE (default 033), RECONCILE_YEAR_MONTH (2026-05),
 *      RECONCILE_REMAIN_H, RECONCILE_CONSUMED_H
 * Run: docker compose exec -T -w /app/apps/api api node scripts/reconcile-033-may-patterns.mjs
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../dist/lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../dist/services/production-schedule/constants.js';
import { buildMaxProductNoWinnerCondition } from '../dist/services/production-schedule/row-resolver/index.js';
import { buildFkojunstProductionScheduleListVisibilityWhereSql } from '../dist/services/production-schedule/policies/fkojunst-production-schedule-list-visibility.policy.js';
import { buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql } from '../dist/services/production-schedule/completion/fkojunst-mail-status-completion.policy.js';
import { buildProductionScheduleEffectiveCompletedSql } from '../dist/services/production-schedule/production-schedule-effective-completion.sql.js';
import { buildLoadBalancingRowEligibilityWhereSql } from '../dist/services/production-schedule/load-balancing/load-balancing-eligibility.policy.js';
import {
  getResourceCategoryPolicy,
  isProductionScheduleExcludedCuttingResourceCd,
  normalizeProductionScheduleResourceCd
} from '../dist/services/production-schedule/policies/resource-category-policy.service.js';
import { distributeRowLoadEvenly } from '../dist/services/production-schedule/load-balancing/load-distribution.js';
import { buildWorkCalendarModeMap, listLoadBalancingWorkCalendars } from '../dist/services/production-schedule/load-balancing/load-balancing-settings.service.js';

const RESOURCE = process.env.RECONCILE_RESOURCE ?? '033';
const YEAR_MONTH = process.env.RECONCILE_YEAR_MONTH ?? '2026-05';
const SITE_KEY = '第2工場';
const DEVICE_SCOPE = 'mac';
const PROD = {
  consumedH: Number(process.env.RECONCILE_CONSUMED_H ?? '301'),
  remainH: Number(process.env.RECONCILE_REMAIN_H ?? '95')
};

function parseTargetMonthRange(yearMonth) {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim());
  if (!m) throw new Error(`invalid RECONCILE_YEAR_MONTH: ${yearMonth}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return {
    monthStart: new Date(Date.UTC(y, mo - 1, 1)),
    monthEndExclusive: new Date(Date.UTC(y, mo, 1)),
    rangeStart: new Date(Date.UTC(y, mo - 2, 1)),
    rangeEnd: new Date(Date.UTC(y, mo + 1, 1))
  };
}

const { monthStart, monthEndExclusive, rangeStart: RANGE_START, rangeEnd: RANGE_END } =
  parseTargetMonthRange(YEAR_MONTH);

const FKO_ST_IN = (codes) =>
  Prisma.sql`UPPER(BTRIM("fkmail"."statusCode")) IN (${Prisma.join(codes.map((c) => Prisma.sql`${c}`), ', ')})`;

function roundH(m) {
  return Math.round((m / 60) * 10) / 10;
}

function rowMinutes(row, useQty) {
  const perUnit = Number(row.perUnitMinutes ?? 0);
  if (perUnit <= 0) return null;
  if (!useQty) return perUnit;
  const q = row.plannedQuantity == null ? null : Number(row.plannedQuantity);
  if (q == null || !Number.isFinite(q) || q <= 0 || !Number.isInteger(q)) return null;
  return perUnit * q;
}

function maySpreadMinutes(row, calendarMap) {
  if (!row.plannedStartDate || !row.effectiveDueDate) return 0;
  const total = row._minutes;
  if (total == null || total <= 0) return 0;
  const mode = calendarMap.get(RESOURCE) ?? 'weekdays';
  const allocs = distributeRowLoadEvenly({
    row: {
      rowId: row.rowId,
      resourceCd: RESOURCE,
      totalMinutes: total,
      plannedStartDate: row.plannedStartDate,
      effectiveDueDate: row.effectiveDueDate
    },
    workCalendarMode: mode
  });
  return allocs.filter((a) => a.yearMonth === YEAR_MONTH).reduce((s, a) => s + a.minutes, 0);
}

async function fetchRows(population) {
  const policy = await getResourceCategoryPolicy({ siteKey: SITE_KEY, deviceScopeKey: DEVICE_SCOPE });

  let fkoFilter = Prisma.empty;
  if (population === 'visible_srcx') {
    fkoFilter = buildFkojunstProductionScheduleListVisibilityWhereSql();
  } else if (population === 'remain_srop') {
    fkoFilter = Prisma.sql`
      AND "fkmail"."id" IS NOT NULL
      AND ${buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql()}
    `;
  } else if (population === 'load_balancing_eligibility') {
    fkoFilter = buildLoadBalancingRowEligibilityWhereSql();
    progressFilter = Prisma.empty;
  } else if (population === 'all_fko' || population === 'cx_any_progress') {
    fkoFilter = Prisma.sql`AND "fkmail"."id" IS NOT NULL AND ${FKO_ST_IN(['C', 'X'])}`;
  }

  let progressFilter = Prisma.sql`AND COALESCE("p"."isCompleted", FALSE) = FALSE`;
  if (population === 'remain_srop_effective') {
    progressFilter = Prisma.sql`
      AND COALESCE("p"."isCompleted", FALSE) = FALSE
      AND ${buildProductionScheduleEffectiveCompletedSql()} = FALSE
    `;
  } else if (population === 'cx_any_progress') {
    progressFilter = Prisma.empty;
  }

  const rows = await prisma.$queryRaw`
    SELECT
      "CsvDashboardRow"."id" AS "rowId",
      UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) AS "resourceCd",
      (
        CASE
          WHEN ("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO') ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'
          THEN (("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO'))::numeric
          ELSE 0
        END
      )::double precision AS "perUnitMinutes",
      "supplement"."plannedQuantity" AS "plannedQuantity",
      "supplement"."plannedStartDate" AS "plannedStartDate",
      COALESCE("n"."dueDate", "supplement"."plannedEndDate") AS "effectiveDueDate",
      UPPER(BTRIM("fkmail"."statusCode")) AS "fkoStatus",
      NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'), '') IS NOT NULL AS "hasResourceCd",
      ${buildProductionScheduleEffectiveCompletedSql()} AS "effectiveCompleted"
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
      ON "ext"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "ext"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleRowNote" AS "n"
      ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
      ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "supplement"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      ${progressFilter}
      AND (
        UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'MH%'
        AND UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'SH%'
      )
      AND NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'), '') IS NOT NULL
      AND (
        (
          "supplement"."plannedStartDate" IS NOT NULL
          AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") IS NOT NULL
          AND "supplement"."plannedStartDate" < ${RANGE_END}
          AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") >= ${RANGE_START}
        )
        OR (
          "supplement"."plannedStartDate" IS NULL
          AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") IS NOT NULL
          AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") >= ${RANGE_START}
          AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") < ${RANGE_END}
        )
        OR (
          "supplement"."plannedStartDate" IS NOT NULL
          AND COALESCE("n"."dueDate", "supplement"."plannedEndDate") IS NULL
          AND "supplement"."plannedStartDate" >= ${RANGE_START}
          AND "supplement"."plannedStartDate" < ${RANGE_END}
        )
      )
      ${fkoFilter}
  `;

  const out = [];
  for (const row of rows) {
    const cd = normalizeProductionScheduleResourceCd(String(row.resourceCd ?? ''));
    if (!cd || cd !== RESOURCE || isProductionScheduleExcludedCuttingResourceCd(cd, policy)) continue;
    out.push({
      rowId: row.rowId,
      perUnitMinutes: Number(row.perUnitMinutes ?? 0),
      plannedQuantity: row.plannedQuantity == null ? null : Number(row.plannedQuantity),
      plannedStartDate: row.plannedStartDate,
      effectiveDueDate: row.effectiveDueDate,
      fkoStatus: String(row.fkoStatus ?? '').toUpperCase(),
      hasResourceCd: Boolean(row.hasResourceCd),
      effectiveCompleted: Boolean(row.effectiveCompleted)
    });
  }
  return out;
}

function aggregate(rows, calendarMap, useQty) {
  const byStatus = { S: 0, R: 0, C: 0, X: 0, P: 0, O: 0, other: 0 };
  let remainMay = 0;
  let consumedMay = 0;
  let rowCount = 0;
  let rawSum = 0;
  let qtySum = 0;

  for (const row of rows) {
    const raw = row.perUnitMinutes;
    const qty =
      row.plannedQuantity != null && Number.isInteger(row.plannedQuantity) && row.plannedQuantity > 0
        ? raw * row.plannedQuantity
        : null;
    rawSum += raw;
    if (qty != null) qtySum += qty;

    row._minutes = useQty ? qty : raw;
    const may = maySpreadMinutes(row, calendarMap);
    if (may <= 0) continue;
    rowCount++;

    const st = row.fkoStatus;
    if (st in byStatus) byStatus[st] += may;
    else byStatus.other += may;

    const isConsumed =
      st === 'C' || st === 'X' || row.effectiveCompleted;
    if (isConsumed) consumedMay += may;
    else remainMay += may;
  }

  return {
    rowCount,
    rawSumH: roundH(rawSum),
    qtySumH: roundH(qtySum),
    byStatusH: Object.fromEntries(
      Object.entries(byStatus).map(([k, v]) => [k, roundH(v)])
    ),
    remainMayH: roundH(remainMay),
    consumedMayH: roundH(consumedMay),
    totalMayH: roundH(remainMay + consumedMay)
  };
}

async function overviewPlannedEndMonthH() {
  const rows = await prisma.$queryRaw`
    SELECT
      UPPER(BTRIM("fkmail"."statusCode")) AS st,
      SUM(
        CASE
          WHEN ("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO') ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'
          THEN (("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO'))::numeric
          ELSE 0
        END
      )::double precision AS minutes
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
      ON "ext"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "ext"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
      ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "supplement"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) = ${RESOURCE}
      AND "supplement"."plannedEndDate" >= ${monthStart}
      AND "supplement"."plannedEndDate" < ${monthEndExclusive}
      AND (
        UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'MH%'
        AND UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'SH%'
      )
      AND NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'), '') IS NOT NULL
      AND "fkmail"."id" IS NOT NULL
      AND ${buildFkojunstMailStatusEligibleForScheduleDisappearanceScalarSql()}
      AND ${buildProductionScheduleEffectiveCompletedSql()} = FALSE
    GROUP BY 1
  `;
  const byStatus = {};
  let totalMin = 0;
  for (const r of rows) {
    const st = String(r.st ?? '').toUpperCase();
    const min = Number(r.minutes ?? 0);
    byStatus[st] = roundH(min);
    totalMin += min;
  }
  return { byStatusH: byStatus, totalH: roundH(totalMin) };
}

async function fkoResourceCdStats() {
  const rows = await prisma.$queryRaw`
    SELECT
      UPPER(BTRIM("fkmail"."statusCode")) AS st,
      COUNT(*)::int AS cnt,
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(c."rowData"->>'FSIGENCD'), '') IS NULL)::int AS no_cd,
      COUNT(*) FILTER (WHERE UPPER(BTRIM(c."rowData"->>'FSIGENCD')) = '033')::int AS is_033
    FROM "CsvDashboardRow" c
    JOIN "ProductionScheduleFkojunstMailStatus" fkmail
      ON fkmail."csvDashboardRowId" = c."id" AND fkmail."csvDashboardId" = c."csvDashboardId"
    WHERE c."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('c')}
    GROUP BY 1
    ORDER BY 2 DESC
  `;
  return rows;
}

async function pRowDiagnostics(calendarMap) {
  const rows = (await fetchRows('remain_srop')).filter((r) => r.fkoStatus === 'P');
  let noDates = 0;
  let noMay = 0;
  let mayPositive = 0;
  let sumMay = 0;
  let sumRaw = 0;
  for (const row of rows) {
    sumRaw += row.perUnitMinutes;
    if (!row.plannedStartDate && !row.effectiveDueDate) noDates++;
    row._minutes = row.perUnitMinutes;
    const may = maySpreadMinutes(row, calendarMap);
    if (may <= 0) noMay++;
    else {
      mayPositive++;
      sumMay += may;
    }
  }
  return {
    pRowsInDateWindow: rows.length,
    noStartAndNoDue: noDates,
    zeroTargetMonthSpread: noMay,
    positiveTargetMonthSpread: mayPositive,
    rawSumH: roundH(sumRaw),
    targetMonthSpreadH: roundH(sumMay)
  };
}

async function fkoMayBreakdown(calendarMap, useQty) {
  const rows = await fetchRows('visible_srcx');
  const by = {};
  for (const row of rows) {
    const st = row.fkoStatus || '?';
    if (!by[st]) by[st] = { rows: 0, rawMin: 0, mayMin: 0 };
    by[st].rows++;
    const raw = row.perUnitMinutes;
    const qty =
      useQty && row.plannedQuantity > 0 && Number.isInteger(row.plannedQuantity)
        ? raw * row.plannedQuantity
        : raw;
    by[st].rawMin += raw;
    row._minutes = qty;
    by[st].mayMin += maySpreadMinutes(row, calendarMap);
  }
  return Object.fromEntries(
    Object.entries(by).map(([st, v]) => [
      st,
      {
        rows: v.rows,
        rawSumH: roundH(v.rawMin),
        maySpreadH: roundH(v.mayMin),
        qtyXrawH: useQty ? roundH(v.rawMin) : undefined
      }
    ])
  );
}

async function main() {
  const calendars = await listLoadBalancingWorkCalendars(SITE_KEY);
  const calendarMap = buildWorkCalendarModeMap(calendars.items);

  const fkoStats = await fkoResourceCdStats();
  const overviewEndMonth = await overviewPlannedEndMonthH();
  const pDiag = await pRowDiagnostics(calendarMap);
  const fkoMonthSrcx = await fkoMayBreakdown(calendarMap, false);
  const fkoMonthSrcxQty = await fkoMayBreakdown(calendarMap, true);

  const patterns = [
    {
      id: 'A_kiosk_start_date_canonical',
      label: '正本（着手日・eligibility・総分のみ）',
      population: 'load_balancing_eligibility',
      useQty: false
    },
    {
      id: 'A_legacy_qty_srcx',
      label: '旧現行（S/R/C/X・×指示数）— 参考',
      population: 'visible_srcx',
      useQty: true
    },
    {
      id: 'B_no_qty_srcx',
      label: '×指示数なし（S/R/C/X・progress未完）— 参考',
      population: 'visible_srcx',
      useQty: false
    },
    {
      id: 'C_no_qty_srop_cx_out',
      label: '×指示数なし・C/X除外（S/R/O/P・progress未完）',
      population: 'remain_srop',
      useQty: false
    },
    {
      id: 'D_no_qty_srop_effective',
      label: '×指示数なし・C/X除外・実効未完了（資源CD俯瞰同系）',
      population: 'remain_srop_effective',
      useQty: false
    },
    {
      id: 'E_remain_sr_only',
      label: '×指示数なし・S/Rのみ（残候補・厳しめ）',
      population: 'remain_srop',
      useQty: false,
      filter: (r) => r.fkoStatus === 'S' || r.fkoStatus === 'R'
    },
    {
      id: 'F_remain_sr_p',
      label: '×指示数なし・S/R/P（P=移動票未発行・残候補）',
      population: 'remain_srop',
      useQty: false,
      filter: (r) => ['S', 'R', 'P'].includes(r.fkoStatus)
    },
    {
      id: 'G_consumed_cx_only',
      label: '×指示数なし・C/Xのみ・progress未完',
      population: 'visible_srcx',
      useQty: false,
      filter: (r) => r.fkoStatus === 'C' || r.fkoStatus === 'X'
    },
    {
      id: 'H_consumed_cx_all',
      label: '×指示数なし・C/Xのみ（完了行含む）',
      population: 'cx_any_progress',
      useQty: false
    }
  ];

  const results = [];
  for (const p of patterns) {
    let rows = await fetchRows(p.population);
    if (p.filter) rows = rows.filter(p.filter);
    const agg = aggregate(rows, calendarMap, p.useQty);
    results.push({
      ...p,
      ...agg,
      deltaRemainH: roundH(agg.remainMayH - PROD.remainH),
      deltaConsumedH: roundH(agg.consumedMayH - PROD.consumedH)
    });
  }

  console.log(
    JSON.stringify(
      {
        resourceCd: RESOURCE,
        yearMonth: YEAR_MONTH,
        productionExpected: PROD,
        overviewPlannedEndMonth: overviewEndMonth,
        fkoWinnerRowsByStatus: fkoStats,
        pRowDiagnostics: pDiag,
        fkoMonthBreakdown_noQty: fkoMonthSrcx,
        fkoMonthBreakdown_withQty: fkoMonthSrcxQty,
        opHandlingInCode: {
          O:
            '一覧非表示・未完了。負荷SQLは FSIGENCD 非空必須のため、資源CD未振りのOは母集団に入らない',
          P: '一覧非表示・未完了。資源CDがCSVにあれば負荷集計対象（eligibility）',
          startDateTab: 'buildLoadBalancingRowEligibilityWhereSql → C/X除外・S/R/O/P・実効未完了',
          machineMonthlyTab: '同上（有効納期月）',
          overviewTab: '同上（plannedEndDate 月）'
        },
        patterns: results.map(({ filter, population, ...r }) => r)
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
