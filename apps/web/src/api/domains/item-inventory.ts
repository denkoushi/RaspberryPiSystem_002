import { api } from '../http';

function inventorySettingsHeaders(accessPassword?: string) {
  return accessPassword ? { 'x-kiosk-access-password': accessPassword } : undefined;
}

export type InventoryTagKind = 'ITEM' | 'QUANTITY' | 'RESTOCK';
export type InventoryPhoto = { id: string; photoIndex: number; photoUrl: string; originalFilename: string; sha256?: string };
export type InventoryImportPhoto = { id: string; photoIndex: number; filename: string; photoUrl: string; sha256: string };
type InventoryItemFields = {
  id: string;
  itemCode: string;
  name: string;
  model: string | null;
  usage: string | null;
  category: string | null;
  area: string | null;
  note: string | null;
  photos: InventoryPhoto[];
};
export type InventoryItemSummary = InventoryItemFields;
export type InventoryItem = InventoryItemFields & {
  compartments: InventoryCompartment[];
};
export type InventoryCompartment = {
  id: string;
  stockQuantity: number;
  area: string;
  shelfNumber: number;
  drawerNumber: number;
  itemTagUid: string | null;
  item: InventoryItemSummary;
};
export type InventoryTag = {
  id: string;
  uid: string;
  kind: InventoryTagKind;
  quantity: number | null;
  compartment: InventoryCompartment | null;
};
export type InventoryShelf = {
  id: string;
  area: string;
  shelfNumber: number;
  drawers: Array<{
    id: string;
    drawerNumber: number;
    shelf: { area: string; shelfNumber: number };
    compartments: InventoryCompartment[];
  }>;
};
export type InventoryImport = {
  id: string;
  sourceItemId: number;
  area: string;
  category: string | null;
  note: string | null;
  manifest: unknown;
  status: string;
  photos: InventoryImportPhoto[];
  messages: Array<{ gmailMessageId: string; outcome: string; errorMessage: string | null }>;
};
export type InventoryHistoryEntry = {
  id: string;
  action: string;
  inventoryItemId: string;
  compartmentId: string | null;
  clientId: string | null;
  delta: number;
  beforeQuantity: number;
  afterQuantity: number;
  createdAt: string;
  inventoryItem: { itemCode: string; name: string };
  compartment: { drawer: { shelf: { area: string; shelfNumber: number }; drawerNumber: number } } | null;
};

export async function resolveInventoryTag(uid: string) {
  const { data } = await api.get<{ tag: InventoryTag | null }>('/item-inventory/tags/resolve', { params: { uid } });
  return data.tag;
}

export async function getInventoryItems() {
  const { data } = await api.get<{ items: InventoryItem[] }>('/item-inventory/items');
  return data.items;
}

export async function getInventoryLocations() {
  const { data } = await api.get<{ locations: InventoryShelf[] }>('/item-inventory/locations');
  return data.locations;
}

export async function getInventoryTags() {
  const { data } = await api.get<{ tags: InventoryTag[] }>('/item-inventory/tags');
  return data.tags;
}

export async function getInventoryImports(accessPassword?: string) {
  const { data } = await api.get<{ imports: InventoryImport[] }>('/item-inventory/imports', {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data.imports;
}

export async function deleteInventoryImportPhoto(payloadId: string, photoId: string, accessPassword?: string) {
  const { data } = await api.delete<{ result: unknown }>(`/item-inventory/imports/${payloadId}/photos/${photoId}`, {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data.result;
}

export async function reorderInventoryImportPhotos(payloadId: string, photoIds: string[], accessPassword?: string) {
  const { data } = await api.put<{ result: unknown }>(`/item-inventory/imports/${payloadId}/photos/order`, { photoIds }, {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data.result;
}

export async function deleteInventoryItemPhoto(itemId: string, photoId: string, accessPassword?: string) {
  const { data } = await api.delete<{ result: unknown }>(`/item-inventory/items/${itemId}/photos/${photoId}`, {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data.result;
}

export async function reorderInventoryItemPhotos(itemId: string, photoIds: string[], accessPassword?: string) {
  const { data } = await api.put<{ result: unknown }>(`/item-inventory/items/${itemId}/photos/order`, { photoIds }, {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data.result;
}

export async function getInventoryHistory(limit = 100) {
  const { data } = await api.get<{ history: InventoryHistoryEntry[] }>('/item-inventory/history', { params: { limit } });
  return data.history;
}

export async function getInventoryImportMessages(accessPassword?: string) {
  const { data } = await api.get<{ messages: Array<{ id: string; gmailMessageId: string; outcome: string; errorMessage: string | null; updatedAt: string }> }>('/item-inventory/import-messages', {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data.messages;
}

export async function ingestInventoryMail(messageId?: string) {
  const { data } = await api.post<{ result: unknown }>('/item-inventory/ingest', messageId ? { messageId } : {});
  return data.result;
}

export async function retryInventoryImportMessage(id: string, accessPassword?: string) {
  const { data } = await api.post(`/item-inventory/import-messages/${id}/retry`, undefined, {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data;
}

export async function registerInventoryImport(id: string, input: {
  mode: 'NEW_ITEM' | 'EXISTING_ITEM';
  itemId?: string;
  name?: string;
  model?: string;
  usage?: string;
  shelfId?: string;
  drawerId?: string;
  itemTagUid?: string;
  initialQuantity?: number;
  reviewNote?: string;
}, accessPassword?: string) {
  const { data } = await api.post<{ result: unknown }>(`/item-inventory/imports/${id}/register`, input, {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data.result;
}

export async function bindInventoryCompartment(input: {
  itemId: string;
  shelfId: string;
  drawerId: string;
  itemTagUid: string;
  initialQuantity: number;
}, accessPassword?: string) {
  const { data } = await api.post<{ result: unknown }>('/item-inventory/compartments', input, {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data.result;
}

export async function createInventoryShelf(input: { area: string; shelfNumber: number }, accessPassword?: string) {
  const { data } = await api.post('/item-inventory/locations/shelves', input, {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data;
}

export async function createInventoryDrawer(input: { shelfId: string; drawerNumber: number }, accessPassword?: string) {
  const { data } = await api.post('/item-inventory/locations/drawers', input, {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data;
}

export async function registerInventoryQuantityTag(input: { uid: string; quantity: number }, accessPassword?: string) {
  const { data } = await api.post('/item-inventory/tags/quantity', input, {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data;
}

export async function registerInventoryRestockTag(uid: string, accessPassword?: string) {
  const { data } = await api.post('/item-inventory/tags/restock', { uid }, {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data;
}

export async function processInventoryTransaction(input: {
  itemTagUid: string;
  quantityTagUid: string;
  restockTagUid?: string;
  restock: boolean;
  idempotencyKey: string;
}) {
  const { data } = await api.post<{ transaction: InventoryHistoryEntry; replayed?: boolean }>('/item-inventory/transactions', input);
  return data;
}

export async function cancelInventoryTransaction(id: string, accessPassword?: string) {
  const { data } = await api.post<{ transaction: InventoryHistoryEntry }>(`/item-inventory/transactions/${id}/cancel`, undefined, {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data;
}

export async function correctInventoryStock(input: { compartmentId: string; desiredQuantity: number; note?: string }, accessPassword?: string) {
  const { data } = await api.post('/item-inventory/corrections', input, {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data;
}

export async function moveInventoryCompartment(id: string, drawerId: string, accessPassword?: string) {
  const { data } = await api.put(`/item-inventory/compartments/${id}/location`, { drawerId }, {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data;
}

export async function replaceInventoryItemTag(id: string, uid: string, accessPassword?: string) {
  const { data } = await api.put(`/item-inventory/compartments/${id}/tag`, { uid }, {
    headers: inventorySettingsHeaders(accessPassword)
  });
  return data;
}

export function inventoryThumbnailUrl(photoUrl: string): string {
  if (!photoUrl.startsWith('/api/storage/photos/')) return photoUrl;
  return photoUrl.replace('/api/storage/photos/', '/storage/thumbnails/').replace(/\.jpg$/i, '_thumb.jpg');
}
