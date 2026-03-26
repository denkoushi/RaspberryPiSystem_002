import { Prisma, type KioskDocument } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import type {
  KioskDocumentListFilters,
  KioskDocumentRepositoryPort,
} from '../ports/kiosk-document-repository.port.js';

export class PrismaKioskDocumentRepository implements KioskDocumentRepositoryPort {
  async create(data: Prisma.KioskDocumentCreateInput): Promise<KioskDocument> {
    return prisma.kioskDocument.create({ data });
  }

  async findById(id: string): Promise<KioskDocument | null> {
    return prisma.kioskDocument.findUnique({ where: { id } });
  }

  async findByGmailDedupeKey(key: string): Promise<KioskDocument | null> {
    return prisma.kioskDocument.findUnique({ where: { gmailDedupeKey: key } });
  }

  async list(filters: KioskDocumentListFilters): Promise<KioskDocument[]> {
    const { query, sourceType, ocrStatus, includeCandidateInSearch = false, enabledOnly = true } = filters;
    const where: Prisma.KioskDocumentWhereInput = {};
    if (enabledOnly) {
      where.enabled = true;
    }
    if (sourceType) {
      where.sourceType = sourceType;
    }
    if (ocrStatus) {
      where.ocrStatus = ocrStatus;
    }
    const searchQuery = query?.trim();
    if (searchQuery && searchQuery.length > 0) {
      const q = searchQuery;
      const searchTargets: Prisma.KioskDocumentWhereInput[] = [
        { displayTitle: { contains: q, mode: 'insensitive' } },
        { title: { contains: q, mode: 'insensitive' } },
        { filename: { contains: q, mode: 'insensitive' } },
        { sourceAttachmentName: { contains: q, mode: 'insensitive' } },
        { extractedText: { contains: q, mode: 'insensitive' } },
        { confirmedFhincd: { contains: q, mode: 'insensitive' } },
        { confirmedDrawingNumber: { contains: q, mode: 'insensitive' } },
        { confirmedProcessName: { contains: q, mode: 'insensitive' } },
        { confirmedResourceCd: { contains: q, mode: 'insensitive' } },
      ];
      if (includeCandidateInSearch) {
        searchTargets.push(
          { candidateFhincd: { contains: q, mode: 'insensitive' } },
          { candidateDrawingNumber: { contains: q, mode: 'insensitive' } },
          { candidateProcessName: { contains: q, mode: 'insensitive' } },
          { candidateResourceCd: { contains: q, mode: 'insensitive' } },
        );
      }
      where.OR = searchTargets;

      const conditions: Prisma.Sql[] = [];
      if (enabledOnly) {
        conditions.push(Prisma.sql`d."enabled" = true`);
      }
      if (sourceType) {
        conditions.push(Prisma.sql`d."sourceType" = ${sourceType}`);
      }
      if (ocrStatus) {
        conditions.push(Prisma.sql`d."ocrStatus" = ${ocrStatus}`);
      }
      conditions.push(
        Prisma.sql`to_tsvector(
          'simple',
          coalesce(d."displayTitle",'') || ' ' ||
          coalesce(d."title",'') || ' ' ||
          coalesce(d."filename",'') || ' ' ||
          coalesce(d."sourceAttachmentName",'') || ' ' ||
          coalesce(d."extractedText",'') || ' ' ||
          coalesce(d."confirmedFhincd",'') || ' ' ||
          coalesce(d."confirmedDrawingNumber",'') || ' ' ||
          coalesce(d."confirmedProcessName",'') || ' ' ||
          coalesce(d."confirmedResourceCd",'') ${
            includeCandidateInSearch
              ? Prisma.sql` || ' ' || coalesce(d."candidateFhincd",'') || ' ' || coalesce(d."candidateDrawingNumber",'') || ' ' || coalesce(d."candidateProcessName",'') || ' ' || coalesce(d."candidateResourceCd",'')`
              : Prisma.sql``
          }
        ) @@ plainto_tsquery('simple', ${searchQuery})`
      );

      const queryRows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT d."id"
        FROM "KioskDocument" d
        WHERE ${Prisma.join(conditions, ' AND ')}
        ORDER BY ts_rank_cd(
          to_tsvector(
            'simple',
            coalesce(d."displayTitle",'') || ' ' ||
            coalesce(d."title",'') || ' ' ||
            coalesce(d."filename",'') || ' ' ||
            coalesce(d."sourceAttachmentName",'') || ' ' ||
            coalesce(d."extractedText",'') || ' ' ||
            coalesce(d."confirmedFhincd",'') || ' ' ||
            coalesce(d."confirmedDrawingNumber",'') || ' ' ||
            coalesce(d."confirmedProcessName",'') || ' ' ||
            coalesce(d."confirmedResourceCd",'') ${
              includeCandidateInSearch
                ? Prisma.sql` || ' ' || coalesce(d."candidateFhincd",'') || ' ' || coalesce(d."candidateDrawingNumber",'') || ' ' || coalesce(d."candidateProcessName",'') || ' ' || coalesce(d."candidateResourceCd",'')`
                : Prisma.sql``
            }
          ),
          plainto_tsquery('simple', ${searchQuery})
        ) DESC,
        d."createdAt" DESC
      `);

      if (queryRows.length === 0) {
        return [];
      }
      const ids = queryRows.map((r) => r.id);
      const rows = await prisma.kioskDocument.findMany({ where: { id: { in: ids } } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids.map((id) => byId.get(id)).filter((r): r is KioskDocument => Boolean(r));
    }
    return prisma.kioskDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPendingProcessing(limit: number): Promise<KioskDocument[]> {
    return prisma.kioskDocument.findMany({
      where: {
        ocrStatus: { in: ['PENDING', 'FAILED'] },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.max(1, limit),
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.kioskDocument.delete({ where: { id } });
  }

  async update(id: string, data: Prisma.KioskDocumentUpdateInput): Promise<KioskDocument> {
    return prisma.kioskDocument.update({ where: { id }, data });
  }

  async createMetadataHistory(data: Prisma.KioskDocumentMetadataHistoryCreateInput): Promise<void> {
    await prisma.kioskDocumentMetadataHistory.create({ data });
  }
}
