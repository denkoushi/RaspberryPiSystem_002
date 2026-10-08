import type { ProcedureMaterial } from '@prisma/client';

const PROCEDURE_MATERIAL_ROW_LIMIT = 20000;
const PROCEDURE_MATERIAL_BODY_TEXT_LIMIT = 4000;

type MaterialRow = Pick<ProcedureMaterial, 'id' | 'gmailMessageId' | 'kind' | 'subjectHint' | 'text' | 'originalFileName' | 'discardedAt'>;

export function procedureMaterialRows(materials: MaterialRow[]): Array<Record<string, string>> {
  const groups = new Map<string, MaterialRow[]>();
  for (const material of materials) {
    if (material.discardedAt) continue;
    const id = material.gmailMessageId === null ? `material:${material.id}` : `mail:${material.gmailMessageId}`;
    const group = groups.get(id) ?? [];
    group.push(material);
    groups.set(id, group);
  }
  const records: Array<Record<string, string>> = [];
  for (const [id, group] of groups) {
    const hints = [...new Set(group.map(row => row.subjectHint).filter((text): text is string => !!text?.trim()))];
    const texts = group.filter(row => row.kind === 'TEXT').map(row => row.text);
    const filenames = group.map(row => row.originalFileName);
    const bodyText = [...hints, ...texts, ...filenames].filter(text => text?.trim()).join('\n').slice(0, PROCEDURE_MATERIAL_BODY_TEXT_LIMIT);
    if (bodyText.trim()) records.push({ kind: 'procedure_material', id, bodyText });
  }
  return records;
}

export async function loadProcedureMaterialRecords() {
  const { prisma } = await import('../../lib/prisma.js');
  const materials = await prisma.$queryRaw<MaterialRow[]>`
    SELECT "id", "gmailMessageId", "kind", "subjectHint", "originalFileName", "discardedAt",
      CASE WHEN "kind" = 'TEXT' THEN LEFT("text", ${PROCEDURE_MATERIAL_BODY_TEXT_LIMIT}) ELSE NULL END AS "text"
    FROM "ProcedureMaterial" WHERE "discardedAt" IS NULL
    ORDER BY "receivedAt" DESC, "createdAt" DESC, "id" DESC LIMIT ${PROCEDURE_MATERIAL_ROW_LIMIT}
  `;
  return procedureMaterialRows(materials);
}
