import { describe, expect, it } from 'vitest';
import { inferenceEnvShape } from '../../../config/env/inference.js';
import { PROCEDURE_SPEECH_HINTS, toWhisperPrompt } from '../procedure-speech-hints.js';

describe('procedure speech hints', () => {
  it.each(Object.entries(PROCEDURE_SPEECH_HINTS))('%s is short and already safe for Whisper', (_key, prompt) => {
    expect(toWhisperPrompt(prompt)).toBe(prompt);
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(800);
    expect(prompt).not.toMatch(/\p{C}/u);
    expect(prompt.split('、').length).toBeGreaterThanOrEqual(30);
    expect(prompt.split('、').length).toBeLessThanOrEqual(40);
  });
  it('replaces all category-C characters and collapses whitespace', () => {
    expect(toWhisperPrompt('  LMガイド\r\n\tシャコマン\u0000\u200b\ue000\u0378\ud800  サドル\u3000 Cキャップ '))
      .toBe('LMガイド シャコマン サドル Cキャップ');
  });
  it('keeps an exactly 800-byte multibyte suffix without splitting code points', () => {
    const tail = '😀'.repeat(199) + 'ねa';
    expect(Buffer.byteLength(tail)).toBe(800);
    expect(toWhisperPrompt(tail)).toBe(tail);
    expect(toWhisperPrompt('先頭' + tail)).toBe(tail);
    expect(toWhisperPrompt('あ'.repeat(267))).toBe('あ'.repeat(266));
  });
  it('trims again after truncating the prefix', () => {
    expect(toWhisperPrompt('あ ' + 'a'.repeat(799))).toBe('a'.repeat(799));
  });
  it.each(['', '  ', '\r\n\t\u200b\ue000'])('omits empty sanitized input %j', input => {
    expect(toWhisperPrompt(input)).toBeUndefined();
  });
  it.each([[undefined, true], ['true', true], [' TRUE ', true], ['false', false], [' FALSE ', false]])('parses the hints flag %j', (input, expected) => {
    expect(inferenceEnvShape.PROCEDURE_SPEECH_TO_TEXT_HINTS_ENABLED.parse(input)).toBe(expected);
  });
});
