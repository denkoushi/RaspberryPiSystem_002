import type { CheckItem } from './checkSheetState';
import type { AssemblyCheckSheetPayload, AssemblyCheckSheetStampPayload } from '@raspi-system/shared-types';
type MockItem = { q?: string; cond?: string; ci?: number; role?: string; rev?: string; note?: string;
  f?: { l: string; u?: string; n?: number; w?: number }[]; s?: string[]; x?: string[]; noOkNg?: number };
// Synthetic data from the approved screen mock, not a customer workbook.
const groups: [string, MockItem[]][] = [
 ['ユニット（LMガイド、ボールねじ）',[
  {q:'摺動抵抗のバラツキは無いか'},{q:'トルク、引っ掛かり、芯振れは無いか'},{q:'締付けトルク、マーキング[青色・白色]は良いか'},{q:'ボールの脱落はないか'},
  {q:'ロックナットは確実に締め付けられているか',f:[{l:'締結トルク',u:'N·m',n:1}]}]],
 ['リニア',[
  {q:'マグネット取付け精度は良いか'},{q:'固定子と可動子の隙間はあるか'},{q:'リニアヘッド取付け精度は良いか'},{q:'スケール取付け精度は良いか'},{q:'リニアモータ向きは良いか'},{q:'リニアヘッドは調整取り外しが出来るか'},{q:'リファレンスマークは取り付けたか'},
  {q:'使用ボルトは合っているか',f:[{l:'ボルト',w:1},{l:'区分'}]},{q:'締付トルクは規定表を確認したか'},
  {q:'リニアスケール貼り付け方向を上長と確認したか',role:'上長'}]],
 ['給油及び配管',[{q:'配管の干渉は無いか'},{q:'油、グリスの量及び漏れは無いか'}]],
 ['エアー関係',[{q:'各部継手エアー漏れは無いか'},{q:'エアー設定値は良いか',f:[{l:'設定値',u:'MPa',n:1}]},{q:'エアーシリンダーセンサー図面通りに付いているか'}]],
 ['ネジマーキング',[{q:'締付け完了ボルトにマーキング[青色・白色]がされているか'},{q:'締付け完了ボルトを最終チェックしピンクマーカをする'}]],
 ['電装関係',[
  {q:'ケーブルに異常なねじれ、折れ、切断はないか'},{q:'バルブ（VAC.CDA）のテスター確認'},
  {q:'ドライバー入力電圧確認',f:[{l:'電圧',u:'V',n:1}]},{q:'センサーとドグが干渉なく感知するか',f:[{l:'センサー',u:'個',n:1}]},
  {q:'センサー台取付位置は図面通りか　図面寸法通りになっているか',rev:'△1'},{q:'各軸のパラメータ確認'}]],
 ['カップリング・モーター',[
  {q:'取付側軸端及びカップリング内周を清掃後に締付けているか'},
  {cond:'モータブラケットが一体でない場合'},
  {q:'モータ台取付の際、専用の治具を使用する',ci:1},
  {q:'クランプボルトのサイズと締結トルク',ci:1,f:[{l:'M',n:1},{l:'締結トルク',u:'N·m',n:1}],note:'締結トルクはメーカー推奨値参照'},
  {q:'クランプボルトねじロック塗布（納入仕様図参照）',ci:1,s:['有','無'],f:[{l:'メーカー'},{l:'型式'}]},
  {q:'カップリングのボルトを緩めた状態で抵抗なく動くこと',ci:1,f:[{l:'前後方向'},{l:'回転方向'}]},
  {q:'各軸のモータ取付向きを確認したか　納入仕様図と組立図で取付向きが異なっていないか',x:['X','Y','Z','θ','その他']}]],
 ['プーリ、ベルト',[{q:'モータプーリとボールねじプーリの位置はあっているか'},{q:'ベルトのテンションを確認したか',f:[{l:'テンション',u:'N',n:1}]}]],
 ['トップテーブル',[{q:'トップテーブルの取り付け方向は合っているか'}]],
 ['Cキャップ、CVキャップ',[{q:'ガイド面面一に打たれているか'}]],
 ['表面処理',[{q:'剥がれ、傷の確認'}]],
 ['防錆',[{q:'錆の処理、対策はされているか',f:[{l:'処理',w:1}]}]],
 ['立ち合い検査',[{q:'立ち合い時、問題は無かったか'}]],
 ['動作確認',[{q:'異音、異常振動は無いか'},{q:'部品の干渉はないか'},
  {q:'メカストッパー間ストロークの確認',rev:'△1',f:[{l:'X',u:'mm',n:1},{l:'Y',u:'mm',n:1},{l:'Z',u:'mm',n:1},{l:'θ',u:'°',n:1}]},
  {q:'サーボアンプ、モータが複数支給・購入の場合、ユニット1台に対し1セットで動作確認を実施したか'}]],
 ['IOチェック',[{q:'配線した機器の入出力を確認',s:['OK','NG','該当無し'],noOkNg:1,role:'制御設計担当'}]],
 ['最終検査',[{q:'仕様の許容値に合格しているか'}]],
 ['銘番',[{q:'検査成績表と銘番は合っているか'},{q:'決められた場所に貼ってあるか'}]],
 ['提出書類',[{q:'製品に検査成績表が付いているか'},{q:'捺印は確実か、保管は確実か'}]],
 ['出荷',[{q:'決められた梱包方法か'}]],
 ['残部品の確認',[{q:'取付け忘れの部品は無いか'},{q:'取付け忘れの部品は無いか',role:'班長'},{q:'残部品は無いか',role:'係長'}]],
 ['チェックシートの全項目',[{q:'チェックシートの全項目は、適合しているか',role:'係長'}]],
 ['検査成績表とデータ',[{q:'検査成績表とデータの数字は正しいか',role:'係長'}]]
];

export function makeCheckSheetFixture(): AssemblyCheckSheetPayload {
  const items: CheckItem[] = [];
  groups.forEach(([, entries], gi) => {
    let count = 0;
    const condition = entries.find((entry) => entry.cond)?.cond;
    entries.filter((entry) => entry.q).forEach((entry) => {
      const key = `${gi + 1}-${++count}`;
      items.push({ id: key, groupId: `group-${gi}`, groupNo: gi + 1, sortOrder: items.length,
        itemKey: key, label: entry.q!, note: entry.note ?? null,
        inputKind: entry.s || entry.x ? 'CHOICE' : entry.f ? entry.f.every((field) => field.n) ? 'NUMBER' : 'TEXT' : 'OK_NG',
        inputSpec: { ...(entry.f ? { fields: entry.f.map((field, i) => ({ key: `value${i}`, label: field.l, unit: field.u })) } : {}),
          ...(entry.s || entry.x ? { options: entry.s ?? entry.x } : {}) },
        roleKeys: entry.role ? [{ 班長: 'leader', 上長: 'leader', 係長: 'section_chief' }[entry.role] ?? entry.role] : [],
        conditionKey: entry.ci ? 'motor' : null, conditionLabel: entry.ci ? condition! : null,
        sourceRows: [items.length + 8], stampCell: `S${items.length + 8}`,
        valueTarget: { mode: 'cell', cell: `F${items.length + 8}` }, warnings: []
      });
    });
  });
  const stamps = items.filter((item) => item.groupNo <= 5 || ['6-1', '6-2'].includes(item.id)).map((item) => makeStamp(item.id));
  const flagged = stamps.find((stamp) => stamp.itemId === '4-2')!;
  Object.assign(flagged, { result: 'NG', flagged: true, values: { value0: 0.50 }, ngReason: '図面は 0.45 MPa' });
  return { id: 'sheet', workUnitId: 'unit', revisionId: 'revision', status: 'IN_PROGRESS',
    startedAt: '2026-10-29T00:00:00Z', completedAt: null, pausedReason: null,
    headerValues: { seiban: 'BA2610-0418', productNo: '0418-01', productName: 'XYZ 3軸ユニット', shipDate: '11/06' }, stamps,
    revision: { id: 'revision', revisionRootId: 'root', revisionNumber: 1, isRevisionHead: true,
      sourceAssetId: 'asset', sourceSheetName: 'チェックシート', createdByUserId: 'admin', createdAt: '2026-10-29T00:00:00Z', layoutSnapshot: null,
      documentNo: '産3-A002BBC-1', title: '組立最終検査チェックシート', modelCode: 'XYZ-300', revisionLabel: '△1 2026.10.15',
      headerCellMap: {}, departmentRoleMembers: {}, stampColumn: 'S',
      groups: groups.map(([label], gi) => ({ id: `group-${gi}`, groupNo: gi + 1, label, sortOrder: gi })), items }
  };
}
export function makeStamp(itemId: string): AssemblyCheckSheetStampPayload {
  return { id: `stamp-${itemId}`, itemId, result: 'OK', values: {}, flagged: false, ngReason: null,
    employeeId: 'employee', employeeCodeSnapshot: 'E001', employeeNameSnapshot: '山田 一郎', positionNameSnapshot: null,
    stampedAt: '2026-10-29T00:12:00Z' };
}
