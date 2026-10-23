import { describe, expect, it, vi } from 'vitest';

import { BusinessHermesChatService } from './business-hermes-chat.service.js';

function group(target = '切削') {
  return {
    partNumber: 'PART-1',
    shootingTarget: target,
    rows: [],
    steps: [{
      id: 'step-1',
      step: 1,
      text: 'ボルトを10 N-mで締める。',
      imageName: 'step-1.jpg',
      imageAssetId: '00000000-0000-0000-0000-000000000001',
      imageStorageKey: 'work-instruction/asset-1.jpg',
      imageMimeType: 'image/jpeg',
      imageSha256: 'sha-1'
    }]
  };
}

describe('BusinessHermesChatService', () => {
  it('retrieves both read models and passes bounded evidence to the Hermes adapter', async () => {
    const hermes = vi.fn().mockResolvedValue({ status: 'ready', message: '根拠に基づく回答です。' });
    const classifyChat = vi.fn().mockResolvedValue({
      status: 'ready',
      intent: { scope: 'both', partNumber: 'PART-1', shootingTarget: null, clarificationQuestion: null }
    });
    const readPublishedGroups = vi.fn().mockResolvedValue([{ shootingTarget: '切削' }]);
    const readPublishedGroup = vi.fn().mockResolvedValue(group());
    const readCurrentByPartNumber = vi.fn().mockResolvedValue([{
      id: 'ng-1',
      discoveredOn: '2026-09-01',
      originDepartmentName: '品質保証',
      remarks: '再確認',
      nonconformityContent: '締付不足',
      dispositionContent: '手直し',
      correctiveContent1: '再教育',
      correctiveContent2: null,
      partName: '部品A',
      machineName: '機械A'
    }]);
    const service = new BusinessHermesChatService({
      hermes: { chat: hermes, classifyChat },
      workInstructions: { readPublishedGroups, readPublishedGroup },
      nonconformities: { readCurrentByPartNumber }
    });

    const result = await service.chat({
      scope: 'both',
      messages: [{ role: 'user', content: '品番: PART-1 の不適合と要領書を教えてください。' }]
    });

    expect(result).toMatchObject({
      status: 'ready',
      partNumber: 'PART-1',
      shootingTarget: '切削',
      needsClarification: false,
      evidence: [
        expect.objectContaining({ kind: 'nonconformity', id: 'ng-1', text: expect.stringContaining('締付不足') }),
        expect.objectContaining({ kind: 'work_instruction', imageUrl: '/api/work-instructions/assets/00000000-0000-0000-0000-000000000001' })
      ]
    });
    expect(readCurrentByPartNumber).toHaveBeenCalledWith('PART-1');
    expect(readPublishedGroups).toHaveBeenCalledWith({ partNumber: 'PART-1', limit: 20, offset: 0 });
    expect(readPublishedGroup).toHaveBeenCalledWith({ partNumber: 'PART-1', shootingTarget: '切削' });
    expect(classifyChat).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({ role: 'user', content: expect.stringContaining('品番') })]
    }));
    expect(hermes).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: expect.stringContaining('締付不足') }),
        expect.objectContaining({ role: 'user', content: expect.stringContaining('品番') })
      ])
    }));
    const systemMessage = hermes.mock.calls[0]?.[0]?.messages?.find((message: { role: string }) => message.role === 'system');
    expect(systemMessage?.content.length).toBeLessThanOrEqual(30_000);
    const evidenceJson = systemMessage?.content.split('\nEVIDENCE=')[1];
    expect(JSON.parse(evidenceJson)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'nonconformity', id: 'ng-1' }),
      expect.objectContaining({ kind: 'work_instruction', id: 'step-1', imageUrl: '/api/work-instructions/assets/00000000-0000-0000-0000-000000000001' })
    ]));
  });

  it('keeps ambiguous work-instruction targets as a clarification request', async () => {
    const hermes = vi.fn().mockResolvedValue({ status: 'ready', message: '対象を指定してください。' });
    const classifyChat = vi.fn().mockResolvedValue({
      status: 'ready',
      intent: { scope: 'work_instruction', partNumber: 'PART-1', shootingTarget: null, clarificationQuestion: null }
    });
    const service = new BusinessHermesChatService({
      hermes: { chat: hermes, classifyChat },
      workInstructions: {
        readPublishedGroups: vi.fn().mockResolvedValue([
          { shootingTarget: '切削' },
          { shootingTarget: '研削' }
        ]),
        readPublishedGroup: vi.fn()
      },
      nonconformities: { readCurrentByPartNumber: vi.fn().mockResolvedValue([]) }
    });

    const result = await service.chat({
      scope: 'work_instruction',
      partNumber: 'PART-1',
      messages: [{ role: 'user', content: '手順を教えてください。' }]
    });

    expect(result).toMatchObject({
      status: 'ready',
      needsClarification: true,
      clarificationMessage: '品番 PART-1 の対象を指定してください（切削、研削）。',
      evidence: []
    });
    expect(hermes).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({ content: expect.stringContaining('対象を指定してください') }), expect.anything()]
    }));
  });

  it('clears a model clarification when the read model resolves the only target', async () => {
    const hermes = vi.fn().mockResolvedValue({ status: 'ready', message: '作業要領を確認しました。' });
    const classifyChat = vi.fn().mockResolvedValue({
      status: 'ready',
      intent: { scope: 'work_instruction', partNumber: 'PART-1', shootingTarget: null, clarificationQuestion: '対象を指定してください。' }
    });
    const readPublishedGroups = vi.fn().mockResolvedValue([{ shootingTarget: '切削' }]);
    const readPublishedGroup = vi.fn().mockResolvedValue(group());
    const service = new BusinessHermesChatService({
      hermes: { chat: hermes, classifyChat },
      workInstructions: { readPublishedGroups, readPublishedGroup },
      nonconformities: { readCurrentByPartNumber: vi.fn().mockResolvedValue([]) }
    });

    const result = await service.chat({
      scope: 'work_instruction',
      messages: [{ role: 'user', content: 'PART-1 の作業要領を見せてください。' }]
    });

    expect(result).toMatchObject({ needsClarification: false, clarificationMessage: null, shootingTarget: '切削' });
    expect(readPublishedGroup).toHaveBeenCalledWith({ partNumber: 'PART-1', shootingTarget: '切削' });
  });

  it('keeps per-source evidence caps when both read models are populated', async () => {
    const hermes = vi.fn().mockResolvedValue({ status: 'ready', message: '根拠を確認しました。' });
    const classifyChat = vi.fn().mockResolvedValue({
      status: 'ready',
      intent: { scope: 'both', partNumber: 'PART-1', shootingTarget: '切削', clarificationQuestion: null }
    });
    const steps = Array.from({ length: 16 }, (_, index) => ({
      id: `step-${index + 1}`,
      step: index + 1,
      text: `手順 ${index + 1}`,
      imageName: null,
      imageAssetId: null,
      imageStorageKey: null,
      imageMimeType: null,
      imageSha256: null
    }));
    const readCurrentByPartNumber = vi.fn().mockResolvedValue(Array.from({ length: 24 }, (_, index) => ({
      id: `ng-${index + 1}`,
      discoveredOn: '2026-09-01',
      originDepartmentName: '品質保証',
      remarks: null,
      nonconformityContent: `不適合 ${index + 1}`,
      dispositionContent: null,
      correctiveContent1: null,
      correctiveContent2: null,
      partName: null,
      machineName: null
    })));
    const service = new BusinessHermesChatService({
      hermes: { chat: hermes, classifyChat },
      workInstructions: {
        readPublishedGroups: vi.fn(),
        readPublishedGroup: vi.fn().mockResolvedValue({ ...group(), steps })
      },
      nonconformities: { readCurrentByPartNumber }
    });

    const result = await service.chat({
      scope: 'both',
      messages: [{ role: 'user', content: 'PART-1・切削の不適合と作業要領を確認してください。' }]
    });

    expect(result.evidence.filter((item) => item.kind === 'nonconformity')).toHaveLength(8);
    expect(result.evidence.filter((item) => item.kind === 'work_instruction')).toHaveLength(16);
    const systemMessage = hermes.mock.calls[0]?.[0]?.messages?.find((message: { role: string }) => message.role === 'system');
    const evidenceJson = systemMessage?.content.split('\nEVIDENCE=')[1];
    const transported = JSON.parse(evidenceJson) as Array<{ kind: string }>;
    expect(transported.some((item) => item.kind === 'nonconformity')).toBe(true);
    expect(transported.some((item) => item.kind === 'work_instruction')).toBe(true);
  });

  it('preserves source step numbers, including duplicates, in Hermes grounding', async () => {
    const hermes = vi.fn().mockResolvedValue({ status: 'ready', message: '根拠カードを確認してください。' });
    const classifyChat = vi.fn().mockResolvedValue({
      status: 'ready',
      intent: { scope: 'work_instruction', partNumber: 'PART-1', shootingTarget: '研削', clarificationQuestion: null }
    });
    const sourceStep = group('研削').steps[0];
    const readPublishedGroup = vi.fn().mockResolvedValue({
      ...group('研削'),
      steps: [
        { ...sourceStep, id: 'step-1a', step: 1, text: '原票1-A' },
        { ...sourceStep, id: 'step-1b', step: 1, text: '原票1-B', imageAssetId: null },
        { ...sourceStep, id: 'step-2', step: 2, text: '原票2' }
      ]
    });
    const service = new BusinessHermesChatService({
      hermes: { chat: hermes, classifyChat },
      workInstructions: { readPublishedGroups: vi.fn(), readPublishedGroup },
      nonconformities: { readCurrentByPartNumber: vi.fn().mockResolvedValue([]) }
    });

    const result = await service.chat({
      scope: 'work_instruction',
      messages: [{ role: 'user', content: 'PART-1の研削の作業要領を確認してください。' }]
    });

    expect(result.evidence.filter((item) => item.kind === 'work_instruction').map((item) => item.step)).toEqual([1, 1, 2]);
    expect(result.evidence.filter((item) => item.kind === 'work_instruction').map((item) => item.title)).toEqual([
      '作業要領 手順1',
      '作業要領 手順1',
      '作業要領 手順2'
    ]);
    const systemMessage = hermes.mock.calls[0]?.[0]?.messages?.find((message: { role: string }) => message.role === 'system');
    expect(systemMessage?.content).toContain('並べ替え・再採番・連番化しない');
    expect(systemMessage?.content).toContain('同じ手順番号の複数レコードは別々の根拠');
    expect(systemMessage?.content).toContain('番号を補わず');
    expect(systemMessage?.content).toContain('手順番号・O番号・数値・条件を要約または列挙せず');
    expect(systemMessage?.content).toContain('作業要領は表示中の根拠カードを確認してください');
    const evidenceJson = systemMessage?.content.split('\nEVIDENCE=')[1];
    expect((JSON.parse(evidenceJson) as Array<{ step?: number }>).map((item) => item.step)).toEqual([1, 1, 2]);
  });

  it('preserves a target explicitly named in the latest turn after a part switch', async () => {
    const hermes = vi.fn().mockResolvedValue({ status: 'ready', message: '研削の要領を確認しました。' });
    const classifyChat = vi.fn().mockResolvedValue({
      status: 'ready',
      intent: { scope: 'work_instruction', partNumber: 'PART-2', shootingTarget: '研削', clarificationQuestion: null }
    });
    const readPublishedGroups = vi.fn();
    const readPublishedGroup = vi.fn().mockResolvedValue(group('研削'));
    const service = new BusinessHermesChatService({
      hermes: { chat: hermes, classifyChat },
      workInstructions: { readPublishedGroups, readPublishedGroup },
      nonconformities: { readCurrentByPartNumber: vi.fn().mockResolvedValue([]) }
    });

    const result = await service.chat({
      scope: 'work_instruction',
      messages: [
        { role: 'user', content: 'PART-1 の対象は切削です。' },
        { role: 'user', content: 'PART-2 の研削の要領を見せてください。' }
      ]
    });

    expect(result).toMatchObject({ partNumber: 'PART-2', shootingTarget: '研削', needsClarification: false });
    expect(readPublishedGroups).not.toHaveBeenCalled();
    expect(readPublishedGroup).toHaveBeenCalledWith({ partNumber: 'PART-2', shootingTarget: '研削' });
  });

  it('does not treat an M6-12 fastener size token as a different part number', async () => {
    const hermes = vi.fn().mockResolvedValue({ status: 'ready', message: '不適合情報を確認しました。' });
    const classifyChat = vi.fn().mockResolvedValue({
      status: 'ready',
      intent: { scope: 'nonconformity', partNumber: 'MD004121632-021', shootingTarget: null, clarificationQuestion: null }
    });
    const readCurrentByPartNumber = vi.fn().mockResolvedValue([]);
    const service = new BusinessHermesChatService({
      hermes: { chat: hermes, classifyChat },
      workInstructions: { readPublishedGroups: vi.fn(), readPublishedGroup: vi.fn() },
      nonconformities: { readCurrentByPartNumber }
    });

    const result = await service.chat({
      scope: 'nonconformity',
      messages: [{ role: 'user', content: 'MD004121632-021のM6-12ボルトの不適合を確認してください。' }]
    });

    expect(result.partNumber).toBe('MD004121632-021');
    expect(readCurrentByPartNumber).toHaveBeenCalledWith('MD004121632-021');
  });

  it('does not accept identifiers from assistant turns or carry a target across a new part', async () => {
    const hermes = vi.fn().mockResolvedValue({ status: 'ready', message: '確認します。' });
    const classifyChat = vi.fn()
      .mockResolvedValueOnce({
        status: 'ready',
        intent: { scope: 'nonconformity', partNumber: 'ABC-123', shootingTarget: null, clarificationQuestion: null }
      })
      .mockResolvedValueOnce({
        status: 'ready',
        intent: { scope: 'work_instruction', partNumber: 'PART-2', shootingTarget: '切削', clarificationQuestion: null }
      });
    const readCurrentByPartNumber = vi.fn().mockResolvedValue([]);
    const readPublishedGroups = vi.fn().mockResolvedValue([{ shootingTarget: '研削' }]);
    const readPublishedGroup = vi.fn().mockResolvedValue(group('研削'));
    const service = new BusinessHermesChatService({
      hermes: { chat: hermes, classifyChat },
      workInstructions: { readPublishedGroups, readPublishedGroup },
      nonconformities: { readCurrentByPartNumber }
    });

    const assistantExampleResult = await service.chat({
      scope: 'nonconformity',
      messages: [
        { role: 'user', content: 'こんにちは' },
        { role: 'assistant', content: '例として ABC-123 を検索できます。' }
      ]
    });
    expect(assistantExampleResult.partNumber).toBeNull();
    expect(readCurrentByPartNumber).not.toHaveBeenCalled();
    expect(classifyChat).toHaveBeenNthCalledWith(1, { messages: [{ role: 'user', content: 'こんにちは' }] });

    await service.chat({
      scope: 'work_instruction',
      messages: [
        { role: 'user', content: 'PART-1 の対象は切削です。' },
        { role: 'assistant', content: '切削の要領です。' },
        { role: 'user', content: 'PART-2 の作業要領を見せてください。' }
      ]
    });
    expect(readPublishedGroups).toHaveBeenCalledWith({ partNumber: 'PART-2', limit: 20, offset: 0 });
    expect(readPublishedGroup).toHaveBeenCalledWith({ partNumber: 'PART-2', shootingTarget: '研削' });
  });
});
