import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
        evidenceVisible: true,
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
          evidenceVisible: true,
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

  it('keeps trusted evidence out of the normal consultation view when the model does not request display', () => {
    render(
      <HermesChatPanel
        mode="consultations"
        messages={[{
          id: 'message-hidden-evidence',
          role: 'assistant',
          content: '直近の記録は3件です。',
          evidenceVisible: false,
          evidence: [{ kind: 'nonconformity', id: 'hidden-source', title: '00008195', partNumber: '', text: '備考' }]
        }]}
        draft=""
        isBusy={false}
        error={null}
        authRequired={null}
        activeConsultation={{
          id: 'case-hidden-evidence',
          title: '相談',
          relatedIdentifiers: [],
          confirmedFacts: [],
          openQuestions: [],
          summary: '',
          updatedAt: '2026-09-07T00:00:00.000Z',
          messages: []
        }}
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('直近の記録は3件です。')).toBeInTheDocument();
    expect(screen.queryByText('備考')).not.toBeInTheDocument();
    expect(screen.queryByText('00008195')).not.toBeInTheDocument();
  });

  it('renders only server-selected generic record fields without source metadata', () => {
    render(
      <HermesChatPanel
        mode="consultations"
        messages={[{
          id: 'message-record-summary',
          role: 'assistant',
          content: '記録を表示します。',
          evidenceVisible: false,
          recordIds: ['nonconformity:nc-summary'],
          recordView: 'summary',
          evidence: [
            {
              kind: 'nonconformity', id: 'nc-summary', title: '不適合記録', partNumber: 'PN-42', text: '内部本文',
              sourceUrl: '/private/source', sourceVersionDate: '2026-09-01',
              displayFields: {
                summary: [{ key: 'businessNo', label: '業務番号', value: 'NC-42' }, { key: 'request', label: '依頼内容', value: '寸法差' }],
                detail: [{ key: 'privateDetail', label: '処置', value: '再検査' }]
              }
            }
          ]
        }]}
        draft=""
        isBusy={false}
        error={null}
        authRequired={null}
        activeConsultation={{
          id: 'case-record-summary',
          title: '記録表示',
          relatedIdentifiers: [],
          confirmedFacts: [],
          openQuestions: [],
          summary: '',
          updatedAt: '2026-09-07T00:00:00.000Z',
          messages: []
        }}
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('業務番号')).toBeInTheDocument();
    expect(screen.getByText('NC-42')).toBeInTheDocument();
    expect(screen.getByText('依頼内容')).toBeInTheDocument();
    expect(screen.getByText('寸法差')).toBeInTheDocument();
    expect(screen.queryByText('処置')).not.toBeInTheDocument();
    expect(screen.queryByText('再検査')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '出典を開く' })).not.toBeInTheDocument();
    expect(screen.queryByText('内部本文')).not.toBeInTheDocument();
  });

  it('toggles each selected record locally without sending a new AI request', () => {
    const onSend = vi.fn();
    const onAnswerSuggestion = vi.fn();
    render(
      <HermesChatPanel
        mode="consultations"
        messages={[{
          id: 'message-record-toggle',
          role: 'assistant',
          content: '選択した記録を表示します。',
          evidenceVisible: false,
          recordIds: ['nonconformity:nc-toggle-1', 'nonconformity:nc-toggle-2', 'nonconformity:nc-toggle-same'],
          recordView: 'summary',
          evidence: [
            {
              kind: 'nonconformity', id: 'nc-toggle-1', title: '不適合記録1', partNumber: '', text: '',
              displayFields: {
                summary: [{ key: 'request', label: '依頼1', value: '概要1' }],
                detail: [{ key: 'disposition', label: '処置1', value: '詳細1' }]
              }
            },
            {
              kind: 'nonconformity', id: 'nc-toggle-2', title: '不適合記録2', partNumber: '', text: '',
              displayFields: {
                summary: [{ key: 'request', label: '依頼2', value: '概要2' }],
                detail: [{ key: 'disposition', label: '処置2', value: '詳細2' }]
              }
            },
            {
              kind: 'nonconformity', id: 'nc-toggle-same', title: '不適合記録（同一表示）', partNumber: '', text: '',
              displayFields: {
                summary: [{ key: 'request', label: '共通項目', value: '共通値' }],
                detail: [{ key: 'request', label: '共通項目', value: '共通値' }]
              }
            }
          ]
        }]}
        draft=""
        isBusy={false}
        error={null}
        authRequired={null}
        activeConsultation={{
          id: 'case-record-toggle',
          title: '記録表示',
          relatedIdentifiers: [],
          confirmedFacts: [],
          openQuestions: [],
          summary: '',
          updatedAt: '2026-09-07T00:00:00.000Z',
          messages: []
        }}
        onDraftChange={vi.fn()}
        onSend={onSend}
        onAnswerSuggestion={onAnswerSuggestion}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const records = Array.from(document.querySelectorAll<HTMLElement>('.hermes-chat-panel__record'));
    expect(records).toHaveLength(3);
    expect(records[0]).toHaveAttribute('data-record-view', 'summary');
    expect(records[1]).toHaveAttribute('data-record-view', 'summary');
    expect(records[2]).toHaveAttribute('data-record-view', 'summary');
    expect(within(records[2]).getByText('共通値')).toBeInTheDocument();
    expect(within(records[2]).queryByRole('button')).not.toBeInTheDocument();

    fireEvent.click(within(records[0]).getByRole('button', { name: '詳細を見る' }));
    expect(records[0]).toHaveAttribute('data-record-view', 'detail');
    expect(within(records[0]).getByText('詳細1')).toBeInTheDocument();
    expect(records[1]).toHaveAttribute('data-record-view', 'summary');
    expect(within(records[1]).getByText('概要2')).toBeInTheDocument();
    expect(within(records[1]).queryByText('詳細2')).not.toBeInTheDocument();

    fireEvent.click(within(records[0]).getByRole('button', { name: '概要に戻す' }));
    expect(records[0]).toHaveAttribute('data-record-view', 'summary');
    expect(within(records[0]).getByText('概要1')).toBeInTheDocument();
    expect(within(records[0]).queryByText('詳細1')).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
    expect(onAnswerSuggestion).not.toHaveBeenCalled();
  });

  it('renders only the server-selected evidence ids while retaining other trusted cards in the response', () => {
    render(
      <HermesChatPanel
        mode="consultations"
        messages={[{
          id: 'message-selected-evidence',
          role: 'assistant',
          content: '選択した根拠です。',
          evidenceVisible: true,
          evidenceVisibleIds: ['nonconformity:nc-1'],
          evidence: [
            { kind: 'nonconformity', id: 'nc-1', title: 'NC-1', partNumber: '', text: '選択対象' },
            { kind: 'nonconformity', id: 'nc-2', title: 'NC-2', partNumber: '', text: '候補として保存' }
          ]
        }]}
        draft=""
        isBusy={false}
        error={null}
        authRequired={null}
        activeConsultation={{
          id: 'case-selected-evidence',
          title: '根拠確認',
          relatedIdentifiers: [],
          confirmedFacts: [],
          openQuestions: [],
          summary: '',
          updatedAt: '2026-09-07T00:00:00.000Z',
          messages: []
        }}
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('選択対象')).toBeInTheDocument();
    expect(screen.queryByText('候補として保存')).not.toBeInTheDocument();
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

  it('opens the existing barcode scanner from the consultation menu bar', () => {
    const onScan = vi.fn();
    render(
      <HermesChatPanel
        mode="consultations"
        messages={[]}
        draft=""
        isBusy={false}
        error={null}
        authRequired={null}
        onScan={onScan}
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'バーコードをスキャン' }));
    expect(onScan).toHaveBeenCalledTimes(1);
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

  it('renders structured answer headings and selection events without exposing markdown markers', () => {
    render(
      <HermesChatPanel
        mode="consultations"
        messages={[{
          id: 'structured-answer',
          role: 'assistant',
          content: '**確認結果**\n00008194の記録を確認しました。\n\n**次の操作**\n必要なら処置の詳細を確認できます。'
        }, {
          id: 'selection-event',
          role: 'user',
          content: '内部保存値',
          selection: { prompt: '次に何を確認しますか？', option: '処置の詳細を見る' }
        }]}
        draft=""
        isBusy={false}
        error={null}
        authRequired={null}
        activeConsultation={{
          id: 'structured-case',
          title: '相談',
          relatedIdentifiers: [],
          confirmedFacts: [],
          openQuestions: [],
          summary: '',
          updatedAt: '2026-09-07T00:00:00.000Z',
          messages: []
        }}
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('確認結果')).toHaveClass('hermes-chat-panel__message-heading');
    expect(screen.getByText('次の操作')).toHaveClass('hermes-chat-panel__message-heading');
    expect(screen.queryByText('**確認結果**')).not.toBeInTheDocument();
    expect(screen.getByText('「処置の詳細を見る」が選択されました。')).toHaveClass('hermes-chat-panel__message-selection');
  });

  it('preserves line breaks in user messages while formatting assistant headings', () => {
    render(
      <HermesChatPanel
        mode="consultations"
        messages={[
          { id: 'user-multiline', role: 'user', content: 'ユーザー一行目\nユーザー二行目' },
          { id: 'assistant-heading', role: 'assistant', content: '**確認結果**\n回答一行目\n回答二行目' }
        ]}
        draft=""
        isBusy={false}
        error={null}
        authRequired={null}
        activeConsultation={{
          id: 'case-layout',
          title: '表示確認',
          relatedIdentifiers: [],
          confirmedFacts: [],
          openQuestions: [],
          summary: '',
          updatedAt: '2026-09-07T00:00:00.000Z',
          messages: []
        }}
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const userMessage = document.querySelector('.cs-message--outgoing .hermes-chat-panel__message');
    expect(userMessage).not.toBeNull();
    expect(userMessage?.textContent).toBe('ユーザー一行目\nユーザー二行目');
    expect(userMessage).toHaveClass('hermes-chat-panel__message');
    expect(screen.getByText('確認結果')).toHaveClass('hermes-chat-panel__message-heading');
    const assistantBody = document.querySelector('.hermes-chat-panel__message-block:not(.hermes-chat-panel__message-heading)');
    expect(assistantBody?.textContent).toBe('回答一行目\n回答二行目');
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

    expect(screen.getByRole('group', { name: 'Hermesからの候補確認' })).not.toHaveTextContent('PN-A-204');
    expect(screen.queryByPlaceholderText('相談名を入力')).not.toBeInTheDocument();
    expect(screen.queryByText('保存')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'はい' }));
    fireEvent.click(screen.getByRole('button', { name: 'いいえ' }));
    expect(onAnswer.mock.calls).toEqual([['はい'], ['いいえ']]);
  });
});
