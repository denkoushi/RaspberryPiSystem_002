import { z } from 'zod';

const localPartPattern = /^[A-Za-z0-9._-]{1,64}$/;
const domainLabel = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function isProcedureManualMailLocalPart(value: string): boolean {
  return localPartPattern.test(value)
    && !/[\r\n]/.test(value)
    && !value.startsWith('.') && !value.endsWith('.') && !value.includes('..');
}

export const procedureManualMailDomainSchema = z.string().trim().max(253).refine(
  (value) => !value || value.split('.').every((label) => domainLabel.test(label)),
  '会社ドメイン名を指定してください'
).transform((value) => value.toLowerCase() || undefined).optional();
