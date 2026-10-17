import { api } from './client';
import { getApiErrorMessageWithCode } from './errors';

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

export async function fetchDgxResourceEvents(limit = 24): Promise<DgxResourceEventsResponse> {
  const { data } = await api.get<DgxResourceEventsResponse>(DGX_RESOURCE_EVENTS_PATH, { params: { limit } });
  return data;
}

export async function postDgxResourceAction(body: DgxResourceActionBody): Promise<DgxResourceActionResult> {
  const { data } = await api.post<DgxResourceActionResult>(DGX_RESOURCE_ACTIONS_PATH, body);
  return data;
}

export function getDgxResourceApiErrorMessage(error: unknown): string {
  return getApiErrorMessageWithCode(error);
}
