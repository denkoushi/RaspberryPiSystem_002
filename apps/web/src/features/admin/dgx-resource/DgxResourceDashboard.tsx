import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  dgxResourceQueryKeys, fetchDgxResourceEvents, fetchDgxResourceOverview,
  getDgxResourceApiErrorMessage, postDgxResourceAction,
} from '../../../api/dgx-resource';
import { POLL_MS } from '../../../lib/admin-polling-intervals';

import { DgxResourceStatusPanel, formatDgxTime } from './DgxResourceStatusPanel';

import type { DgxModelStorageDeletePreview } from '../../../api/dgx-resource.types';

const cardClass = 'rounded-xl border border-slate-700 bg-slate-900 p-5';
const buttonClass = 'rounded-md border border-slate-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-50';
const fieldClass = 'w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50';

export function DgxResourceDashboard() {
  const qc = useQueryClient();
  const overviewQuery = useQuery({
    queryKey: dgxResourceQueryKeys.overview, queryFn: fetchDgxResourceOverview,
    refetchInterval: POLL_MS.dgxResourceDashboardPrimary,
  });
  const eventsQuery = useQuery({
    queryKey: dgxResourceQueryKeys.events(8), queryFn: () => fetchDgxResourceEvents(8),
    refetchInterval: POLL_MS.dgxResourceDashboardPrimary,
  });
  const [selection, setSelection] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'return' | 'stop' | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePreview, setDeletePreview] = useState<DgxModelStorageDeletePreview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const mutation = useMutation({
    mutationFn: postDgxResourceAction,
    onSuccess: (result) => {
      if (result.businessReturn) {
        qc.setQueryData(dgxResourceQueryKeys.overview, (current: typeof overviewQuery.data) => current ? {
          ...current, businessReturn: result.businessReturn!, business: { ...current.business, state: 'returning' },
        } : current);
      }
      void qc.invalidateQueries({ queryKey: dgxResourceQueryKeys.overview });
      void qc.invalidateQueries({ queryKey: ['dgx-resource', 'events'] });
    },
  });
  const overview = overviewQuery.data;
  const profiles = overview?.modelProfiles ?? [];
  const selectedId = selection ?? overview?.business.intendedProfile?.id
    ?? profiles.find((profile) => profile.isRecommended && profile.startable)?.id
    ?? profiles.find((profile) => profile.startable)?.id ?? '';
  const selected = profiles.find((profile) => profile.id === selectedId);
  const deleteProfileName = profiles.find((profile) => profile.id === deletePreview?.modelProfileId)?.displayName ?? '選んだモデル';
  const returning = overview?.businessReturn.state === 'in_progress';
  const busy = mutation.isPending || returning;
  const controlsDisabled = busy || overviewQuery.isError;

  const runBusinessAction = async () => {
    if (!confirmAction || controlsDisabled) return;
    setOperationError(null);
    try {
      await mutation.mutateAsync(confirmAction === 'return'
        ? { type: 'RETURN_TO_BUSINESS', modelProfileId: selectedId } : { type: 'STOP_BUSINESS_LLM' });
      setConfirmAction(null);
    } catch (error) { setOperationError(getDgxResourceApiErrorMessage(error)); }
  };
  const previewDelete = async (modelProfileId: string) => {
    setDeleteError(null);
    setDeletePreview(null);
    setConfirmation('');
    try {
      const result = await mutation.mutateAsync({ type: 'PREVIEW_MODEL_STORAGE_DELETE', modelProfileId });
      if (!result.modelStorageDeletePreview) throw new Error('Missing preview');
      setDeletePreview(result.modelStorageDeletePreview);
    } catch (error) { setDeleteError(getDgxResourceApiErrorMessage(error)); }
  };
  const executeDelete = async () => {
    if (!deletePreview?.canDelete || !deletePreview.planFingerprint || confirmation !== deleteProfileName || controlsDisabled) return;
    setDeleteError(null);
    try {
      await mutation.mutateAsync({ type: 'EXECUTE_MODEL_STORAGE_DELETE', modelProfileId: deletePreview.modelProfileId,
        planFingerprint: deletePreview.planFingerprint, confirmation: deletePreview.requiredConfirmation });
      setDeletePreview(null);
      setConfirmation('');
    } catch (error) { setDeleteError(getDgxResourceApiErrorMessage(error)); }
  };

  return <main className="space-y-5 text-slate-200">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-2xl font-bold text-white">DGX リソース</h1>
      <p className="text-sm tabular-nums text-slate-400">更新 {formatDgxTime(overview?.generatedAt ?? null, true)}</p>
    </header>
    {overviewQuery.isError && <p role="alert" className="rounded-lg border border-amber-400/40 bg-amber-950/40 p-3 text-amber-200">状態を更新できません。接続を確認してください。{overview ? '表示は最後に確認できた状態です。' : ''}</p>}
    {!overview && !overviewQuery.isError && <p role="status">状態を確認しています。</p>}
    {overview && <>
      <DgxResourceStatusPanel overview={overview} />
      {overview.alerts.length > 0 && <aside aria-label="注意" className="space-y-2 rounded-lg border border-amber-400/40 bg-amber-950/40 p-4 text-sm leading-relaxed text-amber-200">
        {overview.alerts.map((alert) => <p key={alert.id}>{alert.messageJa}</p>)}
      </aside>}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <section aria-labelledby="business-return-title" className={cardClass}>
          <h2 id="business-return-title" className="text-lg font-semibold text-white">業務に戻す</h2>
          <label htmlFor="business-model" className="mb-2 mt-4 block text-sm">使うモデル</label>
          <select id="business-model" className={fieldClass} value={selectedId} disabled={controlsDisabled || !overview.modelProfilesAvailable}
            onChange={(event) => { setSelection(event.target.value); setConfirmAction(null); setOperationError(null); }}>
            {!selected && <option value={selectedId}>{overview.business.intendedProfile && selectedId === overview.business.intendedProfile.id
              ? `${overview.business.intendedProfile.displayName}（現在は利用できません）` : 'モデルを選んでください'}</option>}
            {profiles.map((profile) => <option key={profile.id} value={profile.id} disabled={!profile.startable}>
              {profile.displayName}{!profile.startable ? `（${profile.unavailableReasonJa ?? '現在は利用できません'}）` : ''}
            </option>)}
          </select>
          {!overview.modelProfilesAvailable && <p className="mt-2 text-sm text-amber-300">モデル一覧を取得できません。少し待ってお試しください。</p>}
          <button type="button" className={`${buttonClass} mt-3 w-full border-blue-500 bg-blue-600 hover:bg-blue-500`}
            disabled={controlsDisabled || !selected?.startable || !overview.modelProfilesAvailable}
            onClick={() => { setConfirmAction('return'); setOperationError(null); }}>このモデルで業務に戻す</button>
          {confirmAction === 'return' && !returning && <div className="mt-3 space-y-3 rounded-lg border border-blue-400/40 bg-slate-950 p-4">
            <p className="text-sm leading-relaxed">DGX の今の処理を止めて、{selected?.displayName} を読み込みます。読み込みに数分かかり、その間キオスクの AI 機能は使えません。</p>
            <div className="flex gap-2"><button type="button" className={buttonClass} disabled={controlsDisabled} onClick={() => void runBusinessAction()}>戻す</button>
              <button type="button" className={buttonClass} disabled={mutation.isPending} onClick={() => { setConfirmAction(null); setOperationError(null); }}>やめる</button></div>
          </div>}
          {returning && <p role="status" className="mt-4 flex items-start gap-3 text-sm leading-relaxed text-blue-200">
            <span aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-transparent motion-reduce:animate-none" />
            モデルを読み込み中です（開始 {formatDgxTime(overview.businessReturn.startedAt)}）。この画面を離れても続きます。
          </p>}
          {operationError && confirmAction !== 'stop' && <p role="alert" className="mt-3 text-sm text-red-300">{operationError}</p>}
          <div className="mt-6 border-t border-slate-700 pt-5">
            <p className="text-sm leading-relaxed text-slate-400">DGX の業務 LLM を止めます。止めている間、キオスクの AI 機能は使えません。</p>
            <button type="button" className={`${buttonClass} mt-3 border-red-400/60 text-red-300 hover:bg-red-950`}
              disabled={controlsDisabled} onClick={() => { setConfirmAction('stop'); setOperationError(null); }}>業務 LLM を止める</button>
            {confirmAction === 'stop' && !returning && <div className="mt-3 space-y-3 rounded-lg border border-red-400/40 bg-slate-950 p-4">
              <p className="text-sm leading-relaxed">業務 LLM を止めますか？ 再開するには「このモデルで業務に戻す」を押します。</p>
              <div className="flex gap-2"><button type="button" className={`${buttonClass} border-red-400 text-red-300`} disabled={controlsDisabled} onClick={() => void runBusinessAction()}>止める</button>
                <button type="button" className={buttonClass} disabled={mutation.isPending} onClick={() => { setConfirmAction(null); setOperationError(null); }}>やめる</button></div>
            </div>}
            {operationError && confirmAction === 'stop' && <p role="alert" className="mt-3 text-sm text-red-300">{operationError}</p>}
          </div>
        </section>
        <section aria-labelledby="models-title" className={`${cardClass} min-w-0`}>
          <h2 id="models-title" className="text-lg font-semibold text-white">モデル</h2>
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="border-b border-slate-700 text-slate-400"><tr>{['名前', '方式', 'メモリ', '状態', '操作'].map((label) => <th key={label} scope="col" className="whitespace-nowrap px-2 py-3 font-medium">{label}</th>)}</tr></thead>
            <tbody>{profiles.map((profile) => <tr key={profile.id} className="border-b border-slate-800">
              <th scope="row" className="px-2 py-4 font-medium text-white">{profile.displayName}</th>
              <td className="px-2 py-4">{profile.backendLabel}{profile.supportsVision ? ' · 画像可' : ''}</td>
              <td className={`whitespace-nowrap px-2 py-4 ${profile.startupFit === 'fits' ? 'text-emerald-300' : profile.startupFit === 'insufficient' ? 'text-amber-300' : 'text-slate-400'}`}>{{ fits: '入る', insufficient: '不足', unknown: '不明' }[profile.startupFit]}</td>
              <td className="whitespace-nowrap px-2 py-4">{profile.isActive ? <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-xs text-emerald-300">動作中</span> : '待機'}</td>
              <td className="whitespace-nowrap px-2 py-4">{profile.deletable ? <button type="button" className={`${buttonClass} px-2 text-red-300`} disabled={controlsDisabled}
                onClick={() => void previewDelete(profile.id)}>保存先を削除</button> : <span className="text-slate-500">削除不可</span>}</td>
            </tr>)}</tbody>
          </table></div>
          {profiles.length === 0 && <p className="mt-3 text-sm text-slate-400">{overview.modelProfilesAvailable ? '業務用モデルが登録されていません。' : 'モデル一覧を取得できません。'}</p>}
          {deletePreview && <div className="mt-4 space-y-3 rounded-lg border border-red-400/40 bg-slate-950 p-4">
            <p className="font-medium text-white">{deleteProfileName}の保存先を削除</p>
            {(deletePreview.sizeBytes != null || deletePreview.sizeGiB != null) && <p className="text-sm text-slate-300">容量: {(deletePreview.sizeBytes != null ? deletePreview.sizeBytes / 1024 ** 3 : deletePreview.sizeGiB!).toFixed(1)} GB</p>}
            {deletePreview.canDelete && deletePreview.planFingerprint ? <>
              <p className="text-sm">元に戻せません。確認のためモデル名を入力してください。</p>
              <label htmlFor="delete-model-name" className="block text-sm">モデル名: {deleteProfileName}</label>
              <input id="delete-model-name" className={fieldClass} value={confirmation} disabled={controlsDisabled} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
              <button type="button" className={`${buttonClass} border-red-400 text-red-300`} disabled={controlsDisabled || confirmation !== deleteProfileName} onClick={() => void executeDelete()}>削除する</button>
            </> : <p className="text-sm text-amber-300">このモデルは保護されているため、保存先を削除できません。</p>}
            <button type="button" className={`${buttonClass} ml-2`} disabled={mutation.isPending} onClick={() => { setDeletePreview(null); setDeleteError(null); }}>やめる</button>
          </div>}
          {deleteError && <p role="alert" className="mt-3 text-sm text-red-300">{deleteError}</p>}
        </section>
      </div>
    </>}
    <section aria-labelledby="events-title" className={cardClass}>
      <h2 id="events-title" className="text-lg font-semibold text-white">操作の履歴</h2>
      {eventsQuery.isError && <p className="mt-3 text-sm text-amber-300">履歴を更新できません。</p>}
      <ol className="mt-3 divide-y divide-slate-800">{eventsQuery.data?.events.slice(0, 8).map((event) => <li key={event.id} className="flex flex-wrap gap-x-4 gap-y-1 py-2 text-sm">
        <time dateTime={event.at} className="tabular-nums text-slate-400">{formatDgxTime(event.at, true)}</time><span>{event.message}</span>
      </li>)}</ol>
      {eventsQuery.data?.events.length === 0 && <p className="text-sm text-slate-400">操作の履歴はまだありません。</p>}
    </section>
  </main>;
}
