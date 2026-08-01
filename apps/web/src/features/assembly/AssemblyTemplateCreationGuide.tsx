import clsx from 'clsx';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { AnchoredDropdownPortal } from '../../components/kiosk/AnchoredDropdownPortal';
import { Button } from '../../components/ui/Button';

import { buildAssemblyTemplateGuidePresentation } from './assemblyTemplateGuidePresentation';

import type {
  AssemblyTemplateReadiness,
  AssemblyTemplateReadinessIssue,
  AssemblyTemplateReadinessStage
} from './assemblyTemplateReadiness';

type Props = {
  readiness: AssemblyTemplateReadiness;
  readOnly: boolean;
  onStageClick: (stage: AssemblyTemplateReadinessStage) => void;
  onIssueClick: (issue: AssemblyTemplateReadinessIssue) => void;
  onRetryCapabilityCatalog: () => void;
};

export function AssemblyTemplateHeaderGuide({
  readiness,
  readOnly,
  onStageClick,
  onIssueClick,
  onRetryCapabilityCatalog
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const presentation = useMemo(
    () => buildAssemblyTemplateGuidePresentation(readiness),
    [readiness]
  );

  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !(rootRef.current?.contains(target) ?? false) &&
        !(panelRef.current?.contains(target) ?? false)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleStageClick = (stage: AssemblyTemplateReadinessStage) => {
    if (stage === 'review') {
      setIsOpen(true);
      return;
    }
    onStageClick(stage);
  };

  const handleIssueClick = (issue: AssemblyTemplateReadinessIssue) => {
    setIsOpen(false);
    onIssueClick(issue);
  };

  return (
    <section
      className="col-span-2 row-start-2 min-w-0 xl:col-span-1 xl:col-start-2 xl:row-start-1"
      aria-label="テンプレート作成ガイド"
      data-testid="assembly-template-header-guide"
    >
      <div ref={rootRef} className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {presentation.stages.map((stage) => {
          const status = stage.status;
          return (
            <button
              key={stage.id}
              type="button"
              className={clsx(
                'flex min-h-10 shrink-0 items-center gap-1 rounded border px-1.5 text-left',
                status === 'complete'
                  ? 'border-emerald-300/35 bg-emerald-950/35'
                  : status === 'checking'
                    ? 'border-sky-300/35 bg-sky-950/35'
                    : 'border-amber-300/35 bg-amber-950/35'
              )}
              onClick={() => handleStageClick(stage.id)}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[0.68rem] font-black">
                {stage.step}
              </span>
              <span className="min-w-0">
                <span className="block whitespace-nowrap text-[0.7rem] font-bold">{stage.label}</span>
                <span
                  className={clsx(
                    'block text-[0.62rem] font-semibold leading-tight',
                    status === 'complete'
                      ? 'text-emerald-200'
                      : status === 'checking'
                        ? 'text-sky-200'
                        : 'text-amber-200'
                  )}
                >
                  {stage.statusLabel}
                </span>
              </span>
            </button>
          );
        })}
        {!readOnly ? (
          <Button
            ref={triggerRef}
            type="button"
            variant={readiness.isReady ? 'secondary' : 'ghostOnDark'}
            className="min-h-10 shrink-0 whitespace-nowrap !px-2 !py-1 text-xs"
            aria-haspopup="dialog"
            aria-controls={panelId}
            aria-expanded={isOpen}
            onClick={() => setIsOpen((current) => !current)}
          >
            {presentation.summaryLabel}
          </Button>
        ) : null}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {presentation.liveMessage}
      </p>

      <AnchoredDropdownPortal
        isOpen={isOpen && !readOnly}
        id={panelId}
        ariaLabel="テンプレートの未完了項目"
        anchorRef={rootRef}
        panelRef={panelRef}
        fixedZIndex={70}
        className="w-[min(92vw,32rem)] rounded border border-cyan-300/25 bg-slate-950/95 p-2 shadow-2xl"
      >
        <div className="max-h-[min(60dvh,20rem)] overflow-y-auto">
          {readiness.issues.length === 0 ? (
            <p className="text-sm font-semibold text-emerald-200">
              保存条件をすべて満たしました。
            </p>
          ) : (
            <ol className="grid gap-1">
              {readiness.issues.map((issue, index) => (
                <li key={`${issue.code}:${issue.target.id ?? ''}:${index}`}>
                  <button
                    type="button"
                    className="min-h-10 w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-left text-xs font-semibold text-amber-100 hover:bg-white/10"
                    onClick={() => handleIssueClick(issue)}
                  >
                    {issue.message}
                  </button>
                </li>
              ))}
            </ol>
          )}
          {presentation.catalogUnavailable ? (
            <Button
              type="button"
              variant="ghostOnDark"
              className="mt-2 min-h-10"
              onClick={onRetryCapabilityCatalog}
            >
              適合グループを再読込
            </Button>
          ) : null}
        </div>
      </AnchoredDropdownPortal>
    </section>
  );
}
