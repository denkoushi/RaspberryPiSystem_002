import { useEffect, useRef, useState } from 'react';

import { getApiErrorMessage } from '../../api/errors';

import { recentSubjects, searchProcedureTopics, searchSubjects, type ProcedureTopicView } from './knowledgeTriageApi';

import type { KnowledgePoster } from './useKnowledgePoster';
import type { HermesPageContext } from '../../api/domains/assembly';
import type { KnowledgeDestination, KnowledgeSubject } from '@raspi-system/shared-types';

export function useKnowledgeDestination(poster: KnowledgePoster | null, partNumber: string | null, pageContext: HermesPageContext | null) {
  const [selection, setSelection] = useState<{ owner: KnowledgePoster; destination?: KnowledgeDestination; title: string } | null>(null);
  const [view, setView] = useState<'subjects' | 'topics' | 'new'>('subjects');
  const [target, setTarget] = useState('');
  const [query, setQuery] = useState('');
  const [topicQuery, setTopicQuery] = useState('');
  const [subjects, setSubjects] = useState<KnowledgeSubject[]>([]);
  const [recent, setRecent] = useState<KnowledgeSubject[]>([]);
  const [topics, setTopics] = useState<ProcedureTopicView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const active = useRef(poster); active.current = poster;
  useEffect(() => {
    setSelection(null); setView('subjects'); setTarget(''); setQuery(''); setTopicQuery(''); setSubjects([]); setRecent([]); setTopics([]); setError(null);
    if (!poster) return;
    const controller = new AbortController();
    void recentSubjects(poster.tagUid, controller.signal).then(rows => { if (!controller.signal.aborted) setRecent(rows); })
      .catch(failure => { if (!controller.signal.aborted) setError(getApiErrorMessage(failure, '最近の対象を取得できませんでした。')); });
    return () => controller.abort();
  }, [poster]);
  useEffect(() => { if (partNumber) setQuery(partNumber); }, [partNumber]);
  useEffect(() => {
    if (!poster || view !== 'subjects') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchSubjects(query, controller.signal).then(rows => { if (!controller.signal.aborted) setSubjects(rows); })
        .catch(failure => { if (!controller.signal.aborted) setError(getApiErrorMessage(failure, '対象を取得できませんでした。')); });
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [poster, query, view]);
  useEffect(() => {
    if (!poster || view !== 'topics') return;
    const controller = new AbortController(); setLoading(true); setTopics([]);
    const timer = setTimeout(() => {
      void searchProcedureTopics(topicQuery, controller.signal, target).then(rows => {
        if (controller.signal.aborted) return;
        setTopics(rows); if (!rows.length && !topicQuery) setView('new');
      }).catch(failure => { if (!controller.signal.aborted) setError(getApiErrorMessage(failure, '案件を取得できませんでした。')); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [poster, target, topicQuery, view]);
  const chooseSubject = (value: string) => { setTarget(value.trim()); setTopicQuery(''); setError(null); setView('topics'); };
  const choose = (destination: KnowledgeDestination | undefined, title: string) => {
    if (poster && active.current === poster) setSelection({ owner: poster, destination, title });
  };
  const reset = () => { setSelection(null); setTarget(''); setView('subjects'); setError(null); };
  const contextTarget = pageContext?.entity && ['partNumber', 'drawingNumber'].includes(pageContext.entity.kind) ? pageContext.entity.value : null;
  const contextPart = target === contextTarget && pageContext?.entity.kind === 'partNumber' ? pageContext.entity.value : null;
  const contextDrawing = target === contextTarget && pageContext?.entity.kind === 'drawingNumber' ? pageContext.entity.value : null;
  const identifiers = { ...(partNumber || contextPart ? { partNumber: partNumber ?? contextPart! } : {}), ...(contextDrawing ? { drawingNumber: contextDrawing } : {}) };
  const current = selection?.owner === poster ? selection : null;
  return { ready: Boolean(current), destination: current?.destination, title: current?.title, view, target, query, setQuery,
    topicQuery, setTopicQuery, subjects, recent, topics, error, loading, contextTarget, identifiers, chooseSubject, choose, reset,
    newSubject: () => { setTarget(query.trim()); setView('new'); }, newTopic: () => setView('new') };
}

export type KnowledgeDestinationState = ReturnType<typeof useKnowledgeDestination>;
