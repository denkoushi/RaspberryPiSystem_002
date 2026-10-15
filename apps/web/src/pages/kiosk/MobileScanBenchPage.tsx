import { CAMERA_QUALITY, ENGINE_LABELS, scanStats, seconds } from '../../features/scan-bench/helpers';
import { useScanBench } from '../../features/scan-bench/useScanBench';

import type { CameraQuality, ScanEngine } from '../../features/scan-bench/helpers';

const engines: ScanEngine[] = ['zxing', 'native'];
const qualities: CameraQuality[] = ['standard', 'high'];
const button = 'min-h-14 rounded-lg border-2 px-3 py-3 text-lg font-bold focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-yellow-400 disabled:opacity-50';

export function MobileScanBenchPage() {
  const bench = useScanBench();
  const { camera } = bench;
  const shown = bench.records.filter((record) => record.quality === bench.quality);
  return (
    <main className="min-h-dvh bg-slate-950 px-3 py-4 text-white">
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-xl font-bold">読取速度テスト</h1>
        <p className="text-sm" aria-live="polite">
          {`${CAMERA_QUALITY[bench.quality].label}: `}
          {engines.map((engine) => {
            const stats = scanStats(shown.filter((record) => record.engine === engine));
            return `${ENGINE_LABELS[engine]} 中央値 ${seconds(stats.median)} (${stats.successes}回)`;
          }).join(' / ')}
        </p>
        <div className="grid grid-cols-2 gap-2" aria-label="読取方式">
          {engines.map((engine) => (
            <button key={engine} type="button" aria-pressed={bench.engine === engine}
              disabled={engine === 'native' && !bench.nativeAvailable}
              className={`${button} ${bench.engine === engine ? 'border-cyan-300 bg-cyan-800' : 'border-slate-500 bg-slate-800'}`}
              onClick={() => bench.selectEngine(engine)}>{ENGINE_LABELS[engine]}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2" aria-label="画質">
          {qualities.map((quality) => (
            <button key={quality} type="button" aria-pressed={bench.quality === quality} disabled={bench.scanning}
              className={`${button} text-base ${bench.quality === quality ? 'border-cyan-300 bg-cyan-800' : 'border-slate-500 bg-slate-800'}`}
              onClick={() => bench.selectQuality(quality)}>{CAMERA_QUALITY[quality].label}</button>
          ))}
        </div>
        {!bench.checking && !bench.nativeAvailable && (
          <div role="status" className="rounded-lg bg-slate-800 p-3 text-sm">
            <p>この端末では高速読取が使えません</p>
            <p className="mt-1 break-words">対応形式: {bench.supported.join(', ') || 'なし'}</p>
          </div>
        )}
        <div className="relative aspect-[5/3] overflow-hidden rounded-lg bg-black">
          <video ref={camera.videoRef} autoPlay muted playsInline className="h-full w-full object-contain" aria-label="カメラプレビュー" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-[10%] inset-y-[25%] rounded border border-white" />
        </div>
        <p className="text-xs text-slate-300">映像 {camera.resolution} / カメラ開始 {camera.startMs === null ? '—' : `${Math.round(camera.startMs)} ms`}</p>
        {camera.status !== 'ready' && (
          <button type="button" className={`${button} w-full border-white bg-slate-800`} disabled={camera.status === 'starting'} onClick={() => { void camera.start(); }}>
            {camera.status === 'starting' ? 'カメラ起動中…' : 'カメラ開始'}
          </button>
        )}
        {camera.error && <p role="alert" className="text-red-300">{camera.error}</p>}
        <button type="button" className={`${button} w-full border-cyan-200 bg-cyan-700 text-2xl`} disabled={camera.status !== 'ready' || bench.scanning} onClick={bench.read}>
          {bench.scanning ? '読取中…（15秒）' : bench.last ? '次を読む' : '読む'}
        </button>
        {bench.error && <p role="alert" className="text-red-300">{bench.error}</p>}
        {bench.last && <div role="status" className="rounded-lg border border-slate-500 p-3">
          <p className="text-2xl font-bold">{bench.last.value === null ? '読めず' : seconds(bench.last.elapsedMs)}</p>
          <p className="break-all">{bench.last.value}</p>
          <p className="text-sm text-slate-300">{ENGINE_LABELS[bench.last.engine]} {bench.last.format}</p>
        </div>}
        {engines.map((engine) => {
          const records = shown.filter((record) => record.engine === engine);
          const stats = scanStats(records);
          return <section key={engine} className="space-y-2 rounded-lg bg-slate-900 p-3">
            <h2 className="text-lg font-bold">{ENGINE_LABELS[engine]}</h2>
            <dl className="grid grid-cols-3 gap-2 text-sm">
              {([['回数', `${stats.count}回`], ['中央値', seconds(stats.median)], ['最速', seconds(stats.fastest)], ['最遅', seconds(stats.slowest)], ['読めず', `${stats.timeouts}回`]]).map(([label, value]) => <div key={label}><dt className="text-slate-300">{label}</dt><dd>{value}</dd></div>)}
            </dl>
            <table className="w-full table-fixed text-left text-sm">
              <caption className="text-left text-xs text-slate-300">直近10回・新しい順（統計は成功分）</caption>
              <thead><tr><th className="w-20 py-2">秒数</th><th>値 / 形式</th></tr></thead>
              <tbody>{records.slice(-10).reverse().map((record, index) => <tr key={index} className="border-t border-slate-700"><td className="py-2 align-top">{record.value === null ? '読めず' : seconds(record.elapsedMs)}</td><td className="break-all py-2">{record.value ?? '—'}<span className="block text-xs text-slate-300">{record.format}</span></td></tr>)}</tbody>
            </table>
          </section>;
        })}
        <button type="button" className={`${button} w-full border-slate-500 bg-slate-800`} disabled={!bench.records.length || bench.scanning} onClick={() => { if (window.confirm('記録を消しますか？')) bench.clear(); }}>記録を消す</button>
      </div>
    </main>
  );
}
