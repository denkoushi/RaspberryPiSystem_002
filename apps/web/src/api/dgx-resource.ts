import { isAxiosError } from 'axios';

import { api } from './client';

import type {
  DgxResourceActionBody,
  DgxResourceActionResult,
  DgxResourceEventsResponse,
  DgxResourceOverview,
} from './dgx-resource.types';

export const DGX_RESOURCE_OVERVIEW_PATH = '/system/dgx-resource/overview';
export const DGX_RESOURCE_EVENTS_PATH = '/system/dgx-resource/events';
export const DGX_RESOURCE_ACTIONS_PATH = '/system/dgx-resource/actions';

export const dgxResourceQueryKeys = {
  overview: ['dgx-resource', 'overview'] as const,
  events: (limit: number) => ['dgx-resource', 'events', limit] as const,
};

export async function fetchDgxResourceOverview(): Promise<DgxResourceOverview> {
  const { data } = await api.get<DgxResourceOverview>(DGX_RESOURCE_OVERVIEW_PATH);
  return data;
}

export async function fetchDgxResourceEvents(limit = 8): Promise<DgxResourceEventsResponse> {
  const { data } = await api.get<DgxResourceEventsResponse>(DGX_RESOURCE_EVENTS_PATH, { params: { limit } });
  return data;
}

export async function postDgxResourceAction(body: DgxResourceActionBody): Promise<DgxResourceActionResult> {
  const { data } = await api.post<DgxResourceActionResult>(DGX_RESOURCE_ACTIONS_PATH, body);
  return data;
}

export function getDgxResourceApiErrorMessage(error: unknown): string {
  const code = isAxiosError<{ errorCode?: string }>(error) ? error.response?.data?.errorCode : undefined;
  switch (code) {
    case 'DGX_OPERATION_IN_PROGRESS': return '別の操作が進行中です。終わるまでお待ちください。';
    case 'DGX_MODEL_PROFILE_UNKNOWN': return '選んだモデルが見つかりません。画面を更新してください。';
    case 'DGX_MODEL_PROFILE_UNAVAILABLE': return 'このモデルは今は起動できません。メモリやモデルの状態を確認してください。';
    case 'DGX_MODEL_PROFILES_UNAVAILABLE': return 'モデル一覧を取得できません。少し待ってお試しください。';
    case 'DGX_RUNTIME_CONTROL_NOT_CONFIGURED':
    case 'DGX_RUNTIME_TOKEN_MISSING':
    case 'DGX_GATEWAY_UNCONFIGURED': return 'DGX を操作するための設定が足りません。管理者に確認してください。';
    default: return '操作を完了できませんでした。状態を確認して、もう一度お試しください。';
  }
}
