import { useEffect } from 'react';

import { resolveInventoryTag } from '../../../api/client';
import { inventoryKeys } from '../../../api/queryKeys/itemInventory';

import { isClientError, messageFromError, playInventoryTone } from './inventoryPageModel';

import type { InventoryMovementTransaction, InventoryTag } from '../../../api/client';
import type { useInventoryMutations } from '../../../api/hooks';
import type { NfcEvent } from '../../../hooks/useNfcStream';
import type { QueryClient } from '@tanstack/react-query';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

type Options = {
  drainEventsRef: MutableRefObject<() => Promise<void>>;
  drainingRef: MutableRefObject<boolean>;
  flowRef: MutableRefObject<{
    restockMode: boolean;
    restockTagUid: string | null;
    selectedTag: InventoryTag | null;
    processing: boolean;
  }>;
  eventQueueRef: MutableRefObject<NfcEvent[]>;
  queryClient: QueryClient;
  setMessage: Dispatch<SetStateAction<string>>;
  setMessageKind: Dispatch<SetStateAction<'info' | 'success' | 'error'>>;
  mountedRef: MutableRefObject<boolean>;
  setPanel: Dispatch<SetStateAction<'none' | 'correct' | 'quantity'>>;
  selectTag: (tag: InventoryTag | null) => void;
  setRestockMode: Dispatch<SetStateAction<boolean>>;
  setQuantityError: Dispatch<SetStateAction<string | null>>;
  setLastTransaction: Dispatch<SetStateAction<InventoryMovementTransaction | null>>;
  selectionVerificationRef: MutableRefObject<Promise<boolean> | null>;
  verificationGenerationRef: MutableRefObject<number>;
  setRefreshingTag: Dispatch<SetStateAction<boolean>>;
  setCorrectionError: Dispatch<SetStateAction<string | null>>;
  runOperation: (operation: () => Promise<boolean>, onError: (error: unknown) => Promise<void> | void) => Promise<void>;
  mutations: ReturnType<typeof useInventoryMutations>;
  completeMovement: (transaction: InventoryMovementTransaction, restock: boolean) => Promise<void>;
  handleTouchError: (error: unknown) => Promise<void>;
};

export function useInventoryNfcQueue({
  drainEventsRef, drainingRef, flowRef, eventQueueRef, queryClient,
  setMessage, setMessageKind, mountedRef, setPanel, selectTag,
  setRestockMode, setQuantityError, setLastTransaction, selectionVerificationRef,
  verificationGenerationRef, setRefreshingTag, setCorrectionError,
  runOperation, mutations, completeMovement, handleTouchError,
}: Options) {
  useEffect(() => {
    drainEventsRef.current = async () => {
      if (drainingRef.current || flowRef.current.processing) return;
      drainingRef.current = true;
      try {
        while (eventQueueRef.current.length > 0 && !flowRef.current.processing) {
          const event = eventQueueRef.current[0];
          if (!event) continue;
          let tag: InventoryTag | null;
          try {
            tag = event.inventoryTag ?? await resolveInventoryTag(event.uid);
          } catch (error) {
            if (eventQueueRef.current[0] !== event) continue;
            eventQueueRef.current.shift();
            if (isClientError(error)) void queryClient.invalidateQueries({ queryKey: inventoryKeys.tagsAll });
            setMessage(messageFromError(error));
            setMessageKind('error');
            playInventoryTone('error');
            continue;
          }
          if (!mountedRef.current) return;
          if (eventQueueRef.current[0] !== event) continue;
          // A touch operation may have acquired the lock during an uncached lookup.
          if (flowRef.current.processing) {
            eventQueueRef.current[0] = { ...event, inventoryTag: tag ?? undefined };
            break;
          }
          eventQueueRef.current.shift();
          if (!tag) continue;
          const flow = flowRef.current;
          setPanel('none');
          if (tag.kind === 'RESTOCK') {
            selectTag(null);
            flow.restockMode = true;
            flow.restockTagUid = tag.uid;
            setRestockMode(true);
            setMessage('補充モードです。アイテムNFCタグを読み取ってください');
            setMessageKind('info');
            continue;
          }
          if (tag.kind === 'ITEM') {
            if (!tag.compartment) {
              selectTag(null);
              if (event.inventoryTagFromCache) void queryClient.invalidateQueries({ queryKey: inventoryKeys.tagsAll });
              setMessage('アイテムNFCタグに区画が割り当てられていません');
              setMessageKind('error');
              playInventoryTone('error');
              continue;
            }
            selectTag(tag);
            setQuantityError(null);
            setLastTransaction((current) => current?.compartmentId === tag.compartment?.id ? current : null);
            setMessage(flow.restockMode ? '数量NFCタグを読み取って補充してください' : '数量NFCタグを読み取ってください');
            setMessageKind('info');
            if ((event.inventoryTagFromCache || event.inventoryTagNeedsRefresh) && !selectionVerificationRef.current) {
              const cachedTag = tag;
              const generation = verificationGenerationRef.current;
              setRefreshingTag(Boolean(event.inventoryTagNeedsRefresh));
              const verification = resolveInventoryTag(event.uid).then((latest) => {
                if (!mountedRef.current || generation !== verificationGenerationRef.current) return false;
                const unchanged = latest?.kind === 'ITEM' && Boolean(latest.compartment) && latest.compartment?.id === cachedTag.compartment?.id;
                selectTag(latest?.kind === 'ITEM' && latest.compartment ? latest : null);
                setLastTransaction((current) => current?.compartmentId === latest?.compartment?.id ? current : null);
                if (!unchanged) {
                  void queryClient.invalidateQueries({ queryKey: inventoryKeys.tagsAll });
                  setPanel('none');
                  setQuantityError(null);
                  setCorrectionError(null);
                  if (!latest || latest.kind !== 'ITEM' || !latest.compartment) {
                    setMessage('タグの登録が変わりました');
                    setMessageKind('error');
                    playInventoryTone('error');
                  }
                }
                return unchanged;
              }).catch(() => {
                if (!mountedRef.current || generation !== verificationGenerationRef.current) return false;
                if (!Number.isFinite(cachedTag.compartment!.stockQuantity)) {
                  selectTag(null);
                  setMessage('通信できませんでした');
                  setMessageKind('error');
                  playInventoryTone('error');
                  return false;
                }
                return true;
              }).finally(() => {
                if (selectionVerificationRef.current === verification) selectionVerificationRef.current = null;
                if (mountedRef.current && generation === verificationGenerationRef.current) setRefreshingTag(false);
              });
              selectionVerificationRef.current = verification;
            }
            continue;
          }
          let touchRoute = false;
          await runOperation(async () => {
            const generation = verificationGenerationRef.current;
            const selected = flow.selectedTag;
            const compartment = selected?.compartment;
            if (!compartment || !Number.isFinite(compartment.stockQuantity)) {
              setMessage('先にアイテムNFCタグを読み取ってください');
              setMessageKind('error');
              playInventoryTone('error');
              return false;
            }
            const restock = flow.restockMode;
            touchRoute = !selected.uid || (restock && !flow.restockTagUid);
            const idempotencyKey = `nfc-${event.eventId ?? `${event.uid}-${event.timestamp}`}`;
            let result;
            if (touchRoute) {
              const latestQuantity = await resolveInventoryTag(tag.uid);
              if (!mountedRef.current || generation !== verificationGenerationRef.current) return false;
              if (latestQuantity?.kind !== 'QUANTITY' || !latestQuantity.quantity || latestQuantity.quantity <= 0) {
                void queryClient.invalidateQueries({ queryKey: inventoryKeys.tagsAll });
                setMessage('タグの登録が変わりました');
                setMessageKind('error');
                return false;
              }
              result = await mutations.touchTransaction.mutateAsync({
                compartmentId: compartment.id, quantity: latestQuantity.quantity, restock,
                expectedBeforeQuantity: compartment.stockQuantity, idempotencyKey,
              });
            } else {
              result = await mutations.transaction.mutateAsync({
                itemTagUid: selected.uid, expectedCompartmentId: compartment.id, quantityTagUid: tag.uid,
                restockTagUid: flow.restockTagUid ?? undefined, restock, idempotencyKey,
              });
            }
            await completeMovement(result.transaction, restock);
            return true;
          }, async (error) => {
            if (touchRoute) await handleTouchError(error);
            else {
              const response = (error as { response?: { status?: number; data?: { code?: string; errorCode?: string } } })?.response;
              if (response?.status === 409 && (response.data?.errorCode ?? response.data?.code) === 'INVENTORY_CONFLICT') {
                selectTag(null);
                void queryClient.invalidateQueries({ queryKey: inventoryKeys.tagsAll });
                void queryClient.invalidateQueries({ queryKey: inventoryKeys.itemsAll });
                setMessage('タグの登録が変わりました');
              } else setMessage(messageFromError(error));
              setMessageKind('error');
              playInventoryTone('error');
            }
          });
        }
      } finally {
        drainingRef.current = false;
      }
    };
  });
}
