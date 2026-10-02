import { ApiError } from '../../lib/errors.js';

export const ASSEMBLY_PROCEDURE_GMAIL_SUBJECT = 'DocumentASM';
/** 設備稼働ログ（信号灯センサーの日報CSV）のメール件名。専用の取り込みが全添付を読む。 */
export const MACHINE_SIGNAL_GMAIL_SUBJECT = 'AirGridFlexSignal';
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
export const ITEM_INVENTORY_GMAIL_SUBJECT_TOKENS = [
  '[ItemlistRaspi-photo]',
] as const;

const RESERVED_GMAIL_SUBJECTS = [
  { subject: ASSEMBLY_PROCEDURE_GMAIL_SUBJECT, owner: '組立手順書' },
  { subject: MACHINE_SIGNAL_GMAIL_SUBJECT, owner: '設備稼働ログ' },
] as const;

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
function findReservedSubjectMatching(pattern: string): (typeof RESERVED_GMAIL_SUBJECTS)[number] | undefined {
  const normalizedPattern = normalizeGmailSubjectPattern(pattern);
  if (!normalizedPattern) return undefined;
  return RESERVED_GMAIL_SUBJECTS.find((reserved) =>
    normalizeGmailSubjectPattern(reserved.subject).includes(normalizedPattern)
  );
}

export function canCsvSubjectPatternMatchReservedSubject(pattern: string): boolean {
  return findReservedSubjectMatching(pattern) !== undefined;
}

export function assertCsvGmailSubjectPatternAllowed(pattern: string): void {
  const reserved = findReservedSubjectMatching(pattern);
  if (!reserved) return;
  throw new ApiError(
    400,
    `「${reserved.subject}」は${reserved.owner}専用の件名です。このメールに一致するCSV件名パターンは登録できません。`,
    {
      pattern,
      reservedSubject: reserved.subject,
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

/** Return true for the inventory token and its optional variable suffix. */
export function isItemInventoryGmailSubject(subject: string): boolean {
  const normalized = subject.normalize('NFC').trim();
  return ITEM_INVENTORY_GMAIL_SUBJECT_TOKENS.some((token) =>
    normalized === token || normalized.startsWith(`${token} `) || normalized.startsWith(`${token}\t`)
  );
}
