import { randomUUID } from 'node:crypto';

import { InferenceDeferredError } from '../inference/ports/text-completion.port.js';
import type { LocalLlmRuntimeControllerPort } from '../inference/runtime/local-llm-runtime-control.port.js';

import type { KnowledgeIntakeRepositoryPort, Intake } from './knowledge-intake.port.js';
import type { KnowledgeDocumentStorePort } from './knowledge-document.js';
import type { KnowledgeOrganizerPort } from './organizer.port.js';
import type { KnowledgeInferencePort } from './knowledge-inference.js';
import type { KnowledgeAssetStore } from './knowledge-asset-store.js';
import type { PdfKnowledgeImporter } from './pdf-knowledge-importer.js';
import { importKnowledgeNote } from './knowledge-image-importer.js';
import { renderKnowledgeDocument } from './render-knowledge-document.js';

export class KnowledgeWorker {
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private controller: AbortController | null = null;
  constructor(private readonly deps: {
    repository: KnowledgeIntakeRepositoryPort; documents: KnowledgeDocumentStorePort;
    organizer: KnowledgeOrganizerPort; inference: KnowledgeInferencePort; assets: KnowledgeAssetStore;
    pdf: PdfKnowledgeImporter; runtime: LocalLlmRuntimeControllerPort;
    logError: (error: unknown) => void;
  }) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.kick(), 3000);
    this.timer.unref(); this.kick();
  }
  kick() {
    if (!this.timer || this.running) return;
    this.running = this.tick().catch(this.deps.logError).finally(() => { this.running = null; });
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.controller?.abort(); await this.running;
  }
  async tick(): Promise<void> {
    const { repository } = this.deps;
    const token = randomUUID();
    const intake = await repository.claim(token);
    if (!intake) return;
    const controller = new AbortController(); this.controller = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)]);
    const heartbeat = setInterval(() => {
      void repository.renew(token).then(held => { if (!held) controller.abort(); }).catch(() => controller.abort());
    }, 15_000);
    try {
      await this.process(intake, token, signal);
    } catch (error) {
      const deferred = error instanceof InferenceDeferredError || signal.aborted;
      await repository.fail(intake.id, token, deferred ? 'WAITING_FOR_INFERENCE' : 'PROCESSING_FAILED', deferred).catch(this.deps.logError);
      if (!deferred) this.deps.logError(error);
    } finally {
      clearInterval(heartbeat); this.controller = null;
      await repository.release(token);
    }
  }
  private async foreground<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    await this.deps.runtime.ensureReady('business_hermes');
    try { signal.throwIfAborted(); return await operation(); }
    finally { await this.deps.runtime.release('business_hermes'); }
  }
  private async process(intake: Intake, token: string, signal: AbortSignal) {
    const { repository, inference, organizer, assets, pdf, documents } = this.deps;
    const classified = intake.action && intake.action !== 'clarify' ? intake.action
      : !intake.text.trim() ? 'clarify' : await this.foreground(() => inference.classify(intake, signal), signal);
    const action = await repository.route(intake.id, intake.ownerKey, classified);
    if (action === 'clarify') {
      await repository.finish(intake.id, token, 'choice', action, { message: 'この内容は、どのように扱いますか？' }); return;
    }
    if (action === 'delegate') {
      await repository.finish(intake.id, token, 'delegated', action, { message: intake.files.length ? 'この添付はナレッジの記録として登録していません。ほかの業務については文章でご相談ください。' : '通常の業務相談に引き継ぎます。' }); return;
    }
    const ready = await repository.readySources();
    if (action === 'ask' || action === 'report') {
      const answer = await this.foreground(() => inference.answer(intake.text, ready, action === 'report', signal), signal);
      await repository.finish(intake.id, token, 'answered', action, answer); return;
    }
    let sources = intake.sources;
    let organized = intake.organized ?? [];
    if (!sources) {
      const pdfFile = intake.files.find(file => file.kind === 'pdf');
      sources = pdfFile
        ? await pdf.import({ importId: intake.id, capturedAt: intake.createdAt.toISOString(), filename: pdfFile.filename, bytes: await assets.readOriginal(pdfFile.id) }, signal)
        : [await importKnowledgeNote(assets, { id: intake.id, text: intake.text, capturedAt: intake.createdAt.toISOString(), images: await Promise.all(intake.files.map(file => assets.readOriginal(file.id))) })];
      organized = [];
      await repository.saveProgress(intake.id, token, sources, organized);
    }
    if (ready.length + sources.length > 20) throw new Error('Knowledge exceeds 20 sources/pages');
    for (let index = organized.length; index < sources.length; index++) {
      signal.throwIfAborted();
      organized.push(await organizer.organize(sources[index]!, signal));
      await repository.saveProgress(intake.id, token, sources, organized);
    }
    const document = renderKnowledgeDocument([...ready, ...sources.map((source, index) => ({ source, organized: organized[index]! }))]);
    const previous = await documents.read();
    signal.throwIfAborted();
    if (!await repository.renew(token)) throw new Error('KNOWLEDGE_LEASE_LOST');
    const publication = await documents.publish(document, previous?.revision ?? null);
    signal.throwIfAborted();
    await repository.finish(intake.id, token, 'ready', 'save', { message: 'ナレッジの記録に整理して保存しました。', report: document.report, revision: publication.revision }, publication.revision);
  }
}
