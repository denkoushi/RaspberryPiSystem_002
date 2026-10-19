import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../api/http', () => ({ api }));
vi.mock('../../components/ProtectedImage', () => ({ ProtectedImage: ({ imagePath, alt }: { imagePath: string; alt: string }) => <img src={imagePath} alt={alt} /> }));

import { KnowledgeWorkspace, KnowledgeWorkspaceChips } from './KnowledgeWorkspace';
import { useKnowledgeWorkspace } from './useKnowledgeWorkspace';

import type { KnowledgePendingReview, KnowledgeProcedureDocument, KnowledgeProcedureSummary } from '@raspi-system/shared-types';

const document: KnowledgeProcedureDocument = {
  formatVersion: 1, procedureId: 'proc-1', revisionId: 'rev-1', revisionNumber: 1, title: '部品A｜段取り', category: '段取り',
  identifiers: { partNumber: 'PART-A', drawingNumber: 'DRAW-A' }, reviewTier: 'approval_required', state: 'pending_approval', createdAt: '2026-10-04T00:00:00Z',
  steps: [
    { id: 's1', title: '治具を取り付ける', body: '本文1', cautions: [], needsReview: [], photos: [{ imageId: 'img-1', caption: '治具' }], sources: [] },
    { id: 's2', title: '原点を合わせる', body: '本文2', cautions: [], needsReview: [], photos: [], sources: [] },
  ],
};
const pending: KnowledgePendingReview = { ...document, stepCount: 2, publishedRevisionNumber: null, reportComment: null };
const published: KnowledgeProcedureSummary[] = [
  { ...document, publishedAt: document.createdAt },
  { ...document, procedureId: 'proc-2', title: '技能検定｜申し込み', identifiers: { partNumber: 'PART-B' }, reviewTier: 'auto_publish', publishedAt: document.createdAt },
];
const failure = (status: number, code?: string) => ({ isAxiosError: true, response: { status, data: { errorCode: code } } });
function Harness({ tag = 'TAG-SECRET', active = true, identity = 'client-1' }: { tag?: string | null; active?: boolean; identity?: string }) {
  const workspace = useKnowledgeWorkspace(active, tag, identity);
  return <><span data-testid="expanded">{String(workspace.expanded)}</span>
    {workspace.isOpen ? <KnowledgeWorkspace workspace={workspace} posterName={tag ? '社員A' : null} /> : <KnowledgeWorkspaceChips workspace={workspace} />}</>;
}
async function openPending() {
  fireEvent.click(await screen.findByRole('button', { name: '✅ 承認待ち 1' }));
  fireEvent.click(await screen.findByRole('button', { name: /部品A/ }));
  await screen.findByRole('button', { name: '承認して公開' });
}
async function openPublished() {
  fireEvent.click(screen.getByRole('button', { name: '📖 手順書' }));
  fireEvent.click(await screen.findByRole('button', { name: /部品A/ }));
  await screen.findByRole('button', { name: '誤りを報告' });
}

beforeEach(() => {
  api.get.mockReset().mockImplementation(async (url: string) => ({ data: url.endsWith('/procedures') ? { procedures: published } : { procedure: { ...document, state: 'published' } } }));
  api.post.mockReset().mockImplementation(async (url: string) => ({ data: url.endsWith('/pending') ? { reviewer: { rank: 'leader' }, reviews: [pending] } : url.endsWith('/detail') ? { procedure: document } : { ok: true } }));
});

describe('Knowledge chat approval and reading', () => {
  it.each(['leader', 'section_chief', 'manager', 'general_manager', 'executive'])('shows the pending count for %s', async rank => {
    api.post.mockResolvedValue({ data: { reviewer: { rank }, reviews: [pending] } });
    render(<Harness />);
    expect(await screen.findByRole('button', { name: '✅ 承認待ち 1' })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/hermes-knowledge/reviews/pending', { reviewerTagUid: 'TAG-SECRET' }, expect.any(Object));
  });
  it('silently hides approval for an insufficient rank and keeps reading available', async () => {
    api.post.mockRejectedValue(failure(403, 'KNOWLEDGE_APPROVAL_FORBIDDEN'));
    render(<Harness />);
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /承認待ち/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '📖 手順書' })).toBeInTheDocument();
  });
  it('shows new, revised and error-report reasons in the list', async () => {
    api.post.mockResolvedValue({ data: { reviews: [pending, { ...pending, revisionId: 'rev-2', revisionNumber: 3, publishedRevisionNumber: 2 }, { ...pending, revisionId: 'rev-3', reportComment: '締切は6月末では' }] } });
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: '✅ 承認待ち 3' }));
    expect(await screen.findByText('新規')).toBeInTheDocument();
    expect(screen.getByText('改版 2→3')).toBeInTheDocument();
    expect(screen.getByText('誤り報告: 締切は6月末では')).toBeInTheDocument();
    expect(screen.getAllByText(/2手順・10\/4/)).toHaveLength(3);
  });
  it('opens an expanded review with review images, approves and reloads pending', async () => {
    render(<Harness />); await openPending();
    expect(screen.getByTestId('expanded')).toHaveTextContent('true');
    expect(screen.getByRole('img', { name: '治具' })).toHaveAttribute('src', '/api/hermes-knowledge/reviews/rev-1/images/img-1');
    expect(screen.getByText('本文2')).toBeInTheDocument();
    api.post.mockResolvedValue({ data: { reviews: [] } });
    fireEvent.click(screen.getByRole('button', { name: '承認して公開' }));
    expect(await screen.findByText('承認待ち 0件')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/hermes-knowledge/reviews/rev-1/approve', { reviewerTagUid: 'TAG-SECRET' });
    expect(api.post.mock.calls.filter(([url]) => url.endsWith('/pending'))).toHaveLength(3);
  });
  it('requires a return reason and sends it before reloading', async () => {
    render(<Harness />); await openPending();
    fireEvent.click(screen.getByRole('button', { name: '差し戻し' }));
    expect(screen.getByRole('button', { name: '差し戻す' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('差し戻しの理由'), { target: { value: ' ' } });
    expect(screen.getByRole('button', { name: '差し戻す' })).toBeDisabled();
    expect(screen.getByLabelText('差し戻しの理由')).toHaveAttribute('maxlength', '500');
    fireEvent.change(screen.getByLabelText('差し戻しの理由'), { target: { value: ' 寸法を確認 ' } });
    api.post.mockResolvedValue({ data: { reviews: [] } });
    fireEvent.click(screen.getByRole('button', { name: '差し戻す' }));
    expect(await screen.findByText('承認待ち 0件')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/hermes-knowledge/reviews/rev-1/return', { reviewerTagUid: 'TAG-SECRET', comment: '寸法を確認' });
  });
  it.each(['approve', 'return'])('returns to the refreshed list on a 409 during %s', async action => {
    render(<Harness />); await openPending();
    if (action === 'return') {
      fireEvent.click(screen.getByRole('button', { name: '差し戻し' }));
      fireEvent.change(screen.getByLabelText('差し戻しの理由'), { target: { value: '確認' } });
    }
    api.post.mockRejectedValueOnce(failure(409)).mockResolvedValue({ data: { reviews: [] } });
    fireEvent.click(screen.getByRole('button', { name: action === 'approve' ? '承認して公開' : '差し戻す' }));
    expect(await screen.findByText('状態が変わりました。一覧を更新します。')).toBeInTheDocument();
    expect(await screen.findByText('承認待ち 0件')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /部品A/ })).not.toBeInTheDocument();
  });
  it('filters published names, part and drawing numbers and walks individual steps', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '📖 手順書' }));
    await screen.findByRole('button', { name: /技能検定/ });
    for (const query of ['部品A', 'part-a', 'DRAW-A']) {
      fireEvent.change(screen.getByLabelText('名前・品番・図番'), { target: { value: query } });
      expect(screen.getByRole('button', { name: /部品A/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /技能検定/ })).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: /部品A/ }));
    await screen.findByText('1 / 2');
    expect(screen.getByRole('button', { name: '前へ' })).toBeDisabled();
    expect(screen.queryByText('本文2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '次へ' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '前へ' }));
    expect(screen.getByText('本文1')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '表示方法' })).not.toBeInTheDocument();
  });
  it.each(['approval_required', 'auto_publish'] as const)('requires a comment to report a %s procedure and removes it after sending', async reviewTier => {
    api.get.mockImplementation(async (url: string) => ({ data: url.endsWith('/procedures') ? { procedures: published } : { procedure: { ...document, reviewTier, state: 'published' } } }));
    render(<Harness />); await openPublished();
    expect(screen.getByText(reviewTier === 'auto_publish' ? 'AI作成' : '承認済み')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '誤りを報告' }));
    expect(screen.getByText('👤 社員A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '報告する' })).toBeDisabled();
    expect(screen.getByLabelText('どこが違うか')).toHaveAttribute('maxlength', '500');
    fireEvent.change(screen.getByLabelText('どこが違うか'), { target: { value: ' 手順2に誤り ' } });
    fireEvent.click(screen.getByRole('button', { name: '報告する' }));
    await screen.findByLabelText('名前・品番・図番');
    expect(api.post).toHaveBeenCalledWith('/hermes-knowledge/procedures/proc-1/error-report', { reporterTagUid: 'TAG-SECRET', comment: '手順2に誤り' });
    expect(screen.queryByRole('button', { name: /部品A/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /技能検定/ })).toBeInTheDocument();
  });
  it('keeps a general reporter on the published list when pending refresh is forbidden', async () => {
    api.post.mockImplementation(async (url: string) => {
      if (url.endsWith('/pending')) throw failure(403, 'KNOWLEDGE_APPROVAL_FORBIDDEN');
      return { data: { ok: true } };
    });
    render(<Harness />); await openPublished();
    fireEvent.click(screen.getByRole('button', { name: '誤りを報告' }));
    fireEvent.change(screen.getByLabelText('どこが違うか'), { target: { value: '誤り' } });
    fireEvent.click(screen.getByRole('button', { name: '報告する' }));
    await screen.findByLabelText('名前・品番・図番');
    await waitFor(() => expect(screen.getByRole('button', { name: /技能検定/ })).toBeEnabled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /部品A/ })).not.toBeInTheDocument();
  });

  it('allows scanning the existing poster tag while entering an error report', async () => {
    const { rerender } = render(<Harness tag={null} />); await openPublished();
    fireEvent.click(screen.getByRole('button', { name: '誤りを報告' }));
    fireEvent.change(screen.getByLabelText('どこが違うか'), { target: { value: '誤り' } });
    expect(screen.getByRole('button', { name: '報告する' })).toBeDisabled();
    rerender(<Harness />);
    expect(await screen.findByText('👤 社員A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '報告する' }));
    await screen.findByLabelText('名前・品番・図番');
    expect(api.post).toHaveBeenCalledWith('/hermes-knowledge/procedures/proc-1/error-report', { reporterTagUid: 'TAG-SECRET', comment: '誤り' });
  });
  it('ignores a late review detail after changing the tag', async () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: '✅ 承認待ち 1' }));
    let resolve!: (value: unknown) => void;
    api.post.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    fireEvent.click(await screen.findByRole('button', { name: /部品A/ }));
    rerender(<Harness tag="OTHER-TAG" />);
    await act(async () => { resolve({ data: { procedure: document } }); });
    expect(screen.queryByRole('button', { name: '承認して公開' })).not.toBeInTheDocument();
  });
});
