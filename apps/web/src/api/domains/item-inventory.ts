import { api } from '../http';

export type InventoryTagKind = 'ITEM' | 'QUANTITY' | 'RESTOCK';
export type InventoryPhoto = { id: string; photoUrl: string; originalFilename: string; sha256?: string };
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
  photos: Array<{ id: string; photoIndex: number; filename: string; photoUrl: string; sha256: string }>;
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

export async function getInventoryImports() {
  const { data } = await api.get<{ imports: InventoryImport[] }>('/item-inventory/imports');
  return data.imports;
}

export async function getInventoryHistory(limit = 100) {
  const { data } = await api.get<{ history: InventoryHistoryEntry[] }>('/item-inventory/history', { params: { limit } });
  return data.history;
}

export async function getInventoryImportMessages() {
  const { data } = await api.get<{ messages: Array<{ id: string; gmailMessageId: string; outcome: string; errorMessage: string | null; updatedAt: string }> }>('/item-inventory/import-messages');
  return data.messages;
}

export async function ingestInventoryMail(messageId?: string) {
  const { data } = await api.post<{ result: unknown }>('/item-inventory/ingest', messageId ? { messageId } : {});
  return data.result;
}

export async function retryInventoryImportMessage(id: string) {
  const { data } = await api.post(`/item-inventory/import-messages/${id}/retry`);
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
}) {
  const { data } = await api.post<{ result: unknown }>(`/item-inventory/imports/${id}/register`, input);
  return data.result;
}

export async function bindInventoryCompartment(input: {
  itemId: string;
  shelfId: string;
  drawerId: string;
  itemTagUid: string;
  initialQuantity: number;
}) {
  const { data } = await api.post<{ result: unknown }>('/item-inventory/compartments', input);
  return data.result;
}

export async function createInventoryShelf(input: { area: string; shelfNumber: number }) {
  const { data } = await api.post('/item-inventory/locations/shelves', input);
  return data;
}

export async function createInventoryDrawer(input: { shelfId: string; drawerNumber: number }) {
  const { data } = await api.post('/item-inventory/locations/drawers', input);
  return data;
}

export async function registerInventoryQuantityTag(input: { uid: string; quantity: number }) {
  const { data } = await api.post('/item-inventory/tags/quantity', input);
  return data;
}

export async function registerInventoryRestockTag(uid: string) {
  const { data } = await api.post('/item-inventory/tags/restock', { uid });
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

export async function cancelInventoryTransaction(id: string) {
  const { data } = await api.post(`/item-inventory/transactions/${id}/cancel`);
  return data;
}

export async function correctInventoryStock(input: { compartmentId: string; desiredQuantity: number; note?: string }) {
  const { data } = await api.post('/item-inventory/corrections', input);
  return data;
}

export async function moveInventoryCompartment(id: string, drawerId: string) {
  const { data } = await api.put(`/item-inventory/compartments/${id}/location`, { drawerId });
  return data;
}

export async function replaceInventoryItemTag(id: string, uid: string) {
  const { data } = await api.put(`/item-inventory/compartments/${id}/tag`, { uid });
  return data;
}

export function inventoryThumbnailUrl(photoUrl: string): string {
  if (!photoUrl.startsWith('/api/storage/photos/')) return photoUrl;
  return photoUrl.replace('/api/storage/photos/', '/storage/thumbnails/').replace(/\.jpg$/i, '_thumb.jpg');
}
