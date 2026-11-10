import { describe, it, expect } from '@jest/globals';
import {
  isAcceptedVerdict,
  isFailedVerdict,
  isFreshAcceptedResult
} from '../../src/shared/battle-submission.js';

describe('Battle Solve Robustness & False-Positive Prevention', () => {
  describe('1. Precision Verdict Parsing (No False Positives)', () => {
    it('strictly distinguishes true Accepted verdicts from description statistics', () => {
      // True accepted verdicts
      expect(isAcceptedVerdict('Accepted')).toBe(true);
      expect(isAcceptedVerdict('Accepted\nRuntime: 32 ms\nMemory: 48.2 MB')).toBe(true);
      expect(isAcceptedVerdict('Accepted (25/25 testcases passed)')).toBe(true);
      expect(isAcceptedVerdict('Accepted at Nov 10, 2026')).toBe(true);

      // LeetCode problem description metadata (MUST be rejected)
      expect(isAcceptedVerdict('Accepted 5.4M')).toBe(false);
      expect(isAcceptedVerdict('Accepted: 54.2%')).toBe(false);
      expect(isAcceptedVerdict('Accepted Solutions (1.2K)')).toBe(false);
      expect(isAcceptedVerdict('Accepted Submissions: 10.5M')).toBe(false);
      expect(isAcceptedVerdict('Acceptance Rate 52.4%')).toBe(false);
    });

    it('immediately classifies failure outcomes without ambiguity', () => {
      const failures = [
        'Wrong Answer',
        'Wrong Answer\n15 / 60 testcases passed',
        'Time Limit Exceeded',
        'Memory Limit Exceeded',
        'Runtime Error\nLine 15: IndexError: list index out of range',
        'Compile Error\nLine 3: error: cannot find symbol',
        'Compilation Error',
        'Output Limit Exceeded'
      ];

      for (const fail of failures) {
        expect(isFailedVerdict(fail)).toBe(true);
        expect(isAcceptedVerdict(fail)).toBe(false);
      }
    });

    it('treats intermediate states (Pending, Judging) as neither accepted nor failed', () => {
      expect(isAcceptedVerdict('Judging...')).toBe(false);
      expect(isFailedVerdict('Judging...')).toBe(false);
      expect(isAcceptedVerdict('Pending')).toBe(false);
      expect(isFailedVerdict('Pending')).toBe(false);
    });
  });

  describe('2. State Transition Tracking (isFreshAcceptedResult)', () => {
    it('detects fresh solve when transitioning from Judging/Pending to Accepted', () => {
      const result = isFreshAcceptedResult({
        accepted: true,
        submissionId: '123456',
        previousSubmissionId: '123450',
        resultText: 'Accepted\nRuntime: 15 ms',
        previousResultText: 'Judging...',
        sawResultChange: true
      });
      expect(result).toBe(true);
    });

    it('rejects duplicate or stale accepted result when no transition occurred', () => {
      const result = isFreshAcceptedResult({
        accepted: true,
        submissionId: '123456',
        previousSubmissionId: '123456',
        resultText: 'Accepted',
        previousResultText: 'Accepted',
        sawResultChange: false
      });
      expect(result).toBe(false);
    });
  });

  describe('3. Submission ID Extraction Resilience', () => {
    function extractSubmissionIdFromMock(hrefOrPath) {
      // 1. /submissions/detail/<id>/
      const fromDetail = hrefOrPath.match(/detail\/(?:[^/]+\/)?(\d+)/)?.[1];
      if (fromDetail) return fromDetail;

      // 2. /problems/<slug>/submissions/<id>/
      const fromProbSub = hrefOrPath.match(/\/submissions\/(?:detail\/)?(\d+)/)?.[1];
      if (fromProbSub) return fromProbSub;

      return null;
    }

    it('extracts ID from legacy /submissions/detail/<id>/ format', () => {
      expect(extractSubmissionIdFromMock('https://leetcode.com/submissions/detail/987654321/')).toBe('987654321');
    });

    it('extracts ID from modern Next.js /problems/<slug>/submissions/<id>/ format', () => {
      expect(extractSubmissionIdFromMock('/problems/two-sum/submissions/1234567890/')).toBe('1234567890');
    });

    it('extracts ID when query parameters or trailing slashes vary', () => {
      expect(extractSubmissionIdFromMock('/problems/add-two-numbers/submissions/555444333')).toBe('555444333');
    });
  });
});

