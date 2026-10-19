import sop from '../assembly/assembly-procedure-template-sop.definition.json';

export type GuideStepReference = {
  kind: 'sop';
  sheetId: string;
  stepId: string;
  description?: string;
};
export type GuideStepDirect = {
  kind: 'direct';
  title: string;
  targetId: string;
  description: string;
  path?: '/kiosk/assembly/library';
};
export type GuideStep = GuideStepReference | GuideStepDirect;
export type OperationGuide = {
  id: 'assembly-register' | 'assembly-edit';
  label: string;
  action: string;
  steps: readonly GuideStep[];
};

export const operationGuides: readonly OperationGuide[] = [
  {
    id: 'assembly-register', label: '組立の手順書', action: '登録',
    steps: [
      { kind: 'direct', title: 'ファイルから登録', targetId: 'assembly-file-register', description: 'ライブラリで登録画面を開きます。', path: '/kiosk/assembly/library' },
      { kind: 'sop', sheetId: 'assembly-file-register', stepId: 'preview-file', description: 'ファイルを選び先頭ページを確認します。' },
      { kind: 'direct', title: '下書きとして登録', targetId: 'assembly-procedure-register-draft', description: '確認したファイルを下書き登録します。' },
      { kind: 'direct', title: '内容確認・公開を開く', targetId: 'assembly-procedure-preview', description: '下書き行の「内容確認・公開」を押します。', path: '/kiosk/assembly/library' },
      { kind: 'direct', title: '確認して公開', targetId: 'assembly-procedure-publish', description: '内容確認後、パスワード入力して公開。' },
    ],
  },
  {
    id: 'assembly-edit', label: '組立の手順書', action: '編集',
    steps: [
      { kind: 'sop', sheetId: 'assembly-procedure-edit', stepId: 'open-procedure-edit', description: '「編集」か「改版編集」を押します。' },
      { kind: 'sop', sheetId: 'assembly-document-editor-auth', stepId: 'document-editor-password', description: 'テンキーで暗証番号を入力します。' },
      { kind: 'direct', title: 'OK', targetId: 'assembly-document-editor-authenticate', description: '4桁で自動認証。再試行は「OK」。' },
      { kind: 'sop', sheetId: 'assembly-document-editor-range', stepId: 'document-editor-range-add', description: '「範囲」を押して選択を始めます。' },
      { kind: 'sop', sheetId: 'assembly-document-editor-range', stepId: 'document-editor-range-surface', description: '編集する範囲をドラッグします。' },
      { kind: 'sop', sheetId: 'assembly-document-editor-types', stepId: 'document-editor-type-text', description: '「文章」を選び、内容を入力します。' },
      { kind: 'sop', sheetId: 'assembly-document-editor-text-properties', stepId: 'document-editor-save-text', description: '内容を編集し「保存」を押します。' },
      { kind: 'sop', sheetId: 'assembly-document-editor-publish', stepId: 'document-editor-publish', description: '保存済みの内容を確認し「公開」。' },
      { kind: 'direct', title: '承認して公開する', targetId: 'assembly-document-editor-publish-confirm', description: '承認者の社員タグをかざして公開します。' },
    ],
  },
];

export function resolveGuideStep(reference: GuideStep) {
  if (reference.kind === 'direct') return reference;
  for (const scenario of sop.scenarios) {
    const sheet = scenario.sheets.find(item => item.id === reference.sheetId);
    const step = sheet?.steps.find(item => item.id === reference.stepId);
    if (step) return {
      ...step,
      description: reference.description ?? step.description,
      // Editor fixture routes contain synthetic document IDs and must never be navigated to.
      path: scenario.id === 'assembly-library' ? scenario.productionRoute : undefined,
    };
  }
  throw new Error(`Unknown operation guide step: ${reference.sheetId}/${reference.stepId}`);
}
