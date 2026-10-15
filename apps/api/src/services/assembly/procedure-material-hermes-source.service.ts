import type { ProcedureMaterial } from '@prisma/client';

const PROCEDURE_MATERIAL_ROW_LIMIT = 20000;
const PROCEDURE_MATERIAL_BODY_TEXT_LIMIT = 4000;

type MaterialRow = Pick<ProcedureMaterial, 'id' | 'gmailMessageId' | 'kind' | 'subjectHint' | 'text' | 'originalFileName' | 'discardedAt' | 'imageDescription'>;

export function procedureMaterialRows(materials: MaterialRow[]): Array<Record<string, string>> {
  const records: Array<Record<string, string>> = [];
  for (const material of materials) {
    if (material.discardedAt) continue;
    const id = `material:${material.id}`;
    const description = material.imageDescription?.trim().slice(0, 1000) ?? '';
    // Reserve room so long PDF page text cannot erase the image's searchable content.
    const prefix = [material.subjectHint, material.originalFileName, material.text]
      .filter(text => text?.trim()).join('\n')
      .slice(0, PROCEDURE_MATERIAL_BODY_TEXT_LIMIT - (description ? description.length + 1 : 0));
    const bodyText = [prefix, description].filter(Boolean).join('\n');
    if (bodyText.trim()) records.push({ kind: 'procedure_material', id, bodyText });
  }
  return records;
}

export async function loadProcedureMaterialRecords() {
  const { prisma } = await import('../../lib/prisma.js');
  const materials = await prisma.$queryRaw<MaterialRow[]>`
    SELECT "id", "gmailMessageId", "kind", "subjectHint", "originalFileName", "discardedAt",
      LEFT("text", ${PROCEDURE_MATERIAL_BODY_TEXT_LIMIT}::int) AS "text",
      LEFT("imageDescription", ${PROCEDURE_MATERIAL_BODY_TEXT_LIMIT}::int) AS "imageDescription"
    FROM "ProcedureMaterial" WHERE "discardedAt" IS NULL
    ORDER BY "receivedAt" DESC, "createdAt" DESC, "id" DESC LIMIT ${PROCEDURE_MATERIAL_ROW_LIMIT}
  `;
  return procedureMaterialRows(materials);
}
