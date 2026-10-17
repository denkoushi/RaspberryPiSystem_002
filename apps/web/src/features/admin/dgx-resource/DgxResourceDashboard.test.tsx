import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchDgxResourceEvents, fetchDgxResourceOverview, postDgxResourceAction } from '../../../api/dgx-resource';

import { DgxResourceDashboard } from './DgxResourceDashboard';

import type { DgxResourceOverview } from '../../../api/dgx-resource.types';

vi.mock('../../../api/dgx-resource', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/dgx-resource')>(),
  fetchDgxResourceEvents: vi.fn(), fetchDgxResourceOverview: vi.fn(), postDgxResourceAction: vi.fn(),
}));

function overview(): DgxResourceOverview {
  return {
    generatedAt: '2026-10-17T01:02:03Z',
    business: {
      state: 'ready', llm: { state: 'ok' },
      embedding: { state: 'not_observed', lastSuccessAt: null, lastFailureAt: null, lastErrorBrief: null },
      activeProfile: { id: 'internal-a', displayName: '業務モデル A' },
      intendedProfile: { id: 'internal-a', displayName: '業務モデル A' }, matchesIntent: true,
    },
    metrics: { unifiedMemUsedBytes: 32 * 1024 ** 3, unifiedMemTotalBytes: 128 * 1024 ** 3, gpuUtilPct: 25, temperatureC: 42, powerW: 80 },
    modelProfiles: [
      { id: 'internal-a', displayName: '業務モデル A', backendLabel: 'vLLM', supportsVision: false, isActive: true, isRecommended: true, startupFit: 'fits', startable: true, unavailableReasonJa: null, deletable: false },
      { id: 'internal-b', displayName: '画像モデル B', backendLabel: 'llama.cpp', supportsVision: true, isActive: false, isRecommended: false, startupFit: 'unknown', startable: true, unavailableReasonJa: null, deletable: true },
      { id: 'internal-c', displayName: '大型モデル C', backendLabel: 'vLLM', supportsVision: false, isActive: false, isRecommended: false, startupFit: 'insufficient', startable: false, unavailableReasonJa: 'メモリ不足', deletable: false },
    ],
    modelProfilesAvailable: true,
    businessReturn: { state: 'idle', profileId: null, startedAt: null, finishedAt: null, failureReasonJa: null },
    alerts: [],
  };
}
const clients: QueryClient[] = [];
function mount(data = overview()) {
  vi.mocked(fetchDgxResourceOverview).mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  return { ...render(<QueryClientProvider client={client}><DgxResourceDashboard /></QueryClientProvider>), client };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchDgxResourceEvents).mockResolvedValue({ events: [] });
  vi.mocked(postDgxResourceAction).mockResolvedValue({ ok: true, message: '完了しました。' });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

async function loaded() { return screen.findByRole('region', { name: '業務 LLM の状態' }); }

describe('business LLM dashboard', () => {
  it.each([
    ['ready', '使えます'], ['ready_mismatch', '使えます（モデル違い）'], ['degraded', '一部に問題があります'],
    ['down', '使えません'], ['unconfigured', '確認できません'], ['returning', '業務に戻しています'],
  ] as const)('renders %s without internal terminology', async (state, label) => {
    const data = overview(); data.business.state = state;
    const { container } = mount(data);
    expect(within(await loaded()).getByText(label)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/experiment-lab|agent-container|business_first|Strict Ready|指紋|KB-|internal-|not loaded|post_only/);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });
  it.each([
    ['ok', '直近は成功'], ['failed', '直近は失敗'], ['not_observed', 'まだ呼ばれていません'], ['disabled', '使っていません'],
  ] as const)('renders embedding %s', async (state, label) => {
    const data = overview(); data.business.embedding = { state, lastSuccessAt: data.generatedAt, lastFailureAt: data.generatedAt, lastErrorBrief: '写真の処理先に接続できませんでした' };
    mount(data);
    expect(within(await loaded()).getByText(label)).toBeInTheDocument();
  });
  it('shows missing models and measurements without raw values', async () => {
    const data = overview(); data.business.activeProfile = null; data.business.intendedProfile = null; data.business.matchesIntent = null;
    data.metrics = { unifiedMemUsedBytes: null, unifiedMemTotalBytes: null, gpuUtilPct: null, temperatureC: null, powerW: null };
    mount(data);
    const panel = within(await loaded());
    expect(panel.getByText('動いているモデル: なし')).toBeInTheDocument();
    expect(panel.getByText('未設定')).toBeInTheDocument();
    expect(panel.getAllByText('—')).toHaveLength(4);
    expect(panel.queryByRole('meter')).not.toBeInTheDocument();
  });
  it('selects intent first, disables insufficient models, and confirms before starting', async () => {
    const data = overview(); data.business.intendedProfile = { id: 'internal-b', displayName: '画像モデル B' };
    mount(data); await loaded();
    expect(screen.getByLabelText('使うモデル')).toHaveValue('internal-b');
    expect(screen.getByRole('option', { name: '大型モデル C（メモリ不足）' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'このモデルで業務に戻す' }));
    expect(screen.getByText(/DGX の今の処理を止めて、画像モデル B/)).toBeInTheDocument();
    expect(postDgxResourceAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(screen.queryByRole('button', { name: '戻す' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'このモデルで業務に戻す' }));
    fireEvent.click(screen.getByRole('button', { name: '戻す' }));
    await waitFor(() => expect(postDgxResourceAction).toHaveBeenCalledWith({ type: 'RETURN_TO_BUSINESS', modelProfileId: 'internal-b' }, expect.any(Object)));
  });
  it('defaults to the recommended model when intent is absent', async () => {
    const data = overview(); data.business.intendedProfile = null;
    mount(data); await loaded();
    expect(screen.getByLabelText('使うモデル')).toHaveValue('internal-a');
  });
  it('confirms stop inline and shows an error beside that operation', async () => {
    vi.mocked(postDgxResourceAction).mockRejectedValue(new Error('Strict Ready 409 https://secret.test'));
    mount(); await loaded();
    fireEvent.click(screen.getByRole('button', { name: '業務 LLM を止める' }));
    expect(screen.getByText(/業務 LLM を止めますか？/)).toBeInTheDocument();
    expect(postDgxResourceAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    const card = within(screen.getByRole('region', { name: '業務に戻す' }));
    expect(await card.findByRole('alert')).toHaveTextContent('操作を完了できませんでした');
    expect(card.getByRole('alert').textContent).not.toMatch(/Strict Ready|409|secret/);
    expect(postDgxResourceAction).toHaveBeenCalledWith({ type: 'STOP_BUSINESS_LLM' }, expect.any(Object));
  });
  it('restores progress from the API on a fresh page and disables controls', async () => {
    const data = overview(); data.business.state = 'returning';
    data.businessReturn = { state: 'in_progress', profileId: 'internal-a', startedAt: data.generatedAt, finishedAt: null, failureReasonJa: null };
    mount(data); await loaded();
    expect(screen.getByText(/この画面を離れても続きます/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'このモデルで業務に戻す' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '業務 LLM を止める' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存先を削除' })).toBeDisabled();
    expect(document.querySelector('.motion-reduce\\:animate-none')).toBeInTheDocument();
  });
  it('requires exact display-name input, then sends the original deletion contract invisibly', async () => {
    vi.mocked(postDgxResourceAction).mockResolvedValue({ ok: true, message: '確認しました', modelStorageDeletePreview: {
      ok: true, modelProfileId: 'internal-b', displayNameJa: '画像モデル B', canDelete: true,
      blockedReasons: [], storagePath: '/secret/models', resolvedStoragePath: '/secret/models',
      requiredConfirmation: 'DELETE internal-b', planFingerprint: 'f'.repeat(64), sizeBytes: 2 * 1024 ** 3,
    } });
    const { container } = mount(); await loaded();
    fireEvent.click(screen.getByRole('button', { name: '保存先を削除' }));
    expect(await screen.findByText('元に戻せません。確認のためモデル名を入力してください。')).toBeInTheDocument();
    expect(screen.getByText('容量: 2.0 GB')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: '削除する' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('モデル名: 画像モデル B'), { target: { value: '画像モデル' } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('モデル名: 画像モデル B'), { target: { value: '画像モデル B' } });
    expect(button).not.toBeDisabled();
    expect(container.textContent).not.toMatch(/internal-b|DELETE|指紋|secret/);
    fireEvent.click(button);
    await waitFor(() => expect(postDgxResourceAction).toHaveBeenLastCalledWith({ type: 'EXECUTE_MODEL_STORAGE_DELETE', modelProfileId: 'internal-b', planFingerprint: 'f'.repeat(64), confirmation: 'DELETE internal-b' }, expect.any(Object)));
  });
  it('does not allow deleting a protected preview and hides upstream reasons', async () => {
    vi.mocked(postDgxResourceAction).mockResolvedValue({ ok: true, message: '確認しました', modelStorageDeletePreview: {
      ok: true, modelProfileId: 'internal-b', displayNameJa: '画像モデル B', canDelete: false,
      blockedReasons: [{ code: 'active', detailJa: 'Strict Ready KB-123' }], storagePath: null, resolvedStoragePath: null,
      requiredConfirmation: 'DELETE internal-b', planFingerprint: null,
    } });
    const { container } = mount(); await loaded();
    fireEvent.click(screen.getByRole('button', { name: '保存先を削除' }));
    expect(await screen.findByText('このモデルは保護されているため、保存先を削除できません。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '削除する' })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Strict Ready|KB-/);
  });
  it('renders at most eight events and the model mismatch alert', async () => {
    const data = overview(); data.alerts = [{ id: 'mismatch', messageJa: '業務で使うモデルと動いているモデルが違います。' }];
    vi.mocked(fetchDgxResourceEvents).mockResolvedValue({ events: Array.from({ length: 10 }, (_, i) => ({ id: String(i), at: data.generatedAt, message: `操作 ${i}` })) });
    mount(data); await loaded();
    expect(screen.getByText('業務で使うモデルと動いているモデルが違います。')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '操作の履歴' })).getAllByRole('listitem')).toHaveLength(8);
    expect(fetchDgxResourceEvents).toHaveBeenCalledWith(8);
  });
});
