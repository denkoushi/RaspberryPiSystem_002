import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { LocalLlmRuntimeControllerPort } from '../inference/runtime/local-llm-runtime-control.port.js';

import type { KnowledgeAssetStore } from './knowledge-asset-store.js';
import type { Intake, KnowledgeIntakeRepositoryPort } from './knowledge-intake.port.js';
import type { KnowledgeInferencePort } from './knowledge-inference.js';

export const intakeRequestSchema = z.object({
  id: z.string().uuid(), conversationId: z.string().uuid(), text: z.string().max(12_000),
  files: z.array(z.object({ kind: z.enum(['image', 'pdf']), filename: z.string().min(1).max(200), base64: z.string().max(27_000_000) }).strict()).max(4),
}).strict().refine(value => value.text.trim() || value.files.length, 'メモまたは添付が必要です')
  .refine(value => !value.files.some(file => file.kind === 'pdf') || value.files.length === 1, 'PDFは一度に1件ずつ送信してください');

export function intakeResponse(row: Intake) {
  return {
    id: row.id, text: row.text, state: row.state, version: row.version,
    files: row.files.map(file => ({ filename: file.filename, kind: file.kind })),
    message: row.result?.message ?? (row.state === 'receiving' ? '送信が未完了です。同じ添付を再送してください。' : '受け付けました。処理を進めています。'),
    ...(row.result?.report ? { report: row.result.report } : {}),
    errorCode: row.errorCode,
    choices: row.state === 'choice' ? [
      { id: 'save', label: 'ナレッジの記録に残す' }, { id: 'ask', label: 'ナレッジについて調べる' },
      { id: 'report', label: 'ナレッジのレポートにする' }, { id: 'delegate', label: '別の業務について相談する' },
    ] : [],
  };
}

export class KnowledgeIntakeService {
  constructor(private readonly repository: KnowledgeIntakeRepositoryPort, private readonly assets: KnowledgeAssetStore,
    private readonly inference: KnowledgeInferencePort, private readonly runtime: LocalLlmRuntimeControllerPort) {}

  async receive(ownerKey: string, raw: unknown) {
    const input = intakeRequestSchema.parse(raw);
    const files = input.files.map(file => {
      const bytes = Buffer.from(file.base64, 'base64');
      if (bytes.toString('base64') !== file.base64) throw new Error('INVALID_ATTACHMENT');
      if (!bytes.length || bytes.length > (file.kind === 'pdf' ? 20_000_000 : 10_000_000)) throw new Error('INVALID_ATTACHMENT');
      if (file.kind === 'pdf' && !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('INVALID_ATTACHMENT');
      const id = createHash('sha256').update(bytes).digest('hex');
      return { bytes, reference: { id, key: `knowledge-assets/${id}/original`, kind: file.kind, filename: file.filename } };
    });
    const references = files.map(file => file.reference);
    const inputHash = createHash('sha256').update(JSON.stringify({ text: input.text, files: references })).digest('hex');
    let row = await this.repository.receive({ id: input.id, ownerKey, conversationId: input.conversationId, inputHash, text: input.text, files: references });
    if (row.state === 'receiving') {
      for (const file of files) await this.assets.save(file.bytes, 'original');
      await this.repository.accepted(row.id, ownerKey);
      row = (await this.repository.get(row.id, ownerKey))!;
    }
    // Foreground routing is independent of a long-running PDF organization job.
    // If this request disconnects/fails, the durable worker recovers the unrouted row.
    if (row.state === 'pending' && !row.action) {
      let held = false;
      try {
        if (row.text.trim()) { await this.runtime.ensureReady('business_hermes'); held = true; }
        const action = await this.inference.classify(row, AbortSignal.timeout(30_000));
        await this.repository.route(row.id, ownerKey, action);
      } catch { /* raw intake is durable; worker retries after the routing grace period */ }
      finally { if (held) await this.runtime.release('business_hermes').catch(() => undefined); }
      row = (await this.repository.get(row.id, ownerKey))!;
    }
    return intakeResponse(row);
  }
}
