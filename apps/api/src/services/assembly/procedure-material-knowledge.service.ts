import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';
import sharp from 'sharp';

import { ApiError } from '../../lib/errors.js';
import { prisma as defaultPrisma } from '../../lib/prisma.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { FileStorageAlreadyExistsError } from '../file-storage/file-storage-errors.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';
import { getKnowledgeRuntime } from '../knowledge/knowledge-runtime.js';
import { procedureContentSchema } from '../knowledge/procedure-content.js';

type KnowledgeRuntime = ReturnType<typeof getKnowledgeRuntime>;
type ReadonlyKnowledge = {
  repository: Pick<KnowledgeRuntime['repository'], 'readySources'>;
  assets: Pick<KnowledgeRuntime['assets'], 'readDisplay' | 'readOriginal'>;
};
type KnowledgeRef = { kind: 'source' | 'procedure_step'; sourceId?: string; imageId?: string; procedureId?: string; revisionNumber?: number; stepId?: string; fromDisplay?: true };
type Candidate = {
  candidateKey: string; kind: 'TEXT' | 'PHOTO'; title: string; summary?: string; preview: string; sourceLabel: string;
  text: string; imageId?: string; originalKey?: string; knowledgeRef: KnowledgeRef; subjectHint: string; receivedAt: Date; searchText: string;
};
type CandidateSnapshot = { items: Candidate[]; imageIds: Set<string> };
const textLimit = 10_000;
const candidateCacheMs = 30_000;
const photoContentTypes: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const headerSelect = { id: true, title: true, partNumber: true, processName: true, target: true, workType: true } as const;

function splitText(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > textLimit) {
    const window = remaining.slice(0, textLimit);
    const paragraph = window.lastIndexOf('\n\n');
    const line = window.lastIndexOf('\n');
    const end = paragraph >= 0 ? paragraph + 2 : line >= 0 ? line + 1 : textLimit;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function firstDedupeKey(candidate: Candidate): string {
  return candidate.kind === 'TEXT' && candidate.text.length > textLimit ? `${candidate.candidateKey}:1` : candidate.candidateKey;
}

export class ProcedureMaterialKnowledgeService {
  private candidateCache?: { expiresAt: number; value: Promise<CandidateSnapshot> };

  constructor(
    private readonly db = defaultPrisma,
    private readonly store: DurableFileStorePort = getFileStorageRuntime().store,
    private readonly runtime: () => ReadonlyKnowledge = getKnowledgeRuntime,
    private readonly enabled: () => boolean = () => process.env.HERMES_KNOWLEDGE_ENABLED === 'true',
  ) {}

  private candidates(): Promise<CandidateSnapshot> {
    if (this.candidateCache && this.candidateCache.expiresAt > Date.now()) return this.candidateCache.value;
    const cache = { expiresAt: Date.now() + candidateCacheMs, value: this.loadCandidates().then((items) => ({
      items, imageIds: new Set(items.flatMap((c) => c.imageId ? [c.imageId] : [])),
    })) };
    this.candidateCache = cache;
    void cache.value.catch(() => { if (this.candidateCache === cache) this.candidateCache = undefined; });
    return cache.value;
  }

  private async loadCandidates(): Promise<Candidate[]> {
    const runtime = this.runtime();
    const [sources, documents] = await Promise.all([
      runtime.repository.readySources(),
      this.db.knowledgeProcedure.findMany({ where: { publishedRevisionId: { not: null } }, orderBy: { title: 'asc' }, select: {
        ...headerSelect, publishedRevision: { select: { revisionNumber: true, state: true, content: true, createdAt: true } },
      } }),
    ]);
    // Runtime source DTOs omit the chosen procedure; read its headers in one query.
    const materials = await this.db.knowledgeProcedureMaterial.findMany({ where: { sourceId: { in: sources.map(({ source }) => source.id) } }, select: { sourceId: true, procedure: { select: headerSelect } } });
    const originals = new Map(sources.flatMap(({ source }) => source.images.map((image) => [image.id, image.originalKey] as const)));
    const result: Candidate[] = [];
    for (const { source, organized } of sources) {
      const header = materials.find((m) => m.sourceId === source.id)?.procedure;
      const subjectHint = [organized.title, header?.partNumber, header?.processName].filter(Boolean).join(' ');
      const common = { title: organized.title, sourceLabel: 'Chat 投稿', subjectHint, receivedAt: new Date(source.capturedAt),
        searchText: [organized.title, organized.summary, source.text, header?.title, header?.partNumber, header?.processName, header?.target, header?.workType].filter(Boolean).join('\n') };
      if (source.text.trim()) result.push({ ...common, candidateKey: `knowledge:source:${source.id}:text`, kind: 'TEXT', text: source.text, summary: organized.summary,
        preview: source.text.slice(0, 200), knowledgeRef: { kind: 'source', sourceId: source.id } });
      for (const image of source.images) result.push({ ...common, candidateKey: `knowledge:source:${source.id}:image:${image.id}`, kind: 'PHOTO', text: '', imageId: image.id, originalKey: image.originalKey,
        preview: organized.photos.find((p) => p.id === image.id)?.description ?? '', knowledgeRef: { kind: 'source', sourceId: source.id, imageId: image.id } });
    }
    for (const document of documents) {
      const revision = document.publishedRevision;
      if (!revision || revision.state !== 'published') continue;
      const subjectHint = [document.title, document.partNumber, document.processName].filter(Boolean).join(' ');
      for (const step of procedureContentSchema.parse(revision.content).steps) {
        const text = [step.title, step.body, ...step.cautions].join('\n');
        const prefix = `knowledge:procedure:${document.id}:${revision.revisionNumber}:${step.id}`;
        const knowledgeRef: KnowledgeRef = { kind: 'procedure_step', procedureId: document.id, revisionNumber: revision.revisionNumber, stepId: step.id };
        const common = { title: step.title, sourceLabel: `手順書: ${document.title}`, subjectHint, receivedAt: new Date(revision.createdAt),
          searchText: [subjectHint, document.target, document.workType, text].filter(Boolean).join('\n') };
        result.push({ ...common, candidateKey: `${prefix}:text`, kind: 'TEXT', text, preview: text.slice(0, 200), knowledgeRef });
        for (const photo of step.photos) result.push({ ...common, candidateKey: `${prefix}:image:${photo.imageId}`, kind: 'PHOTO', text: '', imageId: photo.imageId, originalKey: originals.get(photo.imageId),
          preview: photo.caption, knowledgeRef: { ...knowledgeRef, imageId: photo.imageId } });
      }
    }
    return result;
  }

  async list(options: { q?: string; limit?: number } = {}) {
    if (!this.enabled()) return { enabled: false, items: [] };
    const q = options.q?.normalize('NFKC').toLowerCase();
    const candidates = (await this.candidates()).items.filter((c) => !q || c.searchText.normalize('NFKC').toLowerCase().includes(q)).slice(0, Math.min(options.limit ?? 100, 300));
    const imported = await this.db.procedureMaterial.findMany({ where: { gmailDedupeKey: { in: candidates.map(firstDedupeKey) } }, select: { gmailDedupeKey: true } });
    const keys = new Set(imported.map((m) => m.gmailDedupeKey));
    return { enabled: true, items: candidates.map((candidate) => {
      const { candidateKey, kind, title, preview, sourceLabel, imageId, summary } = candidate;
      return { candidateKey, kind, title, preview, sourceLabel, ...(summary ? { summary } : {}), ...(imageId ? { imageId } : {}), alreadyImported: keys.has(firstDedupeKey(candidate)) };
    }) };
  }

  async readImage(imageId: string) {
    if (!this.enabled() || !(await this.candidates()).imageIds.has(imageId)) throw new ApiError(404, '写真がありません');
    try { return await this.runtime().assets.readDisplay(imageId); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ApiError(404, '写真がありません'); throw error; }
  }

  private async saveOriginal(key: string, bytes: Buffer) {
    try { await this.store.write({ key, data: bytes, mode: 'create', integrity: true }); }
    catch (error) {
      if (!(error instanceof FileStorageAlreadyExistsError)) throw error;
      if (!(await this.store.read(key, { verifyIntegrity: true })).equals(bytes)) throw new Error('Procedure material identity conflict');
    }
  }

  private async importCandidate(candidate: Candidate): Promise<'imported' | 'duplicate'> {
    if (await this.db.procedureMaterial.findUnique({ where: { gmailDedupeKey: candidate.candidateKey } })) return 'duplicate';
    const data: Prisma.ProcedureMaterialCreateInput = { kind: candidate.kind, origin: 'KNOWLEDGE', knowledgeRef: candidate.knowledgeRef,
      gmailDedupeKey: candidate.candidateKey, subjectHint: candidate.subjectHint, receivedAt: candidate.receivedAt };
    let bytes: Buffer | undefined;
    if (candidate.kind === 'TEXT') data.text = candidate.text;
    else {
      const assets = this.runtime().assets;
      if (candidate.originalKey) {
        // readOriginal takes the original hash, while imageId is the display JPEG hash.
        try { bytes = await assets.readOriginal(candidate.originalKey.split('/')[1]!); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      if (!bytes) {
        bytes = await assets.readDisplay(candidate.imageId!);
        data.knowledgeRef = { ...candidate.knowledgeRef, fromDisplay: true };
      }
      const metadata = await sharp(bytes).metadata();
      const contentType = photoContentTypes[metadata.format ?? ''];
      if (!contentType || !metadata.width || !metadata.height) throw new Error('対応する写真ではありません');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      Object.assign(data, { storageKey: `procedure-materials/${sha256}/original`, sha256, contentType, byteSize: bytes.length, width: metadata.width, height: metadata.height });
      await this.saveOriginal(data.storageKey!, bytes);
    }
    try { await this.db.procedureMaterial.create({ data }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002'
        || !await this.db.procedureMaterial.findUnique({ where: { gmailDedupeKey: candidate.candidateKey } })) throw error;
      return 'duplicate';
    }
    if (bytes) {
      // As in Gmail ingestion, restore an original GC removed before the row existed.
      try { await this.store.stat(data.storageKey!); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await this.saveOriginal(data.storageKey!, bytes); }
    }
    return 'imported';
  }

  async import(candidateKeys: string[]) {
    const result = { imported: 0, duplicate: 0, failed: [] as Array<{ candidateKey: string; reason: string }> };
    if (!this.enabled()) throw new ApiError(409, 'ナレッジ機能は無効です');
    try {
      const candidates = new Map((await this.candidates()).items.map((c) => [c.candidateKey, c]));
      for (const candidateKey of candidateKeys) {
        try {
          const candidate = candidates.get(candidateKey);
          if (!candidate) throw new Error('候補がありません');
          const chunks = candidate.kind === 'TEXT' ? splitText(candidate.text) : [''];
          for (const [index, text] of chunks.entries()) {
            const part = chunks.length > 1 ? { ...candidate, text, candidateKey: `${candidateKey}:${index + 1}`, subjectHint: `${candidate.subjectHint} (${index + 1}/${chunks.length})` } : candidate;
            // eslint-disable-next-line no-await-in-loop
            result[await this.importCandidate(part)]++;
          }
        } catch (error) { result.failed.push({ candidateKey, reason: error instanceof Error ? error.message : String(error) }); }
      }
    } finally {
      this.candidateCache = undefined;
    }
    return result;
  }
}
