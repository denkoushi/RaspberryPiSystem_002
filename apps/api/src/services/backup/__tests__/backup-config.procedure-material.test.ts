import { describe, expect, it } from 'vitest';

import { BackupConfigSchema, defaultBackupConfig } from '../backup-config.js';

const base = { storage: { provider: 'local' }, targets: [] };

describe('backup-config procedure-material allowed sender domains', () => {
  it.each([undefined, {}, { enabled: true, fromEmail: 'sender@example.com' }])('defaults missing domains in existing settings: %j', (settings) => {
    expect(BackupConfigSchema.parse({ ...base, procedureMaterialGmailIngest: settings }).procedureMaterialGmailIngest.allowedSenderDomains).toEqual(['thkintechs.co.jp']);
    expect(defaultBackupConfig.procedureMaterialGmailIngest.allowedSenderDomains).toEqual(['thkintechs.co.jp']);
  });
  it('normalizes case, whitespace, leading @ and duplicates while preserving order', () => {
    const config = BackupConfigSchema.parse({ ...base, procedureMaterialGmailIngest: { allowedSenderDomains: ['  @THKINTECHS.CO.JP  ', 'thkintechs.co.jp', ' @Example-Domain.com ', 'EXAMPLE-DOMAIN.COM'] } });
    expect(config.procedureMaterialGmailIngest.allowedSenderDomains).toEqual(['thkintechs.co.jp', 'example-domain.com']);
  });
  it('preserves an explicit empty array to deny all senders', () => {
    expect(BackupConfigSchema.parse({ ...base, procedureMaterialGmailIngest: { allowedSenderDomains: [] } }).procedureMaterialGmailIngest.allowedSenderDomains).toEqual([]);
  });
  it.each(['', 'localhost', 'sender@example.com', '@@example.com', 'example_com.jp', 'example..com', '.example.com', 'example.com.', '-example.com', 'example-.com', 'exam ple.com', 'https://example.com', '*.example.com', '例.jp'])('rejects invalid domain: %s', (domain) => {
    expect(BackupConfigSchema.safeParse({ ...base, procedureMaterialGmailIngest: { allowedSenderDomains: [domain] } }).success).toBe(false);
  });
});
