import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), role: 'ADMIN' }));
vi.mock('../../api/http', () => ({ api: mocks }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: mocks.role } }) }));

import { KnowledgePositionRanksPage } from './KnowledgePositionRanksPage';

function renderPage() {
  return render(<MemoryRouter initialEntries={['/admin/knowledge-position-ranks']}><Routes>
    <Route path="/admin/knowledge-position-ranks" element={<KnowledgePositionRanksPage />} />
    <Route path="/admin" element={<p>管理ホーム</p>} />
  </Routes></MemoryRouter>);
}
beforeEach(() => {
  mocks.role = 'ADMIN'; mocks.put.mockReset().mockResolvedValue({ data: { ok: true } });
  mocks.get.mockReset().mockImplementation(async (url: string) => ({ data: url.endsWith('/capabilities') ? { enabled: true }
    : url.endsWith('/position-ranks') ? { ranks: [{ positionName: '主任', rank: 'leader' }], unmappedPositions: [{ positionName: '主事', employeeCount: 4 }] }
    : { employees: [{ positionName: '主任' }, { positionName: '主任' }, { positionName: null }] } }));
});

describe('Knowledge position ranks admin page', () => {
  it.each(['ADMIN', 'MANAGER'])('lists mapped and unmapped positions and saves every row as %s', async role => {
    mocks.role = role; renderPage();
    const leader = await screen.findByLabelText('主任の段階');
    expect(leader).toHaveValue('leader');
    expect(within(leader.closest('tr')!).getByText('2')).toBeInTheDocument();
    const unmapped = screen.getByLabelText('主事の段階');
    expect(unmapped).toHaveValue('general');
    expect(within(unmapped.closest('tr')!).getByText('4')).toBeInTheDocument();
    expect(within(unmapped.closest('tr')!).getByText('未設定')).toBeInTheDocument();
    fireEvent.change(unmapped, { target: { value: 'section_chief' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('保存しました')).toBeInTheDocument();
    expect(mocks.put).toHaveBeenCalledWith('/hermes-knowledge/position-ranks', { ranks: [{ positionName: '主任', rank: 'leader' }, { positionName: '主事', rank: 'section_chief' }] });
    expect(screen.queryByText('未設定')).not.toBeInTheDocument();
  });
  it('shows one line when knowledge is disabled without loading the table or roster', async () => {
    mocks.get.mockResolvedValue({ data: { enabled: false } }); renderPage();
    expect(await screen.findByText('ナレッジは無効です。')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  });
  it('redirects viewers before issuing any API request', async () => {
    mocks.role = 'VIEWER'; renderPage();
    expect(await screen.findByText('管理ホーム')).toBeInTheDocument(); expect(mocks.get).not.toHaveBeenCalled();
  });
  it('retains edits and shows a nearby failure when saving fails', async () => {
    mocks.put.mockRejectedValue(new Error('failed')); renderPage();
    fireEvent.change(await screen.findByLabelText('主事の段階'), { target: { value: 'manager' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('保存できません。'));
    expect(screen.getByLabelText('主事の段階')).toHaveValue('manager');
  });
});
