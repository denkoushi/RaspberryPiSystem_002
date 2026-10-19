import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getTagDeskPositionRanks, getTagDeskRegistry, saveTagDeskPositionRanks } from '../../../api/domains/tag-desk';
import { tagDeskQueryKeys } from '../../../api/queryKeys/tagDesk';

import { PositionRankEditor } from './PositionRankEditor';
import { positionRankRows } from './positionRankModel';
import { tagDesk } from './tagDeskTheme';

export function TagDeskPositionRanks({ pin, onBack }: { pin: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const mapping = useQuery({ queryKey: tagDeskQueryKeys.positionRanksAll, queryFn: () => getTagDeskPositionRanks(pin) });
  const employees = useQuery({ queryKey: tagDeskQueryKeys.registry('employee'), queryFn: () => getTagDeskRegistry(pin, 'employee') });
  return (
    <div className={`-mx-4 -my-4 flex min-h-0 flex-1 justify-center p-5 ${tagDesk.ink}`}>
      {mapping.data && employees.data ? <PositionRankEditor
        initialRows={positionRankRows(mapping.data, employees.data)} employeeTotal={employees.data.length} onBack={onBack}
        onSave={async body => {
          await saveTagDeskPositionRanks(pin, body);
          await Promise.all(['position-ranks', 'registry', 'options', 'tag'].map(key => queryClient.invalidateQueries({ queryKey: tagDeskQueryKeys.section(key) })));
        }}
      /> : <div className={`w-full max-w-[1280px] p-6 text-white ${tagDesk.panel}`}>
        <button type="button" className={`${tagDesk.btn} ${tagDesk.ghost}`} onClick={onBack}>戻る</button>
        {mapping.isError || employees.isError ? <><p role="alert" className="mt-4 text-[#ffb547]">職位の対応表を取得できませんでした</p><button type="button" className={`${tagDesk.btn} ${tagDesk.ghost} mt-3`} onClick={() => { void mapping.refetch(); void employees.refetch(); }}>再試行</button></> : <p role="status" className={`mt-4 ${tagDesk.mute}`}>読み込んでいます…</p>}
      </div>}
    </div>
  );
}
