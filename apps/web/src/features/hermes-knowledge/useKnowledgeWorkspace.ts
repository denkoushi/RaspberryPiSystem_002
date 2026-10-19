import axios from 'axios';
import { useEffect, useRef, useState } from 'react';

import { getKnowledgeProcedure, listKnowledgeProcedures } from './knowledgeProcedureApi';
import { approveKnowledgeReview, getKnowledgeReview, listKnowledgePendingReviews, reportKnowledgeError, returnKnowledgeReview } from './knowledgeReviewApi';

import type { KnowledgePendingReview, KnowledgeProcedureDocument, KnowledgeProcedureSummary } from '@raspi-system/shared-types';

type View = 'home' | 'reviews' | 'review' | 'return' | 'procedures' | 'read' | 'report';
const forbidden = (error: unknown) => axios.isAxiosError(error) && error.response?.status === 403
  && error.response.data?.errorCode === 'KNOWLEDGE_APPROVAL_FORBIDDEN';

/** All tag-bearing requests use POST bodies. Late responses cannot cross a tag/mode/session change. */
export function useKnowledgeWorkspace(active: boolean, tagUid: string | null, identity = '') {
  const [view, setView] = useState<View>('home');
  const [reviews, setReviews] = useState<KnowledgePendingReview[] | null>(null);
  const [procedures, setProcedures] = useState<KnowledgeProcedureSummary[]>([]);
  const [procedure, setProcedure] = useState<KnowledgeProcedureDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const generation = useRef(0);
  const pendingGeneration = useRef(0);
  const previousIdentity = useRef(identity);

  useEffect(() => {
    generation.current += 1;
    const request = ++pendingGeneration.current;
    setReviews(null); setBusy(false); setNotice(null);
    if (!active || previousIdentity.current !== identity) {
      setView('home'); setProcedures([]); setProcedure(null); setQuery('');
    } else {
      setView(current => ['reviews', 'review', 'return'].includes(current) ? 'home' : current);
    }
    previousIdentity.current = identity;
    const controller = new AbortController();
    if (active && tagUid) void listKnowledgePendingReviews({ reviewerTagUid: tagUid }, controller.signal).then(result => {
      if (pendingGeneration.current === request) setReviews(result.reviews);
    }).catch(error => {
      if (!controller.signal.aborted && pendingGeneration.current === request && !forbidden(error)) setNotice('承認待ちを取得できません。');
    });
    return () => { controller.abort(); generation.current += 1; pendingGeneration.current += 1; };
  }, [active, tagUid, identity]);

  async function run<T>(operation: () => Promise<T>, success: (result: T) => void, conflictView?: 'reviews' | 'procedures', clearNotice = true) {
    const request = ++generation.current;
    setBusy(true); if (clearNotice) setNotice(null);
    try {
      const result = await operation();
      if (generation.current === request) success(result);
    } catch (error) {
      if (generation.current !== request) return;
      if (forbidden(error)) {
        setReviews(null);
        if (['reviews', 'review', 'return'].includes(view)) { setProcedure(null); setView('home'); }
      } else if (conflictView && axios.isAxiosError(error) && (error.response?.status === 409 || error.response?.status === 404)) {
        setProcedure(null); setView(conflictView); setNotice('状態が変わりました。一覧を更新します。');
        if (conflictView === 'reviews') void refreshReviews(false); else void refreshProcedures(false);
      } else {
        setNotice('操作できませんでした。もう一度お試しください。');
      }
    } finally { if (generation.current === request) setBusy(false); }
  }

  function refreshReviews(clearNotice = true) {
    if (!tagUid) return;
    pendingGeneration.current += 1;
    return run(() => listKnowledgePendingReviews({ reviewerTagUid: tagUid }), result => setReviews(result.reviews), undefined, clearNotice);
  }
  function refreshProcedures(clearNotice = true) {
    return run(listKnowledgeProcedures, setProcedures, undefined, clearNotice);
  }
  function navigate(next: View) {
    generation.current += 1; setBusy(false); setNotice(null); setView(next);
  }
  function showReviews() { navigate('reviews'); void refreshReviews(); }
  function showProcedures() { navigate('procedures'); void refreshProcedures(); }
  function openReview(revisionId: string) {
    if (!tagUid) return;
    void run(() => getKnowledgeReview(revisionId, { reviewerTagUid: tagUid }), result => { setProcedure(result); setView('review'); }, 'reviews');
  }
  function openProcedure(procedureId: string) {
    void run(() => getKnowledgeProcedure(procedureId), result => { setProcedure(result); setView('read'); }, 'procedures');
  }
  function approve() {
    if (!tagUid || !procedure || busy) return;
    void run(() => approveKnowledgeReview(procedure.revisionId, { reviewerTagUid: tagUid }), () => {
      setProcedure(null); setView('reviews'); void refreshReviews();
    }, 'reviews');
  }
  function returnReview(comment: string) {
    const text = comment.trim();
    if (!tagUid || !procedure || busy || !text || text.length > 500) return;
    void run(() => returnKnowledgeReview(procedure.revisionId, { reviewerTagUid: tagUid, comment: text }), () => {
      setProcedure(null); setView('reviews'); void refreshReviews();
    }, 'reviews');
  }
  function reportError(comment: string) {
    const text = comment.trim();
    if (!tagUid || !procedure || busy || !text || text.length > 500) return;
    const procedureId = procedure.procedureId;
    void run(() => reportKnowledgeError(procedureId, { reporterTagUid: tagUid, comment: text }), () => {
      setProcedures(items => items.filter(item => item.procedureId !== procedureId));
      setProcedure(null); setView('procedures');
      // Reporting withdraws a publication and may change this reviewer's pending count.
      void refreshReviews();
    }, 'procedures');
  }

  const q = query.trim().toLocaleLowerCase();
  return {
    view, reviews, procedure, busy, notice, query, setQuery, navigate, showReviews, showProcedures, openReview, openProcedure, approve, returnReview, reportError,
    procedures: procedures.filter(item => [item.title, item.identifiers.partNumber, item.identifiers.drawingNumber].some(value => value?.toLocaleLowerCase().includes(q))),
    isOpen: active && view !== 'home', expanded: active && ['review', 'return', 'read', 'report'].includes(view),
  };
}

export type KnowledgeWorkspaceState = ReturnType<typeof useKnowledgeWorkspace>;
