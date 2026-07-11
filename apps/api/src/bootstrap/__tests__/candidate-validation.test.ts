import { describe, expect, it } from 'vitest';
import { isCandidateValidationMode } from '../candidate-validation.js';

describe('isCandidateValidationMode', () => {
  it('only enables validation mode for the explicit value 1', () => {
    expect(isCandidateValidationMode({ PI5_CANDIDATE_VALIDATION: '1' })).toBe(true);
    expect(isCandidateValidationMode({ PI5_CANDIDATE_VALIDATION: 'true' })).toBe(false);
    expect(isCandidateValidationMode({})).toBe(false);
  });
});
