import { useEffect, useRef, useState } from 'react';

import { useNfcStream, type NfcEvent } from '../../../../hooks/useNfcStream';

function eventKey(event: NfcEvent): string {
  return event.eventId != null ? String(event.eventId) : `${event.uid}:${event.timestamp}`;
}

/**
 * Listens to the NFC reader only while `armed`, and returns the first read that arrives after
 * arming. Setup registers new (unknown) tags, so it listens as a normal (legacy) subscriber;
 * the global inventory router is already off on the setup route.
 */
export function useArmedNfcRead(armed: boolean): NfcEvent | null {
  const event = useNfcStream(armed);
  const baselineRef = useRef<string | null>(null);
  const [read, setRead] = useState<NfcEvent | null>(null);
  const wasArmedRef = useRef(false);

  useEffect(() => {
    if (armed && !wasArmedRef.current) {
      // Ignore a read that was already on screen when the worker started waiting.
      baselineRef.current = event ? eventKey(event) : null;
      setRead(null);
    }
    if (!armed) setRead(null);
    wasArmedRef.current = armed;
  }, [armed, event]);

  useEffect(() => {
    if (!armed || !event) return;
    if (eventKey(event) === baselineRef.current) return;
    baselineRef.current = eventKey(event);
    setRead(event);
  }, [armed, event]);

  return armed ? read : null;
}
