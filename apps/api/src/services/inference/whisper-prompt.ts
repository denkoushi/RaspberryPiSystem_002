// The plant GPU proxy rejects control characters and prompts over 800 UTF-8 bytes.
// Whisper keeps the end of a long prompt, so truncation keeps the tail.
export function toWhisperPrompt(text: string): string | undefined {
  const clean = text.replace(/\p{C}/gu, ' ').replace(/\s+/gu, ' ').trim();
  const points = Array.from(clean);
  let bytes = 0;
  let start = points.length;
  while (start > 0) {
    const size = Buffer.byteLength(points[start - 1], 'utf8');
    if (bytes + size > 800) break;
    bytes += size;
    start--;
  }
  return points.slice(start).join('').trim() || undefined;
}
