import { useMemo } from 'react';

import { usePlanningBoardQueryData } from './usePlanningBoardQueryData';

import type { GrindingPlanningBoardResponse } from '@raspi-system/shared-types';

function selectContent({ snapshotId: _snapshotId, nextCursor: _nextCursor, ...content }: GrindingPlanningBoardResponse) {
  return content;
}

/** Response metadata stays live; only the ordered board contents retain their identity. */
export function usePlanningBoardPageData(response: GrindingPlanningBoardResponse | undefined, scope: string) {
  const incoming = useMemo(() => {
    if (!response) return undefined;
    return { scope, content: selectContent(response) };
  }, [response, scope]);
  const stable = usePlanningBoardQueryData(incoming);
  return { response, data: stable?.content };
}
