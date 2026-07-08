import type { Prisma } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';

export type AssemblyCheckSummary = {
  requiredTotal: number;
  requiredCompleted: number;
  allRequiredCompleted: boolean;
};

type CheckItemLike = {
  id: string;
  required: boolean;
};

type CheckRecordLike = {
  checkItemId: string;
  checked: boolean;
};

export function computeAssemblyCheckSummary(
  checkItems: CheckItemLike[],
  records: CheckRecordLike[]
): AssemblyCheckSummary {
  const recordByItemId = new Map(records.map((record) => [record.checkItemId, record]));
  const requiredItems = checkItems.filter((item) => item.required);
  const requiredCompleted = requiredItems.filter((item) => recordByItemId.get(item.id)?.checked === true).length;
  const requiredTotal = requiredItems.length;
  return {
    requiredTotal,
    requiredCompleted,
    allRequiredCompleted: requiredTotal === 0 || requiredCompleted === requiredTotal
  };
}

export type AssemblyMarkerPageRefInput = {
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
  pageIndex?: number | null;
};

export function normalizeMarkerPageRef(
  ref: AssemblyMarkerPageRefInput,
  options: { allowOmitted?: boolean } = {}
): {
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  pageIndex: number | null;
} {
  const kioskDocumentId = ref.kioskDocumentId?.trim() || null;
  const assemblyProcedureDocumentId = ref.assemblyProcedureDocumentId?.trim() || null;
  const hasKiosk = kioskDocumentId != null;
  const hasAssembly = assemblyProcedureDocumentId != null;

  if (hasKiosk && hasAssembly) {
    throw new ApiError(400, '要領書PDFまたは組立手順書のどちらか一方を指定してください');
  }
  if (!hasKiosk && !hasAssembly) {
    if (!options.allowOmitted) {
      throw new ApiError(400, 'ページ参照が必要です');
    }
    return { kioskDocumentId: null, assemblyProcedureDocumentId: null, pageIndex: null };
  }

  const rawPageIndex = ref.pageIndex;
  const pageIndex = rawPageIndex == null ? 0 : Math.trunc(Number(rawPageIndex));
  if (!Number.isFinite(pageIndex) || pageIndex < 0) {
    throw new ApiError(400, 'ページ番号が不正です');
  }

  return { kioskDocumentId, assemblyProcedureDocumentId, pageIndex };
}

export async function loadAssemblyPageRefContext(
  tx: Prisma.TransactionClient,
  refs: AssemblyMarkerPageRefInput[]
): Promise<{
  assemblyDocs: Map<string, { status: string; isActive: boolean; pageCount: number }>;
  kioskDocs: Map<string, { enabled: boolean; pageCount: number | null }>;
}> {
  const assemblyIds = new Set<string>();
  const kioskIds = new Set<string>();
  for (const ref of refs) {
    const normalized = normalizeMarkerPageRef(ref, { allowOmitted: true });
    if (normalized.assemblyProcedureDocumentId) assemblyIds.add(normalized.assemblyProcedureDocumentId);
    if (normalized.kioskDocumentId) kioskIds.add(normalized.kioskDocumentId);
  }

  const [assemblyRows, kioskRows] = await Promise.all([
    assemblyIds.size > 0
      ? tx.assemblyProcedureDocument.findMany({
          where: { id: { in: [...assemblyIds] } },
          select: {
            id: true,
            status: true,
            isActive: true,
            pages: { select: { pageIndex: true } }
          }
        })
      : [],
    kioskIds.size > 0
      ? tx.kioskDocument.findMany({
          where: { id: { in: [...kioskIds] } },
          select: { id: true, enabled: true, pageCount: true }
        })
      : []
  ]);

  return {
    assemblyDocs: new Map(
      assemblyRows.map((row) => [
        row.id,
        { status: row.status, isActive: row.isActive, pageCount: row.pages.length }
      ])
    ),
    kioskDocs: new Map(kioskRows.map((row) => [row.id, { enabled: row.enabled, pageCount: row.pageCount }]))
  };
}

export function assertMarkerPageRefValid(
  ref: AssemblyMarkerPageRefInput,
  context: Awaited<ReturnType<typeof loadAssemblyPageRefContext>>,
  label: string,
  options: { allowOmitted?: boolean } = {}
): ReturnType<typeof normalizeMarkerPageRef> {
  const normalized = normalizeMarkerPageRef(ref, options);

  if (!normalized.kioskDocumentId && !normalized.assemblyProcedureDocumentId) {
    return normalized;
  }

  if (normalized.assemblyProcedureDocumentId) {
    const doc = context.assemblyDocs.get(normalized.assemblyProcedureDocumentId);
    if (!doc || !doc.isActive || doc.status !== 'PUBLISHED') {
      throw new ApiError(400, `${label}: 公開済みの組立手順書を指定してください`);
    }
    if (normalized.pageIndex! >= doc.pageCount) {
      throw new ApiError(400, `${label}: ページ番号が手順書のページ数を超えています`);
    }
    return normalized;
  }

  const kiosk = context.kioskDocs.get(normalized.kioskDocumentId!);
  if (!kiosk?.enabled) {
    throw new ApiError(400, `${label}: 有効な要領書PDFを指定してください`);
  }
  const maxPage = Math.max(kiosk.pageCount ?? 1, 1);
  if (normalized.pageIndex! >= maxPage) {
    throw new ApiError(400, `${label}: ページ番号が要領書PDFのページ数を超えています`);
  }
  return normalized;
}
