import { describe, expect, it } from 'vitest';

import { buildShadowAssistedUserPrompt } from '../photo-tool-label-prompt-builder.js';

describe('buildShadowAssistedUserPrompt', () => {
  it('候補が空ならベースをそのまま返す', () => {
    expect(buildShadowAssistedUserPrompt('ベース', [])).toBe('ベース');
  });

  it('候補を重複除去して参考文に載せる', () => {
    const out = buildShadowAssistedUserPrompt('ベース', ['A', 'A', '  B ']);
    expect(out.startsWith('ベース\n\n【参考】')).toBe(true);
    expect(out).toContain('A');
    expect(out).toContain('B');
  });
});
