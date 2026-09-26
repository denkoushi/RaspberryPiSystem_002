/**
 * Read-only report of site-scoped data per scope key
 * (docs/plans/explicit-site-scope-execplan.md, Milestone 4).
 *
 * Counts rows per value of every column that stores a site key or a
 * location-derived scope key, and classifies each value as a registered site,
 * a registered device scope key (with that device's site), or unknown.
 * It never writes.
 *
 * Run on Pi5: docker compose -f infrastructure/docker/docker-compose.server.yml exec -T -w /app/apps/api api node scripts/site-scope-report.mjs
 * Output: one JSON document on stdout.
 */
import { prisma } from '../dist/lib/prisma.js';
import { resolveDeviceScopeKey, resolveSiteKeyFromScopeKey } from '../dist/lib/location-scope-resolver.js';
import { GLOBAL_SHARED_LOCATION_KEY } from '../dist/services/production-schedule/due-management-ranking-scope-policy.service.js';
import { SHARED_RESOURCE_CATEGORY_LOCATION } from '../dist/services/production-schedule/policies/resource-category-policy.service.js';
import { SHARED_LOAD_BALANCING_SITE_KEY } from '../dist/services/production-schedule/load-balancing/load-balancing-settings-merge.js';

/** [table, column, role] — role says what the column holds today. */
export const SITE_SCOPED_COLUMNS = [
  ['ProductionScheduleGrindingPlanningBoardState', 'siteKey', 'site'],
  ['ProductionScheduleGrindingPlanningBoardOverride', 'siteKey', 'site'],
  ['ProductionScheduleGrindingPlanningBoardDueScope', 'siteKey', 'site'],
  ['ProductionScheduleOrderAssignment', 'siteKey', 'site'],
  ['ProductionScheduleOrderAssignment', 'location', 'site-or-legacy-device'],
  ['ProductionScheduleOrderSplitAssignment', 'siteKey', 'site'],
  ['ProductionScheduleOrderSplitAssignment', 'location', 'site-or-legacy-device'],
  ['ProductionScheduleOrderSplitAuditLog', 'siteKey', 'site'],
  ['ProductionScheduleManualOrderResourceAssignment', 'siteKey', 'site'],
  ['ProductionScheduleManualOrderResourceAssignment', 'deviceScopeKey', 'device'],
  ['ProductionScheduleResourceCapacityBase', 'siteKey', 'site'],
  ['ProductionScheduleResourceMonthlyCapacity', 'siteKey', 'site'],
  ['ProductionScheduleResourceWorkCalendar', 'siteKey', 'site'],
  ['ProductionScheduleLoadBalanceClass', 'siteKey', 'site'],
  ['ProductionScheduleLoadBalanceTransferRule', 'siteKey', 'site'],
  ['ProductionScheduleResourceCategoryConfig', 'location', 'site'],
  ['ProductionScheduleGlobalRank', 'location', 'site-device-or-shared'],
  ['ProductionScheduleGlobalRowRank', 'location', 'site-device-or-shared'],
  ['KioskProductionScheduleSearchState', 'location', 'device'],
  ['ProductionSchedulePartPriority', 'location', 'device'],
  ['ProductionScheduleProcessingTypeOption', 'location', 'device'],
  ['ProductionScheduleResourceCodeMapping', 'location', 'device'],
  ['ProductionScheduleAccessPasswordConfig', 'location', 'device'],
  ['ProductionScheduleTriageSelection', 'location', 'device'],
  ['ProductionScheduleDailyPlan', 'location', 'device'],
  ['ProductionScheduleActualHoursCanonical', 'location', 'device'],
  ['ProductionScheduleActualHoursFeature', 'location', 'device'],
  ['DueManagementProposalEvent', 'location', 'device'],
  ['DueManagementOperatorDecisionEvent', 'location', 'device'],
  ['DueManagementOutcomeEvent', 'location', 'device'],
  ['ProductionScheduleDueManagementTuningStableSnapshot', 'location', 'device'],
  ['ProductionScheduleDueManagementTuningHistory', 'location', 'device'],
  ['ProductionScheduleDueManagementTuningFailureHistory', 'location', 'device']
];

const quoteIdent = (name) => `"${name.replaceAll('"', '""')}"`;

/** Valid cross-site sentinels per table: they are not accidental sites and must not be merged. */
const SHARED_SENTINELS_BY_TABLE = {
  ProductionScheduleGlobalRank: [GLOBAL_SHARED_LOCATION_KEY],
  ProductionScheduleGlobalRowRank: [GLOBAL_SHARED_LOCATION_KEY],
  ProductionScheduleResourceCategoryConfig: [SHARED_RESOURCE_CATEGORY_LOCATION],
  ProductionScheduleResourceCapacityBase: [SHARED_LOAD_BALANCING_SITE_KEY],
  ProductionScheduleResourceMonthlyCapacity: [SHARED_LOAD_BALANCING_SITE_KEY],
  ProductionScheduleResourceWorkCalendar: [SHARED_LOAD_BALANCING_SITE_KEY],
  ProductionScheduleLoadBalanceClass: [SHARED_LOAD_BALANCING_SITE_KEY],
  ProductionScheduleLoadBalanceTransferRule: [SHARED_LOAD_BALANCING_SITE_KEY]
};

async function main() {
  const [sites, devices] = await Promise.all([
    prisma.site.findMany({ select: { key: true } }),
    prisma.clientDevice.findMany({ select: { name: true, location: true, siteKey: true } })
  ]);
  const siteKeys = new Set(sites.map((site) => site.key));
  const deviceByScopeKey = new Map();
  for (const device of devices) {
    const scopeKey = resolveDeviceScopeKey(device);
    deviceByScopeKey.set(scopeKey, {
      name: device.name,
      explicitSiteKey: device.siteKey ?? null,
      guessedSiteKey: resolveSiteKeyFromScopeKey(scopeKey)
    });
  }

  const classify = (value) => {
    if (value === null) return { kind: 'null' };
    if (siteKeys.has(value)) return { kind: 'registered-site' };
    const device = deviceByScopeKey.get(value);
    if (device) return { kind: 'device-scope-key', device };
    const guessed = resolveSiteKeyFromScopeKey(value);
    return { kind: siteKeys.has(guessed) ? 'unregistered-device-of-site' : 'unknown', guessedSiteKey: guessed };
  };

  const tables = [];
  for (const [table, column, role] of SITE_SCOPED_COLUMNS) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT ${quoteIdent(column)} AS value, COUNT(*)::int AS count FROM ${quoteIdent(table)} GROUP BY 1 ORDER BY 2 DESC`
    );
    tables.push({
      table,
      column,
      role,
      values: rows.map((row) => ({
        value: row.value,
        count: row.count,
        ...((SHARED_SENTINELS_BY_TABLE[table] ?? []).includes(row.value) ? { kind: 'shared-sentinel' } : classify(row.value))
      }))
    });
  }

  const suspicious = tables.flatMap((entry) =>
    entry.values
      .filter(
        (value) =>
          entry.role !== 'device' &&
          value.kind !== 'registered-site' &&
          value.kind !== 'shared-sentinel' &&
          // Global ranks keyed by a device scope key are that device's own (locationScoped) ranking.
          !(entry.role === 'site-device-or-shared' && value.kind === 'device-scope-key')
      )
      .map((value) => ({ table: entry.table, column: entry.column, value: value.value, count: value.count, kind: value.kind }))
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sites: [...siteKeys],
        devices: Object.fromEntries(deviceByScopeKey),
        siteScopedValuesOutsideRegisteredSites: suspicious,
        tables
      },
      null,
      2
    )}\n`
  );
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
