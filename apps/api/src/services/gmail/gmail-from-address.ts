const MAX_FROM_HEADER_LENGTH = 998;

export function extractEmailAddress(from: string | undefined): string | undefined {
  if (!from || from.length > MAX_FROM_HEADER_LENGTH) return undefined;
  return (from.match(/<([^<>]+)>\s*$/)?.[1] ?? from).trim().toLowerCase();
}
