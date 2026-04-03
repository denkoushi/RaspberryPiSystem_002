import { describe, expect, it } from 'vitest';
import { escapeHtml } from './html-escape.js';

describe('escapeHtml', () => {
  it('escapes special characters', () => {
    expect(escapeHtml('a<b>&"x')).toBe('a&lt;b&gt;&amp;&quot;x');
    expect(escapeHtml("'")).toBe('&#39;');
  });
});
