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
export function useInventoryImports() { return useQuery({ queryKey: inventoryKeys.imports, queryFn: getInventoryImports }); }
export function useInventoryImportMessages() { return useQuery({ queryKey: ['inventory-import-messages'], queryFn: getInventoryImportMessages }); }
export function useInventoryHistory() { return useQuery({ queryKey: inventoryKeys.history, queryFn: () => getInventoryHistory() }); }
export function useResolvedInventoryTag(uid: string, enabled = true) {
  return useQuery({ queryKey: ['inventory-tag', uid], queryFn: () => resolveInventoryTag(uid), enabled: enabled && Boolean(uid), staleTime: 30000 });
}

function invalidateInventory(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of Object.values(inventoryKeys)) void queryClient.invalidateQueries({ queryKey: key });
}

export function useInventoryMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => invalidateInventory(queryClient);
  return {
    ingest: useMutation({ mutationFn: ingestInventoryMail, onSuccess: invalidate }),
    retryImport: useMutation({ mutationFn: retryInventoryImportMessage, onSuccess: invalidate }),
    deleteImportPhoto: useMutation({
      mutationFn: ({ payloadId, photoId }: { payloadId: string; photoId: string }) => deleteInventoryImportPhoto(payloadId, photoId),
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
      mutationFn: ({ payloadId, photoIds }: { payloadId: string; photoIds: string[] }) => reorderInventoryImportPhotos(payloadId, photoIds),
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
      mutationFn: ({ itemId, photoId }: { itemId: string; photoId: string }) => deleteInventoryItemPhoto(itemId, photoId),
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
      mutationFn: ({ itemId, photoIds }: { itemId: string; photoIds: string[] }) => reorderInventoryItemPhotos(itemId, photoIds),
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
    registerImport: useMutation({ mutationFn: ({ id, input }: { id: string; input: Parameters<typeof registerInventoryImport>[1] }) => registerInventoryImport(id, input), onSuccess: invalidate }),
    bindCompartment: useMutation({ mutationFn: bindInventoryCompartment, onSuccess: invalidate }),
    createShelf: useMutation({ mutationFn: createInventoryShelf, onSuccess: invalidate }),
    createDrawer: useMutation({ mutationFn: createInventoryDrawer, onSuccess: invalidate }),
    quantityTag: useMutation({ mutationFn: registerInventoryQuantityTag, onSuccess: invalidate }),
    restockTag: useMutation({ mutationFn: registerInventoryRestockTag, onSuccess: invalidate }),
    transaction: useMutation({ mutationFn: processInventoryTransaction, onSuccess: invalidate }),
    cancel: useMutation({ mutationFn: cancelInventoryTransaction, onSuccess: invalidate }),
    correction: useMutation({ mutationFn: correctInventoryStock, onSuccess: invalidate }),
    move: useMutation({ mutationFn: ({ id, drawerId }: { id: string; drawerId: string }) => moveInventoryCompartment(id, drawerId), onSuccess: invalidate }),
    replaceTag: useMutation({ mutationFn: ({ id, uid }: { id: string; uid: string }) => replaceInventoryItemTag(id, uid), onSuccess: invalidate }),
  };
}
