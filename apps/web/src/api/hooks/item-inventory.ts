import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cancelInventoryTransaction,
  bindInventoryCompartment,
  correctInventoryStock,
  createInventoryDrawer,
  createInventoryShelf,
  deleteInventoryImportPhoto,
  deleteInventoryItemPhoto,
  getInventoryHistory,
  getInventoryImports,
  getInventoryImportMessages,
  getInventoryItems,
  getInventoryLocations,
  getInventoryTags,
  ingestInventoryMail,
  moveInventoryCompartment,
  processInventoryTransaction,
  registerInventoryImport,
  registerInventoryQuantityTag,
  registerInventoryRestockTag,
  reorderInventoryImportPhotos,
  reorderInventoryItemPhotos,
  retryInventoryImportMessage,
  replaceInventoryItemTag,
  resolveInventoryTag,
  type InventoryImport,
  type InventoryItem,
} from '../client';

const inventoryKeys = {
  items: ['inventory-items'],
  locations: ['inventory-locations'],
  tags: ['inventory-tags'],
  imports: ['inventory-imports'],
  history: ['inventory-history'],
  importMessages: ['inventory-import-messages'],
};

export function useInventoryItems() { return useQuery({ queryKey: inventoryKeys.items, queryFn: getInventoryItems }); }
export function useInventoryLocations() { return useQuery({ queryKey: inventoryKeys.locations, queryFn: getInventoryLocations }); }
export function useInventoryTags() { return useQuery({ queryKey: inventoryKeys.tags, queryFn: getInventoryTags }); }
export function useInventoryImports(accessPassword?: string) {
  return useQuery({
    queryKey: inventoryKeys.imports,
    queryFn: () => getInventoryImports(accessPassword)
  });
}
export function useInventoryImportMessages(accessPassword?: string) {
  return useQuery({
    queryKey: inventoryKeys.importMessages,
    queryFn: () => getInventoryImportMessages(accessPassword)
  });
}
export function useInventoryHistory() { return useQuery({ queryKey: inventoryKeys.history, queryFn: () => getInventoryHistory() }); }
export function useResolvedInventoryTag(uid: string, enabled = true) {
  return useQuery({ queryKey: ['inventory-tag', uid], queryFn: () => resolveInventoryTag(uid), enabled: enabled && Boolean(uid), staleTime: 30000 });
}

function invalidateInventory(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of Object.values(inventoryKeys)) void queryClient.invalidateQueries({ queryKey: key });
}

export function useInventoryMutations(accessPassword?: string) {
  const queryClient = useQueryClient();
  const invalidate = () => invalidateInventory(queryClient);
  return {
    ingest: useMutation({ mutationFn: ingestInventoryMail, onSuccess: invalidate }),
    retryImport: useMutation({ mutationFn: (id: string) => retryInventoryImportMessage(id, accessPassword), onSuccess: invalidate }),
    deleteImportPhoto: useMutation({
      mutationFn: ({ payloadId, photoId }: { payloadId: string; photoId: string }) => deleteInventoryImportPhoto(payloadId, photoId, accessPassword),
      onMutate: async ({ payloadId, photoId }) => {
        await queryClient.cancelQueries({ queryKey: inventoryKeys.imports });
        const previous = queryClient.getQueryData<InventoryImport[]>(inventoryKeys.imports);
        queryClient.setQueryData<InventoryImport[]>(inventoryKeys.imports, (current) => current?.map((entry) => (
          entry.id === payloadId ? { ...entry, photos: entry.photos.filter((photo) => photo.id !== photoId).map((photo, index) => ({ ...photo, photoIndex: index + 1 })) } : entry
        )));
        return { previous };
      },
      onError: (_error, _variables, context) => {
        if (context?.previous) queryClient.setQueryData(inventoryKeys.imports, context.previous);
      },
      onSettled: () => { void queryClient.invalidateQueries({ queryKey: inventoryKeys.imports }); },
    }),
    reorderImportPhotos: useMutation({
      mutationFn: ({ payloadId, photoIds }: { payloadId: string; photoIds: string[] }) => reorderInventoryImportPhotos(payloadId, photoIds, accessPassword),
      onMutate: async ({ payloadId, photoIds }) => {
        await queryClient.cancelQueries({ queryKey: inventoryKeys.imports });
        const previous = queryClient.getQueryData<InventoryImport[]>(inventoryKeys.imports);
        queryClient.setQueryData<InventoryImport[]>(inventoryKeys.imports, (current) => current?.map((entry) => {
          if (entry.id !== payloadId) return entry;
          const photosById = new Map(entry.photos.map((photo) => [photo.id, photo]));
          if (photoIds.length !== entry.photos.length || new Set(photoIds).size !== entry.photos.length || photoIds.some((id) => !photosById.has(id))) return entry;
          return { ...entry, photos: photoIds.map((id, index) => ({ ...photosById.get(id)!, photoIndex: index + 1 })) };
        }));
        return { previous };
      },
      onError: (_error, _variables, context) => {
        if (context?.previous) queryClient.setQueryData(inventoryKeys.imports, context.previous);
      },
      onSettled: () => { void queryClient.invalidateQueries({ queryKey: inventoryKeys.imports }); },
    }),
    deleteItemPhoto: useMutation({
      mutationFn: ({ itemId, photoId }: { itemId: string; photoId: string }) => deleteInventoryItemPhoto(itemId, photoId, accessPassword),
      onMutate: async ({ itemId, photoId }) => {
        await queryClient.cancelQueries({ queryKey: inventoryKeys.items });
        const previous = queryClient.getQueryData<InventoryItem[]>(inventoryKeys.items);
        queryClient.setQueryData<InventoryItem[]>(inventoryKeys.items, (current) => current?.map((item) => (
          item.id === itemId ? { ...item, photos: item.photos.filter((photo) => photo.id !== photoId).map((photo, index) => ({ ...photo, photoIndex: index + 1 })) } : item
        )));
        return { previous };
      },
      onError: (_error, _variables, context) => {
        if (context?.previous) queryClient.setQueryData(inventoryKeys.items, context.previous);
      },
      onSettled: () => { void queryClient.invalidateQueries({ queryKey: inventoryKeys.items }); },
    }),
    reorderItemPhotos: useMutation({
      mutationFn: ({ itemId, photoIds }: { itemId: string; photoIds: string[] }) => reorderInventoryItemPhotos(itemId, photoIds, accessPassword),
      onMutate: async ({ itemId, photoIds }) => {
        await queryClient.cancelQueries({ queryKey: inventoryKeys.items });
        const previous = queryClient.getQueryData<InventoryItem[]>(inventoryKeys.items);
        queryClient.setQueryData<InventoryItem[]>(inventoryKeys.items, (current) => current?.map((item) => {
          if (item.id !== itemId) return item;
          const photosById = new Map(item.photos.map((photo) => [photo.id, photo]));
          if (photoIds.length !== item.photos.length || new Set(photoIds).size !== item.photos.length || photoIds.some((id) => !photosById.has(id))) return item;
          return { ...item, photos: photoIds.map((id, index) => ({ ...photosById.get(id)!, photoIndex: index + 1 })) };
        }));
        return { previous };
      },
      onError: (_error, _variables, context) => {
        if (context?.previous) queryClient.setQueryData(inventoryKeys.items, context.previous);
      },
      onSettled: () => { void queryClient.invalidateQueries({ queryKey: inventoryKeys.items }); },
    }),
    registerImport: useMutation({ mutationFn: ({ id, input }: { id: string; input: Parameters<typeof registerInventoryImport>[1] }) => registerInventoryImport(id, input, accessPassword), onSuccess: invalidate }),
    bindCompartment: useMutation({ mutationFn: (input: Parameters<typeof bindInventoryCompartment>[0]) => bindInventoryCompartment(input, accessPassword), onSuccess: invalidate }),
    createShelf: useMutation({ mutationFn: (input: Parameters<typeof createInventoryShelf>[0]) => createInventoryShelf(input, accessPassword), onSuccess: invalidate }),
    createDrawer: useMutation({ mutationFn: (input: Parameters<typeof createInventoryDrawer>[0]) => createInventoryDrawer(input, accessPassword), onSuccess: invalidate }),
    quantityTag: useMutation({ mutationFn: (input: Parameters<typeof registerInventoryQuantityTag>[0]) => registerInventoryQuantityTag(input, accessPassword), onSuccess: invalidate }),
    restockTag: useMutation({ mutationFn: (uid: string) => registerInventoryRestockTag(uid, accessPassword), onSuccess: invalidate }),
    transaction: useMutation({ mutationFn: processInventoryTransaction, onSuccess: invalidate }),
    cancel: useMutation({ mutationFn: (id: string) => cancelInventoryTransaction(id, accessPassword), onSuccess: invalidate }),
    correction: useMutation({ mutationFn: (input: Parameters<typeof correctInventoryStock>[0]) => correctInventoryStock(input, accessPassword), onSuccess: invalidate }),
    move: useMutation({ mutationFn: ({ id, drawerId }: { id: string; drawerId: string }) => moveInventoryCompartment(id, drawerId, accessPassword), onSuccess: invalidate }),
    replaceTag: useMutation({ mutationFn: ({ id, uid }: { id: string; uid: string }) => replaceInventoryItemTag(id, uid, accessPassword), onSuccess: invalidate }),
  };
}
