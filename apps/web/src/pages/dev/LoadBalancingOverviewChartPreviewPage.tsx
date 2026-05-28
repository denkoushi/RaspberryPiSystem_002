import {
  getOverviewChartDisplayNameClipHeight,
  getOverviewChartDisplayNameMaxLength,
  getOverviewChartDisplayNameOffsetY,
  loadBalancingOverviewChartAxisBandHeight,
  loadBalancingOverviewXAxisLayout
} from '../../features/kiosk/loadBalancing/loadBalancingOverviewChartAxis';
import { buildLoadBalancingOverviewChartPreviewRows } from '../../features/kiosk/loadBalancing/loadBalancingOverviewChartPreviewFixtures';
import { LoadBalancingOverviewResourceChart } from '../../features/kiosk/loadBalancing/LoadBalancingOverviewResourceChart';
import { LoadBalancingPageHeader } from '../../features/kiosk/loadBalancing/LoadBalancingPageHeader';
import { lbCard, lbGrid, lbPage, lbText } from '../../features/kiosk/loadBalancing/loadBalancingUiClasses';

const previewRows = buildLoadBalancingOverviewChartPreviewRows();

const PREVIEW_TABS = [
  { id: 'overview' as const, label: '資源CD俯瞰' },
  { id: 'machine-monthly' as const, label: '機種別月次負荷' },
  { id: 'start-date-leveling' as const, label: '着手日・平準化' }
];

/** 開発専用 — 負荷調整 overview タブと同じ DOM/CSS で X 軸を評価 */
export function LoadBalancingOverviewChartPreviewPage() {
  const layout = loadBalancingOverviewXAxisLayout;

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-slate-800 text-white">
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4">
        <div className={`${lbPage.root} w-full min-w-[1280px] max-w-none`}>
          <LoadBalancingPageHeader activeView="overview" tabs={PREVIEW_TABS} onViewChange={() => undefined} />

          <div className={lbGrid.leftStack}>
            <section className={lbCard.base}>
              <p className={`mb-2 ${lbText.section}`}>資源CD別（上位48・必要分降順）</p>
              <LoadBalancingOverviewResourceChart rows={previewRows} showOverLabels={false} />
            </section>

            <details className={`${lbCard.inset} ${lbText.meta}`}>
                <summary className="cursor-pointer font-semibold text-white/80">
                  X 軸レイアウト契約（折りたたみ）
                </summary>
                <ul className="mt-2 list-inside list-disc space-y-0.5 text-white/65">
                  <li>資源CD: dy {layout.resourceCd.dy} · lineHeight {layout.resourceCd.lineHeight}</li>
                  <li>CD 下余白: {layout.gapBelowResourceCd}px</li>
                  <li>
                    横スクロール: 1 資源あたり最小幅 40px · カテゴリ間 gap 12px · 棒・CD・表示名は tick 中央揃え
                  </li>
                  <li>
                    Y 軸: データ最大値 × 1.04（プロット内余白を削減）· 上 margin 4px
                  </li>
                  <li>
                    表示名: {layout.displayName.writingMode} · fontSize {layout.displayName.fontSize}px · 高{' '}
                    {getOverviewChartDisplayNameClipHeight()}px · max {getOverviewChartDisplayNameMaxLength()} 文字
                  </li>
                  <li>
                    表示名開始 Y: {getOverviewChartDisplayNameOffsetY()}px · ラベル帯{' '}
                    {loadBalancingOverviewChartAxisBandHeight}px · 外寸 {`lbChart.container`}
                  </li>
                </ul>
              </details>
          </div>
        </div>
      </main>
    </div>
  );
}
