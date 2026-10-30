import { api } from '../http';

export type WatchCameraFrame = {
  id: string;
  deviceName: string;
  capturedAt: string;
  judgement: 'person' | 'unjudged';
};

export async function listWatchCameraFrames(params: { date: string }) {
  const { data } = await api.get<{ frames: WatchCameraFrame[] }>('/watch-camera/admin/frames', { params });
  return data.frames;
}

export async function getWatchCameraImage(id: string, variant: 'thumb' | 'full') {
  const { data } = await api.get<Blob>(`/watch-camera/admin/frames/${encodeURIComponent(id)}/${variant}`, { responseType: 'blob' });
  return data;
}
