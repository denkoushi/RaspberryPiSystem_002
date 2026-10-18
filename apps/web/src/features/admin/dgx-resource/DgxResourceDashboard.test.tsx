import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dgxResourceQueryKeys, fetchDgxResourceEvents, fetchDgxResourceOverview, postDgxResourceAction } from '../../../api/dgx-resource';

import { DgxResourceDashboard } from './DgxResourceDashboard';

import type { DgxResourceOverview } from '../../../api/dgx-resource.types';

vi.mock('../../../api/dgx-resource', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/dgx-resource')>(),
  fetchDgxResourceEvents: vi.fn(), fetchDgxResourceOverview: vi.fn(), postDgxResourceAction: vi.fn(),
}));

function overview(): DgxResourceOverview {
  const common = { backendLabel: 'vLLM' as const, quantizationLabel: 'NVFP4', supportsVision: true,
    isActive: false, isRecommended: false, censored: true, requiredBytes: 64 * 1024 ** 3, fitAvailableBytes: 120 * 1024 ** 3,
    startupFit: 'fits' as const, startable: true, unavailableKind: null, unavailableReasonJa: null, deletable: true };
  return {
    generatedAt: '2026-10-17T01:02:03Z',
    business: { state: 'ready', llm: { state: 'ok' },
      embedding: { state: 'not_observed', lastSuccessAt: null, lastFailureAt: null, lastErrorBrief: null },
      activeProfile: { id: 'internal-a', displayName: 'モデル A' }, intendedProfile: null, matchesIntent: null },
    metrics: { gpuName: 'NVIDIA GB10', unifiedMemUsedBytes: 84 * 1024 ** 3, unifiedMemTotalBytes: 128 * 1024 ** 3,
      modelMemBytes: 80 * 1024 ** 3, otherMemBytes: 4 * 1024 ** 3, gpuUtilPct: 25, temperatureC: 42, powerW: 80 },
    modelProfiles: [
      { ...common, id: 'internal-a', displayName: 'モデル A', isActive: true, deletable: false },
      { ...common, id: 'internal-b', displayName: '画像モデル B' },
      { ...common, id: 'internal-c', displayName: '大型モデル C', startupFit: 'insufficient', startable: false, unavailableKind: 'insufficient_memory', unavailableReasonJa: 'メモリ不足' },
      { ...common, id: 'internal-d', displayName: 'モデル D', startable: false, unavailableKind: 'no_storage', unavailableReasonJa: '保存先なし' },
      { ...common, id: 'internal-e', displayName: 'モデル E', startable: false, unavailableKind: 'disabled', unavailableReasonJa: '停止中' },
    ],
    modelProfilesAvailable: true,
    businessReturn: { state: 'idle', phase: null, profileId: null, startedAt: null, finishedAt: null, failureReasonJa: null }, alerts: [],
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
const row = (name: string) => within(screen.getByText(name, { selector: '.dgx-nm b, .dgx-card b' }).closest('li')!);
const openDelete = () => { fireEvent.click(screen.getByRole('button', { name: '画像モデル B のその他の操作' })); fireEvent.click(screen.getByRole('button', { name: '保存先を削除' })); };

describe('DGX switch console', () => {
  it('shows the active row, switches, censorship chips and no intent or start button', async () => {
    const { container } = mount(); await loaded();
    expect(row('モデル A').getByText('稼働中')).toBeInTheDocument();
    expect(row('画像モデル B').getByRole('button', { name: '切り替える' })).toBeEnabled();
    expect(row('大型モデル C').getByRole('button', { name: '切り替える' })).toBeDisabled();
    expect(row('大型モデル C').getByText('不足')).toBeInTheDocument();
    expect(row('モデル D').getByText('保存先なし')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '起動' })).not.toBeInTheDocument();
    expect(screen.queryByText(/業務で使うモデル|未設定/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('注意')).not.toBeInTheDocument();
    expect(screen.getAllByText('検閲あり')).toHaveLength(5);
    expect(screen.getByText('検閲なしは個人用のため非表示')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/internal-|業務モデル|RETURN_TO_BUSINESS|not_observed|insufficient_memory|DGX_RESOURCE_|Strict Ready|指紋|KB-/);
  });
  it('starts directly when stopped, with no stop control or stale active badge', async () => {
    const data = overview(); data.business.llm.state = 'down'; data.business.state = 'down';
    mount(data); await loaded();
    expect(screen.getByText('業務 LLM 停止')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /停止/ })).not.toBeInTheDocument();
    expect(screen.queryByText('稼働中')).not.toBeInTheDocument();
    fireEvent.click(row('画像モデル B').getByRole('button', { name: '起動' }));
    await waitFor(() => expect(postDgxResourceAction).toHaveBeenCalledWith({ type: 'RETURN_TO_BUSINESS', modelProfileId: 'internal-b' }, expect.any(Object)));
  });
  it('shows the mock warning only for an intended model mismatch', async () => {
    const data = overview(); data.business.state = 'ready_mismatch'; data.business.matchesIntent = false;
    data.business.intendedProfile = { id: 'internal-b', displayName: '画像モデル B' };
    data.alerts = [{ id: 'model_mismatch', messageJa: '業務の既定は 画像モデル B です。いまは別のモデルで動いています' }];
    mount(data); await loaded();
    expect(screen.getByLabelText('注意')).toHaveTextContent(data.alerts[0].messageJa);
  });
  it('confirms switching inline, cancels, then restores API phase progress', async () => {
    const data = overview(); const { client } = mount(data); await loaded();
    fireEvent.click(row('画像モデル B').getByRole('button', { name: '切り替える' }));
    expect(row('画像モデル B').getByText('切り替え中は AI 機能が数分止まります')).toBeInTheDocument();
    expect(postDgxResourceAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(screen.queryByText('切り替え中は AI 機能が数分止まります')).not.toBeInTheDocument();
    fireEvent.click(row('画像モデル B').getByRole('button', { name: '切り替える' }));
    const progress = { ...data, businessReturn: { ...data.businessReturn, state: 'in_progress' as const, profileId: 'internal-b', phase: 'starting' as const } };
    vi.mocked(fetchDgxResourceOverview).mockResolvedValue(progress);
    vi.mocked(postDgxResourceAction).mockResolvedValue({ ok: true, message: '', businessReturn: progress.businessReturn });
    fireEvent.click(screen.getByRole('button', { name: '画像モデル B に切り替える' }));
    await screen.findByText('切り替え中');
    expect(postDgxResourceAction).toHaveBeenCalledWith({ type: 'RETURN_TO_BUSINESS', modelProfileId: 'internal-b' }, expect.any(Object));
    expect(screen.getByText('完了:')).toBeInTheDocument();
    expect(screen.getByText('起動').closest('[aria-current]')).toHaveAttribute('aria-current', 'step');
    expect(row('大型モデル C').getByRole('button', { name: '切り替える' })).toBeDisabled();
    client.setQueryData(dgxResourceQueryKeys.overview, { ...progress, businessReturn: { ...progress.businessReturn, phase: 'checking' } });
    await waitFor(() => expect(screen.getByText('応答確認').closest('[aria-current]')).toHaveAttribute('aria-current', 'step'));
  });
  it('restores progress on fresh navigation', async () => {
    const data = overview(); data.businessReturn = { ...data.businessReturn, state: 'in_progress', phase: 'checking', profileId: 'internal-b' };
    mount(data); await loaded();
    expect(screen.getByText('キオスクの AI 機能は一時停止中')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /停止/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '画像モデル B のその他の操作' })).toBeDisabled();
  });
  it('confirms stop and keeps safe errors near the stop controls', async () => {
    vi.mocked(postDgxResourceAction).mockRejectedValue(new Error('Strict Ready 409 https://secret.test'));
    mount(); await loaded();
    fireEvent.click(screen.getByRole('button', { name: /停止/ }));
    expect(screen.getByText('AI 機能が止まります')).toBeInTheDocument();
    expect(postDgxResourceAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(screen.queryByText('AI 機能が止まります')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /停止/ }));
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    const alert = await within(await loaded()).findByRole('alert');
    expect(alert).toHaveTextContent('操作を完了できませんでした');
    expect(alert.textContent).not.toMatch(/Strict Ready|409|secret/);
    expect(postDgxResourceAction).toHaveBeenCalledWith({ type: 'STOP_BUSINESS_LLM' }, expect.any(Object));
  });
  it('requires exact visible model name, while preserving the deletion contract invisibly', async () => {
    vi.mocked(postDgxResourceAction).mockResolvedValue({ ok: true, message: '', modelStorageDeletePreview: {
      ok: true, modelProfileId: 'internal-b', displayNameJa: '業務 画像モデル B', canDelete: true,
      blockedReasons: [], storagePath: '/secret/models', resolvedStoragePath: '/secret/models',
      requiredConfirmation: 'DELETE internal-b', planFingerprint: 'f'.repeat(64),
    } });
    const { container } = mount(); await loaded(); openDelete();
    const input = await screen.findByLabelText('モデル名');
    const button = screen.getByRole('button', { name: '削除する' }); expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: '画像モデル' } }); expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: '画像モデル B' } }); expect(button).toBeEnabled();
    expect(container.textContent).not.toMatch(/DELETE|internal-|secret|指紋|業務 画像/);
    fireEvent.click(button);
    await waitFor(() => expect(postDgxResourceAction).toHaveBeenLastCalledWith({ type: 'EXECUTE_MODEL_STORAGE_DELETE', modelProfileId: 'internal-b', planFingerprint: 'f'.repeat(64), confirmation: 'DELETE internal-b' }, expect.any(Object)));
  });
  it('prevents deletion when preview denies it and hides raw reasons', async () => {
    vi.mocked(postDgxResourceAction).mockResolvedValue({ ok: true, message: '', modelStorageDeletePreview: {
      ok: true, modelProfileId: 'internal-b', displayNameJa: '画像モデル B', canDelete: false,
      blockedReasons: [{ code: 'active', detailJa: 'Strict Ready KB-123' }], storagePath: null, resolvedStoragePath: null,
      requiredConfirmation: 'DELETE internal-b', planFingerprint: null,
    } });
    const { container } = mount(); await loaded(); openDelete();
    await screen.findByText('このモデルは保護されているため、保存先を削除できません。');
    expect(screen.queryByRole('button', { name: '削除する' })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Strict Ready|KB-/);
  });
  it.each([['ok', '正常'], ['failed', '失敗'], ['not_observed', '未確認'], ['disabled', '未使用']] as const)('labels embedding %s', async (state, label) => {
    const data = overview(); data.business.embedding.state = state; mount(data); await loaded();
    expect(screen.getByText(`写真の埋め込み ${label}`)).toBeInTheDocument();
  });
  it('shows unknown memory without inventing measurements', async () => {
    const data = overview(); data.metrics.modelMemBytes = null; data.metrics.otherMemBytes = null;
    mount(data); await loaded();
    expect(screen.getByText('モデル —')).toBeInTheDocument(); expect(screen.getByText('その他 —')).toBeInTheDocument();
  });
  it('disables actions when the overview refresh fails', async () => {
    const { client } = mount(); await loaded();
    vi.mocked(fetchDgxResourceOverview).mockRejectedValue(new Error('offline'));
    await client.invalidateQueries({ queryKey: dgxResourceQueryKeys.overview });
    await screen.findByText(/表示は最後に確認できた状態です/);
    expect(row('画像モデル B').getByRole('button', { name: '切り替える' })).toBeDisabled();
  });
  it('requests and displays up to twenty events', async () => {
    const data = overview();
    vi.mocked(fetchDgxResourceEvents).mockResolvedValue({ events: Array.from({ length: 25 }, (_, i) => ({ id: String(i), at: data.generatedAt, message: `操作 ${i}` })) });
    mount(data); await loaded();
    expect(within(screen.getByRole('region', { name: '操作の履歴' })).getAllByRole('listitem')).toHaveLength(20);
    expect(fetchDgxResourceEvents).toHaveBeenCalledWith(20);
  });
});
