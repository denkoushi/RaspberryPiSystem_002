import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useInventoryTags } from '../../api/hooks/item-inventory';
import { useNfcStream, type NfcEvent } from '../../hooks/useNfcStream';

/** Screens that read inventory tags themselves; scanning one there must not jump to the inventory screen. */
const INVENTORY_ROUTING_OFF_PATHS = new Set(['/kiosk/inventory/settings', '/kiosk/tag-desk']);

/** Classify inventory tags globally while non-inventory tags fall through. */
export function InventoryNfcRouter() {
  const location = useLocation();
  const inventoryQueryClient = useQueryClient();
  useInventoryTags(300_000);
  const event = useNfcStream(!INVENTORY_ROUTING_OFF_PATHS.has(location.pathname), undefined, { role: 'inventory', inventoryQueryClient });
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
