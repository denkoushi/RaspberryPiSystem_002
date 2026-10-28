import { useMachines } from '../../../api/hooks/tools';
import { extractHydraulicOilTargetSet, parseJson, toggleHydraulicOilTarget } from '../visualization-dashboards/visualizationDashboardFormModel';

import { isEditableJson, readJsonField, writeJsonField } from './graphFieldModel';

export function HydraulicOilExchangeMachinePicker({ config, onChange }: { config: string; onChange: (config: string) => void }) {
  const query = useMachines();
  const selected = extractHydraulicOilTargetSet(config);
  const editable = isEditableJson(config);
  const parsed = parseJson(config, '').value;
  const dates = parsed?.manualLastExchangeDates;
  const manualDates = dates && typeof dates === 'object' && !Array.isArray(dates) ? dates as Record<string, unknown> : {};
  const setDate = (number: string, date: string) => {
    if (!parsed) return;
    const nextDates = { ...manualDates };
    if (date) nextDates[number] = date;
    else delete nextDates[number];
    onChange(JSON.stringify({ ...parsed, manualLastExchangeDates: nextDates }, null, 2));
  };
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span className="sh-flbl" style={{ marginRight: 'auto' }}>前回交換日</span>
        <label className="sh-flbl" htmlFor="sh-gb-hydraulic-cycle">交換周期</label>
        <select
          id="sh-gb-hydraulic-cycle"
          className="sh-input sh-select"
          style={{ width: 96 }}
          value={readJsonField(config, 'defaultCycle') || '半年１回'}
          disabled={!editable}
          onChange={(event) => onChange(writeJsonField(config, { key: 'defaultCycle', kind: 'text' }, event.target.value))}
        >
          <option value="３ヶ月１回">3ヶ月</option>
          <option value="半年１回">半年</option>
          <option value="年１回">1年</option>
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
        {[...selected].map((number) => {
          const machine = choices.find((choice) => choice.equipmentManagementNumber === number);
          const name = machine?.name.normalize('NFKC').trim().toUpperCase() || number;
          const date = typeof manualDates[number] === 'string' ? manualDates[number] : '';
          return (
            <div key={number} style={{ minWidth: 0 }}>
              <label className="sh-item-meta" htmlFor={`sh-gb-hydraulic-date-${number}`} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${name} (${number})`}>
                {name === number ? number : `${name} (${number})`}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  id={`sh-gb-hydraulic-date-${number}`}
                  type="date"
                  className="sh-input"
                  style={{ width: 156 }}
                  value={date}
                  disabled={!editable}
                  onChange={(event) => setDate(number, event.target.value)}
                />
                <button type="button" className="sh-pill" aria-label={`${number}の前回交換日をクリア`} disabled={!editable || !date} onClick={() => setDate(number, '')}>×</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
