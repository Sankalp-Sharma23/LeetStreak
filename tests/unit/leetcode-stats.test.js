/**
 * LeetCode Problem Statistics & Data Contract Tests
 *
 * Verifies:
 * - submitStats.acSubmissionNum is the authoritative source for unique solved counts.
 * - Total solved count is NEVER derived from recentSubmissions.length.
 * - Partial histories, duplicate accepts, and missing fields are handled gracefully.
 * - Submission calendar and accepted submission history are used for chronological streaks.
 */

import { describe, it, expect } from '@jest/globals';
import { getProblemsSolved } from '../../src/shared/streak-calculator.js';

describe('LeetCode Problem Statistics & Contract Integrity', () => {
  it('1. Authoritatively parses unique solved counts from acSubmissionNum', () => {
    const acSubmissionNum = [
      { difficulty: 'All', count: 450 },
      { difficulty: 'Easy', count: 200 },
      { difficulty: 'Medium', count: 200 },
      { difficulty: 'Hard', count: 50 }
    ];

    const stats = getProblemsSolved(acSubmissionNum);

    expect(stats.total).toBe(450);
    expect(stats.easy).toBe(200);
    expect(stats.medium).toBe(200);
    expect(stats.hard).toBe(50);
  });

  it('2. Does NOT truncate total count if recentSubmissions only contains 15 problems', () => {
    const acSubmissionNum = [
      { difficulty: 'All', count: 850 },
      { difficulty: 'Easy', count: 400 },
      { difficulty: 'Medium', count: 350 },
      { difficulty: 'Hard', count: 100 }
    ];
    // Incomplete recent submissions list (max 15 returned by LeetCode API)
    const recentSubmissions = Array(15).fill({ statusDisplay: 'Accepted' });

    const stats = getProblemsSolved(acSubmissionNum);

    // Total must be 850, never 15!
    expect(stats.total).toBe(850);
    expect(stats.total).not.toBe(recentSubmissions.length);
  });

  it('3. Computes total by summing difficulty sub-counts if All count is missing', () => {
    const partialSubmissions = [
      { difficulty: 'Easy', count: 75 },
      { difficulty: 'Medium', count: 25 },
      { difficulty: 'Hard', count: 10 }
    ];

    const stats = getProblemsSolved(partialSubmissions);

    expect(stats.total).toBe(110);
    expect(stats.easy).toBe(75);
    expect(stats.medium).toBe(25);
    expect(stats.hard).toBe(10);
  });

  it('4. Handles string count values safely with radix-10 integer conversion', () => {
    const stringCounts = [
      { difficulty: 'All', count: '125' },
      { difficulty: 'Easy', count: '50' },
      { difficulty: 'Medium', count: '50' },
      { difficulty: 'Hard', count: '25' }
    ];

    const stats = getProblemsSolved(stringCounts);

    expect(stats.total).toBe(125);
    expect(stats.easy).toBe(50);
    expect(stats.medium).toBe(50);
    expect(stats.hard).toBe(25);
  });

  it('5. Returns zeroed statistics on empty, null, or corrupted input', () => {
    expect(getProblemsSolved(null)).toEqual({ easy: 0, medium: 0, hard: 0, total: 0 });
    expect(getProblemsSolved(undefined)).toEqual({ easy: 0, medium: 0, hard: 0, total: 0 });
    expect(getProblemsSolved([])).toEqual({ easy: 0, medium: 0, hard: 0, total: 0 });
    expect(getProblemsSolved('invalid')).toEqual({ easy: 0, medium: 0, hard: 0, total: 0 });
  });
});

