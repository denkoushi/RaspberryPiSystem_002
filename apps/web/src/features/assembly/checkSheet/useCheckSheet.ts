import { useCallback, useEffect, useRef, useState } from 'react';

import { changeAssemblyCheckSheetRevision, listAssemblyCheckSheetRevisions, getAssemblyCheckSheet, skipAssemblyCheckSheetCondition, stampAssemblyCheckSheet, transitionAssemblyCheckSheet } from '../../../api/domains/assembly/check-sheets';
import { useNfcStream } from '../../../hooks/useNfcStream';

import { emptyDraft, nextOpenItem, stampInput } from './checkSheetState';

import type { CheckDraft } from './checkSheetState';
import type { AssemblyCheckSheetPayload, AssemblyCheckSheetRevisionPayload } from '@raspi-system/shared-types';

function message(error: unknown) {
  const response = (error as { response?: { data?: { message?: string } } })?.response?.data;
  return response?.message ?? '操作できませんでした';
}
export function useCheckSheet(sheetId: string, suspended = false) {
  const [sheet, setSheet] = useState<AssemblyCheckSheetPayload | null>(null);
  const [revisions, setRevisions] = useState<AssemblyCheckSheetRevisionPayload[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [previousId, setPreviousId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CheckDraft>(emptyDraft);
  const [conditions, setConditions] = useState<Record<string, 'applies' | 'na'>>({});
  const [pendingAction, setPendingAction] = useState<'pause' | 'resume' | 'complete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastEvent = useRef('');
  const nfc = useNfcStream(!!sheet && (sheet.status === 'IN_PROGRESS' || pendingAction === 'resume') && !busy);
  useEffect(() => {
    let active = true;
    void getAssemblyCheckSheet(sheetId).then((value) => {
      if (!active) return;
      setSheet(value); setCurrentId(nextOpenItem(value, null));
    }).catch((error: unknown) => { if (active) setLoadError(message(error)); });
    return () => { active = false; clearTimeout(advanceTimer.current); };
  }, [sheetId]);
  const canChangeRevision = sheet?.status === 'IN_PROGRESS' && sheet.stamps.length === 0;
  useEffect(() => {
    if (!canChangeRevision) return;
    let active = true;
    void listAssemblyCheckSheetRevisions().then((values) => {
      if (active) setRevisions(values);
    }).catch((error: unknown) => { if (active) setToast(message(error)); });
    return () => { active = false; };
  }, [sheetId, canChangeRevision]);
  const changeRevision = async (revisionRootId: string) => {
    if (!sheet || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const next = await changeAssemblyCheckSheetRevision(sheet.id, revisionRootId);
      setSheet(next); setCurrentId(nextOpenItem(next, null)); setPreviousId(null);
      setDraft(emptyDraft()); setConditions({});
    } catch (error) { setToast(message(error)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);
  const select = useCallback((id: string) => {
    if (inFlight.current) return;
    setCurrentId(id); setDraft(emptyDraft());
  }, []);
  const item = sheet?.revision.items.find((entry) => entry.id === currentId);
  const scan = useCallback(async (uid: string) => {
    if (!sheet || inFlight.current || sheet.status === 'COMPLETED') return;
    if (pendingAction) {
      inFlight.current = true; setBusy(true);
      try {
        const next = await transitionAssemblyCheckSheet(sheet.id, pendingAction, uid);
        setSheet(next); setPendingAction(null);
        if (pendingAction === 'resume') {
          setCurrentId(next.stamps.find((stamp) => stamp.result === 'NG' && !stamp.flagged)?.itemId ?? nextOpenItem(next, null));
          setDraft(emptyDraft());
        }
      } catch (error) { setToast(message(error)); }
      finally { inFlight.current = false; setBusy(false); }
      return;
    }
    if (!item || sheet.status !== 'IN_PROGRESS') return;
    const skip = item.conditionKey && conditions[item.conditionKey] === 'na';
    const input = stampInput(item, draft, item.conditionKey ? conditions[item.conditionKey] : undefined, uid);
    if (!skip && !input) { setToast('記入と OK を先に'); return; }
    inFlight.current = true; setBusy(true);
    try {
      const next = skip
        ? await skipAssemblyCheckSheetCondition(sheet.id, item.conditionKey!, uid)
        : await stampAssemblyCheckSheet(sheet.id, input!);
      setSheet(next); setPreviousId(item.id);
      advanceTimer.current = setTimeout(() => {
        setCurrentId(nextOpenItem(next, item.id)); setDraft(emptyDraft());
        inFlight.current = false; setBusy(false);
      }, 700);
    } catch (error) {
      setToast(message(error)); inFlight.current = false; setBusy(false);
    }
  }, [conditions, draft, item, sheet, pendingAction]);
  useEffect(() => {
    if (!nfc) return;
    const key = `${nfc.uid}:${nfc.timestamp}`;
    if (lastEvent.current === key) return;
    lastEvent.current = key;
    if (!suspended) void scan(nfc.uid);
  }, [nfc, scan, suspended]);
  const transition = (action: 'pause' | 'resume' | 'complete') => {
    if (!sheet || inFlight.current) return;
    setPendingAction(action);
  };
  const cancelTransition = () => { if (!inFlight.current) setPendingAction(null); };
  return { sheet, revisions, changeRevision, item, currentId, previousId, draft, setDraft, conditions, setConditions, busy, toast, loadError, select, transition, pendingAction, cancelTransition };
}
