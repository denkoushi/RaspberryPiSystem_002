import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { procedureMaterialEnvShape } from '../env/procedure-material.js';

const schema = z.object(procedureMaterialEnvShape);
describe('procedure material image description configuration', () => {
  it('uses safe defaults and parses an explicit disabled flag', () => {
    expect(schema.parse({})).toEqual({ PROCEDURE_MATERIAL_IMAGE_DESCRIPTION_ENABLED: true,
      PROCEDURE_MATERIAL_IMAGE_DESCRIPTION_CRON: '*/5 * * * *', PROCEDURE_MATERIAL_IMAGE_DESCRIPTION_BATCH_SIZE: 3 });
    expect(schema.parse({ PROCEDURE_MATERIAL_IMAGE_DESCRIPTION_ENABLED: 'false' }).PROCEDURE_MATERIAL_IMAGE_DESCRIPTION_ENABLED).toBe(false);
  });
  it.each(['0', '21', '1.5', 'invalid'])('rejects invalid batch size %s', value => {
    expect(schema.safeParse({ PROCEDURE_MATERIAL_IMAGE_DESCRIPTION_BATCH_SIZE: value }).success).toBe(false);
  });
});
