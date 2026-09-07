import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ProtectedImage', () => ({
  ProtectedImage: ({ imagePath, alt }: { imagePath: string; alt: string }) => (
    <img data-testid="protected-evidence-image" src={imagePath} alt={alt} />
  )
}));

import HermesChatPanel from './HermesChatPanel';

describe('HermesChatPanel evidence cards', () => {
  beforeEach(() => {
    const nativeQuerySelector = Element.prototype.querySelector;
    vi.spyOn(Element.prototype, 'querySelector').mockImplementation(function (selector: string) {
      if (selector.includes('data-cs-message-list') && selector.includes('last-of-type')) return null;
      return nativeQuerySelector.call(this, selector);
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders source metadata, public viewer link, and raw image caption', async () => {
    const evidence = {
      kind: 'work_instruction' as const,
      id: 'source-step-42',
      title: '公開作業要領',
      partNumber: 'MD004121632-021',
      text: '公開された本文',
      sourceVersionDate: '2026-09-07T00:00:00.000Z',
      sourceUrl: '/assembly/work-instructions/public/row-42',
      imageAssetId: 'active-asset-42',
      imageUrl: '/api/work-instructions/assets/active-asset-42',
      rawImageLabel: '原画像（公開写真）'
    };
    const consultation = {
      id: 'case-evidence',
      title: '根拠確認',
      relatedIdentifiers: ['MD004121632-021'],
      confirmedFacts: [],
      openQuestions: [],
      summary: '',
      updatedAt: '2026-09-07T00:00:00.000Z',
      messages: [{
        id: 'message-evidence',
        role: 'assistant' as const,
        content: '回答本文',
        evidence: [evidence],
        createdAt: '2026-09-07T00:00:00.000Z'
      }]
    };

    render(
      <HermesChatPanel
        mode="consultations"
        messages={[{
          id: 'message-evidence',
          role: 'assistant',
          content: '回答本文',
          evidence: [evidence]
        }]}
        draft=""
        isBusy={false}
        error={null}
        authRequired={null}
        activeConsultation={consultation}
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('回答本文')).toBeInTheDocument();
    expect(screen.queryByText(/出典ID source-step-42/)).not.toBeInTheDocument();
    expect(screen.getByText(/元データ日時 2026-09-07/)).toBeInTheDocument();
    expect(screen.getByText('公開された本文')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '出典を開く' })).toHaveAttribute('href', '/assembly/work-instructions/public/row-42');
    expect(screen.getByText('原画像（公開写真）')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('protected-evidence-image')).toHaveAttribute('src', '/api/work-instructions/assets/active-asset-42'));
    expect(screen.getByTestId('protected-evidence-image')).toHaveAttribute('alt', '原画像（公開写真）');
  });

  it('keeps the consultation state and evidence links while hiding internal context and static labels', () => {
    render(
      <HermesChatPanel
        mode="consultations"
        messages={[{
          id: 'message-state',
          role: 'assistant',
          content: '回答本文',
          evidence: [{
            kind: 'nonconformity',
            id: 'internal-source-id',
            title: '不適合番号00008195',
            partNumber: '',
            text: '備考の本文',
            sourceUrl: '/assembly/nonconformities/00008195'
          }]
        }]}
        draft=""
        isBusy={false}
        error={null}
        authRequired={null}
        consultations={[]}
        activeConsultation={{
          id: 'case-state',
          title: '現在の相談',
          relatedIdentifiers: ['00008195'],
          confirmedFacts: ['確認済みの事実'],
          openQuestions: ['未解決の確認'],
          summary: '保存された要約',
          updatedAt: '2026-09-07T00:00:00.000Z',
          messages: []
        }}
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
        isExpanded
        onToggleSize={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: '現在の相談' })).toBeInTheDocument();
    expect(screen.queryByText('業務Hermes')).not.toBeInTheDocument();
    expect(screen.queryByText('不適合・作業要領を自然な言葉で相談')).not.toBeInTheDocument();
    expect(screen.queryByText('保存された相談情報（会話本文とは別）')).not.toBeInTheDocument();
    expect(screen.queryByText('保存された要約')).not.toBeInTheDocument();
    expect(screen.queryByText('確認済みの事実')).not.toBeInTheDocument();
    expect(screen.getByText('不適合番号00008195')).toBeInTheDocument();
    expect(screen.queryByText(/出典ID internal-source-id/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '出典を開く' })).toHaveAttribute('href', '/assembly/nonconformities/00008195');
    expect(screen.getByRole('button', { name: 'チャットを標準サイズに戻す' })).toBeInTheDocument();
  });

  it('shows only the ten most recent consultations in the existing API order', () => {
    const consultations = Array.from({ length: 11 }, (_, index) => ({
      id: `case-${index + 1}`,
      title: `相談 ${index + 1}`,
      relatedIdentifiers: [],
      confirmedFacts: [],
      openQuestions: [],
      summary: '',
      updatedAt: `2026-09-${String(11 - index).padStart(2, '0')}T00:00:00.000Z`
    }));

    render(
      <HermesChatPanel
        mode="consultations"
        messages={[]}
        draft=""
        isBusy={false}
        error={null}
        authRequired={null}
        consultations={consultations}
        onNewConsultation={vi.fn()}
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /^相談 1 更新/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^相談 10 更新/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^相談 11 更新/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新しい相談を始める' })).toBeInTheDocument();
    expect(screen.queryByText('新しい相談を始める')).not.toBeInTheDocument();
    expect(screen.queryByText('相談を選ぶ')).not.toBeInTheDocument();
  });

  it('renders model choices and does not invent binary buttons', () => {
    const onAnswer = vi.fn();
    const props = { messages: [], draft: '', isBusy: false, error: null, authRequired: null,
      onDraftChange: vi.fn(), onSend: vi.fn(), onReset: vi.fn(), onClose: vi.fn(), onAnswerSuggestion: onAnswer };
    const { rerender } = render(<HermesChatPanel {...props} suggestion={{prompt: 'どの製品ですか？', relatedIdentifiers: [], options: ['PN-A', 'PN-B', 'どれでもない']}} />);
    expect(screen.queryByRole('button', {name: 'はい'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'PN-B'}));
    expect(onAnswer).toHaveBeenCalledWith('PN-B');
    rerender(<HermesChatPanel {...props} suggestion={{prompt: '状況を教えてください', relatedIdentifiers: []}} />);
    expect(screen.queryByRole('button', {name: 'はい'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'いいえ'})).not.toBeInTheDocument();
  });

  it('shows a candidate in the conversation and forwards yes or no without an edit form', () => {
    const onAnswer = vi.fn();
    render(
      <HermesChatPanel
        mode="consultations"
        messages={[{ id: 'answer', role: 'assistant', content: '候補を見つけました。' }]}
        draft=""
        isBusy={false}
        error={null}
        authRequired={null}
        activeConsultation={{
          id: 'candidate-case',
          title: '相談',
          relatedIdentifiers: [],
          confirmedFacts: [],
          openQuestions: [],
          summary: '',
          updatedAt: '2026-09-07T00:00:00.000Z',
          messages: []
        }}
        suggestion={{
          title: '締結部の確認',
          relatedIdentifiers: ['PN-A-204'],
          prompt: 'Hermesが見つけた候補で相談を続けますか？',
          options: ['はい', 'いいえ']
        }}
        onAnswerSuggestion={onAnswer}
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('group', { name: 'Hermesからの候補確認' })).toHaveTextContent('PN-A-204');
    expect(screen.queryByPlaceholderText('相談名を入力')).not.toBeInTheDocument();
    expect(screen.queryByText('保存')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'はい' }));
    fireEvent.click(screen.getByRole('button', { name: 'いいえ' }));
    expect(onAnswer.mock.calls).toEqual([['はい'], ['いいえ']]);
  });
});
