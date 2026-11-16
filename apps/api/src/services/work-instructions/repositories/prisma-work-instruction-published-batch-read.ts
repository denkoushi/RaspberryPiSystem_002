import type { PrismaClient } from '@prisma/client';

import { normalizeWorkInstructionGroupKey } from '../domain/normalization.js';
import type { WorkInstructionGroupView, WorkInstructionRowView } from '../domain/types.js';
import {
  compareSourceOrder,
  publishedPublicationInclude,
  toPublishedRowView,
  toWorkInstructionRowView
} from './prisma-work-instruction-read-queries.js';
import type { WorkInstructionGroupLookup, WorkInstructionPublishedGroupsByKeys } from './work-instruction-repository.port.js';

/**
 * One snapshot for all chunks. Map keys preserve the caller's unnormalized tuple
 * (see WorkInstructionPublishedGroupsByKeys); database predicates use normalized keys.
 */
export async function readPublishedWorkInstructionGroupsByKeys(
  db: PrismaClient,
  keys: ReadonlyArray<WorkInstructionGroupLookup>
): Promise<WorkInstructionPublishedGroupsByKeys> {
  const normalized = new Map(keys.map((key) => [
    JSON.stringify([key.partNumber, key.shootingTarget]),
    normalizeWorkInstructionGroupKey(key.partNumber, key.shootingTarget)
  ]));
  const result = new Map<string, WorkInstructionGroupView | null>([...normalized.keys()].map((key) => [key, null]));
  const unique = new Map([...normalized.values()].flatMap((key) => key
    ? [[JSON.stringify([key.partNumber, key.shootingTarget]), key] as const] : []));
  if (unique.size === 0) return result;
  const groups = await db.$transaction(async (tx) => {
    const found = new Map<string, WorkInstructionGroupView & { rows: WorkInstructionRowView[] }>();
    const inputs = [...unique.values()];
    for (let offset = 0; offset < inputs.length; offset += 200) {
      const batch = inputs.slice(offset, offset + 200);
      const publications = await tx.workInstructionSourcePublication.findMany({
        where: { publishedVersion: { OR: batch } },
        include: publishedPublicationInclude
      });
      const legacyRows = await tx.workInstructionRow.findMany({
        where: { OR: batch, publication: { is: null } },
        include: { steps: { orderBy: { step: 'asc' }, include: { asset: true } } }
      });
      const add = (row: WorkInstructionRowView, updateAvailable: boolean) => {
        const key = JSON.stringify([row.partNumber, row.shootingTarget]);
        let group = found.get(key);
        if (!group) {
          group = { partNumber: row.partNumber!, shootingTarget: row.shootingTarget!, rows: [], steps: [], updateAvailable: false };
          found.set(key, group);
        }
        group.rows.push(row);
        group.updateAvailable ||= updateAvailable;
      };
      for (const publication of publications) {
        add(toPublishedRowView(publication), publication.latestVersionId !== publication.publishedVersionId);
      }
      for (const row of legacyRows) add(toWorkInstructionRowView(row), false);
    }
    for (const group of found.values()) {
      group.rows.sort((left, right) => compareSourceOrder(left.source, right.source));
      group.steps = group.rows.flatMap((row) => row.steps.map((step) => ({ ...step, rowId: row.id, source: row.source })));
    }
    // With zero publications globally, every row is legacy: the query above
    // already reads exactly readWorkInstructionGroup's rows and step ordering.
    // A missing group stays null, so neither count nor a second snapshot is needed.
    return found;
  }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
  for (const [inputKey, key] of normalized) {
    if (key) result.set(inputKey, groups.get(JSON.stringify([key.partNumber, key.shootingTarget])) ?? null);
  }
  return result;
}
