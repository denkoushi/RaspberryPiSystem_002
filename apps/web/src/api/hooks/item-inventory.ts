import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { captureSetupPinSession, sendSetupRequest } from '../../features/kiosk/inventory/setup/setupPinSession';
import {
  getInventoryDashboard, getInventoryValueVariants, mergeInventoryValueVariants, dismissInventoryValueVariants,
  addInventoryToolFieldValue,
  cancelInventoryTransaction,
  bindInventoryCompartment,
  correctInventoryStock,
  createInventoryDrawer,
  createInventoryUnit,
  createInventoryShelf,
  deleteInventoryItem,
  deleteInventoryDrawer,
  deleteInventoryShelf,
  deleteInventoryTag,
  dismissInventoryImport,
  restoreInventoryImport,
  deleteInventoryImportPhoto,
  deleteInventoryItemPhoto,
  deleteInventoryToolFieldValue,
  getInventoryHistory,
  getInventoryImports,
  getInventoryImportSummaries,
  getInventoryImportMessages,
  getInventoryItems,
  getInventoryLocations,
  getInventoryTags,
  getInventoryToolFieldOptions,
  getInventoryToolFieldValues,
  getInventoryUnits,
  ingestInventoryMail,
  moveInventoryCompartment,
  processInventoryTransaction,
  processInventoryTouchTransaction,
  renameInventoryArea,
  renameInventoryToolFieldValue,
  registerInventoryImport,
  registerInventoryQuantityTag,
  registerInventoryRestockTag,
  rotateInventoryImportPhoto,
  rotateInventoryItemPhoto,
  reorderInventoryImportPhotos,
  reorderInventoryItemPhotos,
  retryInventoryImportMessage,
  replaceInventoryItemTag,
  resolveInventoryTag,
  resolveInventoryLabelNumber,
  suggestInventoryToolFields,
  setInventoryItemUnit,
  updateInventoryItemDetails,
  type InventoryMovementTransaction,
  type InventoryImport,
  type InventoryItem,
  type InventoryOptionField,
} from '../client';
import { inventoryKeys, itemInventoryQueryKeys } from '../queryKeys/itemInventory';

export function useInventoryItems(enabled = true) { return useQuery({ queryKey: inventoryKeys.itemsAll, queryFn: getInventoryItems, enabled }); }
export function useInventoryLocations() { return useQuery({ queryKey: inventoryKeys.locationsAll, queryFn: getInventoryLocations }); }
export function useInventoryToolFieldOptions(enabled = true) { return useQuery({ queryKey: inventoryKeys.toolFieldOptionsAll, queryFn: getInventoryToolFieldOptions, enabled }); }
export function useInventoryToolFieldValues(accessPassword: string, enabled = true, setup = false) {
  const session = useMemo(() => setup ? captureSetupPinSession(accessPassword) : null, [accessPassword, setup]);
  return useQuery({ queryKey: session ? itemInventoryQueryKeys.toolFieldValuesSetup(session.generation) : inventoryKeys.toolFieldValuesAll, queryFn: () => session ? sendSetupRequest(session, () => getInventoryToolFieldValues(accessPassword)) : getInventoryToolFieldValues(accessPassword), enabled });
}
export function useInventoryUnits() { return useQuery({ queryKey: inventoryKeys.unitsAll, queryFn: getInventoryUnits }); }
export function useInventoryTags(refetchInterval?: number, enabled = true) { return useQuery({ queryKey: inventoryKeys.tagsAll, queryFn: getInventoryTags, refetchInterval, enabled }); }
export function useInventoryImportSummaries() {
  // Mail is ingested every five minutes; a kiosk left on the list picks new candidates up.
  return useQuery({ queryKey: inventoryKeys.importSummariesAll, queryFn: getInventoryImportSummaries, refetchInterval: 60_000 });
}
export function useInventoryImports(accessPassword?: string, setup = false) {
  const session = useMemo(() => setup ? captureSetupPinSession(accessPassword ?? '') : null, [accessPassword, setup]);
  return useQuery({
    queryKey: session ? itemInventoryQueryKeys.importsSetup(session.generation) : inventoryKeys.importsAll,
    queryFn: () => session ? sendSetupRequest(session, () => getInventoryImports(accessPassword)) : getInventoryImports(accessPassword)
  });
}
export function useInventoryImportMessages(accessPassword?: string, setup = false) {
  const session = useMemo(() => setup ? captureSetupPinSession(accessPassword ?? '') : null, [accessPassword, setup]);
  return useQuery({
    queryKey: session ? itemInventoryQueryKeys.importMessagesSetup(session.generation) : inventoryKeys.importMessagesAll,
    queryFn: () => session ? sendSetupRequest(session, () => getInventoryImportMessages(accessPassword)) : getInventoryImportMessages(accessPassword)
  });
}
export function useInventoryHistory() { return useQuery({ queryKey: inventoryKeys.historyAll, queryFn: () => getInventoryHistory() }); }
export function useInventoryCompartmentHistory(compartmentId: string | null, limit = 3) {
  return useQuery({
    queryKey: itemInventoryQueryKeys.compartmentHistory(compartmentId, limit),
    queryFn: () => getInventoryHistory(limit, compartmentId ?? undefined),
    enabled: Boolean(compartmentId),
  });
}
export function useResolvedInventoryTag(uid: string, enabled = true) {
  return useQuery({ queryKey: itemInventoryQueryKeys.tag(uid), queryFn: () => resolveInventoryTag(uid), enabled: enabled && Boolean(uid), staleTime: 30000 });
}

export function useResolvedInventoryLabelNumber(labelNumber: string, enabled = true) {
  return useQuery({ queryKey: itemInventoryQueryKeys.label(labelNumber), queryFn: () => resolveInventoryLabelNumber(labelNumber), enabled: enabled && Boolean(labelNumber), retry: false });
}

function invalidateInventory(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of Object.values(inventoryKeys)) void queryClient.invalidateQueries({ queryKey: key });
}

export function useInventoryMutations(accessPassword?: string, setup = false) {
  const session = useMemo(() => setup ? captureSetupPinSession(accessPassword ?? '') : null, [accessPassword, setup]);
  const send = <T,>(request: () => Promise<T>) => session ? sendSetupRequest(session, request) : request();
  const queryClient = useQueryClient();
  const importsKey = session ? itemInventoryQueryKeys.importsSetup(session.generation) : inventoryKeys.importsAll;
  const invalidate = () => invalidateInventory(queryClient);
  const invalidateStock = () => {
    for (const key of [inventoryKeys.historyAll, inventoryKeys.locationsAll, inventoryKeys.tagsAll]) void queryClient.invalidateQueries({ queryKey: key });
  };
  const updateStock = ({ transaction }: { transaction: InventoryMovementTransaction }) => {
    queryClient.setQueryData<InventoryItem[]>(inventoryKeys.itemsAll, (items) => items?.map((item) => ({
      ...item,
      compartments: item.compartments.map((compartment) => compartment.id === transaction.compartmentId ? {
        ...compartment,
        stockQuantity: transaction.afterQuantity,
        ...(transaction.action === 'ISSUE' ? { lastIssuedAt: transaction.createdAt } : {}),
      } : compartment),
    })));
    invalidateStock();
  };
  return {
    mergeValueVariants: useMutation({ mutationFn: (input: Parameters<typeof mergeInventoryValueVariants>[0]) => send(() => mergeInventoryValueVariants(input, accessPassword ?? '')), onSuccess: invalidate }),
    dismissValueVariants: useMutation({ mutationFn: (input: Parameters<typeof dismissInventoryValueVariants>[0]) => send(() => dismissInventoryValueVariants(input, accessPassword ?? '')), onSuccess: invalidate }),
    ingest: useMutation({ mutationFn: ingestInventoryMail, onSuccess: invalidate }),
    retryImport: useMutation({ mutationFn: (id: string) => send(() => retryInventoryImportMessage(id, accessPassword)), onSuccess: invalidate }),
    deleteImportPhoto: useMutation({
      mutationFn: ({ payloadId, photoId }: { payloadId: string; photoId: string }) => send(() => deleteInventoryImportPhoto(payloadId, photoId, accessPassword)),
      onMutate: async ({ payloadId, photoId }) => {
        await queryClient.cancelQueries({ queryKey: importsKey });
        const previous = queryClient.getQueryData<InventoryImport[]>(importsKey);
        queryClient.setQueryData<InventoryImport[]>(importsKey, (current) => current?.map((entry) => (
          entry.id === payloadId ? { ...entry, photos: entry.photos.filter((photo) => photo.id !== photoId).map((photo, index) => ({ ...photo, photoIndex: index + 1 })) } : entry
        )));
        return { previous };
      },
      onError: (_error, _variables, context) => {
        if (context?.previous) queryClient.setQueryData(importsKey, context.previous);
      },
      onSettled: () => { void queryClient.invalidateQueries({ queryKey: importsKey }); },
    }),
    rotateImportPhoto: useMutation({
      mutationFn: ({ payloadId, photoId }: { payloadId: string; photoId: string }) => send(() => rotateInventoryImportPhoto(payloadId, photoId, accessPassword)),
      onSettled: () => { void queryClient.invalidateQueries({ queryKey: importsKey }); },
    }),
    reorderImportPhotos: useMutation({
      mutationFn: ({ payloadId, photoIds }: { payloadId: string; photoIds: string[] }) => send(() => reorderInventoryImportPhotos(payloadId, photoIds, accessPassword)),
      onMutate: async ({ payloadId, photoIds }) => {
        await queryClient.cancelQueries({ queryKey: importsKey });
        const previous = queryClient.getQueryData<InventoryImport[]>(importsKey);
        queryClient.setQueryData<InventoryImport[]>(importsKey, (current) => current?.map((entry) => {
          if (entry.id !== payloadId) return entry;
          const photosById = new Map(entry.photos.map((photo) => [photo.id, photo]));
          if (photoIds.length !== entry.photos.length || new Set(photoIds).size !== entry.photos.length || photoIds.some((id) => !photosById.has(id))) return entry;
          return { ...entry, photos: photoIds.map((id, index) => ({ ...photosById.get(id)!, photoIndex: index + 1 })) };
        }));
        return { previous };
      },
      onError: (_error, _variables, context) => {
        if (context?.previous) queryClient.setQueryData(importsKey, context.previous);
      },
      onSettled: () => { void queryClient.invalidateQueries({ queryKey: importsKey }); },
    }),
    deleteItemPhoto: useMutation({
      mutationFn: ({ itemId, photoId }: { itemId: string; photoId: string }) => send(() => deleteInventoryItemPhoto(itemId, photoId, accessPassword)),
      onMutate: async ({ itemId, photoId }) => {
        await queryClient.cancelQueries({ queryKey: inventoryKeys.itemsAll });
        const previous = queryClient.getQueryData<InventoryItem[]>(inventoryKeys.itemsAll);
        queryClient.setQueryData<InventoryItem[]>(inventoryKeys.itemsAll, (current) => current?.map((item) => (
          item.id === itemId ? { ...item, photos: item.photos.filter((photo) => photo.id !== photoId).map((photo, index) => ({ ...photo, photoIndex: index + 1 })) } : item
        )));
        return { previous };
      },
      onError: (_error, _variables, context) => {
        if (context?.previous) queryClient.setQueryData(inventoryKeys.itemsAll, context.previous);
      },
      onSettled: () => { void queryClient.invalidateQueries({ queryKey: inventoryKeys.itemsAll }); },
    }),
    deleteItem: useMutation({ mutationFn: (itemId: string) => send(() => deleteInventoryItem(itemId, accessPassword)), onSuccess: invalidate }),
    rotateItemPhoto: useMutation({
      mutationFn: ({ itemId, photoId }: { itemId: string; photoId: string }) => send(() => rotateInventoryItemPhoto(itemId, photoId, accessPassword)),
      onSettled: () => { void queryClient.invalidateQueries({ queryKey: inventoryKeys.items }); },
    }),
    reorderItemPhotos: useMutation({
      mutationFn: ({ itemId, photoIds }: { itemId: string; photoIds: string[] }) => send(() => reorderInventoryItemPhotos(itemId, photoIds, accessPassword)),
      onMutate: async ({ itemId, photoIds }) => {
        await queryClient.cancelQueries({ queryKey: inventoryKeys.itemsAll });
        const previous = queryClient.getQueryData<InventoryItem[]>(inventoryKeys.itemsAll);
        queryClient.setQueryData<InventoryItem[]>(inventoryKeys.itemsAll, (current) => current?.map((item) => {
          if (item.id !== itemId) return item;
          const photosById = new Map(item.photos.map((photo) => [photo.id, photo]));
          if (photoIds.length !== item.photos.length || new Set(photoIds).size !== item.photos.length || photoIds.some((id) => !photosById.has(id))) return item;
          return { ...item, photos: photoIds.map((id, index) => ({ ...photosById.get(id)!, photoIndex: index + 1 })) };
        }));
        return { previous };
      },
      onError: (_error, _variables, context) => {
        if (context?.previous) queryClient.setQueryData(inventoryKeys.itemsAll, context.previous);
      },
      onSettled: () => { void queryClient.invalidateQueries({ queryKey: inventoryKeys.itemsAll }); },
    }),
    suggestToolFields: useMutation({ mutationFn: (input: Parameters<typeof suggestInventoryToolFields>[0]) => send(() => suggestInventoryToolFields(input, accessPassword)) }),
    registerImport: useMutation({ mutationFn: ({ id, input }: { id: string; input: Parameters<typeof registerInventoryImport>[1] }) => send(() => registerInventoryImport(id, input, accessPassword)), onSuccess: invalidate }),
    dismissImport: useMutation({ mutationFn: (id: string) => send(() => dismissInventoryImport(id, accessPassword)), onSuccess: invalidate }),
    restoreImport: useMutation({ mutationFn: (id: string) => send(() => restoreInventoryImport(id, accessPassword)), onSuccess: async () => { invalidate(); await queryClient.invalidateQueries({ queryKey: importsKey }); } }),
    deleteDrawer: useMutation({ mutationFn: (id: string) => send(() => deleteInventoryDrawer(id, accessPassword)), onSuccess: invalidate }),
    deleteShelf: useMutation({ mutationFn: (id: string) => send(() => deleteInventoryShelf(id, accessPassword)), onSuccess: invalidate }),
    deleteTag: useMutation({ mutationFn: (id: string) => send(() => deleteInventoryTag(id, accessPassword)), onSuccess: invalidate }),
    bindCompartment: useMutation({ mutationFn: (input: Parameters<typeof bindInventoryCompartment>[0]) => send(() => bindInventoryCompartment(input, accessPassword)), onSuccess: invalidate }),
    createShelf: useMutation({ mutationFn: (input: Parameters<typeof createInventoryShelf>[0]) => send(() => createInventoryShelf(input, accessPassword)), onSuccess: invalidate }),
    renameArea: useMutation({ mutationFn: ({ from, to }: { from: string; to: string }) => send(() => renameInventoryArea(from, to, accessPassword)), onSuccess: invalidate }),
    createDrawer: useMutation({ mutationFn: (input: Parameters<typeof createInventoryDrawer>[0]) => send(() => createInventoryDrawer(input, accessPassword)), onSuccess: invalidate }),
    quantityTag: useMutation({ mutationFn: (input: Parameters<typeof registerInventoryQuantityTag>[0]) => send(() => registerInventoryQuantityTag(input, accessPassword)), onSuccess: invalidate }),
    restockTag: useMutation({ mutationFn: (uid: string) => send(() => registerInventoryRestockTag(uid, accessPassword)), onSuccess: invalidate }),
    transaction: useMutation({ mutationFn: processInventoryTransaction, onSuccess: updateStock }),
    touchTransaction: useMutation({ mutationFn: processInventoryTouchTransaction, onSuccess: updateStock }),
    cancel: useMutation({ mutationFn: (id: string) => send(() => cancelInventoryTransaction(id, accessPassword)), onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.itemsAll });
      invalidateStock();
    } }),
    correction: useMutation({ mutationFn: (input: Parameters<typeof correctInventoryStock>[0]) => send(() => correctInventoryStock(input, accessPassword)), onSuccess: updateStock }),
    move: useMutation({ mutationFn: ({ id, drawerId }: { id: string; drawerId: string }) => send(() => moveInventoryCompartment(id, drawerId, accessPassword)), onSuccess: invalidate }),
    addToolFieldValue: useMutation({
      mutationFn: ({ field, value }: { field: InventoryOptionField; value: string }) => send(() => addInventoryToolFieldValue(field, value, accessPassword)),
      onSuccess: invalidate,
    }),
    renameToolFieldValue: useMutation({
      mutationFn: ({ field, from, to }: { field: InventoryOptionField; from: string; to: string }) => send(() => renameInventoryToolFieldValue(field, from, to, accessPassword)),
      onSuccess: invalidate,
    }),
    deleteToolFieldValue: useMutation({
      mutationFn: ({ field, value }: { field: InventoryOptionField; value: string }) => send(() => deleteInventoryToolFieldValue(field, value, accessPassword)),
      onSuccess: invalidate,
    }),
    createUnit: useMutation({ mutationFn: (name: string) => send(() => createInventoryUnit(name, accessPassword)), onSuccess: invalidate }),
    setItemUnit: useMutation({ mutationFn: ({ itemId, unit }: { itemId: string; unit: string | null }) => send(() => setInventoryItemUnit(itemId, unit, accessPassword)), onSuccess: invalidate }),
    updateItemDetails: useMutation({
      mutationFn: ({ itemId, details }: { itemId: string; details: Partial<Record<InventoryOptionField, string>> & { unitPrice?: number | null } }) => send(() => updateInventoryItemDetails(itemId, details, accessPassword)),
      onSuccess: invalidate,
    }),
    replaceTag: useMutation({ mutationFn: ({ id, uid }: { id: string; uid: string }) => send(() => replaceInventoryItemTag(id, uid, accessPassword)), onSuccess: invalidate }),
  };
}

export function useInventoryDashboard(weeks: number, machine: string | undefined, accessPassword?: string) {
  return useQuery({ queryKey: itemInventoryQueryKeys.dashboard(weeks, machine), placeholderData: previous => previous,
    queryFn: () => getInventoryDashboard(weeks, machine, accessPassword) });
}
export function useInventoryValueVariants(accessPassword?: string) {
  return useQuery({ queryKey: inventoryKeys.variantsAll,
    queryFn: () => getInventoryValueVariants(accessPassword) });
}
