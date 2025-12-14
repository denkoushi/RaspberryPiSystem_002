import { authenticator } from 'otplib';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

export function verifyTotpCode(secret: string, token: string): boolean {
  if (!token || !secret) return false;
  return authenticator.check(token, secret);
}

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () => crypto.randomBytes(5).toString('hex'));
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  const hashed = await Promise.all(codes.map((code) => bcrypt.hash(code, 10)));
  return hashed;
}

export async function matchAndConsumeBackupCode(hashedCodes: string[], input?: string): Promise<{ ok: boolean; remaining: string[] }> {
  if (!input) return { ok: false, remaining: hashedCodes };
  for (const hashed of hashedCodes) {
    const ok = await bcrypt.compare(input, hashed);
    if (ok) {
      const remaining = hashedCodes.filter((c) => c !== hashed);
      return { ok: true, remaining };
    }
  }
  return { ok: false, remaining: hashedCodes };
}
