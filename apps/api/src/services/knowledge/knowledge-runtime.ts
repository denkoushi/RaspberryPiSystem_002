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
import { KnowledgeIntakeService } from './knowledge-intake.service.js';

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
  const worker = new KnowledgeWorker({ repository, materials, organizer, inference, assets, pdf, runtime,
    logError: error => logger.warn({ err: error }, 'Knowledge background processing failed'),
  });
  // Sources saved before procedure building existed; enqueue is idempotent per source id.
  const backfillLegacyMaterials = async () => { await materials.enqueue('legacy-ready', await repository.readySources()); };
  return { repository, assets, documents, worker, intake: new KnowledgeIntakeService(repository, assets, inference, runtime),
    procedures, materials, backfillLegacyMaterials,
    procedureWorker: new ProcedureWorker({ materials, procedures, inference: new ProcedureInference(text),
      logError: error => logger.warn({ err: error }, 'Knowledge procedure building failed') }) };
}

let runtime: ReturnType<typeof createKnowledgeRuntime> | undefined;
export function getKnowledgeRuntime() { return runtime ??= createKnowledgeRuntime(); }
