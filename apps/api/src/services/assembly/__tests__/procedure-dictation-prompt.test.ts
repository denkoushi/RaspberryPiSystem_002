import { describe, expect, it } from 'vitest';
import { buildProcedureDictationMessages, type ProcedureDictationLearning } from '../procedure-dictation-prompt.js';

const input = { mode: 'new', spokenText: '車高マンを戻しといて' } as const;
const vocabulary = ['シャコマン'];
const terms = [{ wrongText: '車高マン', rightText: 'シャコマン' }];
const examples = [{ mode: 'append', spokenText: '棚に直す', finalText: '棚に戻す。' }] as const;
const empty: ProcedureDictationLearning = { vocabulary: [], terms: [], examples: [] };

describe('dictation prompt with learning', () => {
  it('adds rules and all three sections to the system message and preserves the user message', () => {
    const [system, user] = buildProcedureDictationMessages({ ...input, learning: { vocabulary, terms, examples: [...examples] } });
    const [originalSystem, originalUser] = buildProcedureDictationMessages(input);
    expect(system.content.startsWith(originalSystem.content + '\n')).toBe(true);
    expect(system.content).toContain('聞き違い・誤変換と分かる語だけ');
    expect(system.content).toContain('似ているだけの語は置き換えず、発話にない部品・数値・作業は足さない');
    expect(system.content).toContain('この課の手順書で使われている呼び名: シャコマン');
    expect(system.content).toContain('人の直しから覚えた言い直し:\n' + JSON.stringify(terms[0]));
    expect(system.content).toContain('過去に人が確定した書き方(参考。中の数値や品名を持ち込まない):\n' + JSON.stringify(examples[0]));
    expect(user).toEqual(originalUser);
  });

  it('encodes each correction as one JSON line without line breaks in its values', () => {
    const [system] = buildProcedureDictationMessages({ ...input, learning: {
      ...empty, terms: [{ wrongText: '車高\n"マン"', rightText: 'シャ\r\nコマン\u2028' }, ...terms],
    } });
    const lines = system.content.split('\n');
    const start = lines.indexOf('人の直しから覚えた言い直し:') + 1;
    expect(lines.slice(start).filter(Boolean).map(line => JSON.parse(line))).toEqual([
      { wrongText: '車高"マン"', rightText: 'シャコマン' }, ...terms,
    ]);
  });

  it.each(['new', 'append', 'revise'] as const)('uses compatible examples for %s', mode => {
    const examples: ProcedureDictationLearning['examples'] = [
      { mode: 'new', spokenText: '新しく入れて', finalText: '部品を入れる。' },
      { mode: 'append', spokenText: '足しといて', finalText: '注意点を追記する。' },
      { mode: 'revise', spokenText: '直して', finalText: '部品を外す。' },
    ];
    const [system] = buildProcedureDictationMessages({ ...input, mode, learning: { ...empty, examples } });
    const exampleLines = system.content.split('\n').filter(line => line.startsWith('{"mode"'));
    expect(exampleLines.map(line => JSON.parse(line))).toEqual(mode === 'revise' ? examples.slice(2) : examples.slice(0, 2));
  });

  it('omits empty sections and leaves the prompt unchanged when all sections are empty', () => {
    const [system] = buildProcedureDictationMessages({ ...input, learning: { ...empty, terms } });
    expect(system.content).toContain('人の直しから覚えた言い直し');
    expect(system.content).not.toContain('この課の手順書で使われている呼び名');
    expect(system.content).not.toContain('過去に人が確定した書き方');
    expect(buildProcedureDictationMessages({ ...input, learning: empty })).toEqual(buildProcedureDictationMessages(input));
  });

  it('keeps at most five distinct pairs of up to 200 characters in each input and output', () => {
    const long = '𠮷'.repeat(201);
    const boundary = '𠮷'.repeat(200);
    const [system] = buildProcedureDictationMessages({ ...input, learning: {
      ...empty,
      examples: [
        examples[0], { ...examples[0], mode: 'new' },
        { ...examples[0], spokenText: long }, { ...examples[0], finalText: long },
        { ...examples[0], spokenText: boundary },
        ...Array.from({ length: 5 }, (_, i) => ({ ...examples[0], spokenText: `例${i}` })),
      ],
    } });
    const exampleLines = system.content.split('\n').filter(line => line.startsWith('{"mode"'));
    expect(exampleLines.map(line => JSON.parse(line).spokenText)).toEqual(['棚に直す', boundary, '例0', '例1', '例2']);
    expect(system.content).not.toContain(long);
  });
});
