import { api } from '../../http';

import { procedureEditHeaders } from './shared';

export async function listProcedureVideos(params: { state?: import('../../../features/assembly/procedure-manuals/procedure-video-types').ProcedureVideoState; q?: string; limit?: number } = {}) {
  const { data } = await api.get<{ videos: import('../../../features/assembly/procedure-manuals/procedure-video-types').ProcedureVideoDto[] }>('/assembly/procedure-videos', { params });
  return data.videos;
}
export async function getProcedureVideoAutoEdit(id: string) {
  const { data } = await api.get<import('@raspi-system/shared-types').ProcedureVideoAutoEditDto | null>(`/assembly/procedure-videos/${encodeURIComponent(id)}/auto-edit`);
  return data;
}
export async function applyProcedureVideoAutoEdit(id: string, input: import('@raspi-system/shared-types').ProcedureVideoAutoEditApplyInput) {
  await api.post(`/assembly/procedure-videos/${encodeURIComponent(id)}/auto-edit/apply`, input);
}
export async function dismissProcedureVideoAutoEdit(id: string, input: import('@raspi-system/shared-types').ProcedureVideoAutoEditDismissInput) {
  await api.post(`/assembly/procedure-videos/${encodeURIComponent(id)}/auto-edit/dismiss`, input);
}
export async function regenerateProcedureVideoAutoEdit(id: string) {
  const { data } = await api.post<import('@raspi-system/shared-types').ProcedureVideoAutoEditDto>(`/assembly/procedure-videos/${encodeURIComponent(id)}/auto-edit/regenerate`);
  return data;
}
export async function getProcedureVideoFile(id: string, signal?: AbortSignal) {
  const { data } = await api.get<Blob>(`/assembly/procedure-videos/${encodeURIComponent(id)}/file`, { responseType: 'blob', signal });
  return data;
}
export async function getProcedureVideoPoster(id: string, sceneId?: string | null) {
  const { data } = await api.get<Blob>(`/assembly/procedure-videos/${encodeURIComponent(id)}${sceneId ? `/scenes/${encodeURIComponent(sceneId)}` : ''}/poster`, { responseType: 'blob' });
  return data;
}
export async function retryProcedureVideo(id: string) { await api.post(`/assembly/procedure-videos/${encodeURIComponent(id)}/retry`); }
export async function discardProcedureVideo(id: string) { await api.post(`/assembly/procedure-videos/${encodeURIComponent(id)}/discard`); }
export async function restoreProcedureVideo(id: string) { await api.post(`/assembly/procedure-videos/${encodeURIComponent(id)}/restore`); }
export async function getProcedurePageVideos(id: string, pageIndex: number) {
  const { data } = await api.get<{ videos: import('../../../features/assembly/procedure-manuals/procedure-video-types').ProcedureVideoSummaryDto[] }>(`/assembly/procedure-documents/${encodeURIComponent(id)}/pages/${pageIndex}/videos`);
  return data.videos;
}
export async function replaceProcedurePageVideos(id: string, pageIndex: number, items: import('../../../features/assembly/procedure-manuals/procedure-video-types').ProcedureVideoLinkItem[], accessPassword: string, holderToken?: string | null) {
  const { data } = await api.put<{ videos: import('../../../features/assembly/procedure-manuals/procedure-video-types').ProcedureVideoSummaryDto[] }>(`/assembly/procedure-documents/${encodeURIComponent(id)}/pages/${pageIndex}/videos`, { items, accessPassword }, procedureEditHeaders(holderToken));
  return data.videos;
}

export async function getProcedureVideoScenes(id: string) {
  const { data } = await api.get<{ scenes: import('../../../features/assembly/procedure-manuals/procedure-video-types').ProcedureVideoSceneDto[] }>(`/assembly/procedure-videos/${encodeURIComponent(id)}/scenes`);
  return data.scenes;
}
export async function createProcedureVideoScene(id: string, scene: { title?: string; startSeconds: number; endSeconds: number }) {
  const { data } = await api.post<import('../../../features/assembly/procedure-manuals/procedure-video-types').ProcedureVideoSceneDto>(`/assembly/procedure-videos/${encodeURIComponent(id)}/scenes`, scene);
  return data;
}
export async function updateProcedureVideoScene(id: string, sceneId: string, scene: { title?: string; startSeconds?: number; endSeconds?: number }) {
  const { data } = await api.patch<import('../../../features/assembly/procedure-manuals/procedure-video-types').ProcedureVideoSceneDto>(`/assembly/procedure-videos/${encodeURIComponent(id)}/scenes/${encodeURIComponent(sceneId)}`, scene);
  return data;
}
export async function deleteProcedureVideoScene(id: string, sceneId: string) {
  await api.delete(`/assembly/procedure-videos/${encodeURIComponent(id)}/scenes/${encodeURIComponent(sceneId)}`);
}

export async function trimProcedureVideo(id: string, startSeconds: number, endSeconds: number) {
  await api.post(`/assembly/procedure-videos/${encodeURIComponent(id)}/trim`, { startSeconds, endSeconds });
}
export async function concatProcedureVideos(sourceVideoIds: string[], title?: string) {
  const { data } = await api.post<import('../../../features/assembly/procedure-manuals/procedure-video-types').ProcedureVideoSummaryDto & { origin: 'CONCAT' }>('/assembly/procedure-videos/concat', { sourceVideoIds, title });
  return data;
}
export async function getProcedureVideoComments(id: string) {
  const { data } = await api.get<{ comments: import('../../../features/assembly/procedure-manuals/procedure-video-types').ProcedureVideoCommentDto[] }>(`/assembly/procedure-videos/${encodeURIComponent(id)}/comments`);
  return data.comments;
}
export async function replaceProcedureVideoComments(id: string, comments: import('../../../features/assembly/procedure-manuals/procedure-video-types').ProcedureVideoCommentDto[]) {
  const { data } = await api.put<{ comments: import('../../../features/assembly/procedure-manuals/procedure-video-types').ProcedureVideoCommentDto[] }>(`/assembly/procedure-videos/${encodeURIComponent(id)}/comments`, { comments: comments.map(({ atSeconds, text }) => ({ atSeconds, text })) });
  return data.comments;
}
