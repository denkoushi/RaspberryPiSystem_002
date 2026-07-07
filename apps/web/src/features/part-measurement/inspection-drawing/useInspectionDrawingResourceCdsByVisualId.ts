import { useEffect, useRef, useState } from 'react';

import { listKioskInspectionDrawingTemplates } from '../../../api/client';

import { buildResourceCdsByVisualId } from './inspectionDrawingResourceCdHelpers';

export function useInspectionDrawingResourceCdsByVisualId(refreshToken: number) {
  const [resourceCdsByVisualId, setResourceCdsByVisualId] = useState<Record<string, string[]>>({});
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const requestSeq = ++requestSeqRef.current;

    void listKioskInspectionDrawingTemplates({ includeInactive: false })
      .then((templates) => {
        if (requestSeqRef.current !== requestSeq) return;
        setResourceCdsByVisualId(buildResourceCdsByVisualId(templates));
      })
      .catch(() => {
        if (requestSeqRef.current !== requestSeq) return;
        setResourceCdsByVisualId({});
      });
  }, [refreshToken]);

  return resourceCdsByVisualId;
}
