import { lbLoading, lbNote } from './loadBalancingUiClasses';

type Props = {
  isInitialLoad: boolean;
  isRefreshing: boolean;
};

export function LoadBalancingTabLoadingStatus({ isInitialLoad, isRefreshing }: Props) {
  if (isInitialLoad) {
    return (
      <div className={lbLoading.banner} role="status" aria-live="polite">
        <p className={lbLoading.status}>集計を読み込み中…</p>
        <p className={lbNote.loadingHint}>初回集計には時間がかかる場合があります。</p>
        <div className="mt-2 flex flex-col gap-2">
          {[1, 2, 3].map((index) => (
            <div key={index} className={lbLoading.skeletonRow}>
              <div className={`${lbLoading.skeletonBar} w-1/4`} />
              <div className={`${lbLoading.skeletonBar} w-1/2`} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isRefreshing) {
    return (
      <p className={lbLoading.status} role="status">
        更新中…
      </p>
    );
  }

  return null;
}
