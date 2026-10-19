import { Button } from '../../../components/ui/Button';
import { AssemblyProcedureSequenceViewer } from '../../../features/assembly';

import type {
  AssemblyCanvasBolt,
  AssemblyCanvasCheckItem,
  currentAssemblyBolt,
  useAssemblyWorkProcedureSequence
} from '../../../features/assembly';
import type { AssemblyProcedureSequencePageDto, AssemblyWorkSessionDto } from '../../../features/assembly/types';

type Props = {
  procedureSequenceState: ReturnType<typeof useAssemblyWorkProcedureSequence>['state'];
  retryProcedureSequence: () => void;
  visibleBoltMarkers: AssemblyCanvasBolt[];
  visibleCheckMarkers: AssemblyCanvasCheckItem[];
  session: AssemblyWorkSessionDto;
  currentBolt: ReturnType<typeof currentAssemblyBolt>;
  sessionActive: boolean;
  toggleCheckItem: (checkItemId: string) => Promise<void>;
  handleCurrentPageChange: (page: AssemblyProcedureSequencePageDto | null) => void;
};

export function AssemblyWorkSessionProcedurePane({
  procedureSequenceState,
  retryProcedureSequence,
  visibleBoltMarkers,
  visibleCheckMarkers,
  session,
  currentBolt,
  sessionActive,
  toggleCheckItem,
  handleCurrentPageChange
}: Props) {
  return (
    <section
      className="flex min-h-[32rem] flex-col overflow-hidden rounded border border-white/15 bg-slate-900/70 xl:min-h-0"
      data-testid="assembly-work-procedure-pane"
    >
      <div className="min-h-0 flex-1">
        {procedureSequenceState.status === 'ready' ? (
          <AssemblyProcedureSequenceViewer
            sequence={procedureSequenceState.sequence}
            className="h-full"
            boltMarkers={visibleBoltMarkers}
            checkMarkers={visibleCheckMarkers}
            inputTargetBoltId={session.currentBoltId}
            currentMarker={
              currentBolt
                ? {
                    kioskDocumentId: currentBolt.kioskDocumentId,
                    assemblyProcedureDocumentId:
                      currentBolt.assemblyProcedureDocumentId ??
                      session.template.procedureDocumentId,
                    pageIndex: currentBolt.pageIndex,
                    xRatio: Number(currentBolt.xRatio),
                    yRatio: Number(currentBolt.yRatio)
                  }
                : null
            }
            onToggleCheckItem={sessionActive ? (checkItemId) => void toggleCheckItem(checkItemId) : undefined}
            onCurrentPageChange={handleCurrentPageChange}
          />
        ) : procedureSequenceState.status === 'error' ? (
          <div
            className="flex h-full min-h-[18rem] flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center"
            role="alert"
          >
            <div className="grid gap-1">
              <p className="text-sm font-semibold text-rose-200">
                要領書の取得に失敗しました。
              </p>
              {procedureSequenceState.error !== '要領書の取得に失敗しました。' ? (
                <p className="text-xs text-white/65">{procedureSequenceState.error}</p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="primary"
              className="min-h-10"
              onClick={retryProcedureSequence}
            >
              再試行
            </Button>
          </div>
        ) : (
          <div
            className="flex h-full min-h-[18rem] items-center justify-center bg-slate-950 text-sm font-semibold text-cyan-100"
            role="status"
          >
            要領書を準備しています
          </div>
        )}
      </div>
    </section>
  );
}
