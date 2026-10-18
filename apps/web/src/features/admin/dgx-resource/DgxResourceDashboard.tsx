import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  dgxResourceQueryKeys, fetchDgxResourceEvents, fetchDgxResourceOverview,
  getDgxResourceApiErrorMessage, postDgxResourceAction,
} from '../../../api/dgx-resource';
import { POLL_MS } from '../../../lib/admin-polling-intervals';

import { DgxResourceStatusPanel, formatDgxTime, formatGiB, memoryPercent } from './DgxResourceStatusPanel';
import './dgx-resource.css';

import type { DgxModelStorageDeletePreview, DgxResourceOverview } from '../../../api/dgx-resource.types';

type Profile = DgxResourceOverview['modelProfiles'][number];

function Guard() {
  return <span className="dgx-guard"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6l7-3z M9 12l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="2" /></svg>検閲あり</span>;
}

export function DgxResourceDashboard() {
  const qc = useQueryClient();
  const overviewQuery = useQuery({
    queryKey: dgxResourceQueryKeys.overview, queryFn: fetchDgxResourceOverview,
    refetchInterval: POLL_MS.dgxResourceDashboardPrimary,
  });
  const eventsQuery = useQuery({
    queryKey: dgxResourceQueryKeys.events(20), queryFn: () => fetchDgxResourceEvents(20),
    refetchInterval: POLL_MS.dgxResourceDashboardPrimary,
  });
  const [open, setOpen] = useState<string | null>(null);
  const [stopConfirm, setStopConfirm] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deletePreview, setDeletePreview] = useState<DgxModelStorageDeletePreview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<{ target: string; message: string } | null>(null);
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
  const returning = overview?.businessReturn.state === 'in_progress';
  const running = overview?.business.llm.state === 'ok';
  const controlsDisabled = mutation.isPending || returning || overviewQuery.isError;
  const profiles = overview?.modelProfiles ?? [];
  const active = (profile: Profile) => running && profile.isActive && !returning;
  // Memory-limited models retain their meter, so the required space remains visible.
  const usable = profiles.filter((profile) => active(profile) || profile.startable || profile.unavailableKind === 'insufficient_memory');
  const unavailable = profiles.filter((profile) => !usable.includes(profile));
  const cancel = () => { setOpen(null); setDeleteId(null); setMenu(null); setError(null); setDeletePreview(null); setConfirmation(''); };
  const run = async (profile?: Profile) => {
    if (controlsDisabled) return;
    setError(null);
    try {
      await mutation.mutateAsync(profile ? { type: 'RETURN_TO_BUSINESS', modelProfileId: profile.id } : { type: 'STOP_BUSINESS_LLM' });
      setOpen(null); setStopConfirm(false);
    } catch (cause) { setError({ target: profile?.id ?? 'stop', message: getDgxResourceApiErrorMessage(cause) }); }
  };
  const previewDelete = async (profile: Profile) => {
    if (controlsDisabled) return;
    cancel(); setDeleteId(profile.id); setStopConfirm(false);
    try {
      const result = await mutation.mutateAsync({ type: 'PREVIEW_MODEL_STORAGE_DELETE', modelProfileId: profile.id });
      if (!result.modelStorageDeletePreview) throw new Error('Missing preview');
      setDeletePreview(result.modelStorageDeletePreview);
    } catch (cause) { setError({ target: profile.id, message: getDgxResourceApiErrorMessage(cause) }); }
  };
  const executeDelete = async (profile: Profile) => {
    if (controlsDisabled || !deletePreview?.canDelete || !deletePreview.planFingerprint || deletePreview.modelProfileId !== profile.id || confirmation !== profile.displayName) return;
    setError(null);
    try {
      await mutation.mutateAsync({ type: 'EXECUTE_MODEL_STORAGE_DELETE', modelProfileId: profile.id,
        planFingerprint: deletePreview.planFingerprint, confirmation: deletePreview.requiredConfirmation });
      cancel();
    } catch (cause) { setError({ target: profile.id, message: getDgxResourceApiErrorMessage(cause) }); }
  };
  const more = (profile: Profile) => profile.deletable && !active(profile) && <div className="dgx-menu-wrap">
    <button className="dgx-more" type="button" aria-label={`${profile.displayName} のその他の操作`} aria-expanded={menu === profile.id}
      disabled={controlsDisabled} onClick={() => { cancel(); setMenu(menu === profile.id ? null : profile.id); }}>⋯</button>
    {menu === profile.id && <div className="dgx-menu"><button className="dgx-ghost" type="button" disabled={controlsDisabled} onClick={() => void previewDelete(profile)}>保存先を削除</button></div>}
  </div>;
  const extra = (profile: Profile) => <>
    {open === profile.id && !returning && <div className="dgx-confirm">
      <span className="dgx-warn">切り替え中は AI 機能が数分止まります</span>
      <button className="dgx-ghost" type="button" disabled={mutation.isPending} onClick={cancel}>やめる</button>
      <button className="dgx-go" type="button" disabled={controlsDisabled || !profile.startable} onClick={() => void run(profile)}>{profile.displayName} に切り替える</button>
    </div>}
    {deleteId === profile.id && <div className="dgx-confirm">
      <span className="dgx-warn dgx-danger">保存先を削除</span>
      {!deletePreview && !error && <span role="status">削除できるか確認しています</span>}
      {deletePreview && (deletePreview.canDelete && deletePreview.planFingerprint ? <>
        <label className="dgx-sr-only" htmlFor="dgx-delete-name">モデル名</label>
        <input id="dgx-delete-name" placeholder={`${profile.displayName} と入力`} value={confirmation} autoComplete="off" disabled={controlsDisabled} onChange={(event) => setConfirmation(event.target.value)} />
      </> : <span>このモデルは保護されているため、保存先を削除できません。</span>)}
      <button className="dgx-ghost" type="button" disabled={mutation.isPending} onClick={cancel}>やめる</button>
      {deletePreview?.canDelete && <button className="dgx-del" type="button" disabled={controlsDisabled || !deletePreview.planFingerprint || confirmation !== profile.displayName} onClick={() => void executeDelete(profile)}>削除する</button>}
    </div>}
    {error?.target === profile.id && <p className="dgx-operation-error" role="alert">{error.message}</p>}
  </>;
  return <main className="dgx-page">
    <header className="dgx-top"><h1>DGXリソース</h1><span className="dgx-hw">{overview?.metrics.gpuName ?? 'ハードウェア未確認'} · 統合メモリ {formatGiB(overview?.metrics.unifiedMemTotalBytes ?? null)} GiB · {formatDgxTime(overview?.generatedAt ?? null, true)} 更新</span></header>
    {overviewQuery.isError && <p className="dgx-alert" role="alert">状態を更新できません。接続を確認してください。{overview ? '表示は最後に確認できた状態です。' : ''}</p>}
    {!overview && !overviewQuery.isError && <p role="status">状態を確認しています。</p>}
    {overview && <>
      {overview.alerts.filter((item) => item.id === 'model_mismatch' && overview.business.matchesIntent === false && overview.business.intendedProfile && running && !returning).map((item) => <aside className="dgx-alert" aria-label="注意" key={item.id}>{item.messageJa}</aside>)}
      <div className="dgx-grid">
        <DgxResourceStatusPanel overview={overview} stopControls={<>
          {stopConfirm ? <><span className="dgx-inline-q">AI 機能が止まります</span><div className="dgx-stop-actions">
            <button className="dgx-ghost" type="button" disabled={mutation.isPending} onClick={() => { setStopConfirm(false); setError(null); }}>やめる</button>
            <button className="dgx-del" type="button" disabled={controlsDisabled} onClick={() => void run()}>止める</button>
          </div></> : <button className="dgx-btn-stop" type="button" disabled={controlsDisabled} onClick={() => { cancel(); setStopConfirm(true); }}>⏻ 停止</button>}
          {error?.target === 'stop' && <p className="dgx-operation-error" role="alert">{error.message}</p>}
        </>} />
        <section className="dgx-models" aria-label="モデル">
          <header><h2>モデル <small>{profiles.length} 件</small></h2><span className="dgx-cap">検閲なしは個人用のため非表示</span></header>
          {!overview.modelProfilesAvailable && <p className="dgx-list-message" role="alert">モデル一覧を取得できません。少し待ってお試しください。</p>}
          {overview.businessReturn.state === 'failed' && <p className="dgx-list-message dgx-danger" role="alert">{overview.businessReturn.failureReasonJa ?? 'モデルを起動できませんでした。'}</p>}
          {overview.modelProfilesAvailable && profiles.length === 0 && <p className="dgx-list-message">業務用モデルが登録されていません。</p>}
          <ul className="dgx-list">
            <li className="dgx-row dgx-axis" aria-hidden="true"><span /><span className="dgx-scale"><span>0</span><span>{formatGiB(overview.metrics.unifiedMemTotalBytes)} GiB</span></span><span>メモリ</span><span /></li>
            {usable.map((profile) => {
              const isActive = active(profile);
              const bytes = isActive ? overview.metrics.modelMemBytes : profile.requiredBytes;
              const fits = profile.startupFit === 'fits';
              return <li key={profile.id} className={`dgx-row ${isActive ? 'dgx-active' : 'dgx-can'}`}>
                <div className="dgx-nm"><b>{profile.displayName}</b><span>{profile.quantizationLabel && <span>{profile.quantizationLabel}</span>}<span>{profile.backendLabel}</span>{profile.supportsVision && <span>画像対応</span>}{profile.censored && <Guard />}</span></div>
                <div className="dgx-meter" role="img" aria-label={`必要メモリ ${formatGiB(profile.requiredBytes)} GiB、切替時の空き ${formatGiB(profile.fitAvailableBytes)} GiB`}><i style={{ width: `${memoryPercent(bytes, overview.metrics.unifiedMemTotalBytes)}%`, background: isActive ? 'var(--live)' : fits ? 'var(--signal)' : 'var(--halt)' }} /></div>
                <span className="dgx-val">{formatGiB(bytes)} GiB{!isActive && <em className={fits ? 'dgx-ok' : profile.startupFit === 'insufficient' ? 'dgx-danger' : ''}>{fits ? '入る' : profile.startupFit === 'insufficient' ? '不足' : '未確認'}</em>}</span>
                <div className="dgx-act">{isActive ? <span className="dgx-badge-live"><i />稼働中</span> : returning && overview.businessReturn.profileId === profile.id ? <span className="dgx-switching">切替中</span> : open !== profile.id && <button className="dgx-go" type="button" disabled={controlsDisabled || !profile.startable || !overview.modelProfilesAvailable} onClick={() => { cancel(); setStopConfirm(false); if (running) setOpen(profile.id); else void run(profile); }}>{running ? '切り替える' : '起動'}</button>}{more(profile)}</div>
                {extra(profile)}
              </li>;
            })}
          </ul>
          {unavailable.length > 0 && <div className="dgx-idle"><h3>いま使えないモデル <small>{unavailable.length}</small></h3><ul className="dgx-cards">{unavailable.map((profile) => <li className="dgx-card" key={profile.id}>
            <b>{profile.displayName}<small>{profile.quantizationLabel} {profile.backendLabel}</small></b>{more(profile)}
            <span className="dgx-sub"><span className="dgx-reason">{profile.unavailableReasonJa ?? '停止中'}</span>{profile.censored && <Guard />}</span>{extra(profile)}
          </li>)}</ul></div>}
          <section className="dgx-log" aria-labelledby="dgx-events-title"><h3 id="dgx-events-title">操作の履歴</h3>
            {eventsQuery.isError && <p role="alert">履歴を更新できません。</p>}
            <ol>{eventsQuery.data?.events.slice(0, 20).map((event) => <li key={event.id}><time dateTime={event.at}>{new Date(event.at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })} {formatDgxTime(event.at)}</time><span>{event.message}</span></li>)}</ol>
            {eventsQuery.data?.events.length === 0 && <p>操作の履歴はまだありません。</p>}
          </section>
        </section>
      </div>
    </>}
  </main>;
}
