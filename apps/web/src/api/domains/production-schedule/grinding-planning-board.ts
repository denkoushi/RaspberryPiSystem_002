import { api } from '../../http';

import type {
  GrindingPlanningBoardProcessChipsRequest,
  GrindingPlanningBoardProcessChipsResponse,
  GrindingPlanningBoardResourceCapacityRequest,
  GrindingPlanningBoardResourceCapacityResponse,
  GrindingPlanningBoardCategory,
  GrindingPlanningBoardOverridesResponse,
  GrindingPlanningBoardResponse,
  GrindingPlanningBoardLoadResponse,
  GrindingPlanningBoardView,
  GrindingPlanningBoardOverridesRequest,
  GrindingPlanningBoardRankRequest,
  GrindingPlanningBoardRankResponse,
  GrindingPlanningBoardResourceOrderRequest,
  GrindingPlanningBoardResourceOrderBulkRequest,
  GrindingPlanningBoardPinsRequest,
  GrindingPlanningBoardResourceOrderResponse,
  GrindingPlanningBoardSeibanOrderRequest,
  GrindingPlanningBoardDueScopeRequest,
  GrindingPlanningBoardDueScopeSnapshot,
  GrindingPlanningBoardSeibanCandidatesResponse
} from '@raspi-system/shared-types';

export async function getKioskGrindingPlanningBoardProcessChips(body: GrindingPlanningBoardProcessChipsRequest) {
  const chipsByPartKey: GrindingPlanningBoardProcessChipsResponse['chipsByPartKey'] = {};
  // Progressive board loading can exceed the endpoint's per-request limit.
  for (let offset = 0; offset < body.parts.length; offset += 1000) {
    const { data } = await api.post<GrindingPlanningBoardProcessChipsResponse>(
      '/kiosk/production-schedule/grinding-planning-board/process-chips',
      { parts: body.parts.slice(offset, offset + 1000) }
    );
    Object.assign(chipsByPartKey, data.chipsByPartKey);
  }
  return { chipsByPartKey };
}

export type KioskGrindingPlanningBoardQuery = {
  category: GrindingPlanningBoardCategory;
  view: GrindingPlanningBoardView;
  fseibans?: readonly string[];
  cursor?: number;
  pageSize?: number;
  snapshotId?: string;
  completionFilter?: 'all' | 'complete' | 'incomplete';
};

export async function getKioskGrindingPlanningBoard(params: KioskGrindingPlanningBoardQuery) {
  const { data } = await api.get<GrindingPlanningBoardResponse>('/kiosk/production-schedule/grinding-planning-board', {
    params: {
      category: params.category,
      view: params.view,
      includeLoad: false,
      ...(params.fseibans && params.fseibans.length > 0 ? { fseibans: params.fseibans.join(',') } : {}),
      ...(params.cursor == null ? {} : { cursor: params.cursor }),
      ...(params.pageSize == null ? {} : { pageSize: params.pageSize }),
      ...(params.snapshotId == null ? {} : { snapshotId: params.snapshotId }),
      ...(params.completionFilter == null ? {} : { completionFilter: params.completionFilter })
    }
  });
  return data;
}

export async function getKioskGrindingPlanningBoardLoad(category: GrindingPlanningBoardCategory) {
  const { data } = await api.get<GrindingPlanningBoardLoadResponse>('/kiosk/production-schedule/grinding-planning-board/load', {
    params: { category }
  });
  return data;
}

export async function getKioskGrindingPlanningBoardSnapshot(params: KioskGrindingPlanningBoardQuery) {
  const first = await getKioskGrindingPlanningBoard({ ...params, cursor: 0, pageSize: 160 });
  const items = [...first.items];
  const seenIds = new Set(first.items.map((item) => item.itemId));
  let nextCursor = first.nextCursor;
  let previousCursor = 0;
  while (nextCursor != null) {
    const cursor = Number(nextCursor);
    if (!Number.isInteger(cursor) || cursor <= previousCursor) {
      throw new Error('生産日程のページ情報が不正です。再読み込みしてください。');
    }
    const page = await getKioskGrindingPlanningBoard({ ...params, cursor, pageSize: 640, snapshotId: first.snapshotId });
    if (page.sourceRevision !== first.sourceRevision || page.snapshotId !== first.snapshotId) {
      throw new Error('表示中の生産日程が更新されました。再読み込みしてください。');
    }
    for (const item of page.items) {
      if (seenIds.has(item.itemId)) throw new Error('生産日程のページに重複があります。再読み込みしてください。');
      seenIds.add(item.itemId);
      items.push(item);
    }
    previousCursor = cursor;
    nextCursor = page.nextCursor;
  }
  return { ...first, items, nextCursor: null };
}

export async function getKioskGrindingPlanningBoardSeibanCandidates(params: {
  category: GrindingPlanningBoardCategory;
  completionFilter?: 'all' | 'incomplete';
}) {
  const { data } = await api.get<GrindingPlanningBoardSeibanCandidatesResponse>(
    '/kiosk/production-schedule/grinding-planning-board/seiban-candidates',
    { params }
  );
  return data;
}

export async function updateKioskGrindingPlanningBoardOverrides(payload: GrindingPlanningBoardOverridesRequest): Promise<GrindingPlanningBoardOverridesResponse> {
  const { data } = await api.put<GrindingPlanningBoardOverridesResponse>(
    '/kiosk/production-schedule/grinding-planning-board/overrides',
    payload
  );
  return data;
}

export async function updateKioskGrindingPlanningBoardPins(payload: GrindingPlanningBoardPinsRequest): Promise<GrindingPlanningBoardOverridesResponse> {
  const { data } = await api.put<GrindingPlanningBoardOverridesResponse>(
    '/kiosk/production-schedule/grinding-planning-board/pins', payload
  );
  return data;
}

export async function updateKioskGrindingPlanningBoardRank(payload: GrindingPlanningBoardRankRequest) {
  const { data } = await api.put<GrindingPlanningBoardRankResponse>(
    '/kiosk/production-schedule/grinding-planning-board/rank',
    payload
  );
  return data;
}

export async function updateKioskGrindingPlanningBoardResourceOrder(payload: GrindingPlanningBoardResourceOrderRequest) {
  const { data } = await api.put<GrindingPlanningBoardResourceOrderResponse>(
    '/kiosk/production-schedule/grinding-planning-board/resource-order',
    payload
  );
  return data;
}

export async function updateKioskGrindingPlanningBoardResourceOrderBulk(payload: GrindingPlanningBoardResourceOrderBulkRequest) {
  const { data } = await api.put<GrindingPlanningBoardResourceOrderResponse>(
    '/kiosk/production-schedule/grinding-planning-board/resource-order/bulk',
    payload
  );
  return data;
}

export async function updateKioskGrindingPlanningBoardSeibanOrder(payload: GrindingPlanningBoardSeibanOrderRequest) {
  const { data } = await api.put<{ sourceRevision: string; seibanOrder: string[] }>(
    '/kiosk/production-schedule/grinding-planning-board/seiban-order',
    payload
  );
  return data;
}

export async function getKioskGrindingPlanningBoardDueDetail(fseiban: string) {
  const { data } = await api.get<GrindingPlanningBoardDueScopeSnapshot>(
    `/kiosk/production-schedule/grinding-planning-board/seiban/${encodeURIComponent(fseiban)}/due-detail`
  );
  return data;
}

export async function updateKioskGrindingPlanningBoardDueScope(
  fseiban: string,
  payload: GrindingPlanningBoardDueScopeRequest
) {
  const { data } = await api.put<{ success: true; sourceGenerationToken: string; scopeRevision: string }>(
    `/kiosk/production-schedule/grinding-planning-board/seiban/${encodeURIComponent(fseiban)}/due-scope`,
    payload
  );
  return data;
}

export async function getKioskGrindingPlanningBoardResourceCapacity() {
  const { data } = await api.get<GrindingPlanningBoardResourceCapacityResponse>(
    '/kiosk/production-schedule/grinding-planning-board/resource-capacity'
  );
  return data;
}

export async function updateKioskGrindingPlanningBoardResourceCapacity(payload: GrindingPlanningBoardResourceCapacityRequest) {
  const { data } = await api.put<GrindingPlanningBoardResourceCapacityResponse>(
    '/kiosk/production-schedule/grinding-planning-board/resource-capacity', payload
  );
  return data;
}
