import { KioskDatePickerModal } from '../../../components/kiosk/KioskDatePickerModal';
import { LeaderBoardDueAssistPanel } from '../leaderOrderBoard/LeaderBoardDueAssistPanel';

import type { DuePickerState, PendingDueScopeUpdate } from './planningBoardPageModel';
import type { PlanningBoardAllocation } from './types';
import type { GrindingPlanningBoardDueDetail, GrindingPlanningBoardDueScope } from '@raspi-system/shared-types';

type Props = {
  dueDetailFseiban: string | null;
  closeDueDetail: () => void;
  dueDetail: GrindingPlanningBoardDueDetail | undefined;
  dueDetailQuery: { isLoading: boolean; isError: boolean };
  pendingDueScope: PendingDueScopeUpdate | null;
  allocation: PlanningBoardAllocation;
  dueConflict: boolean;
  hasPendingSeiban: (fseiban: string) => boolean;
  dueError: string | null;
  refreshDueDetail: () => Promise<void>;
  openDuePicker: (scope: GrindingPlanningBoardDueScope, currentDueDate: string | null) => void;
  duePickerState: DuePickerState | null;
  setDuePickerState: (state: DuePickerState | null) => void;
  commitDueDate: (nextDueDate: string) => void;
};

export function PlanningBoardDuePanels({
  dueDetailFseiban, closeDueDetail, dueDetail, dueDetailQuery, pendingDueScope, allocation,
  dueConflict, hasPendingSeiban, dueError, refreshDueDetail, openDuePicker,
  duePickerState, setDuePickerState, commitDueDate
}: Props) {
  return (
    <>
      {dueDetailFseiban ? (
        <div
          className="fixed inset-0 z-40 bg-black/45"
          role="presentation"
          onClick={closeDueDetail}
        />
      ) : null}
      <div className="fixed inset-y-0 right-0 z-50 flex max-w-full">
        <LeaderBoardDueAssistPanel
          isOpen={dueDetailFseiban !== null}
          selectedFseiban={dueDetailFseiban}
          detail={dueDetail}
          loading={dueDetailQuery.isLoading}
          error={dueDetailQuery.isError}
          dueUpdatePending={pendingDueScope?.fseiban === dueDetailFseiban}
          readOnly={allocation === 'original' || dueConflict || (dueDetailFseiban != null && hasPendingSeiban(dueDetailFseiban)) || pendingDueScope?.fseiban === dueDetailFseiban}
          conflict={dueConflict}
          errorMessage={dueError}
          onRefresh={() => void refreshDueDetail()}
          onClose={closeDueDetail}
          onOpenSeibanDueDatePicker={() => openDuePicker({ kind: 'seiban' }, dueDetail?.dueDate ?? null)}
          onOpenProcessingDueDatePicker={(processingType, currentDueDate) => openDuePicker({ kind: 'processing', processingType }, currentDueDate)}
        />
      </div>
      <KioskDatePickerModal
        isOpen={duePickerState !== null}
        value={duePickerState?.value ?? ''}
        onCancel={() => setDuePickerState(null)}
        onCommit={(next) => void commitDueDate(next)}
        overlayZIndex={60}
      />
    </>
  );
}
