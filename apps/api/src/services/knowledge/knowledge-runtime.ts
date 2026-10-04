import path from 'node:path';

import { prisma } from '../../lib/prisma.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import { getLocalLlmRuntimeController } from '../inference/runtime/get-local-llm-runtime-controller.js';
import { getImageOcrPort } from '../ocr/image-ocr-runtime.js';
import { logger } from '../../lib/logger.js';

import { PrismaKnowledgeIntakeRepository } from './prisma-knowledge-intake.repository.js';
import { PrismaKnowledgeProcedureRepository } from './prisma-knowledge-procedure.repository.js';
import { PrismaProcedureMaterialRepository } from './prisma-procedure-material.repository.js';
import { ProcedureInference } from './procedure-inference.js';
import { ProcedureWorker } from './procedure-worker.js';
import { GitKnowledgeDocumentStore } from './git-knowledge-document-store.js';
import { KnowledgeAssetStore } from './knowledge-asset-store.js';
import { KnowledgeInference, KnowledgePhotoDescriber } from './knowledge-inference.js';
import { InferenceKnowledgeOrganizer } from './inference-knowledge-organizer.js';
import { PdfKnowledgeImporter } from './pdf-knowledge-importer.js';
import { PopplerPdfPagesAdapter } from './poppler-pdf-pages.adapter.js';
import { KnowledgeWorker } from './knowledge-worker.js';
import { KnowledgeIntakeService, type Poster } from './knowledge-intake.service.js';
import { KnowledgeTriageService } from './knowledge-triage.service.js';
import { ensureKnowledgeReferenceData } from './knowledge-reference-data.js';
import { PrismaKnowledgeReviewerRepository } from './prisma-knowledge-reviewer.repository.js';
import { PrismaTriageRepository } from './prisma-triage.repository.js';

async function resolvePoster(tagUid: string): Promise<Poster | null> {
  const employee = await prisma.employee.findFirst({ where: { nfcTagUid: tagUid.trim() }, select: { id: true, displayName: true, status: true } });
  return employee && employee.status === 'ACTIVE' ? { id: employee.id, displayName: employee.displayName } : null;
}

async function activeWorkTypes(): Promise<string[]> {
  return (await prisma.knowledgeWorkType.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' }, select: { name: true } })).map(row => row.name);
}

function createKnowledgeRuntime() {
  const files = getFileStorageRuntime();
  const repository = new PrismaKnowledgeIntakeRepository(prisma);
  const assets = new KnowledgeAssetStore(files.store);
  const documents = new GitKnowledgeDocumentStore(path.join(files.root, 'knowledge-git', 'preparation.git'));
  const runtime = getLocalLlmRuntimeController();
  const inferenceRuntime = getInferenceRuntime();
  const text = inferenceRuntime.createTextCompletionPort();
  const inference = new KnowledgeInference(text);
  const organizer = new InferenceKnowledgeOrganizer(text, new KnowledgePhotoDescriber(assets, inferenceRuntime.createVisionCompletionPort()));
  const pdf = new PdfKnowledgeImporter(assets, new PopplerPdfPagesAdapter(), getImageOcrPort());
  const materials = new PrismaProcedureMaterialRepository(prisma);
  const procedures = new PrismaKnowledgeProcedureRepository(prisma);
  const triage = new PrismaTriageRepository(prisma);
  const worker = new KnowledgeWorker({ repository, materials, triage, organizer, inference, assets, pdf, runtime,
    logError: error => logger.warn({ err: error }, 'Knowledge background processing failed'),
  });
  const procedureWorker = new ProcedureWorker({ triage, materials, procedures, inference: new ProcedureInference(text),
    workTypes: activeWorkTypes,
    scannedPartNumber: async intakeId => (await repository.byIds([intakeId]))[0]?.scannedPartNumber ?? null,
    logError: error => logger.warn({ err: error }, 'Knowledge procedure building failed') });
  return { reviewers: new PrismaKnowledgeReviewerRepository(prisma), repository, assets, documents, worker, procedures, materials, triage, procedureWorker, workTypes: activeWorkTypes,
    ensureReferenceData: () => ensureKnowledgeReferenceData(prisma, triage, procedures),
    intake: new KnowledgeIntakeService(repository, assets, resolvePoster),
    triageService: new KnowledgeTriageService({ triage, intakes: repository, resolvePoster }) };
}

let runtime: ReturnType<typeof createKnowledgeRuntime> | undefined;
export function getKnowledgeRuntime() { return runtime ??= createKnowledgeRuntime(); }
