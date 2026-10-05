import { api } from '../http';

/** Master records whose NFC tags are managed on the kiosk tag desk. */
export type TagDeskKind = 'employee' | 'item' | 'instrument' | 'rigging';
/** Inventory shelf / quantity / restock tags: released here, attached in inventory setup. */
export type TagBindingKind = TagDeskKind | 'inventory';

export type TagDeskTag = { bindingId: string; uid: string };

export type TagDeskRow = {
  kind: TagDeskKind;
  id: string;
  code: string;
  name: string;
  sub: string | null;
  sub2?: string | null;
  status: string;
  tags: TagDeskTag[];
  record: Record<string, string | number>;
};

export type TagUse = { at: string; action: 'BORROW' | 'RETURN'; label: string };

export type TagBinding = {
  kind: TagBindingKind;
  bindingId: string;
  targetId: string | null;
  code: string;
  name: string;
  sub: string | null;
  sub2?: string | null;
  status: string | null;
  activeLoans: number;
  recent: TagUse[];
};

export type TagBindingEvent = {
  id: string;
  uid: string;
  action: 'LINK' | 'UNLINK';
  targetKind: string;
  targetLabel: string;
  createdAt: string;
};

export type TagDeskOptions = {
  divisions: string[];
  sections: Array<{ division: string; name: string }>;
  departments: string[];
  genres: Array<{ id: string; name: string }>;
};

const MASTER_PATHS: Record<TagDeskKind, string> = {
  employee: 'employees',
  item: 'items',
  instrument: 'measuring-instruments',
  rigging: 'rigging-gears'
};

const pinHeaders = (pin: string) => ({ 'x-kiosk-access-password': pin });

export async function verifyTagDeskPin(password: string) {
  const { data } = await api.post<{ success: boolean }>('/kiosk/tag-desk/verify-access-password', { password });
  return data;
}

export async function getTagDeskRegistry(pin: string, kind: TagDeskKind) {
  const { data } = await api.get<{ rows: TagDeskRow[] }>('/kiosk/tag-desk/registry', { params: { kind }, headers: pinHeaders(pin) });
  return data.rows;
}

export async function getTagDeskOptions(pin: string) {
  const { data } = await api.get<TagDeskOptions>('/kiosk/tag-desk/options', { headers: pinHeaders(pin) });
  return data;
}

export async function resolveTagDeskUid(pin: string, uid: string) {
  const { data } = await api.get<{ uid: string; bindings: TagBinding[] }>(`/kiosk/tag-desk/tags/${encodeURIComponent(uid)}`, {
    headers: pinHeaders(pin)
  });
  return data.bindings;
}

export async function getTagDeskEvents(pin: string, limit = 6) {
  const { data } = await api.get<{ events: TagBindingEvent[] }>('/kiosk/tag-desk/events', { params: { limit }, headers: pinHeaders(pin) });
  return data.events;
}

export async function linkTagDeskTag(pin: string, payload: { kind: TagDeskKind; targetId: string; uid: string; replace?: boolean }) {
  const { data } = await api.post<{ uid: string; bindings: TagBinding[] }>('/kiosk/tag-desk/bindings', payload, { headers: pinHeaders(pin) });
  return data.bindings;
}

export async function unlinkTagDeskTag(pin: string, payload: { kind: TagBindingKind; bindingId: string }) {
  await api.delete('/kiosk/tag-desk/bindings', { data: payload, headers: pinHeaders(pin) });
}

export async function saveTagDeskRecord(pin: string, kind: TagDeskKind, id: string | null, payload: Record<string, unknown>) {
  const path = `/kiosk/tag-desk/${MASTER_PATHS[kind]}`;
  const { data } = id
    ? await api.put<Record<string, { id: string }>>(`${path}/${encodeURIComponent(id)}`, payload, { headers: pinHeaders(pin) })
    : await api.post<Record<string, { id: string }>>(path, payload, { headers: pinHeaders(pin) });
  return Object.values(data)[0];
}

export async function deleteTagDeskRecord(pin: string, kind: TagDeskKind, id: string) {
  await api.delete(`/kiosk/tag-desk/${MASTER_PATHS[kind]}/${encodeURIComponent(id)}`, { headers: pinHeaders(pin) });
}
