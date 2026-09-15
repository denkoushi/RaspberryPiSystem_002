import { describe, expect, it, vi } from 'vitest';

import { InferenceKnowledgeOrganizer } from '../inference-knowledge-organizer.js';
import type { KnowledgeSource } from '../knowledge-source.js';
import type { TextCompletionPort } from '../../inference/ports/text-completion.port.js';

const source: KnowledgeSource = {
  id: '123e4567-e89b-42d3-a456-426614174000', capturedAt: '2026-09-15T00:00:00.000Z',
  text: '練習用の板を用意した。',
  images: [{ id: 'a'.repeat(64), originalKey: `knowledge-assets/${'b'.repeat(64)}/original`, displayKey: `knowledge-assets/${'b'.repeat(64)}/display.jpg` }],
};
const note = { title: '練習用の板', summary: '板を準備した記録。', category: '実技準備', quotes: ['練習用の板を用意した。'], photos: [{ id: 'a'.repeat(64), description: '板の写真' }] };

describe('Knowledge organizer inference boundary', () => {
  it('uses background inference and validates quotes/photo IDs before returning', async () => {
    const complete = vi.fn<TextCompletionPort['complete']>().mockResolvedValue({ rawText: JSON.stringify(note), model: 'synthetic-test-model' });
    const describePhoto = vi.fn().mockResolvedValue('板が写っている。');
    const controller = new AbortController();
    expect(await new InferenceKnowledgeOrganizer({ complete }, { describe: describePhoto }).organize(source, controller.signal)).toEqual(note);
    expect(describePhoto).toHaveBeenCalledWith(source.images[0], controller.signal);
    expect(complete.mock.calls[0]?.[0]).toMatchObject({ background: true, useCase: 'business_hermes', signal: controller.signal });
    expect(JSON.parse(complete.mock.calls[0]![0].messages[1]!.content)).toEqual({ text: source.text, photos: [{ id: 'a'.repeat(64), description: '板が写っている。' }] });
  });

  it('rejects invented source quotes from otherwise valid model JSON', async () => {
    const complete = vi.fn<TextCompletionPort['complete']>().mockResolvedValue({ rawText: JSON.stringify({ ...note, quotes: ['検定には必ず合格できる。'] }), model: 'synthetic-test-model' });
    await expect(new InferenceKnowledgeOrganizer({ complete }, { describe: async () => '板' }).organize(source)).rejects.toThrow('quotation');
  });

  it('propagates inference failures instead of returning an empty successful note', async () => {
    const complete = vi.fn<TextCompletionPort['complete']>().mockRejectedValue(new Error('DGX unavailable'));
    await expect(new InferenceKnowledgeOrganizer({ complete }, { describe: async () => '板' }).organize(source)).rejects.toThrow('DGX unavailable');
  });

  it('does not infer after cancellation or a photo processing failure', async () => {
    const complete = vi.fn<TextCompletionPort['complete']>();
    const organizer = new InferenceKnowledgeOrganizer({ complete }, { describe: async () => { throw new Error('photo failed'); } });
    const controller = new AbortController(); controller.abort();
    await expect(organizer.organize(source, controller.signal)).rejects.toThrow();
    await expect(organizer.organize(source)).rejects.toThrow('photo failed');
    expect(complete).not.toHaveBeenCalled();
  });
});
