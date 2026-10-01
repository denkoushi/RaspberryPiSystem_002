import { useState } from 'react';

import { AssemblyHomeBoard, AssemblyLotRegisterRail } from '../../features/assembly';

import type { AssemblyHomeLotRowView, AssemblyHomeUnitState, AssemblyHomeUnitView } from '../../features/assembly';
import type { AssemblySeibanCandidateDto } from '../../features/assembly/types';

type UnitSeed = [state: AssemblyHomeUnitState, operatorName?: string, accepted?: number, total?: number];

function row(productNo: string, machineName: string, seeds: UnitSeed[]): AssemblyHomeLotRowView {
  const units = seeds.map<AssemblyHomeUnitView>(([state, operatorName, accepted = 0, total = 0], index) => {
    const label = String(index + 1).padStart(3, '0');
    return {
      key: `${productNo}-${label}`,
      workUnitId: `unit-${productNo}-${label}`,
      workId: `${productNo}-${label}`,
      label,
      state,
      stateLabel: state === 'before' ? '着手前' : state === 'wip' ? '仕掛中' : state === 'done' ? '承認済み' : '完了',
      lotId: `lot-${productNo}`,
      lotSerialId: `serial-${productNo}-${label}`,
      sessionId: state === 'before' ? null : `session-${productNo}-${label}`,
      operatorName: operatorName ?? null,
      progressText: total > 0 ? `${accepted}/${total}` : null,
      progressPercent: total > 0 ? Math.round((accepted / total) * 100) : 0,
      details: [
        { label: '作業者', value: operatorName ?? '開始時にNFC確認' },
        { label: 'テンプレート', value: `${machineName} 標準 v2` }
      ]
    };
  });
  return {
    id: `lot-${productNo}`,
    productNo,
    machineName,
    totalCount: units.length,
    finishedCount: units.filter((unit) => unit.state === 'done' || unit.state === 'pending').length,
    units
  };
}

const previewRows: AssemblyHomeLotRowView[] = [
  row('DA4K0312', 'DX-200 主軸ユニット', [['done', '佐藤'], ['done', '佐藤'], ['pending', '田中'], ['wip', '佐藤', 9, 12], ['wip', '田中', 3, 12], ['before'], ['before'], ['before']]),
  row('DA4K0298', 'DX-200 送り軸ブラケット', [['pending', '鈴木'], ['pending', '鈴木'], ['wip', '鈴木', 5, 6], ['before']]),
  row('GB2M1175', 'GR-80 砥石軸ハウジング', [['before'], ['before'], ['before'], ['before'], ['before'], ['before']]),
  row('GB2M1160', 'GR-80 テーブルベース', [['done', '高橋'], ['done', '高橋'], ['done', '高橋'], ['wip', '高橋', 14, 18]]),
  row('HC7P0044', 'HM-500 ATCアーム', [['done', '伊藤'], ['pending', '伊藤']])
];

const template = { id: 't1', modelCode: 'DX-200', procedurePattern: '標準', name: 'DX-200 主軸ユニット 標準', version: 2 };
const previewCandidates: AssemblySeibanCandidateDto[] = [
  { fseiban: 'DA4K0320', machineName: 'DX-200 主軸ユニット', machineNameSource: 'production_schedule', activeTemplate: template },
  { fseiban: 'DA4K0327', machineName: 'DX-200 クーラントマニホールド', machineNameSource: 'production_schedule', activeTemplate: template },
  { fseiban: 'DA4M0051', machineName: 'DX-350 主軸ユニット', machineNameSource: 'production_schedule', activeTemplate: null }
];

/** 組立ホームの見た目確認用（APIなし・例データ）。 */
export function KioskAssemblyHomePreviewPage() {
  const [fseiban, setFseiban] = useState('DA4');
  const [selected, setSelected] = useState<AssemblySeibanCandidateDto | null>(previewCandidates[0]!);
  const [manual, setManual] = useState(false);
  const quantity = 6;
  const workIds = selected ? Array.from({ length: quantity }, (_, index) => `${selected.fseiban}-${String(index + 1).padStart(3, '0')}`) : [];

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-[#0f1317] text-[#eef3f6]">
      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-auto xl:grid-cols-[minmax(0,1fr)_27rem] xl:overflow-hidden">
        <AssemblyHomeBoard
          rows={previewRows}
          loading={false}
          busySerialId={null}
          onReload={() => undefined}
          onStartSerial={() => undefined}
          onInvalidate={() => undefined}
        />
        <AssemblyLotRegisterRail
          fseibanInput={fseiban}
          normalizedFseiban={fseiban}
          onFseibanInputChange={setFseiban}
          onFseibanKey={(key) => setFseiban((current) => current + key)}
          onFseibanBackspace={() => setFseiban((current) => current.slice(0, -1))}
          onFseibanClear={() => setFseiban('')}
          candidates={previewCandidates.filter((candidate) => candidate.fseiban.startsWith(fseiban))}
          candidateLoading={false}
          selectedCandidate={selected}
          onSelectCandidate={setSelected}
          workIdMode={manual ? 'manual' : 'auto'}
          onWorkIdModeChange={(mode) => setManual(mode === 'manual')}
          serialDraft=""
          serialNos={workIds}
          expectedLotQuantity={selected ? quantity : null}
          serialDraftDuplicate={false}
          onSerialDraftChange={() => undefined}
          onSerialKey={() => undefined}
          onSerialBackspace={() => undefined}
          onSerialClear={() => undefined}
          onSerialAdd={() => undefined}
          onSerialRemove={() => undefined}
          autoLotQty={selected ? quantity : null}
          manualLotQtyDraft=""
          onManualLotQtyDraftChange={() => undefined}
          lotQtyLoading={false}
          canRegisterLot={!!selected?.activeTemplate}
          busy={false}
          onRegisterLot={() => undefined}
        />
      </main>
    </div>
  );
}
