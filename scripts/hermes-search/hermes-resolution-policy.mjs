export const RESOLUTION_ACTIONS = Object.freeze({
  CONTINUE_SET: 'continue_set',
  RESOLVE_EXISTING: 'resolve_existing',
  CONFIRM: 'confirm',
});

// Ambiguity is a signal for impact evaluation, not a confirmation decision.
// The same policy can be used for organization, exact, or future condition
// resolvers without knowing the condition's domain.
export function evaluateAmbiguityImpact({
  ambiguity = null,
  candidateSetSafe = false,
  existingCondition = false,
} = {}) {
  if (!ambiguity) {
    return { action: RESOLUTION_ACTIONS.CONTINUE_SET, reason: 'unambiguous' };
  }

  if (['unknown', 'not_found', 'unresolved_meaning'].includes(ambiguity.reason)) {
    return { action: RESOLUTION_ACTIONS.CONFIRM, reason: 'meaning_unresolved' };
  }

  if (existingCondition) {
    return { action: RESOLUTION_ACTIONS.RESOLVE_EXISTING, reason: 'existing_condition_limits_scope' };
  }

  if (candidateSetSafe) {
    return { action: RESOLUTION_ACTIONS.CONTINUE_SET, reason: 'candidate_set_preserves_reading_intent' };
  }

  return { action: RESOLUTION_ACTIONS.CONFIRM, reason: 'interpretation_changes_search_scope' };
}
