export function formatRecordBody(value: string): Array<{ heading?: string; items: string[] }> {
  return value.split(/\r?\n/u).flatMap((line) => {
    const items = line.split('。').map((sentence) => sentence.trim()).filter(Boolean);
    if (!items.length) return [];
    const prefix = items.length >= 2 ? items[0].match(/^([^:]+): (.+)$/u) : null;
    if (prefix && Array.from(prefix[1].trim()).length >= 16) {
      return [{ heading: prefix[1].trim(), items: [prefix[2].trim(), ...items.slice(1)] }];
    }
    return [{ items }];
  });
}
