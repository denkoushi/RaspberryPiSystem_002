/**
 * A candidate API container is used only to prove that a newly built image can
 * start and answer its health endpoint. It shares the production database, so
 * scheduled jobs must not start in that short-lived validation process.
 */
export function isCandidateValidationMode(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment['PI5_CANDIDATE_VALIDATION'] === '1';
}
