import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { KnowledgeAssetStore } from './knowledge-asset-store.js';
import type { Intake, KnowledgeIntakeRepositoryPort } from './knowledge-intake.port.js';
import type { Triage } from './triage.port.js';

/** An active employee identified by the NFC tag scanned before posting. */
export type Poster = { id: string; displayName: string };
export type PosterResolver = (tagUid: string) => Promise<Poster | null>;

export const intakeRequestSchema = z.object({
  id: z.string().uuid(), conversationId: z.string().uuid(), text: z.string().max(12_000),
  files: z.array(z.object({ kind: z.enum(['image', 'pdf']), filename: z.string().min(1).max(200), base64: z.string().max(27_000_000) }).strict()).max(4),
  // Every post is made by an employee who scanned their NFC tag just before sending.
  posterTagUid: z.string().trim().min(1).max(64),
  scannedPartNumber: z.string().trim().min(1).max(64).optional(),
}).strict().refine(value => value.text.trim() || value.files.length, 'メモまたは添付が必要です')
  .refine(value => !value.files.some(file => file.kind === 'pdf') || value.files.length === 1, 'PDFは一度に1件ずつ送信してください');

export function intakeResponse(row: Intake, triage?: Triage) {
  return {
    id: row.id, text: row.text, state: row.state, version: row.version,
    files: row.files.map(file => ({ filename: file.filename, kind: file.kind })),
    message: row.result?.message ?? (row.state === 'receiving' ? '送信が未完了です。同じ添付を再送してください。' : '受け付けました。処理を進めています。'),
    ...(row.result?.report ? { report: row.result.report } : {}),
    errorCode: row.errorCode,
    posterName: row.posterNameSnapshot,
    scannedPartNumber: row.scannedPartNumber,
    ...(triage ? { triage: { state: triage.state, suggestions: triage.suggestions, decidedProcedureId: triage.decidedProcedureId } } : {}),
    choices: row.state === 'choice' ? [
      { id: 'save', label: 'ナレッジの記録に残す' }, { id: 'ask', label: 'ナレッジについて調べる' },
      { id: 'report', label: 'ナレッジのレポートにする' }, { id: 'delegate', label: '別の業務について相談する' },
    ] : [],
  };
}

export class KnowledgeIntakeService {
  constructor(private readonly repository: KnowledgeIntakeRepositoryPort, private readonly assets: KnowledgeAssetStore,
    private readonly resolvePoster: PosterResolver) {}

  async receive(ownerKey: string, raw: unknown) {
    const input = intakeRequestSchema.parse(raw);
    const poster = await this.resolvePoster(input.posterTagUid);
    if (!poster) throw new Error('UNKNOWN_POSTER');
    const files = input.files.map(file => {
      const bytes = Buffer.from(file.base64, 'base64');
      if (bytes.toString('base64') !== file.base64) throw new Error('INVALID_ATTACHMENT');
      if (!bytes.length || bytes.length > (file.kind === 'pdf' ? 20_000_000 : 10_000_000)) throw new Error('INVALID_ATTACHMENT');
      if (file.kind === 'pdf' && !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('INVALID_ATTACHMENT');
      const id = createHash('sha256').update(bytes).digest('hex');
      return { bytes, reference: { id, key: `knowledge-assets/${id}/original`, kind: file.kind, filename: file.filename } };
    });
    const references = files.map(file => file.reference);
    const scannedPartNumber = input.scannedPartNumber ?? null;
    const inputHash = createHash('sha256').update(JSON.stringify({ text: input.text, files: references, poster: poster.id, scannedPartNumber })).digest('hex');
    let row = await this.repository.receive({ id: input.id, ownerKey, conversationId: input.conversationId, inputHash, text: input.text, files: references,
      posterEmployeeId: poster.id, posterNameSnapshot: poster.displayName, scannedPartNumber });
    if (row.state === 'receiving') {
      for (const file of files) await this.assets.save(file.bytes, 'original');
      await this.repository.accepted(row.id, ownerKey);
      row = (await this.repository.get(row.id, ownerKey))!;
    }
    // A tagged post is knowledge to record, so it needs no intent classification by the model.
    if (row.state === 'pending' && !row.action) {
      await this.repository.route(row.id, ownerKey, 'save');
      row = (await this.repository.get(row.id, ownerKey))!;
    }
    return intakeResponse(row);
  }
}
