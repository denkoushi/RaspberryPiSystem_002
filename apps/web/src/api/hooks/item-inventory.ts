import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cancelInventoryTransaction,
  bindInventoryCompartment,
  correctInventoryStock,
  createInventoryDrawer,
  createInventoryShelf,
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
  retryInventoryImportMessage,
  replaceInventoryItemTag,
  resolveInventoryTag,
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
