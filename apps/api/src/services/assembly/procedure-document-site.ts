import { prisma } from '../../lib/prisma.js';
import type { ProcedureSite } from './procedure-published-examples.js';

/** The department (組立 / 研削) any revision of the document is filed under, by process or parent process name. */
export async function documentSite(revisionRootId: string): Promise<ProcedureSite | null> {
  const assignments = await prisma.procedureManualAssignment.findMany({
    where: { assemblyProcedureDocument: { revisionMetadata: { revisionRootId } } },
    select: { process: { select: { name: true, parent: { select: { name: true } } } } },
  });
  const names = assignments.flatMap(({ process }) => [process.name, process.parent?.name ?? '']);
  if (names.some(name => name.startsWith('組立'))) return 'assembly';
  if (names.some(name => name.startsWith('研削'))) return 'grinding';
  return null;
}
