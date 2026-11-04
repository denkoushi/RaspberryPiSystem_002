import { KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX } from '@raspi-system/shared-types';
import { Prisma } from '@prisma/client';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { boardRevision, getOrCreateState, stateOrder } from '../grinding-planning-board/state.js';
import { updateGrindingPlanningBoardSeibanOrder } from '../grinding-planning-board/write.js';
import { getProductionScheduleSearchState, updateProductionScheduleSearchState } from '../production-schedule-search-state.service.js';
import type { DScheduleMinutesBlock, DScheduleMinutesWarning } from './parse-d-schedule-minutes.js';

import type { DScheduleMinutesMetrics } from './import-summary.js';

type RegistrationOwnership = { planningBoards: Record<string, string[]>; searchHistory: string[]; metrics?: DScheduleMinutesMetrics };

/** Run after persistence; no scheduler or HTTP entry point is installed here. */
export async function autoRegisterDScheduleMinutes(input: { runId: string; blocks: DScheduleMinutesBlock[] }): Promise<void> {
  // The lock serializes imports while existing write services retain their own optimistic concurrency checks.
  await prisma.$transaction(async (lock) => {
    await lock.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('d-schedule-minutes'))`;
    const run = await prisma.productionScheduleDScheduleMinutesImportRun.findUniqueOrThrow({ where: { id: input.runId } });
    if (run.status === 'SUCCESS') return;
    const previous = await prisma.productionScheduleDScheduleMinutesImportRun.findFirst({
      where: { status: 'SUCCESS', id: { not: run.id } }, orderBy: [{ meetingDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
    });
    const previousOwnership = (previous?.autoRegisteredSeibans ?? { planningBoards: {}, searchHistory: [] }) as RegistrationOwnership;
    const ownership = run.autoRegisteredSeibans as RegistrationOwnership;
    const newerRun = await prisma.productionScheduleDScheduleMinutesImportRun.findFirst({
      where: { status: { in: ['SUCCESS', 'APPLIED'] }, meetingDate: { gt: run.meetingDate } },
      orderBy: [{ meetingDate: 'desc' }, { createdAt: 'desc' }]
    });
    if (newerRun) {
      // Keep the last successful ownership available to the next reconciliation.
      await prisma.productionScheduleDScheduleMinutesImportRun.update({
        where: { id: run.id }, data: { status: 'SUCCESS', autoRegisteredSeibans: {
          ...previousOwnership, metrics: ownership.metrics, autoRegistrationSkipped: 'STALE_FILE'
        } }
      });
      return;
    }
    const warnings = run.warnings as DScheduleMinutesWarning[];
    const unavailable = new Set(warnings.filter((warning) => warning.code === 'NOT_IN_SCHEDULE').map((warning) => warning.seiban));
    const all = new Set(input.blocks.flatMap((block) => [block.seiban, ...block.aliasSeibans]));
    const eligible = [...input.blocks].sort((a, b) =>
      (a.partsCompleteDate ?? '9999-12-31').localeCompare(b.partsCompleteDate ?? '9999-12-31')
    ).flatMap((block) => [block.seiban, ...block.aliasSeibans]).filter((seiban) => !unavailable.has(seiban));
    const limitWarnings = new Set<string>();

    const reconcile = async (
      previousAuto: string[],
      savedAuto: string[],
      read: () => Promise<{ entries: string[]; revision: string }>,
      write: (entries: string[], revision: string) => Promise<unknown>,
      saveOwnership: (owned: string[]) => void
    ) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = await read();
        const auto = new Set([...previousAuto, ...savedAuto]);
        const entries = current.entries.filter((seiban) => !auto.has(seiban) || all.has(seiban));
        const owned = entries.filter((seiban) => auto.has(seiban));
        const present = new Set(entries);
        const rejected: string[] = [];
        for (const seiban of eligible) {
          if (present.has(seiban)) continue;
          if (entries.length >= KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX) { rejected.push(seiban); continue; }
          entries.push(seiban);
          owned.push(seiban);
          present.add(seiban);
        }
        try {
          if (JSON.stringify(entries) !== JSON.stringify(current.entries)) await write(entries, current.revision);
          if (ownership.metrics) {
            ownership.metrics.registeredSeibans = [...new Set([...ownership.metrics.registeredSeibans, ...entries.filter((seiban) => !current.entries.includes(seiban))])];
            ownership.metrics.unregisteredSeibans = [...new Set([...ownership.metrics.unregisteredSeibans, ...current.entries.filter((seiban) => !entries.includes(seiban))])];
          }
          saveOwnership(owned);
          // Persist progress per destination so a retry after partial success keeps ownership.
          await prisma.productionScheduleDScheduleMinutesImportRun.update({ where: { id: run.id }, data: { autoRegisteredSeibans: ownership } });
          rejected.forEach((seiban) => limitWarnings.add(seiban));
          return;
        } catch (error) {
          if (!(error instanceof ApiError) || error.statusCode !== 409 || attempt === 1) throw error;
        }
      }
    };

    const [sites, existingBoards] = await Promise.all([
      prisma.site.findMany({ select: { key: true }, orderBy: { key: 'asc' } }),
      prisma.productionScheduleGrindingPlanningBoardState.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }, select: { siteKey: true } })
    ]);
    const existingBoardKeys = new Set(existingBoards.map((board) => board.siteKey));
    for (const siteKey of new Set([...sites.map((site) => site.key), ...existingBoards.map((board) => board.siteKey)])) {
      // A new board is seeded from shared history by the existing state service.
      const inherited = existingBoardKeys.has(siteKey) ? [] : previousOwnership.searchHistory;
      await reconcile(previousOwnership.planningBoards[siteKey] ?? inherited, ownership.planningBoards[siteKey] ?? [], async () => {
        const state = await getOrCreateState(siteKey, []);
        return { entries: stateOrder(state), revision: boardRevision(state) };
      }, (fseibans, sourceRevision) => updateGrindingPlanningBoardSeibanOrder({ siteKey, fseibans, sourceRevision }),
      (owned) => { ownership.planningBoards[siteKey] = owned; });
    }
    await reconcile(previousOwnership.searchHistory, ownership.searchHistory, async () => {
      const state = await getProductionScheduleSearchState('shared');
      return { entries: state.state.history, revision: state.etag };
    }, (incomingHistory, ifMatchHeader) => updateProductionScheduleSearchState({ locationKey: 'shared', incomingHistory, ifMatchHeader }),
    (owned) => { ownership.searchHistory = owned; });
    const nextWarnings = [...warnings.filter((warning) => warning.code !== 'REGISTRATION_LIMIT'), ...[...limitWarnings].map((seiban) => ({
      code: 'REGISTRATION_LIMIT', seiban, cell: null, rawText: null
    }))];
    await prisma.productionScheduleDScheduleMinutesImportRun.update({
      where: { id: run.id }, data: { status: 'SUCCESS', autoRegisteredSeibans: ownership, warnings: nextWarnings as Prisma.InputJsonValue[] }
    });
  }, { timeout: 30000 });
}
