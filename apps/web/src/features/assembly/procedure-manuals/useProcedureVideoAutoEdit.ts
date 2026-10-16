import { useCallback, useEffect, useRef, useState } from 'react';

import { applyProcedureVideoAutoEdit, dismissProcedureVideoAutoEdit, getProcedureVideoAutoEdit, getProcedureVideoComments, regenerateProcedureVideoAutoEdit } from '../../../api/client';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { autoEditApplyInput, mergeScene } from './procedure-video-timeline';

import type { ProcedureVideoCommentDto, ProcedureVideoDto } from './procedure-video-types';
import type { ProcedureVideoAutoEditDto, ProcedureVideoAutoEditScene } from '@raspi-system/shared-types';

export function useProcedureVideoAutoEdit(video: ProcedureVideoDto | undefined, disabled: boolean, onDisabled: () => void, onChanged: () => void, onError: (message: string) => void, version: number) {
  const [row, setRow] = useState<ProcedureVideoAutoEditDto | null>(null);
  const [draft, setDraft] = useState<ProcedureVideoAutoEditScene[]>([]);
  const [comments, setComments] = useState<ProcedureVideoCommentDto[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const pending = useRef<{ videoId: string; suggestionId: string; row: ProcedureVideoAutoEditDto } | null>(null);
  const undo = useRef<ProcedureVideoAutoEditScene[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const callbacks = useRef({ onChanged, onError });
  callbacks.current = { onChanged, onError };
  const videoId = video?.id;
  const currentId = useRef(videoId);
  currentId.current = videoId;
  const status = video?.autoEdit?.status, decision = video?.autoEdit?.decision;

  const flushDismiss = useCallback(async () => {
    const item = pending.current;
    if (!item) return true;
    pending.current = null;
    clearTimeout(timer.current);
    setToast(null);
    setBusy(true);
    try {
      await dismissProcedureVideoAutoEdit(item.videoId, { suggestionId: item.suggestionId });
      if (currentId.current === item.videoId) setRow({ ...item.row, decision: 'DISMISSED' });
      callbacks.current.onChanged();
      return true;
    } catch (e) {
      callbacks.current.onError(readAssemblyApiErrorMessage(e, 'AI案を変更できません'));
      if (currentId.current === item.videoId) setDismissed(false);
      return false;
    } finally { setBusy(false); }
  }, []);

  useEffect(() => () => { clearTimeout(timer.current); void flushDismiss(); }, [videoId, flushDismiss]);
  useEffect(() => {
    setRow(null); setDraft([]); setComments([]); setCommentsLoaded(false); setArmed(false); setDismissed(false); setToast(null); setError(null);
    undo.current = null;
  }, [videoId]);
  useEffect(() => {
    if (!videoId) { setLoading(false); return; }
    let cancelled = false;
    setCommentsLoaded(false);
    void getProcedureVideoComments(videoId).then((rows) => { if (!cancelled) { setComments(rows); setCommentsLoaded(true); } })
      .catch((e: unknown) => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, 'コメントを取得できません')); });
    return () => { cancelled = true; };
  }, [videoId, version, decision]);
  useEffect(() => {
    let cancelled = false;
    if (!videoId || disabled) { setLoading(false); return; }
    setLoading(true); setError(null);
    void getProcedureVideoAutoEdit(videoId).then((next) => {
      if (cancelled) return;
      setRow(next);
      setDraft(next?.suggestion?.scenes.map((scene) => ({ ...scene })) ?? []);
      setArmed(false); setDismissed(false);
    }).catch((e: unknown) => {
      const response = (e as { response?: { status?: number; data?: { message?: string } } })?.response;
      if (response?.status === 409 && response.data?.message === '自動編集は無効です') onDisabled();
      else if (!cancelled) setError(readAssemblyApiErrorMessage(e, 'AI案を取得できません'));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [videoId, status, decision, disabled, onDisabled, version]);

  const changeDraft = (next: ProcedureVideoAutoEditScene[]) => { setDraft(next); setArmed(false); };
  const merge = (index: number) => {
    clearTimeout(timer.current);
    undo.current = draft;
    changeDraft(mergeScene(draft, index));
    setToast('となりの場面とまとめました');
    timer.current = setTimeout(() => { undo.current = null; setToast(null); }, 4000);
  };
  const dismiss = () => {
    if (!row || !videoId || busy) return;
    clearTimeout(timer.current); undo.current = null;
    pending.current = { videoId, suggestionId: row.id, row };
    setDismissed(true); setArmed(false); setToast('このAI案は使いません');
    timer.current = setTimeout(() => { void flushDismiss(); }, 4000);
  };
  const restore = () => {
    clearTimeout(timer.current);
    if (pending.current) { pending.current = null; setDismissed(false); }
    else if (undo.current) changeDraft(undo.current);
    undo.current = null; setToast(null);
  };
  const apply = async () => {
    if (!row || !videoId || busy || !commentsLoaded) return;
    if (comments.length && !armed) { setArmed(true); return; }
    const input = autoEditApplyInput(row.id, draft);
    setBusy(true); setError(null);
    try {
      await applyProcedureVideoAutoEdit(videoId, input);
      clearTimeout(timer.current); undo.current = null; setToast(null);
      setRow({ ...row, decision: 'APPLIED', confirmed: { comments: input.comments, scenes: input.scenes ?? [] } });
      setComments(input.comments); setArmed(false); onChanged();
    } catch (e) { setError(readAssemblyApiErrorMessage(e, 'AI案を採用できません')); }
    finally { setBusy(false); }
  };
  const regenerate = async () => {
    if (!videoId || disabled || busy || pending.current) return;
    setBusy(true); setError(null);
    try {
      const next = await regenerateProcedureVideoAutoEdit(videoId);
      clearTimeout(timer.current); undo.current = null; setToast(null);
      setRow(next); setDraft([]); setArmed(false); setDismissed(false); onChanged();
    } catch (e) { setError(readAssemblyApiErrorMessage(e, 'AI案を作れませんでした')); }
    finally { setBusy(false); }
  };
  return { row, draft, comments, commentsLoaded, loading, error, busy, armed, dismissed, toast, pendingDismiss: Boolean(pending.current), changeDraft, merge, dismiss, restore, apply, regenerate, flushDismiss };
}
