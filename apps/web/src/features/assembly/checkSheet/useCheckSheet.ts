import { useCallback, useEffect, useRef, useState } from 'react';

import { getAssemblyCheckSheet, skipAssemblyCheckSheetCondition, stampAssemblyCheckSheet, transitionAssemblyCheckSheet } from '../../../api/domains/assembly/check-sheets';
import { useNfcStream } from '../../../hooks/useNfcStream';

import { emptyDraft, nextOpenItem, stampInput } from './checkSheetState';

import type { CheckDraft } from './checkSheetState';
import type { AssemblyCheckSheetPayload } from '@raspi-system/shared-types';

function message(error: unknown) {
  const response = (error as { response?: { data?: { message?: string } } })?.response?.data;
  return response?.message ?? '操作できませんでした';
}
export function useCheckSheet(sheetId: string) {
  const [sheet, setSheet] = useState<AssemblyCheckSheetPayload | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [previousId, setPreviousId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CheckDraft>(emptyDraft);
  const [conditions, setConditions] = useState<Record<string, 'applies' | 'na'>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastEvent = useRef('');
  const nfc = useNfcStream(!!sheet && sheet.status === 'IN_PROGRESS' && !busy);
  useEffect(() => {
    let active = true;
    void getAssemblyCheckSheet(sheetId).then((value) => {
      if (!active) return;
      setSheet(value); setCurrentId(nextOpenItem(value, null));
    }).catch((error: unknown) => { if (active) setLoadError(message(error)); });
    return () => { active = false; clearTimeout(advanceTimer.current); };
  }, [sheetId]);
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
    if (!sheet || !item || inFlight.current || sheet.status !== 'IN_PROGRESS') return;
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
  }, [conditions, draft, item, sheet]);
  useEffect(() => {
    if (!nfc) return;
    const key = `${nfc.uid}:${nfc.timestamp}`;
    if (lastEvent.current === key) return;
    lastEvent.current = key;
    void scan(nfc.uid);
  }, [nfc, scan]);
  const transition = async (action: 'pause' | 'resume' | 'complete') => {
    if (!sheet || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const next = await transitionAssemblyCheckSheet(sheet.id, action);
      setSheet(next);
      if (action === 'resume') {
        setCurrentId(next.stamps.find((stamp) => stamp.result === 'NG' && !stamp.flagged)?.itemId ?? nextOpenItem(next, null));
        setDraft(emptyDraft());
      }
    }
    catch (error) { setToast(message(error)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return { sheet, item, currentId, previousId, draft, setDraft, conditions, setConditions, busy, toast, loadError, select, transition };
}
