import { ApiError } from '../../lib/errors.js';

export const ASSEMBLY_PROCEDURE_GMAIL_SUBJECT = 'DocumentASM';
export const GMAIL_SUBJECT_PATTERN_RESERVED_CODE = 'GMAIL_SUBJECT_PATTERN_RESERVED';

/**
 * SharePoint work-instruction mail is a separate mailbox owner. Keep the
 * canonical bracketed token here so every Gmail consumer applies the same
 * boundary rule before parsing or disposing a message. The subject suffix
 * (for example, an item ID) is deliberately outside this ownership token.
 */
export const WORK_INSTRUCTION_GMAIL_SUBJECT_TOKENS = [
  '[Kakou-Dandori-photo]',
] as const;

const RESERVED_PATTERN_MESSAGE =
  '「DocumentASM」は組立手順書専用の件名です。このメールに一致するCSV件名パターンは登録できません。';

export function normalizeGmailSubjectPattern(value: string): string {
  const trimmed = value.normalize('NFC').trim();
  const withoutLegacyRegexDelimiters =
    trimmed.length >= 2 && trimmed.startsWith('/') && trimmed.endsWith('/')
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  return withoutLegacyRegexDelimiters.toLocaleLowerCase('en-US');
}

/**
 * CSV側は件名の部分一致で照合するため、候補が予約件名に含まれる場合は競合する。
 * 例: DocumentASM / documentasm / ASM はすべて予約件名へ一致する。
 */
export function canCsvSubjectPatternMatchReservedSubject(pattern: string): boolean {
  const normalizedPattern = normalizeGmailSubjectPattern(pattern);
  if (!normalizedPattern) return false;
  const normalizedReserved = normalizeGmailSubjectPattern(ASSEMBLY_PROCEDURE_GMAIL_SUBJECT);
  return normalizedReserved.includes(normalizedPattern);
}

export function assertCsvGmailSubjectPatternAllowed(pattern: string): void {
  if (!canCsvSubjectPatternMatchReservedSubject(pattern)) return;
  throw new ApiError(
    400,
    RESERVED_PATTERN_MESSAGE,
    {
      pattern,
      reservedSubject: ASSEMBLY_PROCEDURE_GMAIL_SUBJECT,
    },
    GMAIL_SUBJECT_PATTERN_RESERVED_CODE
  );
}

/**
 * Return true only when the complete work-instruction token leads the subject.
 * The closing bracket and following boundary are part of the ownership
 * contract, while the suffix after the token remains dynamic and ignored.
 */
export function isWorkInstructionGmailSubject(subject: string): boolean {
  const normalized = subject.normalize('NFC').trim();
  return WORK_INSTRUCTION_GMAIL_SUBJECT_TOKENS.some((token) =>
    normalized === token || normalized.startsWith(`${token} `) || normalized.startsWith(`${token}\t`)
  );
}
