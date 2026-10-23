import { Button } from '../../../components/ui/Button';

import type { AssemblyProcedureDocumentEditorController } from './useAssemblyProcedureDocumentEditorController';

export function AssemblyProcedureLayoutSuggestionPanel({ suggestions }: { suggestions: AssemblyProcedureDocumentEditorController['layoutSuggestions'] }) {
  const state = suggestions.state;
  if (state.status === 'idle') return null;
  const selectedClass = '!border-[#5fc3e8] !text-[#5fc3e8]';
  return <div className="absolute bottom-4 left-1/2 z-50 w-max max-w-[calc(100%-32px)] -translate-x-1/2 rounded-lg border border-[#344252] bg-[#161c22f5] px-3 py-2 text-sm" role={state.status === 'error' ? 'alert' : 'status'} aria-label="配置の提案">
    {state.status === 'pending' ? <div className="flex items-center gap-3"><p>配置を考えています {state.seconds}秒</p><Button type="button" variant="ghostOnDark" onClick={suggestions.cancel}>やめる</Button></div> : null}
    {state.status === 'error' ? <div className="flex items-center gap-3"><p>{state.message}</p><Button type="button" variant="ghostOnDark" onClick={suggestions.cancel}>閉じる</Button></div> : null}
    {state.status === 'preview' ? <>
      {state.suggestion.overflow ? <>
        <p className="mb-2 flex items-center gap-2"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-400" />写真が1ページに入りきりません</p>
        <div role="group" aria-label="ページに収める方法" className="mb-3 flex flex-wrap gap-2">
          {state.suggestion.overflow.shrink ? <Button type="button" variant="ghostOnDark" disabled={state.applying} aria-pressed={state.selectedOption === 'shrink'} className={state.selectedOption === 'shrink' ? selectedClass : ''} onClick={() => suggestions.selectOption('shrink')}>
            <span className="flex items-center gap-2">
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="6" y="6" width="12" height="12" rx="1" /><path d="M2 7V2h5M17 2h5v5M22 17v5h-5M7 22H2v-5M8 15l3-3 2 2 3-4" /></svg>
              <span className="text-left"><strong className="block">写真を縮める</strong><span className="block text-xs font-normal text-[#9fadb9]">1ページのまま ・ 写真 {state.suggestion.overflow.shrink.scalePercent}%</span></span>
            </span>
          </Button> : null}
          {state.suggestion.overflow.split ? <Button type="button" variant="ghostOnDark" disabled={state.applying} aria-pressed={state.selectedOption === 'split'} className={state.selectedOption === 'split' ? selectedClass : ''} onClick={() => suggestions.selectOption('split')}>
            <span className="flex items-center gap-2">
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="4" width="8" height="16" rx="1" /><rect x="15" y="4" width="8" height="16" rx="1" /><path d="M10 12h4m-2-2 2 2-2 2" /></svg>
              <span className="text-left"><strong className="block">2ページに分ける</strong><span className="block text-xs font-normal text-[#9fadb9]">写真はそのまま ・ {state.suggestion.overflow.split.firstMovedPhotoNumber}枚目から次へ</span><span className="block text-xs font-normal text-[#9fadb9]">残りは次の新しいページへ</span></span>
            </span>
          </Button> : null}
        </div>
      </> : <ul className="mb-2 list-inside list-disc text-xs">
        {state.suggestion.changes.slice(0, 8).map((change, index) => <li key={index}>{change}</li>)}
      </ul>}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <div role="group" aria-label="変更の前後" className="flex gap-1">
          <Button type="button" variant="ghostOnDark" disabled={state.applying} aria-pressed={state.before} className={state.before ? selectedClass : ''} onClick={() => suggestions.showBefore(true)}>前</Button>
          <Button type="button" variant="ghostOnDark" disabled={state.applying} aria-pressed={!state.before} className={!state.before ? selectedClass : ''} onClick={() => suggestions.showBefore(false)}>後</Button>
        </div>
        <Button type="button" variant="ghostOnDark" disabled={state.applying} onClick={suggestions.cancel}>やめる</Button>
        <Button type="button" variant="primary" disabled={state.applying} onClick={() => void suggestions.apply()}>これにする</Button>
      </div>
    </> : null}
  </div>;
}
