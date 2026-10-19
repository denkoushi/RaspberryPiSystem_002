import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decideTriage, fetchFields, searchProcedureTopics } from './knowledgeTriageApi';
import { KnowledgeTriageCard, type KnowledgeTriageCardProps } from './KnowledgeTriageCard';

vi.mock('./knowledgeTriageApi', () => ({ decideTriage: vi.fn(), fetchFields: vi.fn(), searchProcedureTopics: vi.fn() }));

const props = (overrides: Partial<KnowledgeTriageCardProps> = {}): KnowledgeTriageCardProps => ({
  intakeId: 'post-1', text: 'クランプは対角の順に締める', files: [], scannedPartNumber: 'P-1', header: '田中さんの投稿', state: 'awaiting', tagUid: 'tag-1',
  suggestions: { confidence: 0.9, candidates: [{ procedureId: 'p1', title: 'P-1 テーブル｜段取り', reason: '同じ品番' }, { procedureId: 'p2', title: 'P-1 テーブル｜切削条件', reason: '' }],
    proposal: { parts: { target: 'P-1 テーブル', workType: '段取り', detail: 'クランプ' }, title: 'P-1 テーブル｜段取り｜クランプ', identifiers: { partNumber: 'P-1' }, reviewTier: 'approval_required', reason: '' } },
  onDecided: vi.fn(), onLater: vi.fn(), ...overrides,
});

beforeEach(() => {
  vi.mocked(decideTriage).mockReset().mockResolvedValue({ procedureId: 'p1' });
  vi.mocked(fetchFields).mockReset().mockResolvedValue([{ id: '1', name: '段取り', aliases: [], children: [] }, { id: '2', name: '切削条件', aliases: [], children: [] }, { id: '3', name: 'その他', aliases: [], children: [] }]);
  vi.mocked(searchProcedureTopics).mockReset().mockResolvedValue([]);
});

describe('knowledge triage card', () => {
  it('adds the post to the AI-recommended topic with the poster tag', async () => {
    const p = props();
    render(<KnowledgeTriageCard {...p} />);
    expect(screen.getByText('AIのおすすめ')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /AIのおすすめ/ }));
    await waitFor(() => expect(decideTriage).toHaveBeenCalledWith('post-1', 'tag-1', { procedureId: 'p1' }));
    expect(p.onDecided).toHaveBeenCalledWith('post-1', 'P-1 テーブル｜段取り');
  });

  it('creates a new topic from the editable AI proposal', async () => {
    render(<KnowledgeTriageCard {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /新しい案件として追加/ }));
    await screen.findByText('種類：段取り');
    fireEvent.change(screen.getByLabelText('補足（任意）'), { target: { value: '' } });
    expect(screen.getByText('タイトル：P-1 テーブル｜段取り')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'この案件を作って追加' }));
    await waitFor(() => expect(decideTriage).toHaveBeenCalledWith('post-1', 'tag-1', { newTopic: { target: 'P-1 テーブル', workType: '段取り', partNumber: 'P-1' } }));
  });

  it('finds another topic grouped by target', async () => {
    vi.mocked(searchProcedureTopics).mockResolvedValue([{ procedureId: 'p9', title: 'P-9 脚｜検査・測定', parts: { target: 'P-9 脚', workType: '検査・測定' } }]);
    render(<KnowledgeTriageCard {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /他の案件を探す/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'P-9 脚｜検査・測定' }));
    await waitFor(() => expect(decideTriage).toHaveBeenCalledWith('post-1', 'tag-1', { procedureId: 'p9' }));
    expect(screen.getByText('P-9 脚（1件）')).toBeInTheDocument();
  });

  it('can be postponed, and without the poster tag only explains how to triage', () => {
    const p = props();
    const { rerender } = render(<KnowledgeTriageCard {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'あとで仕分ける' }));
    expect(p.onLater).toHaveBeenCalledWith('post-1');
    rerender(<KnowledgeTriageCard {...p} tagUid={null} />);
    expect(screen.queryByRole('button', { name: /段取り/ })).not.toBeInTheDocument();
    expect(screen.getByText(/社員タグをかざしてください/)).toBeInTheDocument();
  });

  it('keeps the choices and shows an error when saving fails', async () => {
    vi.mocked(decideTriage).mockRejectedValue(new Error('network'));
    const p = props();
    render(<KnowledgeTriageCard {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /P-1 テーブル｜切削条件/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(p.onDecided).not.toHaveBeenCalled();
  });
});
