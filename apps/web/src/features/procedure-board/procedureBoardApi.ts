import { useQuery } from '@tanstack/react-query';

import { api } from '../../api/client';

import type { BoardItem, BoardLayout, BoardTarget } from './procedureBoardLayout';

export type Material = { materialId: string; createdAt: string; text: string; images: { id: string }[];
  pdf: { assetId: string; filename: string; pageNumber: number; extraction: string } | null };
export type BoardResponse = { boardId: string; procedureId: string; version: number; layout: BoardLayout;
  stats?: { accepted: number; modified: number; manual: number } };
export type BoardEvent = { id: string; type: string; payload: Record<string, unknown> };
export type SuggestionSet = { id: string; boardVersion: number; stale?: boolean;
  placements: (BoardTarget & { id: string; materialId: string })[];
  headings: { id: string; page: number; text: string }[];
  gaps: (BoardTarget & { id: string; text: string })[];
  conflicts: { id: string; materialIds: [string, string]; quotes: [string, string] }[] };
export type Suggestions = { boardVersion: number; status: string; current: SuggestionSet | null;
  previous: SuggestionSet | null; pollAfterMs: number };
export type FormatResult = { pages: { page: number; rows: { cols: { itemIds: string[] }[]; w: number[] }[] }[];
  styles: { itemId: string; style: BoardItem['style'] }[] };
export type FormatProposal = { proposalId: string; boardVersion: number; status: string; pollAfterMs: number; result?: FormatResult | null };
export type Decision = { proposalId: string; action: 'accept' | 'dismiss' | 'relocate' | 'select_conflict';
  itemId?: string; target?: BoardTarget; selectedMaterialId?: string | null; workId?: string; activeMs?: number };
const root = '/kiosk/procedure-boards';
export const boardPath = (id: string) => `${root}/${encodeURIComponent(id)}`;
const read = async <T>(path: string): Promise<T> => (await api.get<T>(path)).data;
const post = async <T>(path: string, body: unknown): Promise<T> => (await api.post<T>(path, body)).data;
export const procedureBoardApi = {
  access: async () => {
    const [device, knowledge] = await Promise.all([
      read<{ procedureBoardEnabled?: boolean }>('/mobile-placement/client-capabilities'),
      read<{ enabled: boolean }>('/hermes-knowledge/capabilities'),
    ]);
    return device.procedureBoardEnabled === true && knowledge.enabled === true;
  },
  procedures: (cursor?: string) => read<{ procedures: { procedureId: string; title: string; boardId: string | null }[]; nextCursor: string | null }>(`${root}/procedures${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  get: (id: string) => read<BoardResponse>(boardPath(id)),
  open: async (id: string) => {
    try { return await procedureBoardApi.get(id); } catch (error) {
      if (httpStatus(error) !== 404) throw error;
      return post<BoardResponse>(boardPath(id), {});
    }
  },
  materials: async (id: string) => {
    const result: Material[] = []; let cursor: string | null = null;
    do {
      const page: { materials: Material[]; nextCursor: string | null } = await read(`${boardPath(id)}/materials${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      result.push(...page.materials); cursor = page.nextCursor;
    } while (cursor);
    return result;
  },
  save: async (id: string, expectedVersion: number, layout: BoardLayout, event: BoardEvent) =>
    (await api.put<BoardResponse>(boardPath(id), { expectedVersion, layout, event })).data,
  events: (id: string, boardVersion: number, events: BoardEvent[]) => post(`${boardPath(id)}/events`, { boardVersion, events }),
  suggestions: (id: string) => read<Suggestions>(`${boardPath(id)}/suggestions`),
  decide: (id: string, setId: string, version: number, decision: Decision, eventId: string) =>
    post<BoardResponse>(`${boardPath(id)}/suggestions/${encodeURIComponent(setId)}/decisions`, { expectedVersion: version, eventId, ...decision }),
  requestFormat: (id: string, expectedVersion: number, requestId: string) => post<FormatProposal>(`${boardPath(id)}/format-proposals`, { expectedVersion, requestId }),
  format: (id: string, proposalId: string) => read<FormatProposal>(`${boardPath(id)}/format-proposals/${encodeURIComponent(proposalId)}`),
  decideFormat: (id: string, proposalId: string, expectedVersion: number, action: 'accept' | 'revert', eventId: string) =>
    post<BoardResponse>(`${boardPath(id)}/format-proposals/${encodeURIComponent(proposalId)}/decision`, { expectedVersion, eventId, action }),
};
export function httpStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status;
}
export function useProcedureBoardAccess() {
  return useQuery({ queryKey: ['procedure-board-access'], queryFn: procedureBoardApi.access, retry: false, staleTime: 30_000 });
}
