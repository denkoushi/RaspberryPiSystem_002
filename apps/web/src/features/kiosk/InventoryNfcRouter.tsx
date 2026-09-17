import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useNfcStream, type NfcEvent } from '../../hooks/useNfcStream';

/** Classify inventory tags globally while non-inventory tags fall through. */
export function InventoryNfcRouter() {
  const location = useLocation();
  const event = useNfcStream(location.pathname !== '/kiosk/inventory/settings', undefined, { role: 'inventory' });
  const navigate = useNavigate();
  const lastRoutedEventKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!event?.uid) return;
    const eventKey = event.eventId != null ? String(event.eventId) : `${event.uid}:${event.timestamp}`;
    if (lastRoutedEventKeyRef.current === eventKey) return;
    lastRoutedEventKeyRef.current = eventKey;
    navigate('/kiosk/inventory', {
      replace: true,
      state: { inventoryNfcEvent: event as NfcEvent },
    });
  }, [event, navigate]);

  return null;
}
