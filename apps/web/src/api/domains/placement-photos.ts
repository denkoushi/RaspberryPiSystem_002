import { api } from '../http';

export type PlacementPhoto = {
  id: string;
  number: string | null;
  slipKind: 'manufacturing_order' | 'purchase_order' | null;
  branchNo: number | null;
  shelfCodeRaw: string | null;
  deviceName: string;
  placedAt: string;
  hasCrop: boolean;
};
export async function listPlacementPhotos(params: { q: string; shelf: string; date: string }) {
  const { data } = await api.get<{ photos: PlacementPhoto[] }>('/mobile-placement/admin/placement-photos', {
    params: { q: params.q || undefined, shelf: params.shelf || undefined, date: params.date || undefined }
  });
  return data.photos;
}
export async function getPlacementPhoto(id: string, variant: 'crop' | 'full' | 'crop-thumb' | 'full-thumb') {
  const { data } = await api.get<Blob>(`/mobile-placement/admin/scan-frames/${encodeURIComponent(id)}/${variant}`, { responseType: 'blob' });
  return data;
}
