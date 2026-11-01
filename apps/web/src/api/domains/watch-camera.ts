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

export type SampleLabel = 'ok' | 'ng' | 'later';
export type SampleFilter = 'all' | 'none' | SampleLabel;
export type SampleCamera = { id: string; name: string; location: string | null };
export type SampleStart = { clientDeviceId: string; intervalSec: number; durationSec: number; maxFrames: number };
export type SampleSession = {
  id: string; deviceName: string; intervalSec: number; durationSec: number; maxFrames: number;
  status: 'running' | 'stopped' | 'completed'; startedAt: string; endsAt: string; endedAt: string | null;
  frameCount: number; byteSize: number; counts: Record<SampleLabel | 'none', number>;
};
export type SampleFrame = { id: string; capturedAt: string; label: SampleLabel | null };

export async function listSampleCameras() {
  return (await api.get<SampleCamera[]>('/watch-camera/admin/cameras')).data;
}
export async function startSampleSession(input: SampleStart) {
  return (await api.post('/watch-camera/admin/samples', input)).data;
}
export async function stopSampleSession(id: string) {
  await api.post(`/watch-camera/admin/samples/${encodeURIComponent(id)}/stop`);
}
export async function listSampleSessions(clientDeviceId: string) {
  return (await api.get<SampleSession[]>('/watch-camera/admin/samples', { params: { clientDeviceId } })).data;
}
export async function listSampleFrames(id: string, label: SampleFilter) {
  return (await api.get<SampleFrame[]>(`/watch-camera/admin/samples/${encodeURIComponent(id)}/frames`, { params: { label } })).data;
}
export async function getSampleImage(id: string, variant: 'thumb' | 'full') {
  return (await api.get<Blob>(`/watch-camera/admin/sample-frames/${encodeURIComponent(id)}/${variant}`, { responseType: 'blob' })).data;
}
export async function labelSampleFrame(id: string, label: SampleLabel | null) {
  await api.patch(`/watch-camera/admin/sample-frames/${encodeURIComponent(id)}`, { label });
}
export async function deleteSampleSession(id: string) {
  await api.delete(`/watch-camera/admin/samples/${encodeURIComponent(id)}`);
}
