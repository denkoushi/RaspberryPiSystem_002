import { describe, expect, it } from 'vitest';
import { BackupConfigSchema } from '../../backup/backup-config.js';
import { verifyGmailSender } from '../gmail-sender-verification.js';

const from = (value = 'Sender <sender@thkintechs.co.jp>') => ({ name: 'From', value });
const auth = (value = 'mx.google.com; spf=pass smtp.mailfrom=thkintechs.co.jp; dkim=pass header.i=@thkintechs.co.jp; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=thkintechs.co.jp', name = 'Authentication-Results') => ({ name, value });
const verify = (headers: Array<{ name: string; value: string }>) => verifyGmailSender(headers, ['thkintechs.co.jp']);

describe('verifyGmailSender', () => {
  it('accepts Gmail authentication results', () => expect(verify([from(), auth()])).toEqual({ ok: true, domain: 'thkintechs.co.jp' }));
  it.each([
    ['mx.attacker.example; dmarc=pass header.from=thkintechs.co.jp', 'Authentication-Results', 'no_auth_results'],
    ['mx.google.com; dmarc=pass header.from=thkintechs.co.jp', 'ARC-Authentication-Results', 'no_auth_results'],
    ['mx.google.com; spf=pass; dkim=pass; dmarc=fail header.from=thkintechs.co.jp', 'Authentication-Results', 'dmarc_not_pass'],
    ['mx.google.com; dmarc=none header.from=thkintechs.co.jp', 'Authentication-Results', 'dmarc_not_pass'],
    ['mx.google.com; dmarc=pass header.from=example.com', 'Authentication-Results', 'header_from_mismatch'],
    ['mx.google.com; spf=pass (dmarc=pass)', 'Authentication-Results', 'dmarc_not_pass'],
    ['mx.google.com.evil; dmarc=pass', 'Authentication-Results', 'no_auth_results'],
    ['mx.google.com; dmarc=pass header.from=thkintechs.co.jp; dmarc=fail header.from=thkintechs.co.jp', 'Authentication-Results', 'dmarc_not_pass'],
    ['mx.google.com (comment; dmarc=pass); dmarc=fail header.from=thkintechs.co.jp', 'Authentication-Results', 'dmarc_not_pass'],
  ])('rejects %s / %s', (value, name, reason) => expect(verify([from(), auth(value, name)])).toMatchObject({ ok: false, reason }));
  it('ignores untrusted results and uses the first Google results', () => {
    expect(verify([from(), auth('evil; dmarc=pass'), auth('mx.google.com; dmarc=fail'), auth()])).toMatchObject({ ok: false, reason: 'dmarc_not_pass' });
    expect(verify([from(), auth('evil; dmarc=fail'), auth(), auth('mx.google.com; dmarc=fail')])).toMatchObject({ ok: true });
  });
  it('allows missing header.from when DMARC passes', () => expect(verify([from(), auth('mx.google.com; dmarc=pass')])).toMatchObject({ ok: true }));
  it('checks the mailbox rather than the display name', () => expect(verify([from('"x@thkintechs.co.jp" <evil@example.com>'), auth()])).toEqual({ ok: false, reason: 'domain_not_allowed', domain: 'example.com' }));
  it('rejects two From headers', () => expect(verify([from(), from(), auth()])).toMatchObject({ ok: false, reason: 'multiple_from' }));
  it.each(['a@thkintechs.co.jp, b@thkintechs.co.jp', 'A <a@thkintechs.co.jp>, B <b@thkintechs.co.jp>', 'group: a@thkintechs.co.jp;'])('rejects multiple/group addresses: %s', (value) => expect(verify([from(value), auth()])).toMatchObject({ ok: false, reason: 'invalid_from' }));
  it('rejects missing From', () => expect(verify([auth()])).toMatchObject({ ok: false, reason: 'no_from' }));
  it.each(['sender@example.com', 'sender@mail.thkintechs.co.jp'])('requires an exact allowed domain: %s', (value) => expect(verify([from(value), auth()])).toMatchObject({ ok: false, reason: 'domain_not_allowed' }));
  it('normalizes domains and header names', () => expect(verifyGmailSender([{ name: 'fRoM', value: 'Sender <sender@THKINTECHS.CO.JP>' }, auth()], ['THKINTECHS.CO.JP'])).toMatchObject({ ok: true, domain: 'thkintechs.co.jp' }));
  it('does not expose the local part in rejection results', () => expect(JSON.stringify(verify([from('private@example.com'), auth()]))).not.toContain('private'));
});

describe('gmailIngestSenderPolicy config', () => {
  const base = { storage: { provider: 'gmail' }, targets: [] };
  it('defaults missing config', () => expect(BackupConfigSchema.parse(base).gmailIngestSenderPolicy).toEqual({ allowedSenderDomains: ['thkintechs.co.jp'] }));
  it('preserves an explicitly empty allowlist', () => expect(BackupConfigSchema.parse({ ...base, gmailIngestSenderPolicy: { allowedSenderDomains: [] } }).gmailIngestSenderPolicy.allowedSenderDomains).toEqual([]));
  it('normalizes configured domains', () => expect(BackupConfigSchema.parse({ ...base, gmailIngestSenderPolicy: { allowedSenderDomains: ['THKINTECHS.CO.JP'] } }).gmailIngestSenderPolicy.allowedSenderDomains).toEqual(['thkintechs.co.jp']));
});
