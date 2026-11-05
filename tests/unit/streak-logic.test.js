/**
 * Unit Tests - Streak Calculation Logic
 * Tests canonical personal streak calculations without external dependencies (no sinon)
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { calculateStreak, needsRefresh, getAcceptedSolveDates, timestampToDateString } from '../../src/shared/streak-calculator.js';

describe('Streak Calculation Logic', () => {
  beforeEach(() => {
    // 2023-01-03 12:00:00 UTC
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2023-01-03T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Basic Personal Streak Calculation', () => {
    test('should increment streak when user solved on consecutive days', () => {
      const submissionCalendar = {
        // Today (2023-01-03)
        [Math.floor(Date.UTC(2023, 0, 3, 0, 0, 0) / 1000)]: 3,
        // Yesterday (2023-01-02)
        [Math.floor(Date.UTC(2023, 0, 2, 0, 0, 0) / 1000)]: 2,
        // Day before (2023-01-01)
        [Math.floor(Date.UTC(2023, 0, 1, 0, 0, 0) / 1000)]: 1
      };

      const result = calculateStreak(submissionCalendar);
      expect(result.currentStreak).toBe(3);
      expect(result.longestStreak).toBe(3);
      expect(result.solvedToday).toBe(true);
      expect(result.isAtRisk).toBe(false);
    });

    test('should maintain streak during active today if user solved yesterday (Prompt Spec)', () => {
      const submissionCalendar = {
        // Yesterday only (2023-01-02)
        [Math.floor(Date.UTC(2023, 0, 2, 0, 0, 0) / 1000)]: 2,
        // Day before (2023-01-01)
        [Math.floor(Date.UTC(2023, 0, 1, 0, 0, 0) / 1000)]: 1
      };

      const result = calculateStreak(submissionCalendar);
      // Streak should be 2, still active today, but marked at risk
      expect(result.currentStreak).toBe(2);
      expect(result.longestStreak).toBe(2);
      expect(result.solvedToday).toBe(false);
      expect(result.isAtRisk).toBe(true);
    });

    test('should reset streak to 0 when 2 days gap detected without today solve', () => {
      const submissionCalendar = {
        // 2 days ago (2023-01-01) - missed yesterday and today
        [Math.floor(Date.UTC(2023, 0, 1, 0, 0, 0) / 1000)]: 2
      };

      const result = calculateStreak(submissionCalendar);
      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(1);
    });

    test('should count multiple submissions on same day as single day', () => {
      const acceptedList = [
        { timestamp: Math.floor(Date.UTC(2023, 0, 3, 2, 0, 0) / 1000), titleSlug: 'two-sum' },
        { timestamp: Math.floor(Date.UTC(2023, 0, 3, 5, 30, 0) / 1000), titleSlug: 'add-two-numbers' },
        { timestamp: Math.floor(Date.UTC(2023, 0, 3, 10, 0, 0) / 1000), titleSlug: 'reverse-integer' }
      ];

      const result = calculateStreak(acceptedList);
      expect(result.currentStreak).toBe(1);
      expect(result.solveDates.length).toBe(1);
    });

    test('should preserve longest streak even when current streak breaks', () => {
      const submissionCalendar = {
        // 4 day run in past
        [Math.floor(Date.UTC(2022, 11, 20, 0, 0, 0) / 1000)]: 1,
        [Math.floor(Date.UTC(2022, 11, 21, 0, 0, 0) / 1000)]: 1,
        [Math.floor(Date.UTC(2022, 11, 22, 0, 0, 0) / 1000)]: 1,
        [Math.floor(Date.UTC(2022, 11, 23, 0, 0, 0) / 1000)]: 1,
        // Gap of days...
        // Today only
        [Math.floor(Date.UTC(2023, 0, 3, 0, 0, 0) / 1000)]: 1
      };

      const result = calculateStreak(submissionCalendar);
      expect(result.currentStreak).toBe(1);
      expect(result.longestStreak).toBe(4);
    });
  });

  describe('Timezone & Date Utilities', () => {
    test('timestampToDateString should format correctly for UTC', () => {
      const ts = Math.floor(Date.UTC(2023, 0, 3, 0, 0, 0) / 1000);
      const str = timestampToDateString(ts, 'UTC');
      expect(str).toBe('2023-01-03');
    });

    test('getAcceptedSolveDates deduplicates and sorts ascending', () => {
      const list = [
        { timestamp: 1672790400 }, // 2023-01-04
        { timestamp: 1672704000 }, // 2023-01-03
        { timestamp: 1672704100 }  // 2023-01-03
      ];
      const dates = getAcceptedSolveDates(list, null, 'UTC');
      expect(dates).toEqual(['2023-01-03', '2023-01-04']);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty submission input', () => {
      expect(calculateStreak([])).toEqual({
        currentStreak: 0,
        longestStreak: 0,
        isAtRisk: false,
        solvedToday: false,
        solveDates: []
      });
      expect(calculateStreak({})).toEqual({
        currentStreak: 0,
        longestStreak: 0,
        isAtRisk: false,
        solvedToday: false,
        solveDates: []
      });
      expect(calculateStreak(null)).toEqual({
        currentStreak: 0,
        longestStreak: 0,
        isAtRisk: false,
        solvedToday: false,
        solveDates: []
      });
    });
  });

  describe('Data Refresh Logic', () => {
    test('should need refresh when data is older than 15 minutes', () => {
      const sixteenMinutesAgo = Date.now() - (16 * 60 * 1000);
      expect(needsRefresh(sixteenMinutesAgo)).toBe(true);
    });

    test('should not need refresh when data is fresher than 15 minutes', () => {
      const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
      expect(needsRefresh(tenMinutesAgo)).toBe(false);
    });

    test('should need refresh when no timestamp provided', () => {
      expect(needsRefresh(null)).toBe(true);
      expect(needsRefresh(undefined)).toBe(true);
    });
  });
});
