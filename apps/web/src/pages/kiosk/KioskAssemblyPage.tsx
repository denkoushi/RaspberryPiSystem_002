import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  advanceAssemblyArea,
  completeAssemblyWorkSession,
  createAssemblyTemplate,
  downloadAssemblyWorkSessionXlsx,
  listAssemblyProcedureDocuments,
  listAssemblyTemplates,
  recordAssemblyTorque,
  restartAssemblyArea,
  startAssemblyWorkSession,
  uploadAssemblyProcedureDocument
} from '../../api/client';
import { AssemblyProcedureCanvas, type AssemblyCanvasBolt } from '../../features/assembly/AssemblyProcedureCanvas';

import type {
  AssemblyProcedureDocumentDto,
  AssemblyTemplateAreaInput,
  AssemblyTemplateBoltInput,
  AssemblyTemplateDto,
  AssemblyWorkSessionDto
} from '../../features/assembly/types';

type DraftBolt = AssemblyTemplateBoltInput & { id: string };
type DraftArea = Omit<AssemblyTemplateAreaInput, 'bolts'> & { id: string; bolts: DraftBolt[] };

const emptyArea = (): DraftArea => ({
  id: crypto.randomUUID(),
  sortOrder: 0,
  processNo: '7',
  areaCode: '13',
  areaName: 'ストッパー取付',
  unitCode: 'U1',
  requireManualAdvance: true,
  bolts: []
});

const toNumber = (raw: string | null | undefined, fallback = 0): number => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const formatTighteningId = (area: DraftArea, index: number) =>
  `P${area.processNo}-A${area.areaCode}-U${area.unitCode}-B${index + 1}`;

const latestStatusByBolt = (session: AssemblyWorkSessionDto): Map<string, AssemblyCanvasBolt['status']> => {
  const map = new Map<string, AssemblyCanvasBolt['status']>();
  for (const record of session.torqueRecords) {
    if (record.judgement === 'ok' && record.accepted) map.set(record.templateBoltId, 'ok');
    else if (record.judgement === 'ng') map.set(record.templateBoltId, 'ng');
    else if (record.judgement === 'ignored') map.set(record.templateBoltId, 'ignored');
  }
  if (session.currentBoltId) map.set(session.currentBoltId, 'current');
  return map;
};

function templateToCanvasBolts(template: AssemblyTemplateDto, statusByBolt = new Map<string, AssemblyCanvasBolt['status']>()) {
  return template.areas.flatMap((area) =>
    area.bolts.map((bolt) => ({
      id: bolt.id,
      markerNo: bolt.markerNo,
      xRatio: toNumber(bolt.xRatio),
      yRatio: toNumber(bolt.yRatio),
      label: bolt.tighteningId,
      status: statusByBolt.get(bolt.id) ?? 'pending'
    }))
  );
}

function draftToCanvasBolts(areas: DraftArea[]): AssemblyCanvasBolt[] {
  return areas.flatMap((area) =>
    area.bolts.map((bolt) => ({
      id: bolt.id,
      markerNo: bolt.markerNo,
      xRatio: bolt.xRatio,
      yRatio: bolt.yRatio,
      label: bolt.tighteningId,
      status: 'pending' as const
    }))
  );
}

function currentArea(session: AssemblyWorkSessionDto) {
  return session.template.areas.find((area) => area.id === session.currentAreaId) ?? null;
}

function currentBolt(session: AssemblyWorkSessionDto) {
  return session.template.areas.flatMap((area) => area.bolts).find((bolt) => bolt.id === session.currentBoltId) ?? null;
}

export function KioskAssemblyPage() {
  const [documents, setDocuments] = useState<AssemblyProcedureDocumentDto[]>([]);
  const [templates, setTemplates] = useState<AssemblyTemplateDto[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [documentName, setDocumentName] = useState('組立手順書');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [templateName, setTemplateName] = useState('組立トルクテンプレート');
  const [modelCode, setModelCode] = useState('');
  const [procedurePattern, setProcedurePattern] = useState('手順7');
  const [areas, setAreas] = useState<DraftArea[]>([emptyArea()]);
  const [selectedAreaId, setSelectedAreaId] = useState<string>(() => areas[0]!.id);
  const [selectedBoltId, setSelectedBoltId] = useState<string | null>(null);
  const [session, setSession] = useState<AssemblyWorkSessionDto | null>(null);
  const [startForm, setStartForm] = useState({
    productNo: '',
    serialNo: '',
    nameplateNo: '',
    operatorNameSnapshot: '',
    targetUnit: '',
    torqueWrenchId: 'CEM20N3X10D-BTLA'
  });
  const [torqueValue, setTorqueValue] = useState('');
  const [torqueSource, setTorqueSource] = useState<'manual' | 'mock'>('manual');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [nextDocuments, nextTemplates] = await Promise.all([
      listAssemblyProcedureDocuments(),
      listAssemblyTemplates()
    ]);
    setDocuments(nextDocuments);
    setTemplates(nextTemplates);
    setSelectedDocumentId((current) => current || nextDocuments[0]?.id || '');
    setSelectedTemplateId((current) => current || nextTemplates[0]?.id || '');
  }, []);

  useEffect(() => {
    void load().catch(() => setMessage('組立データの読み込みに失敗しました'));
  }, [load]);

  const selectedDocument = useMemo(
    () => documents.find((doc) => doc.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId]
  );
  const selectedArea = areas.find((area) => area.id === selectedAreaId) ?? areas[0]!;
  const selectedBolt = selectedArea.bolts.find((bolt) => bolt.id === selectedBoltId) ?? null;
  const workCurrentArea = session ? currentArea(session) : null;
  const workCurrentBolt = session ? currentBolt(session) : null;
  const statusByBolt = session ? latestStatusByBolt(session) : new Map<string, AssemblyCanvasBolt['status']>();
  const allComplete = session ? session.template.areas.every((area) => area.bolts.every((bolt) => statusByBolt.get(bolt.id) === 'ok')) : false;

  const setAreaPatch = (areaId: string, patch: Partial<DraftArea>) => {
    setAreas((prev) => prev.map((area) => (area.id === areaId ? { ...area, ...patch } : area)));
  };

  const setBoltPatch = (boltId: string, patch: Partial<DraftBolt>) => {
    setAreas((prev) =>
      prev.map((area) => ({
        ...area,
        bolts: area.bolts.map((bolt) => (bolt.id === boltId ? { ...bolt, ...patch } : bolt))
      }))
    );
  };

  const runBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '処理に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const addBoltAt = (xRatio: number, yRatio: number) => {
    const index = selectedArea.bolts.length;
    const next: DraftBolt = {
      id: crypto.randomUUID(),
      sortOrder: index,
      tighteningId: formatTighteningId(selectedArea, index),
      markerNo: index + 1,
      xRatio,
      yRatio,
      boltSpec: 'M6x30',
      nominalTorque: 90,
      lowerLimit: 81,
      upperLimit: 99,
      unit: 'kgf-cm'
    };
    setAreas((prev) => prev.map((area) => (area.id === selectedArea.id ? { ...area, bolts: [...area.bolts, next] } : area)));
    setSelectedBoltId(next.id);
  };

  const saveTemplate = () =>
    runBusy(async () => {
      if (!selectedDocumentId) throw new Error('手順書を選択してください');
      const payload = {
        name: templateName,
        modelCode,
        procedurePattern,
        procedureDocumentId: selectedDocumentId,
        areas: areas.map((area, areaIndex) => ({
          sortOrder: areaIndex,
          processNo: area.processNo,
          areaCode: area.areaCode,
          areaName: area.areaName,
          unitCode: area.unitCode,
          requireManualAdvance: true,
          bolts: area.bolts.map((bolt, boltIndex) => ({ ...bolt, sortOrder: boltIndex }))
        }))
      };
      const saved = await createAssemblyTemplate(payload);
      await load();
      setSelectedTemplateId(saved.id);
      setMessage(`テンプレートを保存しました: ${saved.name} v${saved.version}`);
    });

  const uploadDocument = () =>
    runBusy(async () => {
      if (!uploadFile) throw new Error('手順書ファイルを選択してください');
      const doc = await uploadAssemblyProcedureDocument({ name: documentName, file: uploadFile });
      await load();
      setSelectedDocumentId(doc.id);
      setMessage(`手順書を登録しました: ${doc.name}`);
    });

  const startWork = () =>
    runBusy(async () => {
      if (!selectedTemplateId) throw new Error('テンプレートを選択してください');
      const next = await startAssemblyWorkSession({ ...startForm, templateId: selectedTemplateId });
      setSession(next);
      setMessage('組立作業を開始しました');
    });

  const recordTorque = () =>
    runBusy(async () => {
      if (!session) throw new Error('作業を開始してください');
      const value = Number(torqueValue);
      if (!Number.isFinite(value)) throw new Error('トルク値を入力してください');
      const result = await recordAssemblyTorque(session.id, { value, source: torqueSource });
      setSession(result.session);
      setTorqueValue('');
      if (result.outcome.kind === 'ignored_duplicate') setMessage('1秒以内の再送信として無視しました');
      else if (result.outcome.kind === 'recorded_ng') setMessage(result.outcome.requiresAreaRestart ? 'NGです。上限超過が続いています。エリアやり直しを確認してください。' : 'NGです。同じ箇所で停止します。');
      else setMessage(result.outcome.areaCompleted ? 'エリア完了です。次工程へ進んでください。' : 'OKです。次の締付箇所へ進みました。');
    });

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-slate-950 text-white">
      <header className="shrink-0 border-b border-white/10 bg-slate-900 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">組立トルク管理</h1>
            <p className="text-sm text-white/60">手順書に丸数字を置き、順番どおりに締付値を記録します。</p>
          </div>
          <button
            type="button"
            className="rounded bg-white px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
            disabled={busy || !session}
            onClick={() => session && void downloadAssemblyWorkSessionXlsx(session.id)}
          >
            Excel出力
          </button>
        </div>
        {message ? <div className="mt-2 rounded border border-white/10 bg-white/10 px-3 py-2 text-sm">{message}</div> : null}
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 xl:grid-cols-[minmax(22rem,28rem)_1fr_minmax(22rem,28rem)] xl:overflow-hidden">
        <section className="min-h-0 overflow-y-auto rounded-lg border border-white/10 bg-slate-900 p-3">
          <h2 className="text-base font-semibold">1. ライブラリ</h2>
          <div className="mt-3 space-y-2">
            <input
              className="w-full rounded border border-white/10 bg-slate-950 px-3 py-2 text-sm"
              value={documentName}
              onChange={(event) => setDocumentName(event.target.value)}
              placeholder="手順書名"
            />
            <input
              className="w-full text-sm"
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.pdf,.tif,.tiff,image/*,application/pdf"
              onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              disabled={busy}
              className="w-full rounded bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
              onClick={uploadDocument}
            >
              手順書を登録
            </button>
          </div>

          <label className="mt-5 block text-xs font-semibold text-white/60">手順書</label>
          <select
            className="mt-1 w-full rounded border border-white/10 bg-slate-950 px-3 py-2 text-sm"
            value={selectedDocumentId}
            onChange={(event) => setSelectedDocumentId(event.target.value)}
          >
            {documents.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.name}
              </option>
            ))}
          </select>

          <label className="mt-5 block text-xs font-semibold text-white/60">テンプレート</label>
          <select
            className="mt-1 w-full rounded border border-white/10 bg-slate-950 px-3 py-2 text-sm"
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
          >
            <option value="">未選択</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.modelCode} / {template.procedurePattern} v{template.version}
              </option>
            ))}
          </select>

          <h2 className="mt-6 text-base font-semibold">2. 作業開始</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {([
              ['productNo', '製番/M番号'],
              ['serialNo', 'シリアルNo.'],
              ['nameplateNo', '銘板No.'],
              ['operatorNameSnapshot', '作業者'],
              ['targetUnit', '対象ユニット'],
              ['torqueWrenchId', 'トルクレンチ']
            ] as const).map(([key, label]) => (
              <label key={key} className="text-xs text-white/70">
                {label}
                <input
                  className="mt-1 w-full rounded border border-white/10 bg-slate-950 px-2 py-2 text-sm text-white"
                  value={startForm[key]}
                  onChange={(event) => setStartForm((prev) => ({ ...prev, [key]: event.target.value }))}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || !selectedTemplateId}
            className="mt-3 w-full rounded bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
            onClick={startWork}
          >
            組立開始
          </button>
        </section>

        <section className="flex min-h-[28rem] flex-col overflow-hidden rounded-lg border border-white/10 bg-slate-900 xl:min-h-0">
          <div className="shrink-0 border-b border-white/10 p-3">
            <h2 className="text-base font-semibold">手順書 / 締付位置</h2>
            <div className="mt-1 text-sm text-white/60">
              {session
                ? `${session.productNo} / ${workCurrentBolt?.tighteningId ?? 'エリア完了'}`
                : selectedDocument?.name ?? '手順書未選択'}
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <AssemblyProcedureCanvas
              imageRelativePath={session?.template.procedureDocument.imageRelativePath ?? selectedDocument?.imageRelativePath}
              bolts={session ? templateToCanvasBolts(session.template, statusByBolt) : draftToCanvasBolts(areas)}
              selectedBoltId={session?.currentBoltId ?? selectedBoltId}
              onSelectBolt={session ? undefined : setSelectedBoltId}
              onAddBolt={session ? undefined : addBoltAt}
              className="h-full"
            />
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto rounded-lg border border-white/10 bg-slate-900 p-3">
          {!session ? (
            <>
              <h2 className="text-base font-semibold">3. テンプレート作成</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-xs text-white/70">
                  形番/FHINCD
                  <input className="mt-1 w-full rounded bg-slate-950 px-2 py-2 text-sm" value={modelCode} onChange={(event) => setModelCode(event.target.value)} />
                </label>
                <label className="text-xs text-white/70">
                  手順パターン
                  <input className="mt-1 w-full rounded bg-slate-950 px-2 py-2 text-sm" value={procedurePattern} onChange={(event) => setProcedurePattern(event.target.value)} />
                </label>
                <label className="col-span-2 text-xs text-white/70">
                  テンプレート名
                  <input className="mt-1 w-full rounded bg-slate-950 px-2 py-2 text-sm" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
                </label>
              </div>
              <div className="mt-4 flex gap-2">
                {areas.map((area) => (
                  <button
                    key={area.id}
                    type="button"
                    className={clsx('rounded px-3 py-2 text-xs font-semibold', selectedAreaId === area.id ? 'bg-cyan-400 text-slate-950' : 'bg-slate-800 text-white')}
                    onClick={() => setSelectedAreaId(area.id)}
                  >
                    {area.processNo}-{area.areaCode}
                  </button>
                ))}
                <button
                  type="button"
                  className="rounded bg-slate-700 px-3 py-2 text-xs font-semibold"
                  onClick={() => {
                    const next = { ...emptyArea(), sortOrder: areas.length, processNo: String(areas.length + 1), areaCode: String(areas.length + 1), areaName: `工程${areas.length + 1}` };
                    setAreas((prev) => [...prev, next]);
                    setSelectedAreaId(next.id);
                  }}
                >
                  エリア追加
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {([
                  ['processNo', '工程No.'],
                  ['areaCode', 'エリア'],
                  ['unitCode', 'ユニット'],
                  ['areaName', 'エリア名']
                ] as const).map(([key, label]) => (
                  <label key={key} className="text-xs text-white/70">
                    {label}
                    <input
                      className="mt-1 w-full rounded bg-slate-950 px-2 py-2 text-sm"
                      value={selectedArea[key]}
                      onChange={(event) => setAreaPatch(selectedArea.id, { [key]: event.target.value })}
                    />
                  </label>
                ))}
              </div>

              {selectedBolt ? (
                <div className="mt-4 rounded border border-white/10 bg-slate-950 p-3">
                  <div className="mb-2 text-sm font-semibold">丸数字 {selectedBolt.markerNo}</div>
                  <label className="block text-xs text-white/70">
                    締付ID
                    <input className="mt-1 w-full rounded bg-slate-900 px-2 py-2 text-sm" value={selectedBolt.tighteningId} onChange={(event) => setBoltPatch(selectedBolt.id, { tighteningId: event.target.value })} />
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-xs text-white/70">
                      ボルト
                      <input className="mt-1 w-full rounded bg-slate-900 px-2 py-2 text-sm" value={selectedBolt.boltSpec} onChange={(event) => setBoltPatch(selectedBolt.id, { boltSpec: event.target.value })} />
                    </label>
                    <label className="text-xs text-white/70">
                      単位
                      <input className="mt-1 w-full rounded bg-slate-900 px-2 py-2 text-sm" value={selectedBolt.unit} onChange={(event) => setBoltPatch(selectedBolt.id, { unit: event.target.value })} />
                    </label>
                    {([
                      ['nominalTorque', '規定'],
                      ['lowerLimit', '下限'],
                      ['upperLimit', '上限']
                    ] as const).map(([key, label]) => (
                      <label key={key} className="text-xs text-white/70">
                        {label}
                        <input className="mt-1 w-full rounded bg-slate-900 px-2 py-2 text-sm" value={selectedBolt[key]} onChange={(event) => setBoltPatch(selectedBolt.id, { [key]: Number(event.target.value) })} />
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded border border-dashed border-white/20 p-3 text-sm text-white/60">手順書上をクリックして締付位置を追加</div>
              )}
              <button type="button" disabled={busy} className="mt-4 w-full rounded bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50" onClick={saveTemplate}>
                テンプレート保存
              </button>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold">4. 締付作業</h2>
              <div className="mt-3 rounded bg-slate-950 p-3">
                <div className="text-sm text-white/60">現在</div>
                <div className="mt-1 text-lg font-semibold">{workCurrentBolt?.tighteningId ?? (allComplete ? '全締付完了' : '次工程待ち')}</div>
                <div className="mt-1 text-sm text-white/70">{workCurrentArea?.areaName ?? ''}</div>
                {workCurrentBolt ? (
                  <div className="mt-2 text-sm text-white/80">
                    規定 {workCurrentBolt.nominalTorque} / 下限 {workCurrentBolt.lowerLimit} / 上限 {workCurrentBolt.upperLimit} {workCurrentBolt.unit}
                  </div>
                ) : null}
              </div>
              <div className="mt-3 grid grid-cols-[1fr_6rem] gap-2">
                <input
                  className="rounded bg-slate-950 px-3 py-3 text-lg"
                  value={torqueValue}
                  onChange={(event) => setTorqueValue(event.target.value)}
                  placeholder="トルク値"
                />
                <select className="rounded bg-slate-950 px-2 text-sm" value={torqueSource} onChange={(event) => setTorqueSource(event.target.value as 'manual' | 'mock')}>
                  <option value="manual">手入力</option>
                  <option value="mock">mock</option>
                </select>
              </div>
              <button type="button" disabled={busy || !session.currentBoltId} className="mt-2 w-full rounded bg-emerald-500 px-3 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50" onClick={recordTorque}>
                トルク記録
              </button>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" disabled={busy || Boolean(session.currentBoltId) || allComplete} className="rounded bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50" onClick={() => void runBusy(async () => setSession(await advanceAssemblyArea(session.id)))}>
                  次工程へ
                </button>
                <button type="button" disabled={busy || !session.currentAreaId} className="rounded bg-rose-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void runBusy(async () => setSession(await restartAssemblyArea(session.id, { reason: '画面操作によるエリアやり直し' })))}>
                  エリアやり直し
                </button>
                <button type="button" disabled={busy || !allComplete || session.status !== 'in_progress'} className="col-span-2 rounded bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50" onClick={() => void runBusy(async () => setSession(await completeAssemblyWorkSession(session.id)))}>
                  作業完了
                </button>
              </div>
              <h3 className="mt-5 text-sm font-semibold">履歴</h3>
              <div className="mt-2 max-h-80 overflow-y-auto rounded border border-white/10">
                {session.torqueRecords.slice().reverse().map((record) => (
                  <div key={record.id} className="grid grid-cols-[1fr_4rem_4rem] gap-2 border-b border-white/10 px-3 py-2 text-xs">
                    <div>
                      <div className="font-semibold">{record.tighteningId}</div>
                      <div className="text-white/50">{new Date(record.recordedAt).toLocaleString()}</div>
                    </div>
                    <div>{record.value ?? '-'}</div>
                    <div className={record.judgement === 'ok' ? 'text-emerald-300' : record.judgement === 'ng' ? 'text-rose-300' : 'text-slate-300'}>
                      {record.judgement.toUpperCase()}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
