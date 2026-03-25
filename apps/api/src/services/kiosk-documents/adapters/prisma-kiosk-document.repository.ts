import type { KioskDocument, Prisma } from '@prisma/client';

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
    const { query, sourceType, enabledOnly = true } = filters;
    const where: Prisma.KioskDocumentWhereInput = {};
    if (enabledOnly) {
      where.enabled = true;
    }
    if (sourceType) {
      where.sourceType = sourceType;
    }
    if (query && query.trim().length > 0) {
      const q = query.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { filename: { contains: q, mode: 'insensitive' } },
        { sourceAttachmentName: { contains: q, mode: 'insensitive' } },
      ];
    }
    return prisma.kioskDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.kioskDocument.delete({ where: { id } });
  }

  async update(id: string, data: Prisma.KioskDocumentUpdateInput): Promise<KioskDocument> {
    return prisma.kioskDocument.update({ where: { id }, data });
  }
}
