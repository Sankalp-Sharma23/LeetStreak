import { describe, it, expect } from '@jest/globals';
import {
  isAcceptedVerdict,
  isFailedVerdict,
  isFreshAcceptedResult,
  parseLeetCodePerformance
} from '../../src/shared/battle-submission.js';

describe('LeetCode battle submission result parsing', () => {
  it('accepts only the Accepted verdict, not execution or unsuccessful outcomes', () => {
    expect(isAcceptedVerdict('Accepted\nRuntime: 12 ms\nMemory: 43.1 MB')).toBe(true);
    expect(isAcceptedVerdict('Accepted (15/15 testcases passed)')).toBe(true);
    expect(isAcceptedVerdict('Accepted')).toBe(true);
    expect(isAcceptedVerdict('Accepted 5.4M')).toBe(false);
    expect(isAcceptedVerdict('Accepted (54.2%)')).toBe(false);
    expect(isAcceptedVerdict('Accepted Solutions')).toBe(false);
    expect(isAcceptedVerdict('Not Accepted')).toBe(false);
    expect(isAcceptedVerdict('Pending')).toBe(false);
    for (const verdict of ['Wrong Answer', 'Time Limit Exceeded', 'Memory Limit Exceeded', 'Compilation Error', 'Runtime Error']) {
      expect(isAcceptedVerdict(verdict)).toBe(false);
      expect(isFailedVerdict(verdict)).toBe(true);
    }
    expect(isAcceptedVerdict('Run: Accepted')).toBe(false);
  });

  it('extracts only reported runtime and memory values and preserves missing data', () => {
    expect(parseLeetCodePerformance('Accepted\nRuntime: 12 ms\nMemory: 43.1 MB')).toEqual({ runtimeMs: 12, memoryMb: 43.1 });
    expect(parseLeetCodePerformance('Accepted\nRuntime: 0 ms')).toEqual({ runtimeMs: 0, memoryMb: null });
    expect(parseLeetCodePerformance('Accepted')).toEqual({ runtimeMs: null, memoryMb: null });
  });

  it('requires a non-accepted to accepted verdict transition, even when the submission id changes', () => {
    const baseline = { accepted: true, submissionId: '10', previousSubmissionId: '10', resultText: 'Accepted', previousResultText: 'Accepted' };
    expect(isFreshAcceptedResult(baseline)).toBe(false);
    expect(isFreshAcceptedResult({ ...baseline, submissionId: '11', sawResultChange: true })).toBe(false);
    expect(isFreshAcceptedResult({
      ...baseline,
      submissionId: '11',
      previousResultText: '',
      sawResultChange: false
    })).toBe(false);
    expect(isFreshAcceptedResult({ ...baseline, resultText: 'Accepted Runtime: 10 ms', sawResultChange: true })).toBe(false);
    expect(isFreshAcceptedResult({ ...baseline, submissionId: null, previousSubmissionId: null,
      resultText: 'Accepted Runtime: 10 ms', previousResultText: 'Judging...', sawResultChange: true })).toBe(true);
    expect(isFreshAcceptedResult({ ...baseline, submissionId: '11', previousResultText: 'Pending', sawResultChange: true })).toBe(true);
    expect(isFreshAcceptedResult({ ...baseline, accepted: false, submissionId: '11' })).toBe(false);
  });
});
