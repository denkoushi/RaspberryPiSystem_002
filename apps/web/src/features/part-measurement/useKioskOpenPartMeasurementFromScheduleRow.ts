import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { findOrOpenPartMeasurementSheet, getResolvedClientKey } from '../../api/client';
import { isGrindingResourceCd } from '../kiosk/productionSchedule/resourceCategory';

import { savePartMeasurementProcessGroup } from './processGroupStorage';

import type { PartMeasurementProcessGroup } from './types';
import type { NormalizedScheduleRow } from '../kiosk/productionSchedule/displayRowDerivation';


/**
 * 生産スケジュール（または同等の NormalizedScheduleRow）から部品測定フローを開く。
 * `find-or-open` で下書き再開・確定閲覧・新規下書き・テンプレ作成へ振り分ける。
 */
export function useKioskOpenPartMeasurementFromScheduleRow() {
  const navigate = useNavigate();
  const clientKey = getResolvedClientKey();
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const openFromScheduleRow = useCallback(
    async (row: NormalizedScheduleRow) => {
      const productNo = String(row.data.ProductNo ?? '').trim();
      const resourceCd = String(row.data.FSIGENCD ?? '').trim();
      const fhincd = String(row.data.FHINCD ?? '').trim();
      if (!productNo || !resourceCd) return;
      const processGroup: PartMeasurementProcessGroup = isGrindingResourceCd(resourceCd) ? 'grinding' : 'cutting';
      savePartMeasurementProcessGroup(processGroup);
      setBusyRowId(row.id);
      setError(null);
      try {
        const res = await findOrOpenPartMeasurementSheet(
          {
            productNo,
            processGroup,
            resourceCd,
            scheduleRowId: row.id,
            fseiban: row.data.FSEIBAN ? String(row.data.FSEIBAN).trim() : null,
            fhincd: fhincd || null,
            fhinmei: row.data.FHINMEI ? String(row.data.FHINMEI).trim() : null,
            machineName: null,
            scannedBarcodeRaw: productNo
          },
          clientKey
        );
        if (res.mode === 'resume_draft' || res.mode === 'created_draft' || res.mode === 'view_finalized') {
          void navigate(`/kiosk/part-measurement/edit/${res.sheet.id}`);
          return;
        }
        if (res.mode === 'needs_template' && res.header) {
          void navigate('/kiosk/part-measurement/template/new', {
            state: {
              fhincd: res.header.fhincd,
              resourceCd: res.header.resourceCd,
              processGroup: res.header.processGroup
            }
          });
          return;
        }
        void navigate('/kiosk/part-measurement', {
          state: { productNo, resourceCdFilter: resourceCd }
        });
      } catch (e: unknown) {
        const err = e as { response?: { data?: { message?: string } } };
        setError(err.response?.data?.message ?? '部品測定を開けませんでした。');
      } finally {
        setBusyRowId(null);
      }
    },
    [navigate, clientKey]
  );

  return { openFromScheduleRow, busyRowId, error, clearError };
}
