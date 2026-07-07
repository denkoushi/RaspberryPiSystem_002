import { lbNote } from './loadBalancingUiClasses';

export const LOAD_BALANCING_PRODUCTION_SYSTEM_DISCLAIMER =
  '生産システムの資源所要量積み上げ（FSIGENSHOYOYMD軸）とは集計軸が異なるため、数値は一致しません。';

export function LoadBalancingProductionSystemNote() {
  return (
    <p className={lbNote.disclaimer} data-testid="load-balancing-production-system-note">
      {LOAD_BALANCING_PRODUCTION_SYSTEM_DISCLAIMER}
    </p>
  );
}
