import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  assignAssemblyFormalIdentifier,
  correctAssemblyFormalIdentifier,
  linkAssemblyWorkUnits,
  listAssemblyTraceabilityWorkUnits,
  reassignAssemblyWorkUnit,
  resolveAssemblyTraceabilityWorkUnit,
  unlinkAssemblyWorkUnits,
  verifyKioskAssemblyTraceabilityAccessPassword
} from '../../api/client';
import { Button, buttonClassName } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Input } from '../../components/ui/Input';
import {
  KIOSK_ASSEMBLY_HOME_PATH,
  normalizeAssemblyUpperIdentifier,
  readAssemblyApiErrorMessage
} from '../../features/assembly';
import { useSerialBarcodeStream } from '../../features/barcode-scan';

import type {
  AssemblyGenealogyNodeDto,
  AssemblyTraceabilityDetailDto,
  AssemblyTraceabilityWorkUnitDto
} from '../../features/assembly/types';

type ScanTarget = 'parent' | 'child' | 'formal';
type PendingAction =
  | { kind: 'unlink'; linkId: string; workId: string }
  | { kind: 'reassign'; linkId: string; workId: string }
  | { kind: 'correct'; assignmentId: string; formalId: string };

function workUnitCaption(unit: AssemblyTraceabilityWorkUnitDto): string {
  return [unit.workId, unit.productNo, unit.targetUnit].filter(Boolean).join(' / ');
}

function GenealogyNode({ node }: { node: AssemblyGenealogyNodeDto }) {
  return (
    <li className="grid gap-1 border-l border-cyan-300/35 pl-3">
      <span className="font-semibold">{workUnitCaption(node.workUnit)}</span>
      <span className="text-xs text-white/60">{node.workUnit.status === 'completed' ? '完了' : node.workUnit.status}</span>
      {node.children.length > 0 ? (
        <ul className="grid gap-2 pl-2">
          {node.children.map((child) => <GenealogyNode key={child.workUnit.id} node={child} />)}
        </ul>
      ) : null}
    </li>
  );
}

export function KioskAssemblyTraceabilityPage() {
  const [searchParams] = useSearchParams();
  const initialWorkId = searchParams.get('workId') ?? '';
  const [accessPassword, setAccessPassword] = useState<string | null>(null);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const accessPromptShownRef = useRef(false);
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const [parentWorkId, setParentWorkId] = useState(initialWorkId);
  const [childWorkId, setChildWorkId] = useState('');
  const [formalId, setFormalId] = useState('');
  const [reassignParentWorkId, setReassignParentWorkId] = useState('');
  const [reason, setReason] = useState('');
  const [scanTarget, setScanTarget] = useState<ScanTarget>('parent');
  const [detail, setDetail] = useState<AssemblyTraceabilityDetailDto | null>(null);
  const [completedUnits, setCompletedUnits] = useState<Array<AssemblyTraceabilityWorkUnitDto & { formalIdentifier: { id: string; formalId: string } | null }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const requestAccessPassword = useCallback(async () => {
    const password = typeof window !== 'undefined' ? window.prompt('製品構成・正式IDの管理パスワードを入力してください') : null;
    if (!password) {
      setAccessMessage('製品構成・正式IDの操作にはパスワード認証が必要です。');
      return;
    }
    setVerifyingPassword(true);
    try {
      const result = await verifyKioskAssemblyTraceabilityAccessPassword({ password });
      if (!result.success) {
        setAccessMessage('パスワードが違います。');
        return;
      }
      setAccessPassword(password);
      setAccessMessage(null);
    } catch {
      setAccessMessage('認証に失敗しました。ネットワーク接続を確認してください。');
    } finally {
      setVerifyingPassword(false);
    }
  }, []);

  useEffect(() => {
    if (accessPassword || accessPromptShownRef.current) return;
    accessPromptShownRef.current = true;
    void requestAccessPassword();
  }, [accessPassword, requestAccessPassword]);

  const reloadCompletedUnits = useCallback(async () => {
    if (!accessPassword) return;
    try {
      setCompletedUnits(await listAssemblyTraceabilityWorkUnits({ limit: 50 }));
    } catch (error: unknown) {
      setMessage(readAssemblyApiErrorMessage(error, '完成品一覧を取得できませんでした。'));
    }
  }, [accessPassword]);

  const resolveParent = useCallback(async (workId = parentWorkId) => {
    const normalized = normalizeAssemblyUpperIdentifier(workId);
    if (!normalized) {
      setMessage('親（完成品）の作業用IDを入力してください。');
      return;
    }
    setBusy(true);
    try {
      const next = await resolveAssemblyTraceabilityWorkUnit(normalized);
      setDetail(next);
      setParentWorkId(next.workUnit.workId);
      setFormalId(next.root.formalIdentifier?.formalId ?? '');
      setMessage(null);
    } catch (error: unknown) {
      setDetail(null);
      setMessage(readAssemblyApiErrorMessage(error, '作業用IDを確認できませんでした。'));
    } finally {
      setBusy(false);
    }
  }, [parentWorkId]);

  useEffect(() => {
    if (!accessPassword || !initialWorkId) return;
    void resolveParent(initialWorkId);
  }, [accessPassword, initialWorkId, resolveParent]);

  useEffect(() => {
    void reloadCompletedUnits();
  }, [reloadCompletedUnits]);

  useSerialBarcodeStream(Boolean(accessPassword), (scanned) => {
    const normalized = normalizeAssemblyUpperIdentifier(scanned);
    if (!normalized) return;
    if (scanTarget === 'parent') {
      setParentWorkId(normalized);
      void resolveParent(normalized);
    } else if (scanTarget === 'child') {
      setChildWorkId(normalized);
    } else {
      setFormalId(normalized);
    }
  });

  const activeFormalAssignment = useMemo(
    () => detail?.formalIdentifierHistory.find((assignment) => assignment.supersededAt == null) ?? null,
    [detail]
  );

  const refresh = async () => {
    await Promise.all([resolveParent(), reloadCompletedUnits()]);
  };

  const linkChild = async () => {
    if (!accessPassword || !detail) return;
    setBusy(true);
    try {
      await linkAssemblyWorkUnits({
        parentWorkId: detail.workUnit.workId,
        childWorkId,
        accessPassword
      });
      setChildWorkId('');
      setMessage('子アセンブリを紐付けました。');
      await refresh();
    } catch (error: unknown) {
      setMessage(readAssemblyApiErrorMessage(error, '子アセンブリを紐付けできませんでした。'));
    } finally {
      setBusy(false);
    }
  };

  const assignFormalId = async () => {
    if (!accessPassword || !detail) return;
    setBusy(true);
    try {
      await assignAssemblyFormalIdentifier({ workId: detail.root.workUnit.workId, formalId, accessPassword });
      setMessage('正式IDを付与しました。');
      await refresh();
    } catch (error: unknown) {
      setMessage(readAssemblyApiErrorMessage(error, '正式IDを付与できませんでした。'));
    } finally {
      setBusy(false);
    }
  };

  const confirmPendingAction = async () => {
    if (!accessPassword || !pendingAction || !reason.trim()) return;
    setBusy(true);
    try {
      if (pendingAction.kind === 'unlink') {
        await unlinkAssemblyWorkUnits(pendingAction.linkId, { accessPassword, reason });
        setMessage(`${pendingAction.workId} の構成を解除しました。`);
      } else if (pendingAction.kind === 'reassign') {
        if (!reassignParentWorkId.trim()) {
          setMessage('変更先の親作業用IDを入力してください。');
          return;
        }
        await reassignAssemblyWorkUnit(pendingAction.linkId, { parentWorkId: reassignParentWorkId, accessPassword, reason });
        setMessage(`${pendingAction.workId} の親を変更しました。`);
      } else {
        await correctAssemblyFormalIdentifier(pendingAction.assignmentId, { formalId, accessPassword, reason });
        setMessage(`正式ID ${pendingAction.formalId} を訂正しました。`);
      }
      setPendingAction(null);
      setReason('');
      await refresh();
    } catch (error: unknown) {
      setMessage(readAssemblyApiErrorMessage(error, '変更を保存できませんでした。'));
    } finally {
      setBusy(false);
    }
  };

  if (!accessPassword) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 bg-slate-800 p-3 text-white">
        <section className="rounded border border-white/15 bg-slate-900/70 p-3">
          <h1 className="text-2xl font-bold">製品構成・正式ID</h1>
          <p className="mt-1 text-sm text-white/65">{accessMessage ?? 'パスワード認証中です。'}</p>
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="secondary" disabled={verifyingPassword} onClick={() => void requestAccessPassword()}>認証する</Button>
            <Link to={KIOSK_ASSEMBLY_HOME_PATH} className={buttonClassName('ghostOnDark', 'inline-flex items-center')}>戻る</Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto bg-slate-800 p-3 text-white">
      <header className="flex flex-wrap items-end justify-between gap-3 rounded border border-white/15 bg-slate-900/70 p-3">
        <div>
          <h1 className="text-2xl font-bold">製品構成・正式ID</h1>
          <p className="mt-1 text-sm text-white/65">完了済みサブアセンブリを構成へ紐付け、最上位完成品へ正式IDを付与します。</p>
        </div>
        <Link to={KIOSK_ASSEMBLY_HOME_PATH} className={buttonClassName('ghostOnDark', 'inline-flex min-h-11 items-center')}>組立状況へ戻る</Link>
      </header>

      {message ? <p className="rounded border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-100" role="status">{message}</p> : null}

      <main className="grid gap-3 xl:grid-cols-[minmax(21rem,0.8fr)_minmax(0,1.2fr)]">
        <section className="grid content-start gap-3 rounded border border-white/15 bg-slate-900/70 p-3">
          <h2 className="text-lg font-bold">完成品の作業用ID</h2>
          <div className="flex gap-2">
            <Input value={parentWorkId} onFocus={() => setScanTarget('parent')} onChange={(event) => setParentWorkId(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void resolveParent(); }} placeholder="作業用IDをスキャンまたは入力" className="min-h-11" />
            <Button type="button" disabled={busy} onClick={() => void resolveParent()}>確認</Button>
          </div>
          <p className="text-xs text-white/55">スキャナ入力先: 親（完成品）</p>
          <div className="grid gap-1 rounded border border-white/10 bg-slate-950/45 p-2">
            <h3 className="font-bold">完成済み・最上位の候補</h3>
            {completedUnits.length === 0 ? <p className="text-sm text-white/55">該当する完成品はありません。</p> : completedUnits.map((unit) => (
              <button key={unit.id} type="button" onClick={() => void resolveParent(unit.workId)} className="rounded border border-white/10 px-2 py-1.5 text-left text-sm hover:bg-slate-800">
                {workUnitCaption(unit)} <span className="ml-2 text-xs text-cyan-100">{unit.formalIdentifier?.formalId ?? '正式ID未登録'}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="grid content-start gap-3 rounded border border-white/15 bg-slate-900/70 p-3">
          {!detail ? <p className="text-white/60">完成品の作業用IDを確認すると、構成と正式IDを操作できます。</p> : <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">{workUnitCaption(detail.root.workUnit)}</h2>
                <p className="text-sm text-white/65">正式ID: {detail.root.formalIdentifier?.formalId ?? '未登録'}</p>
              </div>
              <span className="rounded bg-cyan-500/15 px-2 py-1 text-xs font-bold text-cyan-100">{detail.root.workUnit.status === 'completed' ? '完了済み' : detail.root.workUnit.status}</span>
            </div>

            <section className="grid gap-2 rounded border border-white/10 p-2">
              <h3 className="font-bold">子アセンブリを追加</h3>
              <div className="flex gap-2">
                <Input value={childWorkId} onFocus={() => setScanTarget('child')} onChange={(event) => setChildWorkId(event.target.value)} placeholder="完了済み子の作業用ID" className="min-h-11" />
                <Button type="button" disabled={busy || !childWorkId.trim()} onClick={() => void linkChild()}>紐付け</Button>
              </div>
              <p className="text-xs text-white/55">スキャナ入力先: 子アセンブリ。子は完了済みで、別の親へ未紐付けのIDだけ登録できます。</p>
              {detail.activeChildren.length === 0 ? <p className="text-sm text-white/55">有効な子アセンブリはありません。</p> : detail.activeChildren.map(({ linkId, workUnit }) => (
                <div key={linkId} className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-slate-950/45 p-2">
                  <span className="text-sm font-semibold">{workUnitCaption(workUnit)}</span>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghostOnDark" className="min-h-10 text-xs" onClick={() => setPendingAction({ kind: 'reassign', linkId, workId: workUnit.workId })}>親変更</Button>
                    <Button type="button" variant="ghostOnDark" className="min-h-10 text-xs" onClick={() => setPendingAction({ kind: 'unlink', linkId, workId: workUnit.workId })}>解除</Button>
                  </div>
                </div>
              ))}
              <Input value={reassignParentWorkId} onChange={(event) => setReassignParentWorkId(event.target.value)} placeholder="親変更時の変更先 親作業用ID" className="min-h-11" />
              <label className="grid gap-1 text-xs font-semibold text-white/70">親変更・解除・正式ID訂正の理由
                <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="履歴に残す理由" className="min-h-11" />
              </label>
            </section>

            <section className="grid gap-2 rounded border border-white/10 p-2">
              <h3 className="font-bold">正式ID</h3>
              <div className="flex gap-2">
                <Input value={formalId} onFocus={() => setScanTarget('formal')} onChange={(event) => setFormalId(event.target.value)} placeholder="正式IDをスキャンまたは入力" className="min-h-11" />
                {activeFormalAssignment ? (
                  <Button type="button" disabled={busy || !formalId.trim()} onClick={() => setPendingAction({ kind: 'correct', assignmentId: activeFormalAssignment.id, formalId: activeFormalAssignment.formalId })}>訂正</Button>
                ) : (
                  <Button type="button" disabled={busy || !formalId.trim() || detail.root.workUnit.status !== 'completed'} onClick={() => void assignFormalId()}>付与</Button>
                )}
              </div>
              <p className="text-xs text-white/55">スキャナ入力先: 正式ID。正式IDは完了済みの最上位完成品だけに付与でき、過去の番号も再利用できません。</p>
              <ul className="grid gap-1 text-sm">
                {detail.formalIdentifierHistory.map((assignment) => <li key={assignment.id} className="rounded bg-slate-950/45 px-2 py-1">{assignment.formalId} / {assignment.supersededAt ? `訂正済み: ${assignment.supersedeReason ?? '-'}` : '現在有効'}</li>)}
              </ul>
            </section>

            <section className="grid gap-2 rounded border border-white/10 p-2">
              <h3 className="font-bold">構成ツリー</h3>
              <ul className="grid gap-2">{detail.genealogy.map((node) => <GenealogyNode key={node.workUnit.id} node={node} />)}</ul>
            </section>
          </>}
        </section>
      </main>

      <ConfirmDialog
        isOpen={pendingAction != null}
        title={pendingAction?.kind === 'unlink' ? '構成を解除しますか？' : pendingAction?.kind === 'reassign' ? '親を変更しますか？' : '正式IDを訂正しますか？'}
        description="理由を記録し、履歴は削除されません。"
        confirmLabel="確定する"
        tone="danger"
        onCancel={() => { setPendingAction(null); setReason(''); }}
        onConfirm={() => void confirmPendingAction()}
      />
    </div>
  );
}
