import { mpKioskTheme } from '../ui/mobilePlacementKioskTheme';
import { useHaizenCurrentPlacements } from '../useHaizenCurrentPlacements';

type MobilePlacementHaizenPanelProps = {
  /** 配膳画面で選択中の棚（構造化ラベル） */
  selectedShelfCode: string;
};

/**
 * Zero2W 棚番エッジの配膳状態を閲覧する。
 */
export function MobilePlacementHaizenPanel({ selectedShelfCode }: MobilePlacementHaizenPanelProps) {
  const shelfKey = selectedShelfCode.trim();
  const currentQuery = useHaizenCurrentPlacements(shelfKey.length > 0 ? shelfKey : undefined);

  const rows = currentQuery.data?.rows ?? [];

  return (
    <section
      className="mx-3 mb-3 rounded-lg border border-slate-600/80 bg-slate-900/40 px-3 py-3"
      aria-label="Zero2W 棚番配膳の状態"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-100">棚番配膳（Zero2W）</h2>
        <button
          type="button"
          className={mpKioskTheme.partSearchButton}
          onClick={() => void currentQuery.refetch()}
          disabled={currentQuery.isFetching}
        >
          一覧を更新
        </button>
      </div>
      <p className="mb-2 text-sm text-slate-300">
        {shelfKey.length > 0 ? (
          <>
            表示フィルタ: <span className="font-mono text-slate-200">{shelfKey}</span>
          </>
        ) : (
          <span className="text-slate-400">棚未選択のため全棚の最新50件</span>
        )}
      </p>
      <p className="mb-2 text-xs text-slate-400">
        Zero2W の棚番プリセットは、対象端末の `x-client-key` で
        `PATCH /api/mobile-placement/haizen-preset-shelf` を実行して設定します。
      </p>
      {currentQuery.isError ? (
        <p className="text-sm text-red-300">配膳一覧の取得に失敗しました。更新を再度お試しください。</p>
      ) : null}
      {currentQuery.isLoading && rows.length === 0 ? (
        <p className="text-sm text-slate-400">読み込み中…</p>
      ) : null}
      {rows.length === 0 && !currentQuery.isLoading ? (
        <p className="text-sm text-slate-400">該当する配膳記録はありません。</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded border border-slate-700/80 bg-slate-950/50 px-2 py-2 text-sm text-slate-100"
            >
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <span className="font-mono text-amber-100">棚 {r.shelfCodeRaw}</span>
                <span className="font-mono">製造order {r.manufacturingOrderBarcodeRaw}</span>
                {r.distributionNumber != null ? (
                  <span className="text-slate-300">分配 {r.distributionNumber}</span>
                ) : null}
                <span
                  className={
                    r.resolutionNote === 'RESOLVED' ? 'text-emerald-400' : 'text-amber-400'
                  }
                >
                  {r.resolutionNote === 'RESOLVED' ? '日程一致' : '未照合'}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                製番 {r.fseiban ?? '—'} · 品番 {r.fhincd ?? '—'} · {r.fhinmei ?? '—'} · 更新{' '}
                {new Date(r.updatedAt).toLocaleString('ja-JP')}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
