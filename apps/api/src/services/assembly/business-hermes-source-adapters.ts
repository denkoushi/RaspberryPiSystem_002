import { sourceFingerprint } from './business-hermes-source-identity.js';

export type BusinessHermesSourceKind = 'nonconformity' | 'work_instruction';
export const BUSINESS_HERMES_SOURCE_DEFINITION_VERSION = 1 as const;

export type BusinessHermesSourceDefinition = {
  version: typeof BUSINESS_HERMES_SOURCE_DEFINITION_VERSION;
  kind: BusinessHermesSourceKind;
  description: string;
  requestHints: ReadonlyArray<string>;
  recordUnit: string;
  identity: {
    primary: string;
    lookup: string;
  };
  fields: ReadonlyArray<{
    name: string;
    meaning: string;
    dateMeaning?: string;
    searchable?: boolean;
    nullable?: boolean;
  }>;
  candidateFields: ReadonlyArray<{
    name: string;
    codeField?: string;
    source: string;
  }>;
  relationKeys: ReadonlyArray<{
    key: string;
    target: string;
    rule: string;
  }>;
  operations: ReadonlyArray<{
    name: string;
    use: string;
  }>;
  constraints: ReadonlyArray<string>;
};

/**
 * The source contract is shared by live MCP search, Hermes context, and
 * background preparation. It describes how to read a source; it is not a
 * second business-data catalogue and contains no generated answers.
 */
export const businessHermesSourceDefinitions: Readonly<Record<BusinessHermesSourceKind, BusinessHermesSourceDefinition>> = {
  nonconformity: {
    version: BUSINESS_HERMES_SOURCE_DEFINITION_VERSION,
    kind: 'nonconformity',
    description: '最新取込で有効なScawStFutekigoCurrentの不適合記録。過去の記録済み内容であり、現在の作業指示や責任部署の確定情報ではない。',
    requestHints: ['不適合', '不具合', '処置', '是正', '起因部署', '責任部署', '発見日'],
    recordUnit: '1行 = 1件の不適合記録',
    identity: {
      primary: 'id（内部レコード識別子）',
      lookup: 'business_hermes_get_detailのidはidまたは不適合番号nonconformityNo'
    },
    fields: [
      { name: 'id', meaning: '内部レコード識別子' },
      { name: 'evidenceKey', meaning: '取得済み根拠を表示指定するkind:idキー。利用者向け本文には表示しない' },
      { name: 'nonconformityNo', meaning: '不適合番号。記録を利用者へ説明するときの業務番号', searchable: true },
      { name: 'partNumber', meaning: '品番。空欄になり得る。値が返ったときだけ公開作業要領との照合キーにできる', searchable: true, nullable: true },
      { name: 'partName', meaning: '記録された品名', searchable: true, nullable: true },
      { name: 'machineName', meaning: '記録された機械名。公開作業要領の対象工程とは同一とは限らない', searchable: true, nullable: true },
      { name: 'originDepartmentCode', meaning: '記録された起因部署コード。責任部署や処置担当ではない', searchable: true, nullable: true },
      { name: 'originDepartmentName', meaning: '記録された起因部署名。責任部署や処置担当ではない', searchable: true, nullable: true },
      { name: 'condition', meaning: '不適合内容。検索のcondition条件はこの欄だけを対象にする', searchable: true, nullable: true },
      { name: 'remarks', meaning: '備考。空欄は未記録を示し、未実施を意味しない', searchable: true, nullable: true },
      { name: 'correctiveContent', meaning: '個別是正内容1・2を連結した表示。処置内容欄とは別項目', searchable: true, nullable: true },
      { name: 'disposition', meaning: '処置内容。空欄は未記録を示し、処置未実施を意味しない', searchable: true, nullable: true },
      { name: 'discoveredOn', meaning: '不適合の発見日。dateFrom/dateToの包含範囲で絞る日付', dateMeaning: '発見日', nullable: true },
      { name: 'sourceVersionDate', meaning: '元データの更新日。発見日ではない', dateMeaning: '元データの版・鮮度', nullable: true },
      { name: 'provenance', meaning: '取得元と最新取込状態を示す由来情報' }
    ],
    candidateFields: [
      { name: 'nonconformityNo', source: 'ScawStFutekigoCurrent' },
      { name: 'partNumber', source: 'ScawStFutekigoCurrent' },
      { name: 'originDepartmentName', codeField: 'originDepartmentCode', source: 'ScawStFutekigoCurrent' }
    ],
    relationKeys: [
      { key: 'partNumber', target: 'work_instruction.partNumber', rule: '両方の検索結果に同じ正規化済み品番が実際に存在するときだけ横断する。共通文字や機械名では結合しない' }
    ],
    operations: [
      { name: 'business_hermes_describe_sources', use: '項目意味、日付、関連キー、認可境界を確認する' },
      { name: 'business_hermes_search', use: 'partNumber、nonconformityNo、起因部署、condition、dateFrom/dateTo、query、limit、nonconformityOffsetで最新有効行を検索する。nextCursor.nonconformityOffsetを次の値に使う' },
      { name: 'business_hermes_get_detail', use: '検索結果のidまたは不適合番号で1行の詳細を再取得する' }
    ],
    constraints: [
      'partNumberは既存の正規化後に専用条件で完全一致し、nonconformityNoとoriginDepartmentCodeは専用条件で完全一致する。originDepartmentName、query、conditionは大文字小文字を区別しない部分一致で、query中の空白はAND条件ではない',
      '検索結果はdiscoveredOn降順（nullは最後）、同値時はnonconformityNo降順で並ぶ',
      'isPresentInLatestSnapshot=trueの行だけを対象にし、記録のない原因・責任部署・対策を補わない',
      '結果のtotal、hasMore、nextCursorを無視して件数や最新性を断定しない'
    ]
  },
  work_instruction: {
    version: BUSINESS_HERMES_SOURCE_DEFINITION_VERSION,
    kind: 'work_instruction',
    description: 'WorkInstructionSourcePublicationが指す公開済み改訂の有効本文。未公開取込や下書きは含めない。',
    requestHints: ['作業要領', '要領', '手順', '公開'],
    recordUnit: '1資料 = 1品番・shootingTargetの公開グループ（行と手順を含む）',
    identity: {
      primary: 'partNumber + shootingTarget（公開グループ）',
      lookup: 'business_hermes_get_detailはグループのrow id、またはpartNumber + shootingTargetで取得する'
    },
    fields: [
      { name: 'id', meaning: '公開グループの代表row識別子' },
      { name: 'partNumber', meaning: '公開資料の対象品番。横断検索に使える実在キー', searchable: true },
      { name: 'shootingTarget', meaning: '撮影対象・工程の分類。公開グループの識別項目', searchable: true },
      { name: 'source', meaning: '取込元のシステム・リスト・項目識別情報。原資料の出所', nullable: true },
      { name: 'sourceVersionDate', meaning: '取込元の更新日。公開操作日や手順の実施日ではない', dateMeaning: '元データの版・鮮度' },
      { name: 'publishedVersionId', meaning: '公開された版の識別子', nullable: true },
      { name: 'publishedVersionCreatedAt', meaning: '公開版が作成された日時。公開操作の日時とは限らない', dateMeaning: '公開版作成時点', nullable: true },
      { name: 'publishedRevisionId', meaning: '公開改訂の識別子', nullable: true },
      { name: 'publishedRevisionCreatedAt', meaning: '公開改訂が作成された日時。公開操作の日時とは限らない', dateMeaning: '公開改訂作成時点', nullable: true },
      { name: 'steps.id', meaning: '公開手順レコードの識別子' },
      { name: 'steps.evidenceKey', meaning: '表示する手順を指定するwork_instruction:steps.id' },
      { name: 'steps.step', meaning: '原資料に記録された手順番号。一覧の並び順から再採番しない', nullable: true },
      { name: 'steps.effectiveText', meaning: '公開編集を反映した現在の本文。memoOverrideが空文字でも有効な上書き', searchable: true, nullable: true },
      { name: 'steps.imageAssetId', meaning: '手順に対応するACTIVE写真アセットの識別子。URLはAPIが生成する', nullable: true },
      { name: 'steps.imageUrl', meaning: 'APIが返した表示用URL。モデルが創作するURLではない', nullable: true }
    ],
    candidateFields: [
      { name: 'partNumber', source: 'WorkInstructionSourcePublication' },
      { name: 'shootingTarget', source: 'WorkInstructionSourcePublication' }
    ],
    relationKeys: [
      { key: 'partNumber', target: 'nonconformity.partNumber', rule: '両方の検索結果に同じ正規化済み品番が実際に存在するときだけ横断する。shootingTargetや共通文字だけでは結合しない' }
    ],
    operations: [
      { name: 'business_hermes_describe_sources', use: '公開境界、単位、版日付、手順識別子を確認する' },
      { name: 'business_hermes_search', use: '公開effectiveText、partNumber、shootingTargetを既存の文字検索で検索し、limitとworkInstructionOffsetでページを進める。nextCursor.workInstructionOffsetを次の値に使う' },
      { name: 'business_hermes_get_detail', use: '公開グループのrow id、またはpartNumber + shootingTargetで行・手順・ACTIVE写真を取得する' }
    ],
    constraints: [
      'latest imported drafts are excluded',
      'sourceVersionDate is the immutable source modified date; publishedVersionCreatedAt and publishedRevisionCreatedAt identify public publication provenance',
      'memoOverride replaces source text, including an empty override',
      'only ACTIVE image assets are exposed',
      'the group id is used for detail lookup; use each steps.evidenceKey to select a displayed step',
      'partNumberとshootingTargetの専用条件は正規化後の完全一致。queryはpartNumber、shootingTarget、effectiveTextの大文字小文字を区別しない部分一致で、空白はAND条件ではない',
      '公開されたeffectiveTextだけを使い、元の取込本文・下書き・非ACTIVE写真と混ぜない',
      '手順番号、O番号、数値、単位、条件、順序を本文から推測・再構成しない'
    ]
  }
};

export function businessHermesSourceDefinitionList(): ReadonlyArray<BusinessHermesSourceDefinition> {
  return Object.values(businessHermesSourceDefinitions);
}

export function businessHermesSourceDefinition(kind: string): BusinessHermesSourceDefinition | undefined {
  return Object.hasOwn(businessHermesSourceDefinitions, kind)
    ? businessHermesSourceDefinitions[kind as BusinessHermesSourceKind]
    : undefined;
}

/** Table-specific fields stop here. Learning/search use SourceDocument only. */
export type SourceDocument = {
  kind: string; id: string; title: string; text: string; identifiers: string[]; revision?: string;
};
type SourceAdapter = {
  cursorKey: string; sourceKey: string;
  project: (record: Record<string, unknown>) => { title: string; answerScope: string; searchText: string; evidence: Record<string, unknown>; identifiers: string[] };
};
export const businessSourceAdapters: Readonly<Record<string, SourceAdapter>> = {
  nonconformity: {
    cursorKey: 'nonconformityOffset', sourceKey: 'nonconformity',
    project: (r) => ({
      answerScope: '記録' + r.nonconformityNo,
      searchText: ['nonconformityNo', 'partNumber', 'condition', 'remarks', 'correctiveContent'].map((k) => String(r[k] || '')).join('\n'),
      title: '記録' + r.nonconformityNo + '：' + (r.remarks || r.condition || '記録の内容'),
      evidence: Object.fromEntries(['kind', 'id', 'nonconformityNo', 'partNumber', 'condition', 'remarks', 'correctiveContent', 'disposition'].map((k) => [k, r[k]])),
      identifiers: [String(r.partNumber || ''), String(r.nonconformityNo || '')].filter(Boolean)
    })
  },
  work_instruction: {
    cursorKey: 'workInstructionOffset', sourceKey: 'workInstruction',
    project: (r) => ({
      answerScope: '公開要領：' + r.partNumber + '・' + r.shootingTarget,
      searchText: [r.partNumber, r.shootingTarget, ...(r.rows as Array<{ steps: Array<{ effectiveText: string }> }>).flatMap((row) => row.steps.map((s) => s.effectiveText))].join('\n'),
      title: '公開要領：' + r.partNumber + '・' + r.shootingTarget,
      evidence: { kind: r.kind, id: r.id, partNumber: r.partNumber, shootingTarget: r.shootingTarget,
        steps: (r.rows as Array<{ steps: Array<{ step: number; effectiveText: string }> }>).flatMap((row) => row.steps.map((s) => ({ step: s.step, text: s.effectiveText }))) },
      identifiers: [String(r.partNumber || '')].filter(Boolean)
    })
  }
};

export function projectBusinessSource(record: Record<string, unknown>) {
  const kind = String(record.kind);
  if (!Object.hasOwn(businessSourceAdapters, kind) || typeof record.id !== 'string') throw new Error('Unsupported business source');
  return businessSourceAdapters[kind]!.project(record);
}

export function sourceDocument(record: Record<string, unknown>): SourceDocument {
  const projected = projectBusinessSource(record);
  return { kind: String(record.kind), id: String(record.id), title: projected.title.replace(/\s+/g, ' ').slice(0, 100),
    text: projected.searchText, identifiers: projected.identifiers, revision: sourceFingerprint(record) };
}
