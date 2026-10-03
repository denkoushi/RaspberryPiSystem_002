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

const B: UnitSeed = ['before'];
const D: UnitSeed = ['done', '佐藤'];
const P: UnitSeed = ['pending', '田中'];
const previewRows: AssemblyHomeLotRowView[] = [
  row('B260401', 'MH-2200 搬送装置', [D, D, P, ['wip', '佐藤', 9, 12], ['wip', '田中', 3, 12], B, B, B]),
  row('B260402', 'MH-2200 搬送装置 昇降ユニット', [P, P, ['wip', '鈴木', 5, 6], B]),
  row('A260312', '小型治具ユニット', [B, B, B, B, B, B]),
  row('A260315', '小型治具ユニット 左勝手', [D, D, D, ['wip', '高橋', 14, 18]]),
  row('C260118', 'GR-80 砥石軸ハウジング', [D, P]),
  row('C260121', 'GR-80 テーブルベース', [D, D, ['wip', '伊藤', 2, 8], B, B]),
  row('C260122', 'GR-80 ドレッサーブラケット', [B, B, B]),
  row('D260044', 'DX-200 主軸ユニット', [D, D, D, D]),
  row('D260047', 'DX-200 送り軸ブラケット（Z軸・カバー付）', [['wip', '佐藤', 1, 10], B, B, B]),
  row('D260051', 'DX-200 クーラントマニホールド', [B, B]),
  row('D260052', 'DX-350 主軸ユニット', [P, ['wip', '田中', 7, 24], B]),
  row('E260203', 'HM-500 ATCアーム', [D, P, P]),
  row('E260207', 'HM-500 パレットクランプ', [D, D, ['wip', '鈴木', 2, 8], B, B]),
  row('E260210', 'HM-500 マガジンベース', [B, B, B, B]),
  row('F260009', 'LT-40 刃物台ベース', [B, B, B]),
  row('F260011', 'LT-40 心押台', [D, D, D, D]),
  row('F260014', 'LT-40 主軸台カバー', [P]),
  row('G260330', 'SP-12 スピンドルカートリッジ', [['wip', '高橋', 20, 22], B]),
  row('G260331', 'SP-12 冷却ジャケット', [B, B]),
  row('H260071', '治具プレート A（溶接後加工品）', [D, P]),
  row('H260072', '治具プレート B', [B]),
  row('J260415', 'CV-7 コンベヤ駆動部', [D, D, B, B]),
  row('J260416', 'CV-7 テンションユニット', [['wip', '伊藤', 4, 6]]),
  row('K260002', '検査台 フレーム組立', [B, B])
];

const template = { id: 't1', modelCode: 'DX-200', procedurePattern: '標準', name: 'DX-200 主軸ユニット 標準', version: 2 };
const previewCandidates: AssemblySeibanCandidateDto[] = [
  { fseiban: 'B260403', machineName: 'MH-2200 搬送装置', machineNameSource: 'production_schedule', activeTemplate: template },
  { fseiban: 'B260404', machineName: 'MH-2200 搬送装置 昇降ユニット', machineNameSource: 'production_schedule', activeTemplate: template },
  { fseiban: 'B260405', machineName: 'MH-3000 搬送装置', machineNameSource: 'production_schedule', activeTemplate: null }
];

/** 組立ホームの見た目確認用（APIなし・例データ）。 */
export function KioskAssemblyHomePreviewPage() {
  const [fseiban, setFseiban] = useState('B2604');
  const [selected, setSelected] = useState<AssemblySeibanCandidateDto | null>(previewCandidates[0]!);
  const [manual, setManual] = useState(false);
  const [quantity, setQuantity] = useState(6);
  const workIds = selected ? Array.from({ length: quantity }, (_, index) => `${selected.fseiban}-${String(index + 1).padStart(3, '0')}`) : [];

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-[#0f1317] text-[#eef3f6]">
      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-auto xl:grid-cols-[minmax(0,1fr)_22rem] xl:overflow-hidden">
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
          autoLotQty={selected ? 6 : null}
          onAdjustLotQty={(delta) => setQuantity((current) => Math.max(1, current + delta))}
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
