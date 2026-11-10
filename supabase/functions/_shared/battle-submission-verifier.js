export function isValidBattleSolveInput({ battleId, problemSlug, submissionId }) {
  return typeof battleId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(battleId)
    && typeof problemSlug === 'string'
    && /^[a-z0-9-]{1,100}$/.test(problemSlug)
    && typeof submissionId === 'string'
    && /^\d{1,30}$/.test(submissionId);
}

export function findAcceptedBattleSubmission(submissions, {
  submissionId,
  problemSlug,
  matchStartMs,
  matchDeadlineMs = null,
}) {
  if (!Array.isArray(submissions) || !Number.isFinite(matchStartMs)) return null;

  const submission = submissions.find(item => String(item?.id) === String(submissionId));
  if (!submission || String(submission.titleSlug || '').toLowerCase() !== problemSlug) return null;

  const acceptedAt = Number(submission.timestamp) * 1000;
  if (!Number.isFinite(acceptedAt) || acceptedAt < matchStartMs) return null;
  if (Number.isFinite(matchDeadlineMs) && acceptedAt > matchDeadlineMs) return null;

  return submission;
}
