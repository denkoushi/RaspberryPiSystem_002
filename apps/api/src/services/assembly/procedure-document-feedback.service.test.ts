import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runProcedureDocumentFeedback } from './procedure-document-feedback.service.js';
import { getProcedureDocumentFeedbackScheduler } from './procedure-document-feedback.scheduler.js';

const mocks = vi.hoisted(() => ({
  env: {
    PROCEDURE_DOCUMENT_FEEDBACK_ENABLED: 'true',
    PROCEDURE_DOCUMENT_FEEDBACK_CRON: '50 2 * * *',
    PROCEDURE_DOCUMENT_FEEDBACK_LOOKBACK_DAYS: 2,
    PROCEDURE_DOCUMENT_FEEDBACK_BATCH_LIMIT: 20,
  },
  candidates: vi.fn(), findDocument: vi.fn(), employees: vi.fn(), save: vi.fn(),
  text: vi.fn(), vision: vi.fn(), read: vi.fn(), ensureReady: vi.fn(), release: vi.fn(),
  warn: vi.fn(), schedule: vi.fn(), stop: vi.fn(),
}));

vi.mock('../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: mocks.warn, error: vi.fn() } }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: mocks.candidates,
    $transaction: (work: (tx: unknown) => unknown) => work({ assemblyProcedureDocument: { findUnique: mocks.findDocument } }),
    employee: { findMany: mocks.employees },
    assemblyProcedureDocumentFeedback: { createMany: mocks.save },
  },
}));
vi.mock('../assembly-procedure-assets/index.js', () => ({ getAssemblyProcedureAssetStorage: () => ({ read: mocks.read }) }));
vi.mock('../inference/inference-runtime.js', () => ({
  getInferenceRuntime: () => ({
    createTextCompletionPort: () => ({ complete: mocks.text }),
    createVisionCompletionPort: () => ({ complete: mocks.vision }),
  }),
}));
vi.mock('../inference/runtime/get-local-llm-runtime-controller.js', () => ({
  getLocalLlmRuntimeController: () => ({ ensureReady: mocks.ensureReady, release: mocks.release }),
}));
vi.mock('node-cron', () => ({ default: { schedule: mocks.schedule } }));

const updatedAt = new Date('2026-11-26T02:00:00Z');
const candidate = { id: 'version-2', updatedAt };
const document = {
  name: '山田太郎の加工要領',
  updatedAt,
  revisionMetadata: { revisionRootId: 'root', revisionNumber: 2 },
  pages: [
    { pageIndex: 0, overlayElements: [{ kind: 'TEXT', text: '山田が加工する' }, { kind: 'TEXT', text: '太郎が確認する' }] },
    { pageIndex: 1, overlayElements: [{ kind: 'TEXT', text: '鈴木 花子が記録する' }] },
  ],
};
const run = () => runProcedureDocumentFeedback(new AbortController().signal);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.PROCEDURE_DOCUMENT_FEEDBACK_ENABLED = 'true';
  mocks.candidates.mockResolvedValue([candidate]);
  mocks.findDocument.mockResolvedValue(document);
  mocks.employees.mockResolvedValue([
    { displayName: '山田 太郎', lastName: '山田', firstName: '太郎' },
    { displayName: '鈴木 花子', lastName: '鈴木', firstName: '花子' },
  ]);
  mocks.save.mockResolvedValue({ count: 1 });
  mocks.text.mockResolvedValue({ rawText: '{"questions":["加工原点の確認は？"]}' });
});

describe('夜間の要領書への感想', () => {
  it('フラグが無効ならスケジュールも処理も起動しない', async () => {
    mocks.env.PROCEDURE_DOCUMENT_FEEDBACK_ENABLED = 'false';
    getProcedureDocumentFeedbackScheduler().start();
    await expect(run()).resolves.toEqual({ selected: 0, saved: 0 });
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.candidates).not.toHaveBeenCalled();
    expect(mocks.text).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('稼働中に重複して起動せず、停止時に処理を待つ', async () => {
    mocks.schedule.mockReturnValue({ stop: mocks.stop });
    const scheduler = getProcedureDocumentFeedbackScheduler();
    scheduler.start();
    scheduler.start();
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith('50 2 * * *', expect.any(Function), { timezone: 'Asia/Tokyo' });
    const tick = mocks.schedule.mock.calls[0]![1] as () => void;
    try {
      tick();
      tick();
      expect(mocks.candidates).toHaveBeenCalledOnce();
    } finally {
      await scheduler.stop();
    }
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it('写真は3枚までJPEGで読み、入力と保存する感想の両方で従業員名を置き換える', async () => {
    const images = Array.from({ length: 4 }, (_, index) => ({ kind: 'IMAGE', asset: { storageKey: `asset-${index}` } }));
    mocks.findDocument.mockResolvedValue({ ...document, pages: [...document.pages, { pageIndex: 2, overlayElements: images }] });
    mocks.read.mockResolvedValue(await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer());
    mocks.vision.mockResolvedValue({ rawText: '・鈴木花子のメモと山田 太郎の印' });
    mocks.text.mockResolvedValue({ rawText: '\x60\x60\x60json\n' + JSON.stringify({
      questions: [' ', 42, '山田 太郎が担当？', '花子が記録？', '3', '4', '5', '6', '7'],
      missing: 'invalid', unclear: ['鈴木の欄'], ideas: ['太郎の手順'],
    }) + '\n\x60\x60\x60' });

    await expect(run()).resolves.toEqual({ selected: 1, saved: 1 });

    expect(mocks.read).toHaveBeenCalledTimes(3);
    expect(mocks.vision).toHaveBeenCalledTimes(3);
    const photo = mocks.vision.mock.calls[0]![0];
    expect(photo.mimeType).toBe('image/jpeg');
    expect((await sharp(photo.imageBytes).metadata()).format).toBe('jpeg');
    expect(photo.userText).not.toMatch(/山田|太郎|鈴木|花子/);
    const request = mocks.text.mock.calls[0]![0];
    expect(request).toMatchObject({ useCase: 'business_hermes', jsonOutput: true, enableThinking: false });
    const prompt = request.messages[1].content;
    expect(prompt).not.toMatch(/山田|太郎|鈴木|花子/);
    expect(prompt).toContain('文書名: 作業者Aの加工要領');
    expect(prompt).toContain('=== 参考資料(金属加工の一般的な流れと、良い手順書の条件)\n[R1 初品加工の一般的な流れ]');
    expect(prompt).toContain('1ページ目\n作業者Aが加工する\n作業者Aが確認する\n\n2ページ目\n作業者Bが記録する');
    expect(prompt).toContain('3ページ目の写真 1\n・作業者Bのメモと作業者Aの印');
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
      data: {
        documentId: candidate.id, revisionRootId: 'root', revisionNumber: 2, sourceUpdatedAt: updatedAt,
        questions: ['作業者Aが担当？', '作業者Bが記録？', '3', '4', '5', '6'],
        missing: [], unclear: ['作業者Bの欄'], ideas: ['作業者Aの手順'],
      },
      skipDuplicates: true,
    });
    expect(mocks.ensureReady).toHaveBeenCalledExactlyOnceWith('business_hermes');
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith('business_hermes');
  });

  it.each(['{"questions": }', '{"questions":[null,"  "]}'])('使えない応答 %s を飛ばして次の文書を保存する', async rawText => {
    mocks.candidates.mockResolvedValue([candidate, { id: 'legacy', updatedAt }]);
    mocks.findDocument.mockResolvedValueOnce(document).mockResolvedValueOnce({ ...document, revisionMetadata: null });
    mocks.text.mockResolvedValueOnce({ rawText });
    await expect(run()).resolves.toEqual({ selected: 2, saved: 1 });
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      documentId: 'legacy', revisionRootId: 'legacy', revisionNumber: 1,
    }) }));
    expect(mocks.warn).toHaveBeenCalledWith({ documentId: candidate.id }, 'procedure_document_feedback_unusable_response');
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });

  it('AI呼び出しが失敗した文書の実行枠を解放し、次の文書を保存する', async () => {
    mocks.candidates.mockResolvedValue([candidate, { id: 'next', updatedAt }]);
    mocks.text.mockRejectedValueOnce(new Error('offline'));
    await expect(run()).resolves.toEqual({ selected: 2, saved: 1 });
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });

  it('候補が無ければ従業員やAIにアクセスしない', async () => {
    mocks.candidates.mockResolvedValue([]);
    await expect(run()).resolves.toEqual({ selected: 0, saved: 0 });
    expect(mocks.employees).not.toHaveBeenCalled();
    expect(mocks.ensureReady).not.toHaveBeenCalled();
  });
});
