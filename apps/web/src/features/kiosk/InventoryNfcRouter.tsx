import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { useNfcStream, type NfcEvent } from '../../hooks/useNfcStream';

/** Classify inventory tags globally while non-inventory tags fall through. */
export function InventoryNfcRouter() {
  const event = useNfcStream(true, undefined, { role: 'inventory' });
  const navigate = useNavigate();

  useEffect(() => {
    if (!event?.uid) return;
    navigate('/kiosk/inventory', {
      replace: true,
      state: { inventoryNfcEvent: event as NfcEvent },
    });
  }, [event, navigate]);

  return null;
}
