import { useEffect, useRef, useState } from 'react';

import { listKioskInspectionDrawingTemplates } from '../../../api/client';

import { buildProcessGroupsByVisualId, buildResourceCdsByVisualId } from './inspectionDrawingResourceCdHelpers';

import type { PartMeasurementProcessGroup } from '../types';

export function useInspectionDrawingResourceCdsByVisualId(refreshToken: number) {
  const [maps, setMaps] = useState<{
    resourceCdsByVisualId: Record<string, string[]>;
    processGroupsByVisualId: Record<string, PartMeasurementProcessGroup[]>;
  }>({ resourceCdsByVisualId: {}, processGroupsByVisualId: {} });
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const requestSeq = ++requestSeqRef.current;

    void listKioskInspectionDrawingTemplates({ includeInactive: false })
      .then((templates) => {
        if (requestSeqRef.current !== requestSeq) return;
        setMaps({
          resourceCdsByVisualId: buildResourceCdsByVisualId(templates),
          processGroupsByVisualId: buildProcessGroupsByVisualId(templates)
        });
      })
      .catch(() => {
        if (requestSeqRef.current !== requestSeq) return;
        setMaps({ resourceCdsByVisualId: {}, processGroupsByVisualId: {} });
      });
  }, [refreshToken]);

  return maps;
}
