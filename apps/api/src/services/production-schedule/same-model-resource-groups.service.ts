import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { resolveSiteKeyForScopeKey } from '../../lib/site-directory.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { resourceCdSchema } from './grinding-planning-board-resource-capacity.service.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from './fkojunst-status-mail-critical-lock.js';
import { getResourceCategoryPolicy, isProductionScheduleGrindingResourceCd, isProductionScheduleCuttingResourceCd } from './policies/resource-category-policy.service.js';
import { readSameModelResourceGroups, representativeResourceCd, sameModelResourceCds } from './same-model-resource-resolver.js';
import { lockOperationDefinitionPieces, reconcileOperationDefinitionPieces } from './sessaku-pieces/piece-operation-definitions.js';
import type { ProductionScheduleSameModelResourceGroupsResponse, ProductionScheduleSameModelMinutesConflictDetails } from '@raspi-system/shared-types';

const groupFields = {
  resolutions: z.record(z.string().trim().min(1), resourceCdSchema).optional(),
  groups: z.array(z.object({ resourceCds: z.array(resourceCdSchema).min(2, '組には機械を2台以上入れてください').max(300) })).max(300)
};
const validateGroups = ({ groups }: { groups: Array<{ resourceCds: string[] }> }, ctx: z.RefinementCtx) => {
  const used = new Set<string>();
  for (const group of groups) for (const cd of group.resourceCds) {
    if (used.has(cd)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '同じ機械を複数の組に入れることはできません' });
    used.add(cd);
  }
};
export const sameModelGroupsSchema = z.object({ location: z.string().trim().min(1).max(100), ...groupFields }).superRefine(validateGroups);
export const kioskSameModelGroupsSchema = z.object(groupFields).strict().superRefine(validateGroups);

export async function getSameModelResourceGroups(location: string): Promise<ProductionScheduleSameModelResourceGroupsResponse> {
  const siteKey = resolveSiteKeyForScopeKey(location.trim());
  return getSameModelResourceGroupsForSite(siteKey);
}

export async function getSameModelResourceGroupsForSite(siteKey: string): Promise<ProductionScheduleSameModelResourceGroupsResponse> {
  const [groups, master, policy] = await Promise.all([
    readSameModelResourceGroups(siteKey),
    prisma.productionScheduleResourceMaster.findMany({ select: { resourceCd: true, resourceName: true }, orderBy: [{ resourceCd: 'asc' }, { resourceName: 'asc' }] }),
    getResourceCategoryPolicy({ siteKey })
  ]);
  const resources = [...new Map(master.filter((row) => isProductionScheduleGrindingResourceCd(row.resourceCd, policy)
    || isProductionScheduleCuttingResourceCd(row.resourceCd, policy)).map((row) => [row.resourceCd, row])).values()];
  return { siteKey, groups, resources };
}

export async function replaceSameModelResourceGroups(input: z.input<typeof sameModelGroupsSchema>) {
  const { location, ...body } = sameModelGroupsSchema.parse(input);
  return replaceSameModelResourceGroupsForSite(resolveSiteKeyForScopeKey(location), body);
}

export async function replaceSameModelResourceGroupsForSite(siteKey: string, input: z.input<typeof kioskSameModelGroupsSchema>) {
  const { groups: rawGroups, resolutions = {} } = kioskSameModelGroupsSchema.parse(input);
  const groups = rawGroups.map((group) => ({ resourceCds: [...group.resourceCds].sort() }));
  if (siteKey === 'shared') throw new ApiError(400, '同型機の組には工場を選択してください');
  await prisma.$transaction(async (tx) => {
    // The same first lock as definition/piece writers serializes regrouping with edits and moves.
    await acquireFkojunstStatusMailCriticalTransactionLock(tx);
    const previousGroups = await readSameModelResourceGroups(siteKey, tx);
    const resources = [...new Set([...previousGroups, ...groups].flatMap((group) => group.resourceCds))]
      .filter((cd) => JSON.stringify([...sameModelResourceCds(previousGroups, cd)].sort())
        !== JSON.stringify(sameModelResourceCds(groups, cd)));
    if (!resources.length) {
      if (Object.keys(resolutions).length) throw new ApiError(400, '食い違い元の機械を選択してください');
      return;
    }
    const where = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey };
    const values = await tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany({
      where: { ...where, resourceCd: { in: resources } }, include: { ops: { orderBy: { opNo: 'asc' } } }
    });
    type Value = typeof values[number];
    const byResource = new Map<string, Value[]>();
    for (const cd of resources) byResource.set(cd, values.filter((value) => value.resourceCd === representativeResourceCd(previousGroups, cd)));
    const content = (value: Value) => JSON.stringify([value.perUnitMinutes, value.setupMinutes,
      value.ops.map((op) => [op.opNo, op.setupMinutes, op.minutes])]);
    const desired = new Map<string, Map<string, Value>>();
    const conflicts = new Set<string>();
    for (const cd of resources) {
      const representative = representativeResourceCd(groups, cd);
      const parts = desired.get(representative) ?? new Map<string, Value>();
      for (const value of byResource.get(cd) ?? []) {
        const current = parts.get(value.fhincd);
        if (current && content(current) !== content(value)) conflicts.add(value.fhincd);
        else if (!current || value.resourceCd === representative) parts.set(value.fhincd, value);
      }
      desired.set(representative, parts);
    }
    const details: ProductionScheduleSameModelMinutesConflictDetails = { fhincds: [...conflicts].sort(), values: {} };
    for (const fhincd of details.fhincds) {
      details.values[fhincd] = {};
      for (const cd of resources) {
        const representative = representativeResourceCd(groups, cd);
        const candidates = resources.filter((member) => representativeResourceCd(groups, member) === representative)
          .flatMap((member) => byResource.get(member)?.filter((row) => row.fhincd === fhincd) ?? []);
        if (new Set(candidates.map(content)).size < 2) continue;
        const value = byResource.get(cd)?.find((row) => row.fhincd === fhincd);
        if (value) details.values[fhincd][cd] = { perUnitMinutes: value.perUnitMinutes, setupMinutes: value.setupMinutes,
          ops: value.ops.map(({ opNo, setupMinutes, minutes }) => ({ opNo, setupMinutes, minutes })) };
      }
    }
    for (const [fhincd, cd] of Object.entries(resolutions)) {
      if (!details.values[fhincd]?.[cd]) throw new ApiError(400, '食い違い元の機械を選択してください');
    }
    const unresolved = details.fhincds.filter((fhincd) => !resolutions[fhincd]);
    if (unresolved.length) throw new ApiError(409, '品番の値が食い違っています', details, 'SAME_MODEL_MINUTES_CONFLICT');
    for (const [resourceCd, parts] of desired) for (const fhincd of parts.keys()) {
      const cd = resolutions[fhincd];
      if (!cd) continue;
      const candidates = resources.filter((member) => representativeResourceCd(groups, member) === resourceCd)
        .flatMap((member) => byResource.get(member)?.filter((row) => row.fhincd === fhincd) ?? []);
      if (new Set(candidates.map(content)).size < 2) continue;
      const selected = candidates.find((row) => row.resourceCd === representativeResourceCd(previousGroups, cd));
      if (!selected) throw new ApiError(400, '食い違い元の機械を選択してください');
      parts.set(fhincd, selected);
    }
    const keys = new Map<string, Awaited<ReturnType<typeof lockOperationDefinitionPieces>>>();
    for (const fhincd of [...new Set(values.map((value) => value.fhincd))].sort()) keys.set(fhincd, await lockOperationDefinitionPieces(tx, fhincd));
    const retainedIds: string[] = [];
    for (const [resourceCd, parts] of desired) for (const [fhincd, value] of parts) {
      const existing = values.find((row) => row.resourceCd === resourceCd && row.fhincd === fhincd);
      if (existing) {
        if (content(existing) !== content(value)) {
          // Keep operation row IDs for matching operation numbers; reconciliation below handles changed numbers.
          const nextNos = new Set(value.ops.map((op) => op.opNo));
          await tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.update({
            where: { id: existing.id }, data: { perUnitMinutes: value.perUnitMinutes, setupMinutes: value.setupMinutes, ops: {
              deleteMany: existing.ops.filter((op) => !nextNos.has(op.opNo)).map((op) => ({ id: op.id })),
              update: value.ops.filter((op) => existing.ops.some((row) => row.opNo === op.opNo))
                .map(({ opNo, setupMinutes, minutes }) => ({ where: { id: existing.ops.find((row) => row.opNo === opNo)!.id }, data: { setupMinutes, minutes } })),
              create: value.ops.filter((op) => !existing.ops.some((row) => row.opNo === op.opNo))
                .map(({ opNo, setupMinutes, minutes }) => ({ opNo, setupMinutes, minutes }))
            } }
          });
        }
        retainedIds.push(existing.id); continue;
      }
      // Move the original row (and its operation IDs) when its former key is no longer needed.
      if (!retainedIds.includes(value.id) && !desired.get(value.resourceCd)?.has(fhincd)) {
        await tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.update({ where: { id: value.id }, data: { resourceCd } });
        retainedIds.push(value.id);
      } else {
        const copied = await tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.create({ data: {
          ...where, resourceCd, fhincd, perUnitMinutes: value.perUnitMinutes, setupMinutes: value.setupMinutes,
          ops: { create: value.ops.map(({ opNo, setupMinutes, minutes }) => ({ opNo, setupMinutes, minutes })) }
        } });
        retainedIds.push(copied.id);
      }
    }
    await tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.deleteMany({ where: {
      ...where, resourceCd: { in: resources }, id: { notIn: retainedIds }
    } });
    const sources = await tx.productionScheduleGrindingPlanningBoardResourceMinutesSource.findMany({ where: { ...where, resourceCd: { in: resources } } });
    await tx.productionScheduleSameModelResourceGroup.deleteMany({ where: { siteKey } });
    for (const group of groups) {
      const created = await tx.productionScheduleSameModelResourceGroup.create({ data: { siteKey } });
      await tx.productionScheduleSameModelResourceMember.createMany({
        data: group.resourceCds.map((resourceCd) => ({ groupId: created.id, siteKey, resourceCd }))
      });
      if (group.resourceCds.some((cd) => sources.some((source) => source.resourceCd === cd))) {
        await tx.productionScheduleGrindingPlanningBoardResourceMinutesSource.createMany({
          data: group.resourceCds.map((resourceCd) => ({ ...where, resourceCd, source: 'own' })), skipDuplicates: true
        });
      }
    }
    for (const [resourceCd, parts] of desired) for (const [fhincd, value] of parts) {
      const nextNos = value.ops.map((op) => op.opNo);
      const members = resources.filter((cd) => representativeResourceCd(groups, cd) === resourceCd);
      const changed = members.some((cd) => JSON.stringify(byResource.get(cd)?.find((row) => row.fhincd === fhincd)?.ops.map((op) => op.opNo) ?? []) !== JSON.stringify(nextNos));
      if (changed) await reconcileOperationDefinitionPieces(tx, { siteKey, resourceCd }, keys.get(fhincd) ?? [], nextNos);
    }
  }, { timeout: 30000, maxWait: 15000 });
  return getSameModelResourceGroupsForSite(siteKey);
}
