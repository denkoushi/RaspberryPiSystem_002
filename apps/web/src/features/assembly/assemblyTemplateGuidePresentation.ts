import type {
  AssemblyTemplateReadiness,
  AssemblyTemplateReadinessStage,
  AssemblyTemplateReadinessStatus
} from './assemblyTemplateReadiness';

// Display only: do not use this for stored values or search keys.
export function formatAssemblyEditorName(value: string): string {
  return value.replace(/[Ａ-Ｚａ-ｚ０-９\u3000]/g, (character) =>
    character === '　' ? ' ' : String.fromCharCode(character.charCodeAt(0) - 0xfee0)
  );
}

const HALF_WIDTH_KATAKANA: Record<string, string> = {
  ア: 'ｱ', イ: 'ｲ', ウ: 'ｳ', エ: 'ｴ', オ: 'ｵ', カ: 'ｶ', キ: 'ｷ', ク: 'ｸ', ケ: 'ｹ', コ: 'ｺ',
  サ: 'ｻ', シ: 'ｼ', ス: 'ｽ', セ: 'ｾ', ソ: 'ｿ', タ: 'ﾀ', チ: 'ﾁ', ツ: 'ﾂ', テ: 'ﾃ', ト: 'ﾄ',
  ナ: 'ﾅ', ニ: 'ﾆ', ヌ: 'ﾇ', ネ: 'ﾈ', ノ: 'ﾉ', ハ: 'ﾊ', ヒ: 'ﾋ', フ: 'ﾌ', ヘ: 'ﾍ', ホ: 'ﾎ',
  マ: 'ﾏ', ミ: 'ﾐ', ム: 'ﾑ', メ: 'ﾒ', モ: 'ﾓ', ヤ: 'ﾔ', ユ: 'ﾕ', ヨ: 'ﾖ', ラ: 'ﾗ', リ: 'ﾘ',
  ル: 'ﾙ', レ: 'ﾚ', ロ: 'ﾛ', ワ: 'ﾜ', ヲ: 'ｦ', ン: 'ﾝ', ヴ: 'ｳﾞ', ァ: 'ｧ', ィ: 'ｨ', ゥ: 'ｩ',
  ェ: 'ｪ', ォ: 'ｫ', ッ: 'ｯ', ャ: 'ｬ', ュ: 'ｭ', ョ: 'ｮ', ガ: 'ｶﾞ', ギ: 'ｷﾞ', グ: 'ｸﾞ', ゲ: 'ｹﾞ', ゴ: 'ｺﾞ',
  ザ: 'ｻﾞ', ジ: 'ｼﾞ', ズ: 'ｽﾞ', ゼ: 'ｾﾞ', ゾ: 'ｿﾞ', ダ: 'ﾀﾞ', ヂ: 'ﾁﾞ', ヅ: 'ﾂﾞ', デ: 'ﾃﾞ', ド: 'ﾄﾞ',
  バ: 'ﾊﾞ', ビ: 'ﾋﾞ', ブ: 'ﾌﾞ', ベ: 'ﾍﾞ', ボ: 'ﾎﾞ', パ: 'ﾊﾟ', ピ: 'ﾋﾟ', プ: 'ﾌﾟ', ペ: 'ﾍﾟ', ポ: 'ﾎﾟ'
};

/** Machine names are display-only; stored/API values remain unchanged. */
export function formatAssemblyMachineName(value: string): string {
  const ascii = value.replace(/[！-～]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
  return ascii.replace(/[ァ-ヺ]/g, (character) => HALF_WIDTH_KATAKANA[character] ?? character).replace(/ー/g, 'ｰ').replace(/・/g, '･');
}

export function assemblyEditorPageName(label: string, pageIndex: number): string {
  const suffix = ` / ${pageIndex + 1}ページ`;
  return formatAssemblyEditorName(label.endsWith(suffix) ? label.slice(0, -suffix.length) : label);
}

export type AssemblyTemplateGuideStagePresentation = {
  id: AssemblyTemplateReadinessStage;
  step: number;
  label: string;
  status: AssemblyTemplateReadinessStatus;
  statusLabel: string;
};

export type AssemblyTemplateGuidePresentation = {
  stages: AssemblyTemplateGuideStagePresentation[];
  issueCount: number;
  summaryLabel: string;
  liveMessage: string;
  catalogUnavailable: boolean;
};

const STAGES: Array<{
  id: AssemblyTemplateReadinessStage;
  step: number;
  label: string;
}> = [
  { id: 'basic', step: 1, label: '基本設定' },
  { id: 'procedure', step: 2, label: '文書・手順' },
  { id: 'areas', step: 3, label: '工程・締付' },
  { id: 'review', step: 4, label: '確認・保存' }
];

const statusLabel = (status: AssemblyTemplateReadinessStatus): string => {
  if (status === 'complete') return '完了';
  if (status === 'checking') return '確認中';
  return '未完了';
};

export function buildAssemblyTemplateGuidePresentation(
  readiness: AssemblyTemplateReadiness
): AssemblyTemplateGuidePresentation {
  const issueCount = readiness.issues.length;
  return {
    stages: STAGES.map((stage) => ({
      ...stage,
      status: readiness.stages[stage.id],
      statusLabel: statusLabel(readiness.stages[stage.id])
    })),
    issueCount,
    summaryLabel: readiness.isReady ? '保存可能' : `未完了 ${issueCount}件`,
    liveMessage: readiness.isReady
      ? '保存条件をすべて満たしました。'
      : `未完了項目が${issueCount}件あります。`,
    catalogUnavailable: readiness.issues.some(
      (issue) => issue.code === 'capability_catalog.unavailable'
    )
  };
}
