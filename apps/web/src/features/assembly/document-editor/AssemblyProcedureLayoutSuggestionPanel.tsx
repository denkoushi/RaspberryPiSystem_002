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
      <ul className="mb-2 list-inside list-disc text-xs">
        {state.suggestion.changes.slice(0, 8).map((change, index) => <li key={index}>{change}</li>)}
      </ul>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <div role="group" aria-label="変更の前後" className="flex gap-1">
          <Button type="button" variant="ghostOnDark" aria-pressed={state.before} className={state.before ? selectedClass : ''} onClick={() => suggestions.showBefore(true)}>前</Button>
          <Button type="button" variant="ghostOnDark" aria-pressed={!state.before} className={!state.before ? selectedClass : ''} onClick={() => suggestions.showBefore(false)}>後</Button>
        </div>
        <Button type="button" variant="ghostOnDark" onClick={suggestions.cancel}>やめる</Button>
        <Button type="button" variant="primary" onClick={suggestions.apply}>これにする</Button>
      </div>
    </> : null}
  </div>;
}
