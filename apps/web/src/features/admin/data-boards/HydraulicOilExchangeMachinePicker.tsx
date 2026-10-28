import { useMachines } from '../../../api/hooks/tools';
import { extractHydraulicOilTargetSet, toggleHydraulicOilTarget } from '../visualization-dashboards/visualizationDashboardFormModel';

import { isEditableJson } from './graphFieldModel';

export function HydraulicOilExchangeMachinePicker({ config, onChange }: { config: string; onChange: (config: string) => void }) {
  const query = useMachines();
  const selected = extractHydraulicOilTargetSet(config);
  const editable = isEditableJson(config);
  const machines = (query.data ?? []).filter((machine) => {
    const name = machine.name.normalize('NFKC').toUpperCase().replace(/\s/g, '');
    return !name.includes('ROBODRILL') && !name.includes('ロボドリル');
  }).sort((a, b) => Number(b.operatingStatus === '稼働中') - Number(a.operatingStatus === '稼働中')
    || a.equipmentManagementNumber.localeCompare(b.equipmentManagementNumber, 'ja', { numeric: true }));
  const knownNumbers = new Set((query.data ?? []).map((machine) => machine.equipmentManagementNumber));
  const choices = [
    ...machines,
    ...[...selected].filter((number) => !knownNumbers.has(number)).map((number) => ({ equipmentManagementNumber: number, name: number })),
  ];

  return (
    <div className="sh-fld" role="group" aria-labelledby="sh-gb-hydraulic-targets" style={{ width: '100%', maxWidth: 640 }}>
      <div className="sh-row-between">
        <span id="sh-gb-hydraulic-targets" className="sh-flbl">対象の加工機</span>
        <span className="sh-item-meta">{selected.size} 台選択</span>
      </div>
      {query.isError && <span className="sh-error">加工機の一覧を取得できませんでした。</span>}
      <div aria-busy={query.isLoading} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
        {choices.map((machine) => {
          const number = machine.equipmentManagementNumber;
          const name = machine.name.trim().replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ').toUpperCase();
          return (
            <button
              key={number}
              type="button"
              className="sh-pill"
              aria-pressed={selected.has(number)}
              disabled={!editable || (!selected.has(number) && selected.size >= 200)}
              onClick={() => onChange(toggleHydraulicOilTarget(config, number))}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0, borderRadius: 8, height: 'auto', minHeight: 44, padding: '6px 10px' }}
              title={name}
            >
              <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              <span className="sh-item-meta" style={{ fontSize: 10, color: 'inherit', opacity: 0.7 }}>{number}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
