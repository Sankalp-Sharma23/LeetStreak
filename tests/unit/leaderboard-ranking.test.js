import {
  getTotalSolved,
  getStreak,
  getRating,
  sortFriends
} from '../../src/shared/ranking-manager.js';

describe('Leaderboard Ranking Order & Contest Rating Resolution', () => {
  const userAlpha = {
    profile: { username: 'Alpha' },
    stats: { total: 450, streak: 5, easy: 200, medium: 200, hard: 50 },
    contest: { rating: 1850, attended: 12, ranking: 5400 }
  };

  const userBeta = {
    profile: { username: 'Beta' },
    stats: { total: 120, streak: 42, easy: 80, medium: 35, hard: 5 },
    contest: { rating: 1420, attended: 4, ranking: 32000 }
  };

  const userGamma = {
    profile: { username: 'Gamma' },
    stats: { total: 800, streak: 12, easy: 300, medium: 400, hard: 100 },
    contest: { rating: 2150, attended: 25, ranking: 1100 }
  };

  const userDeltaUnrated = {
    profile: { username: 'Delta' },
    stats: { total: 300, streak: 8, easy: 150, medium: 140, hard: 10 },
    contest: { rating: 0, attended: 0, ranking: 0 } // Never attended contests
  };

  const userEpsilonSupabaseShape = {
    username: 'Epsilon',
    total_solved: 450,
    current_streak: 20,
    contest_rating: 1600
  };

  describe('1. Metric Getters & Normalization', () => {
    test('getTotalSolved extracts correctly from nested stats, flat total_solved, or difficulty sums', () => {
      expect(getTotalSolved(userAlpha)).toBe(450);
      expect(getTotalSolved(userBeta)).toBe(120);
      expect(getTotalSolved(userEpsilonSupabaseShape)).toBe(450);

      // Sums sub-counts if total is omitted
      const userWithoutTotal = { stats: { easy: 10, medium: 20, hard: 30 } };
      expect(getTotalSolved(userWithoutTotal)).toBe(60);

      // Safe fallback on empty
      expect(getTotalSolved(null)).toBe(0);
      expect(getTotalSolved({})).toBe(0);
    });

    test('getStreak extracts streak from stats.streak or current_streak', () => {
      expect(getStreak(userAlpha)).toBe(5);
      expect(getStreak(userBeta)).toBe(42);
      expect(getStreak(userEpsilonSupabaseShape)).toBe(20);
      expect(getStreak(null)).toBe(0);
    });

    test('getRating extracts contest rating or defaults to 0 for unrated users', () => {
      expect(getRating(userAlpha)).toBe(1850);
      expect(getRating(userGamma)).toBe(2150);
      expect(getRating(userDeltaUnrated)).toBe(0);
      expect(getRating(userEpsilonSupabaseShape)).toBe(1600);
      expect(getRating(null)).toBe(0);
    });
  });

  describe('2. Solved Ranking Order (Highest Solved at the Top)', () => {
    test('sorts users in descending order of total problems solved with secondary tiebreakers', () => {
      const users = [userBeta, userAlpha, userGamma, userDeltaUnrated, userEpsilonSupabaseShape];

      const sorted = sortFriends(users, 'total');
      const names = sorted.map(u => u.profile?.username || u.username);
      // Expected Solved counts: Gamma (800) > Alpha (450, streak 5) vs Epsilon (450, streak 20) => Epsilon then Alpha > Delta (300) > Beta (120)
      expect(names).toEqual(['Gamma', 'Epsilon', 'Alpha', 'Delta', 'Beta']);
      expect(getTotalSolved(sorted[0])).toBe(800);
      expect(getTotalSolved(sorted[sorted.length - 1])).toBe(120);
    });
  });

  describe('3. Streak Ranking Order (Longest Streak at the Top)', () => {
    test('sorts users in descending order of personal streak with secondary tiebreakers', () => {
      const users = [userAlpha, userGamma, userDeltaUnrated, userBeta, userEpsilonSupabaseShape];

      const sorted = sortFriends(users, 'streak');
      const names = sorted.map(u => u.profile?.username || u.username);
      // Expected Streaks: Beta (42) > Epsilon (20) > Gamma (12) > Delta (8) > Alpha (5)
      expect(names).toEqual(['Beta', 'Epsilon', 'Gamma', 'Delta', 'Alpha']);
      expect(getStreak(sorted[0])).toBe(42);
      expect(getStreak(sorted[sorted.length - 1])).toBe(5);
    });
  });

  describe('4. Rating Ranking Order (Highest Rating at Top, Unrated at Bottom)', () => {
    test('sorts users in descending order of LeetCode contest rating', () => {
      const users = [userBeta, userAlpha, userGamma, userDeltaUnrated, userEpsilonSupabaseShape];

      const sorted = sortFriends(users, 'rating');
      const names = sorted.map(u => u.profile?.username || u.username);
      // Expected Ratings: Gamma (2150) > Alpha (1850) > Epsilon (1600) > Beta (1420) > Delta (0 - Unrated)
      expect(names).toEqual(['Gamma', 'Alpha', 'Epsilon', 'Beta', 'Delta']);
      expect(getRating(sorted[0])).toBe(2150);
      expect(getRating(sorted[sorted.length - 1])).toBe(0);
    });
  });
});
