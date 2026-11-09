export const GMAIL_SENDER_REJECTED_LABEL = 'rps_sender_rejected';
export const DEFAULT_GMAIL_SENDER_DOMAINS = ['thkintechs.co.jp'];
export type GmailSenderRejectionReason = 'no_from' | 'multiple_from' | 'invalid_from' | 'domain_not_allowed' | 'no_auth_results' | 'dmarc_not_pass' | 'header_from_mismatch' | 'policy_empty';
export type GmailSenderVerification = { ok: true; domain: string } | { ok: false; reason: GmailSenderRejectionReason; domain?: string };
type Header = { name: string; value: string };

// Remove RFC comments without treating text inside a quoted string as a comment.
function withoutComments(value: string): string {
  let depth = 0, quoted = false, escaped = false, result = '';
  for (const char of value) {
    if (escaped) { if (!depth) result += char; escaped = false; continue; }
    if (char === '\\') { escaped = true; if (!depth) result += char; continue; }
    if (!depth && char === '"') quoted = !quoted;
    if (!quoted && char === '(') { depth++; continue; }
    if (!quoted && char === ')' && depth) { depth--; continue; }
    if (!depth) result += char;
  }
  return result;
}

export function verifyGmailSender(headers: Header[] | undefined, allowedSenderDomains: readonly string[]): GmailSenderVerification {
  const from = headers?.filter((header) => header.name.toLowerCase() === 'from') ?? [];
  if (!from.length) return { ok: false, reason: 'no_from' };
  if (from.length !== 1) return { ok: false, reason: 'multiple_from' };
  const value = from[0].value.trim();
  const mailbox = value.includes('<')
    ? value.match(/^(?:"(?:[^"\\]|\\.)*"|[^"<>,;]*)\s*<([^<>]+)>$/)?.[1]
    : value;
  const address = mailbox?.trim().match(/^[^\s@<>(),;:"\\]+@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/i);
  if (!address) return { ok: false, reason: 'invalid_from' };
  const domain = address[1].toLowerCase();
  if (!allowedSenderDomains.length) return { ok: false, reason: 'policy_empty', domain };
  if (!allowedSenderDomains.some((allowed) => allowed.toLowerCase() === domain)) return { ok: false, reason: 'domain_not_allowed', domain };
  const auth = headers?.filter((header) => header.name.toLowerCase() === 'authentication-results')
    .map((header) => withoutComments(header.value))
    .find((result) => /^mx\.google\.com(?:\s+\d+)?$/i.test(result.split(';')[0].trim()));
  if (!auth) return { ok: false, reason: 'no_auth_results', domain };
  const dmarc = auth.split(';').slice(1).filter((clause) => /^\s*dmarc\s*=/i.test(clause));
  if (dmarc.length !== 1 || !/^\s*dmarc\s*=\s*pass(?:\s|$)/i.test(dmarc[0])) return { ok: false, reason: 'dmarc_not_pass', domain };
  const headerFrom = dmarc[0].match(/\bheader\.from\s*=\s*(?:"([^"\s]+)"|([^\s]+))/i);
  if (/\bheader\.from\s*=/i.test(dmarc[0]) && (headerFrom?.[1] ?? headerFrom?.[2])?.toLowerCase() !== domain) {
    return { ok: false, reason: 'header_from_mismatch', domain };
  }
  return { ok: true, domain };
}

export class GmailSenderRejectedError extends Error {
  constructor(readonly reason: GmailSenderRejectionReason, readonly domain?: string) {
    super(`Gmail sender rejected: ${reason}${domain ? ` (${domain})` : ''}`);
    this.name = 'GmailSenderRejectedError';
  }
}
