const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;
const WHITESPACE = /\s/;

/** 「場合 … 以下 … 確認」が同じ行にこの順で現れるか。文字列の長さに比例する時間で終わる。 */
export function hasConditionWordsInLine(text: string): boolean {
  return text.split(LINE_TERMINATOR).some((line) => {
    const first = line.indexOf('場合');
    if (first < 0) return false;
    const second = line.indexOf('以下', first + 2);
    return second >= 0 && line.indexOf('確認', second + 2) >= 0;
  });
}

/** 行末側の区切り。先頭から e までの条件文の後ろに続く空白と改行、または「・」の直前を数える。 */
function tailLength(text: string, end: number): number {
  let run = end;
  let lastNewline = -1;
  while (run < text.length && WHITESPACE.test(text[run])) {
    if (text[run] === '\n') lastNewline = run;
    run++;
  }
  if (lastNewline >= 0) return lastNewline + 1;
  if (run < text.length && (text[run] === '・' || text[run] === '･')) return run;
  if (end === text.length) return end;
  return -1;
}

/**
 * 先頭の「…場合…以下…確認…こと[。.]」と、その後ろの区切りまでを取り出す。
 * label は条件文そのもの、length は区切りまで含めた長さ。見つからなければ null。
 * 後戻りをしないので、入力が長くても時間は長さに比例する。
 */
export function matchConditionHeader(text: string): { label: string; length: number } | null {
  const when = text.indexOf('場合');
  if (when < 0) return null;
  const firstTerminator = text.search(LINE_TERMINATOR);
  if (firstTerminator >= 0 && firstTerminator < when + 2) return null;
  const newline = text.indexOf('\n');
  const lineEnd = newline < 0 ? text.length : newline;
  const below = text.indexOf('以下', when + 2);
  if (below < 0 || below + 2 > lineEnd) return null;
  const confirm = text.indexOf('確認', below + 2);
  if (confirm < 0 || confirm + 2 > lineEnd) return null;
  for (let at = text.indexOf('こと', confirm + 2); at >= 0 && at + 2 <= lineEnd; at = text.indexOf('こと', at + 1)) {
    const base = at + 2;
    if (base < text.length && (text[base] === '。' || text[base] === '.')) {
      const withMark = tailLength(text, base + 1);
      if (withMark >= 0) return { label: text.slice(0, base + 1), length: withMark };
    }
    const plain = tailLength(text, base);
    if (plain >= 0) return { label: text.slice(0, base), length: plain };
  }
  return null;
}
