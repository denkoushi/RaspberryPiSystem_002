import type { PrismaClient } from '@prisma/client';

export async function ensureProcedureManualProcesses(db: PrismaClient): Promise<void> {
  await db.procedureManualProcess.createMany({
    data: [{ id: 'procedure-manual-machining', parentId: null, name: '加工', sortOrder: 2 }],
    skipDuplicates: true,
  });
  await db.procedureManualProcess.createMany({
    data: [
      { id: 'procedure-manual-machining-cutting', parentId: 'procedure-manual-machining', name: '切削', sortOrder: 0, subjectKind: 'PART' },
      { id: 'procedure-manual-machining-grinding', parentId: 'procedure-manual-machining', name: '研削', sortOrder: 1, subjectKind: 'PART' },
    ],
    skipDuplicates: true,
  });
}
