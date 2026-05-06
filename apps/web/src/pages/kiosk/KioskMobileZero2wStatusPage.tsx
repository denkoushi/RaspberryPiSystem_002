import { useNavigate } from 'react-router-dom';

import { MobilePlacementHaizenPanel } from '../../features/mobile-placement/components/MobilePlacementHaizenPanel';
import { mpKioskTheme } from '../../features/mobile-placement/ui/mobilePlacementKioskTheme';

/**
 * Zero2W の配膳現在値一覧をメインページから切り離して表示する。
 * 選択棚フィルタはメインページと共有しない（棚番未指定時は全棚から最新を取得）。
 */
export function KioskMobileZero2wStatusPage() {
  const navigate = useNavigate();

  return (
    <div className="flex w-full min-h-0 flex-col gap-3 px-3 pb-3 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={mpKioskTheme.partSearchButton}
          onClick={() => navigate('/kiosk/mobile-placement')}
        >
          戻る
        </button>
        <p className="min-w-0 flex-1 text-sm text-slate-300">
          メイン画面から棚選択は共有されません。必要なら一覧更新後に製造orderで確認してください。
        </p>
      </div>
      <MobilePlacementHaizenPanel selectedShelfCode="" />
    </div>
  );
}
