import { Prisma } from '@prisma/client';

import { isMachineSectionAssigned } from './machine-section-assignee.js';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { readMachiningCompletionBySeiban } from '../grinding-planning-board/completion.js';
import { boardRevision, getOrCreateState, stateOrder, stateUncheckedFseibans } from '../grinding-planning-board/state.js';
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
      where: { kind: run.kind, status: 'SUCCESS', id: { not: run.id } }, orderBy: [{ meetingDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
    });
    const previousOwnership = (previous?.autoRegisteredSeibans ?? { planningBoards: {}, searchHistory: [] }) as RegistrationOwnership;
    let ownership = run.autoRegisteredSeibans as RegistrationOwnership;
    const newerRun = await prisma.productionScheduleDScheduleMinutesImportRun.findFirst({
      where: { kind: run.kind, status: { in: ['SUCCESS', 'APPLIED'] }, meetingDate: { gt: run.meetingDate } },
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
    const otherRun = await prisma.productionScheduleDScheduleMinutesImportRun.findFirst({
      where: { kind: run.kind === 'INTERNAL' ? 'D_COMPANY' : 'INTERNAL', status: 'SUCCESS' },
      orderBy: [{ meetingDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
    });
    const otherOwnership = (otherRun?.autoRegisteredSeibans ?? { planningBoards: {}, searchHistory: [] }) as RegistrationOwnership;
    const otherFile = new Set(otherRun ? (await prisma.productionScheduleDScheduleMinutesKindMembership.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, kind: otherRun.kind, lastSourceRunId: otherRun.id },
      select: { fseiban: true }
    })).map((row) => row.fseiban) : []);
    const warnings = run.warnings as DScheduleMinutesWarning[];
    const stale = new Set(warnings.filter((warning) => warning.code === 'STALE_FILE').map((warning) => warning.seiban));
    const rechecked = new Set(run.kind === 'D_COMPANY'
      ? ownership.metrics?.machineSectionAssignedFseibans?.filter((fseiban) => !stale.has(fseiban))
      : []);
    const unavailable = new Set(warnings.filter((warning) => warning.code === 'NOT_IN_SCHEDULE').map((warning) => warning.seiban));
    const all = new Set(input.blocks.flatMap((block) => [block.seiban, ...block.aliasSeibans]));
    // A skipped block still proves presence, but only readable blocks can be added below.
    for (const warning of warnings) if (warning.seiban !== null) all.add(warning.seiban);
    const eligible = [...new Set(input.blocks.filter((block) => run.kind !== 'INTERNAL' || block.partsCompleteDate !== null).sort((a, b) =>
      (a.partsCompleteDate ?? '9999-12-31').localeCompare(b.partsCompleteDate ?? '9999-12-31')
    ).flatMap((block) => [block.seiban, ...block.aliasSeibans]).filter((seiban) => !unavailable.has(seiban)))];
    const [sites, existingBoards, sharedState] = await Promise.all([
      prisma.site.findMany({ select: { key: true }, orderBy: { key: 'asc' } }),
      prisma.productionScheduleGrindingPlanningBoardState.findMany({
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }, select: { siteKey: true, seibanOrder: true }
      }),
      getProductionScheduleSearchState('shared')
    ]);
    // One date/assignee lookup for all destinations, including manual entries used as insertion anchors.
    const listed = existingBoards.flatMap((board) => Array.isArray(board.seibanOrder)
      ? board.seibanOrder.filter((value): value is string => typeof value === 'string') : []);
    const minutes = await prisma.productionScheduleDScheduleMinutes.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        fseiban: { in: [...new Set([...eligible, ...listed, ...sharedState.state.history])] } },
      select: { fseiban: true, assignees: true, assigneesKnown: true, partsCompleteDate: true }
    });
    const eligibleSet = new Set(eligible);
    const nonMachineAssignees = new Set<string>();
    const blankAssignees = new Set<string>();
    for (const { fseiban, assigneesKnown, assignees } of minutes) {
      if (!eligibleSet.has(fseiban) || !assigneesKnown) continue;
      if (!assignees.some((value) => value.trim().length > 0)) blankAssignees.add(fseiban);
      else if (!isMachineSectionAssigned(assignees)) nonMachineAssignees.add(fseiban);
    }
    const partsDates = new Map(minutes.map((row) => [row.fseiban, row.partsCompleteDate?.toISOString().slice(0, 10) ?? null]));

    const reconcile = async (
      previousAuto: string[],
      savedAuto: string[],
      otherAuto: string[],
      read: () => Promise<{ entries: string[]; revision: string; needsWrite?: boolean }>,
      write: (entries: string[], revision: string, saveProgress: (client: Prisma.TransactionClient) => Promise<void>, additions: string[]) => Promise<void>,
      ownershipUpdate: (owned: string[]) => Partial<RegistrationOwnership>
    ) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = await read();
        const auto = new Set([...previousAuto, ...savedAuto]);
        const other = new Set(otherAuto);
        const entries = current.entries.filter((seiban) => !auto.has(seiban) || all.has(seiban) || other.has(seiban) || otherFile.has(seiban));
        // Existing manual entries stay unowned. Shared automatic entries can be owned by both kinds.
        // Keep ownership while the other file still lists it, so the entry is removed once neither file has it.
        const owned = entries.filter((seiban) => (auto.has(seiban) && (all.has(seiban) || otherFile.has(seiban)))
          || (eligibleSet.has(seiban) && other.has(seiban)));
        const present = new Set(entries);
        const additions = eligible.filter((seiban) => !present.has(seiban)).sort((a, b) =>
          (partsDates.get(a) ?? '9999-12-31').localeCompare(partsDates.get(b) ?? '9999-12-31'));
        for (const seiban of additions) {
          const date = partsDates.get(seiban);
          const index = date == null ? -1 : entries.findIndex((existing) => {
            const existingDate = partsDates.get(existing);
            return existingDate != null && existingDate > date;
          });
          entries.splice(index < 0 ? entries.length : index, 0, seiban);
          owned.push(seiban);
        }
        try {
          const nextOwnership = { ...ownership, ...ownershipUpdate(owned) };
          if (ownership.metrics) {
            nextOwnership.metrics = {
              ...ownership.metrics,
              registeredSeibans: [...new Set([...ownership.metrics.registeredSeibans, ...entries.filter((seiban) => !current.entries.includes(seiban))])],
              unregisteredSeibans: [...new Set([...ownership.metrics.unregisteredSeibans, ...current.entries.filter((seiban) => !entries.includes(seiban))])]
            };
          }
          const saveProgress = async (client: Prisma.TransactionClient) => {
            await client.productionScheduleDScheduleMinutesImportRun.update({ where: { id: run.id }, data: { autoRegisteredSeibans: nextOwnership } });
          };
          if (current.needsWrite || JSON.stringify(entries) !== JSON.stringify(current.entries)) {
            await write(entries, current.revision, saveProgress, additions);
          } else {
            await saveProgress(prisma);
          }
          ownership = nextOwnership;
          return;
        } catch (error) {
          if (!(error instanceof ApiError) || error.statusCode !== 409 || attempt === 1) throw error;
        }
      }
    };

    const existingBoardKeys = new Set(existingBoards.map((board) => board.siteKey));
    for (const siteKey of new Set([...sites.map((site) => site.key), ...existingBoards.map((board) => board.siteKey)])) {
      // A new board is seeded from shared history by the existing state service.
      const inherited = existingBoardKeys.has(siteKey) ? [] : previousOwnership.searchHistory;
      const otherInherited = existingBoardKeys.has(siteKey) ? [] : otherOwnership.searchHistory;
      // The ownership checkpoint also marks boards already reconciled by this run.
      const recheckBoard = rechecked.size > 0 && existingBoardKeys.has(siteKey) && !Object.hasOwn(ownership.planningBoards, siteKey);
      await reconcile(previousOwnership.planningBoards[siteKey] ?? inherited, ownership.planningBoards[siteKey] ?? [],
      otherOwnership.planningBoards[siteKey] ?? otherInherited, async () => {
        const state = await getOrCreateState(siteKey, []);
        const entries = stateOrder(state);
        const needsWrite = recheckBoard && (state.uncheckedFseibans == null ? entries : stateUncheckedFseibans(state))
          .some((fseiban) => rechecked.has(fseiban));
        return { entries, revision: boardRevision(state), needsWrite };
      }, async (fseibans, sourceRevision, saveProgress, additions) => {
        const newUncheckedFseibans = additions.filter((fseiban) => nonMachineAssignees.has(fseiban));
        const blankAdditions = additions.filter((fseiban) => blankAssignees.has(fseiban));
        if (blankAdditions.length > 0) {
          const completion = await readMachiningCompletionBySeiban(siteKey, blankAdditions);
          newUncheckedFseibans.push(...blankAdditions.filter((fseiban) => completion.get(fseiban) !== 'unfinished'));
        }
        await updateGrindingPlanningBoardSeibanOrder({
          siteKey, fseibans, sourceRevision, newUncheckedFseibans,
          ...(recheckBoard ? { recheckedFseibans: rechecked } : {})
        }, recheckBoard ? saveProgress : undefined);
        if (!recheckBoard) await saveProgress(prisma);
      }, (owned) => ({ planningBoards: { ...ownership.planningBoards, [siteKey]: owned } }));
    }
    await reconcile(previousOwnership.searchHistory, ownership.searchHistory, otherOwnership.searchHistory, async () => {
      const state = await getProductionScheduleSearchState('shared');
      return { entries: state.state.history, revision: state.etag };
    }, async (incomingHistory, ifMatchHeader, saveProgress) => {
      await updateProductionScheduleSearchState({ locationKey: 'shared', incomingHistory, ifMatchHeader });
      await saveProgress(prisma);
    }, (owned) => ({ searchHistory: owned }));
    const nextWarnings = warnings.filter((warning) => warning.code !== 'REGISTRATION_LIMIT');
    await prisma.productionScheduleDScheduleMinutesImportRun.update({
      where: { id: run.id }, data: { status: 'SUCCESS', autoRegisteredSeibans: ownership, warnings: nextWarnings as Prisma.InputJsonValue[] }
    });
  }, { timeout: 120000 });
}
