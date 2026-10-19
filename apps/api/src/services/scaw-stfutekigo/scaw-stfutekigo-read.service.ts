import { prisma } from '../../lib/prisma.js';
import { normalizeWorkInstructionPartNumber } from '../work-instructions/domain/normalization.js';

export type ScawStFutekigoReadItem = {
  id: string;
  discoveredOn: string | null;
  originDepartmentName: string | null;
  remarks: string | null;
  nonconformityContent: string | null;
  dispositionContent: string | null;
  correctiveContent1: string | null;
  correctiveContent2: string | null;
  partName: string | null;
  machineName: string | null;
};

export type ScawStFutekigoCurrentRepository = {
  readCurrentByPartNumber(partNumber: string): Promise<ReadonlyArray<ScawStFutekigoReadItem>>;
};

type ScawStFutekigoCurrentDbRow = {
  id: string;
  nonconformityNo: string;
  discoveredOn: Date | string | null;
  originDepartmentName: string | null;
  remarks: string | null;
  nonconformityContent: string | null;
  dispositionContent: string | null;
  correctiveContent1: string | null;
  correctiveContent2: string | null;
  partName: string | null;
  machineName: string | null;
};

function toDateOnly(value: Date | string | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 10) : null;
}

function toReadItem(row: ScawStFutekigoCurrentDbRow): ScawStFutekigoReadItem {
  return {
    id: row.id,
    discoveredOn: toDateOnly(row.discoveredOn),
    originDepartmentName: row.originDepartmentName,
    remarks: row.remarks,
    nonconformityContent: row.nonconformityContent,
    dispositionContent: row.dispositionContent,
    correctiveContent1: row.correctiveContent1,
    correctiveContent2: row.correctiveContent2,
    partName: row.partName,
    machineName: row.machineName
  };
}

/**
 * Reads only the active rows from the persisted current projection.  The
 * production schedule is intentionally absent from this query: enrichment is
 * performed by the ingest projection and remains durable after schedule rows
 * change or disappear.
 */
export class PrismaScawStFutekigoCurrentRepository implements ScawStFutekigoCurrentRepository {
  async readCurrentByPartNumber(partNumber: string): Promise<ReadonlyArray<ScawStFutekigoReadItem>> {
    const rows = await prisma.scawStfutekigoCurrent.findMany({
      where: {
        partNumber,
        isPresentInLatestSnapshot: true
      },
      select: {
        id: true,
        nonconformityNo: true,
        discoveredOn: true,
        originDepartmentName: true,
        remarks: true,
        nonconformityContent: true,
        dispositionContent: true,
        correctiveContent1: true,
        correctiveContent2: true,
        partName: true,
        machineName: true
      },
      orderBy: [
        { discoveredOn: { sort: 'desc', nulls: 'last' } },
        { nonconformityNo: 'desc' }
      ]
    });
    return rows.map(toReadItem);
  }
}

/** Read facade used by HTTP and future non-HTTP adapters. */
export class ScawStFutekigoReadService {
  constructor(
    private readonly repository: ScawStFutekigoCurrentRepository =
      new PrismaScawStFutekigoCurrentRepository()
  ) {}

  readCurrentByPartNumber(partNumber: string): Promise<ReadonlyArray<ScawStFutekigoReadItem>> {
    const normalized = normalizeWorkInstructionPartNumber(partNumber);
    if (!normalized) return Promise.resolve([]);
    return this.repository.readCurrentByPartNumber(normalized);
  }
}
