import { Prisma, type KioskDocument } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import type {
  KioskDocumentListFilters,
  KioskDocumentRepositoryPort,
} from '../ports/kiosk-document-repository.port.js';
import {
  buildKioskDocumentSearchOrConditions,
  escapeLikePattern,
} from '../search/build-kiosk-document-search-or.js';

const KIOSK_DOCUMENT_SUMMARY_SELECT = {
  id: true,
  title: true,
  displayTitle: true,
  filename: true,
  filePath: true,
  fileHash: true,
  sourceType: true,
  gmailMessageId: true,
  sourceAttachmentName: true,
  gmailLogicalKey: true,
  gmailInternalDateMs: true,
  gmailDedupeKey: true,
  pageCount: true,
  ocrStatus: true,
  ocrEngine: true,
  ocrStartedAt: true,
  ocrFinishedAt: true,
  ocrRetryCount: true,
  ocrFailureReason: true,
  ocrTargetPages: true,
  candidateFhincd: true,
  candidateDrawingNumber: true,
  candidateProcessName: true,
  candidateResourceCd: true,
  candidateDocumentNumber: true,
  confidenceFhincd: true,
  confidenceDrawingNumber: true,
  confidenceProcessName: true,
  confidenceResourceCd: true,
  confidenceDocumentNumber: true,
  confirmedFhincd: true,
  confirmedDrawingNumber: true,
  confirmedProcessName: true,
  confirmedResourceCd: true,
  confirmedDocumentNumber: true,
  confirmedSummaryText: true,
  documentCategory: true,
  summaryCandidate1: true,
  summaryCandidate2: true,
  summaryCandidate3: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.KioskDocumentSelect;

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

  async findByGmailLogicalKey(key: string): Promise<KioskDocument | null> {
    return prisma.kioskDocument.findUnique({ where: { gmailLogicalKey: key } });
  }

  async list(filters: KioskDocumentListFilters): Promise<KioskDocument[]> {
    const {
      query,
      sourceType,
      ocrStatus,
      includeCandidateInSearch = false,
      enabledOnly = true,
      fields,
      limit,
      offset,
    } = filters;
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
    const listQuery = {
      where,
      orderBy: { createdAt: 'desc' as const },
      ...(limit !== undefined ? { take: limit } : {}),
      ...(offset !== undefined ? { skip: offset } : {}),
      ...(fields === 'summary' ? { select: KIOSK_DOCUMENT_SUMMARY_SELECT } : {}),
    };
    if (searchQuery && searchQuery.length > 0) {
      const q = escapeLikePattern(searchQuery);
      if (q.length === 0) {
        return prisma.kioskDocument.findMany(listQuery);
      }
      where.OR = buildKioskDocumentSearchOrConditions(q, {
        includeCandidateFields: includeCandidateInSearch,
      });
    }
    return prisma.kioskDocument.findMany(listQuery);
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
