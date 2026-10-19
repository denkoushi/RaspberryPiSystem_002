import { useCallback, useEffect, useRef, useState } from 'react';

import { getApiErrorMessage } from '../../api/errors';
import { useArmedNfcRead } from '../kiosk/inventory/setup/useArmedNfcRead';

import { fetchPendingTriage, type PendingTriageItem } from './knowledgeTriageApi';

export type KnowledgePoster = { tagUid: string; name: string };

/**
 * Every knowledge post starts with an employee NFC tag. While `active` and nobody is identified,
 * the reader is armed; a read is verified by the server, which also returns that employee's
 * undecided posts. `consume` hands the poster to one post and requires a new scan afterwards.
 */
export function useKnowledgePoster(active: boolean) {
  const [poster, setPoster] = useState<KnowledgePoster | null>(null);
  const [pending, setPending] = useState<PendingTriageItem[]>([]);
  const [partNumber, setPartNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const read = useArmedNfcRead(active && !poster && !verifying);
  const generation = useRef(0);

  const verify = useCallback(async (tagUid: string) => {
    const current = ++generation.current;
    setVerifying(true); setError(null);
    try {
      const result = await fetchPendingTriage(tagUid);
      if (current !== generation.current) return;
      setPoster({ tagUid, name: result.posterName }); setPending(result.items);
    } catch (failure) {
      if (current === generation.current) setError(getApiErrorMessage(failure, '社員タグを確認できません。もう一度かざしてください。'));
    } finally { if (current === generation.current) setVerifying(false); }
  }, []);

  useEffect(() => { if (read?.uid) void verify(read.uid); }, [read, verify]);

  const clear = useCallback(() => {
    generation.current += 1;
    setPoster(null); setPending([]); setPartNumber(null); setError(null); setVerifying(false);
  }, []);
  useEffect(() => { if (!active) clear(); }, [active, clear]);

  /** Returns the identified poster for one post and requires a new scan for the next one. */
  const consume = useCallback(() => {
    const current = poster ? { ...poster, partNumber } : null;
    setPoster(null); setPartNumber(null); setPending([]);
    return current;
  }, [poster, partNumber]);

  const removePending = useCallback((intakeId: string) => setPending(items => items.filter(item => item.intakeId !== intakeId)), []);

  return { poster, pending, partNumber, setPartNumber, error, verifying, consume, clear, removePending };
}
