import { useEffect, useState } from 'react';

import { resolveInventoryTag, type InventoryItem, type InventoryTag } from '../api/client';
import { resolveNfcRuntimeContract } from '../features/nfc/nfcRuntimeContract';

import type { NfcStreamPolicy } from '../features/nfc/nfcPolicy';
import type { QueryClient } from '@tanstack/react-query';

export interface NfcEvent {
  uid: string;
  timestamp: string;
  receivedAt?: number;
  readerSerial?: string;
  type?: string;
  eventId?: number;
  eventKey?: string;
  inventoryTag?: InventoryTag;
  inventoryTagNeedsRefresh?: boolean;
  inventoryTagFromCache?: boolean;
}

type NfcSubscriberRole = 'legacy' | 'inventory';
type NfcSubscriber = { role: NfcSubscriberRole; suppressInventoryRouting: boolean; inventoryQueryClient?: QueryClient; setEvent: (event: NfcEvent | null) => void };

const isBrowser = typeof window !== 'undefined';
const LAST_EVENT_ID_KEY = 'kiosk-last-event-id';

const readStoredEventId = () => {
  if (!isBrowser) return null;
  const raw = window.sessionStorage.getItem(LAST_EVENT_ID_KEY);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const persistEventId = (eventId: number) => {
  if (!isBrowser) return;
  window.sessionStorage.setItem(LAST_EVENT_ID_KEY, String(eventId));
};

type NfcHub = {
  subscribers: Set<NfcSubscriber>;
  socket: WebSocket | null;
  reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  candidateIndex: number;
  activeSince: string | null;
  lastEventKey: string | null;
  lastProcessedEventId: number | null;
  generation: number;
  classificationQueue: Promise<void>;
};

const hub: NfcHub = {
  subscribers: new Set(),
  socket: null,
  reconnectTimer: undefined,
  candidateIndex: 0,
  activeSince: null,
  lastEventKey: null,
  lastProcessedEventId: null,
  generation: 0,
  classificationQueue: Promise.resolve(),
};

function closeHubSocket() {
  hub.generation += 1;
  if (hub.reconnectTimer !== undefined) clearTimeout(hub.reconnectTimer);
  hub.reconnectTimer = undefined;
  hub.socket?.close();
  hub.socket = null;
  hub.activeSince = null;
  hub.lastEventKey = null;
  hub.classificationQueue = Promise.resolve();
}

function notifySubscribers(event: NfcEvent, role: NfcSubscriberRole) {
  for (const subscriber of hub.subscribers) {
    if (subscriber.role === role) subscriber.setEvent(event);
  }
}

const tagIndexes = new WeakMap<InventoryTag[], Map<string, InventoryTag>>();

function cachedInventoryEvent(event: NfcEvent): NfcEvent | null {
  const client = [...hub.subscribers].find((subscriber) => subscriber.role === 'inventory' && subscriber.inventoryQueryClient)?.inventoryQueryClient;
  if (!client || client.getQueryState(['inventory-tags'])?.status !== 'success') return null;
  const tags = client.getQueryData<InventoryTag[]>(['inventory-tags']);
  if (!tags) return null;
  let index = tagIndexes.get(tags);
  if (!index) {
    index = new Map(tags.map((tag) => [tag.uid, tag]));
    tagIndexes.set(tags, index);
  }
  const tag = index.get(event.uid);
  if (!tag) return null;
  if (tag.kind !== 'ITEM') return { ...event, inventoryTag: tag };
  if (!tag.compartment) return { ...event, inventoryTag: tag, inventoryTagFromCache: true };
  const items = client.getQueryData<InventoryItem[]>(['inventory-items']);
  const item = items?.find((entry) => entry.compartments.some((compartment) => compartment.id === tag.compartment?.id));
  const compartment = item?.compartments.find((entry) => entry.id === tag.compartment?.id);
  const complete = compartment && item && Array.isArray(item.photos) && Number.isFinite(compartment.stockQuantity);
  return {
    ...event,
    inventoryTag: { ...tag, compartment: complete ? { ...compartment, item } : { ...tag.compartment, stockQuantity: NaN, item: { ...tag.compartment.item, photos: [] } } },
    inventoryTagNeedsRefresh: !complete,
    inventoryTagFromCache: true,
  };
}

function enqueueEvent(event: NfcEvent, generation: number) {
  // Keep a scan private even if its armed reader unmounts before the queue reaches it.
  const suppressInventoryRouting = [...hub.subscribers].some((subscriber) => subscriber.suppressInventoryRouting);
  hub.classificationQueue = hub.classificationQueue
    .then(async () => {
      if (generation !== hub.generation || hub.subscribers.size === 0) return;
      const hasInventorySubscriber = [...hub.subscribers].some((subscriber) => subscriber.role === 'inventory');
      if (suppressInventoryRouting || !hasInventorySubscriber) {
        notifySubscribers(event, 'legacy');
        return;
      }
      try {
        const cached = cachedInventoryEvent(event);
        if (cached) {
          notifySubscribers(cached, 'inventory');
          return;
        }
        const inventoryTag = await resolveInventoryTag(event.uid);
        if (generation !== hub.generation || hub.subscribers.size === 0) return;
        notifySubscribers(inventoryTag ? { ...event, inventoryTag } : event, inventoryTag ? 'inventory' : 'legacy');
      } catch {
        // Inventory lookup failure must not block the existing NFC flows.
        if (generation === hub.generation) notifySubscribers(event, 'legacy');
      }
    })
    // Let subscriber effects consume each scan before delivering the next one.
    .finally(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
    .catch(() => {
      // A malformed or failed classification is isolated to this event.
    });
}

function startHubSocket(policy?: NfcStreamPolicy) {
  if (hub.socket || hub.subscribers.size === 0) return;
  const runtime = resolveNfcRuntimeContract(policy);
  if (runtime.policy === 'disabled' || runtime.streamUrls.length === 0) return;
  hub.activeSince = new Date().toISOString();
  hub.candidateIndex = 0;
  const generation = hub.generation;
  if (hub.lastProcessedEventId === null) hub.lastProcessedEventId = readStoredEventId();

  const connect = () => {
    if (generation !== hub.generation || hub.subscribers.size === 0 || runtime.streamUrls.length === 0) return;
    try {
      const url = runtime.streamUrls[Math.min(hub.candidateIndex, runtime.streamUrls.length - 1)];
      let opened = false;
      const socket = new WebSocket(url);
      hub.socket = socket;
      socket.onopen = () => { opened = true; };
      socket.onmessage = (message) => {
        const receivedAt = performance.now();
        if (generation !== hub.generation) return;
        try {
          const payload = JSON.parse(message.data) as Partial<NfcEvent>;
          if (typeof payload.uid !== 'string' || typeof payload.timestamp !== 'string') return;
          if (hub.activeSince && payload.timestamp < hub.activeSince) return;
          const eventId = typeof payload.eventId === 'number' ? payload.eventId : null;
          if (eventId !== null) {
            const lastProcessed = hub.lastProcessedEventId ?? readStoredEventId();
            if (lastProcessed !== null && eventId <= lastProcessed) return;
            hub.lastProcessedEventId = eventId;
            persistEventId(eventId);
          }
          const eventKey = `${payload.uid}:${payload.timestamp}`;
          if (eventId === null && hub.lastEventKey === eventKey) return;
          hub.lastEventKey = eventKey;
          enqueueEvent({ ...payload, receivedAt } as NfcEvent, generation);
        } catch {
          // Ignore malformed payloads.
        }
      };
      socket.onclose = () => {
        if (generation !== hub.generation || hub.socket !== socket || hub.subscribers.size === 0) return;
        hub.socket = null;
        if (!opened && hub.candidateIndex < runtime.streamUrls.length - 1) {
          hub.candidateIndex += 1;
          hub.reconnectTimer = setTimeout(connect, 100);
          return;
        }
        hub.reconnectTimer = setTimeout(connect, 2000);
      };
      socket.onerror = () => {
        // onclose handles reconnects; connection failures are expected when the agent is off.
      };
    } catch {
      if (generation !== hub.generation || hub.subscribers.size === 0) return;
      const hasFallback = hub.candidateIndex < runtime.streamUrls.length - 1;
      if (hasFallback) hub.candidateIndex += 1;
      hub.reconnectTimer = setTimeout(connect, hasFallback ? 100 : 2000);
    }
  };
  connect();
}

export function useNfcStream(
  enabled = false,
  policy?: NfcStreamPolicy,
  options: { role?: NfcSubscriberRole; suppressInventoryRouting?: boolean; inventoryQueryClient?: QueryClient } = {},
) {
  const [event, setEvent] = useState<NfcEvent | null>(null);
  const inventoryQueryClient = options.inventoryQueryClient;
  const role = options.role ?? 'legacy';
  const suppressInventoryRouting = options.suppressInventoryRouting ?? false;

  useEffect(() => {
    if (!enabled) {
      setEvent(null);
      return;
    }
    const subscriber: NfcSubscriber = { role, suppressInventoryRouting, inventoryQueryClient, setEvent };
    hub.subscribers.add(subscriber);
    startHubSocket(policy);
    return () => {
      hub.subscribers.delete(subscriber);
      setEvent(null);
      if (hub.subscribers.size === 0) closeHubSocket();
    };
  }, [enabled, policy, role, suppressInventoryRouting, inventoryQueryClient]);

  return event;
}
