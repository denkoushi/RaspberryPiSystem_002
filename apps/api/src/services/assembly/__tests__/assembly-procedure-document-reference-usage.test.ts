import { describe, expect, it } from 'vitest';
import {
  AssemblyProcedureDocumentService,
  type AssemblyProcedureDocumentReferenceUsage
} from '../assembly-procedure-document.service.js';

const unused: AssemblyProcedureDocumentReferenceUsage = {
  inProcedureManualAssignment: false,
  inProcedureOrder: false,
  inTemplatePrimary: false,
  inActiveTemplatePrimary: false,
  inTemplateProcedureSequence: false,
  inActiveTemplateProcedureSequence: false,
  inTemplateProcedureStep: false,
  inActiveTemplateProcedureStep: false,
  inBoltPageRef: false,
  inCheckPageRef: false,
  inRevisionHistory: false
};

// Literal expectations copied from the original message guards, in priority order.
const cases = [
  ['inProcedureManualAssignment', '要領書の機種×工程割り当てで使用中の手順書は削除・公開取消できません'],
  ['inProcedureOrder', '旧形式テンプレートの互換手順書列で使用中の手順書は公開取り消しできません'],
  ['inActiveTemplateProcedureSequence', '有効なテンプレートの文書順で使用中の手順書は公開取り消しできません'],
  ['inActiveTemplateProcedureStep', '有効なテンプレートの表示ステップで使用中の手順書は公開取り消しできません'],
  ['inTemplateProcedureSequence', 'テンプレートの文書順で使用中の手順書は公開取り消しできません'],
  ['inTemplateProcedureStep', 'テンプレートの表示ステップで使用中の手順書は公開取り消しできません'],
  ['inActiveTemplatePrimary', '有効なテンプレートで使用中の手順書は公開取り消しできません'],
  ['inTemplatePrimary', 'テンプレートで使用中の手順書は公開取り消しできません'],
  ['inBoltPageRef', 'マーカー参照で使用中の手順書は公開取り消しできません'],
  ['inCheckPageRef', 'マーカー参照で使用中の手順書は公開取り消しできません'],
  ['inRevisionHistory', '版履歴で使用中の手順書は削除できません']
] as const satisfies ReadonlyArray<readonly [keyof AssemblyProcedureDocumentReferenceUsage, string]>;

const priorityCases = cases.slice(0, -1).map(([key, message], index) => ({
  key,
  message,
  lowerPriorityKeys: cases.slice(index + 1).map(([lowerKey]) => lowerKey)
}));

const service = new AssemblyProcedureDocumentService({ collectGarbageForAssetIds: async () => {} } as never);

describe('assembly procedure document reference usage', () => {
  it('returns false and the default message when all flags are false', () => {
    expect(service.isReferenced(unused)).toBe(false);
    expect(service.buildInUseMessage(unused)).toBe('使用中の手順書は公開取り消しできません');
  });

  it.each(cases)('detects %s alone and preserves its message', (key, message) => {
    const usage = { ...unused, [key]: true };
    expect(service.isReferenced(usage)).toBe(true);
    expect(service.buildInUseMessage(usage)).toBe(message);
  });

  it.each(priorityCases)('prioritizes $key over the remaining flags', ({ key, message, lowerPriorityKeys }) => {
    const usage = { ...unused, [key]: true };
    for (const lowerKey of lowerPriorityKeys) usage[lowerKey] = true;
    expect(service.isReferenced(usage)).toBe(true);
    expect(service.buildInUseMessage(usage)).toBe(message);
  });
});
