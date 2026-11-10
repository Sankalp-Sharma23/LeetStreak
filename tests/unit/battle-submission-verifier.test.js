import { describe, expect, it } from '@jest/globals';
import { findAcceptedBattleSubmission, isValidBattleSolveInput } from '../../supabase/functions/_shared/battle-submission-verifier.js';

const validInput = {
  battleId: 'a2db3520-fbf2-47ba-a317-c5a57ca0dce8',
  problemSlug: 'two-sum',
  submissionId: '123456789',
};

describe('server-side battle submission verification', () => {
  it('requires a real battle UUID, problem slug, and numeric LeetCode submission ID', () => {
    expect(isValidBattleSolveInput(validInput)).toBe(true);
    expect(isValidBattleSolveInput({ ...validInput, submissionId: 'client_123' })).toBe(false);
  });

  it('accepts only a LeetCode submission matching both ID and battle problem', () => {
    const submissions = [{ id: '123456789', titleSlug: 'two-sum', timestamp: '200' }];
    expect(findAcceptedBattleSubmission(submissions, {
      submissionId: '123456789', problemSlug: 'two-sum', matchStartMs: 100_000,
    })).toEqual(submissions[0]);
    expect(findAcceptedBattleSubmission(submissions, {
      submissionId: '123456789', problemSlug: 'add-two-numbers', matchStartMs: 100_000,
    })).toBeNull();
  });

  it('rejects submissions made before the battle or after its deadline', () => {
    const submissions = [{ id: '123456789', titleSlug: 'two-sum', timestamp: '99' }];
    expect(findAcceptedBattleSubmission(submissions, {
      submissionId: '123456789', problemSlug: 'two-sum', matchStartMs: 100_000,
    })).toBeNull();

    submissions[0].timestamp = '201';
    expect(findAcceptedBattleSubmission(submissions, {
      submissionId: '123456789', problemSlug: 'two-sum', matchStartMs: 100_000, matchDeadlineMs: 200_000,
    })).toBeNull();
  });

  it('fails closed when LeetCode returns no usable accepted history', () => {
    expect(findAcceptedBattleSubmission(null, {
      submissionId: '123456789', problemSlug: 'two-sum', matchStartMs: 0,
    })).toBeNull();
  });
});
