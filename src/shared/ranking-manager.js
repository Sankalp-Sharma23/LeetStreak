/**
 * Canonical Ranking & Leaderboard Manager
 *
 * Responsibilities:
 * - Robust metric extraction for total solved, streak, and contest rating.
 * - Deterministic descending sorting with multi-level tiebreakers.
 * - Uniform handling of user profiles across offline cache and Supabase shapes.
 */

export function getTotalSolved(user) {
  if (!user) return 0;
  const raw = user.stats?.total ?? user.stats?.totalSolved ?? user.total_solved ?? user.totalSolved;
  if (raw !== undefined && raw !== null) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  const easy = parseInt(user.stats?.easy ?? user.easy_solved ?? 0, 10) || 0;
  const med = parseInt(user.stats?.medium ?? user.medium_solved ?? 0, 10) || 0;
  const hard = parseInt(user.stats?.hard ?? user.hard_solved ?? 0, 10) || 0;
  return easy + med + hard;
}

export function getStreak(user) {
  if (!user) return 0;
  const raw = user.stats?.streak ?? user.stats?.currentStreak ?? user.current_streak ?? user.currentStreak;
  const parsed = parseInt(raw, 10);
  return !isNaN(parsed) && parsed >= 0 ? parsed : 0;
}

export function getRating(user) {
  if (!user) return 0;
  const raw = user.contest?.rating ?? user.contestRanking?.rating ?? user.contest_rating;
  const parsed = Math.round(Number(raw));
  return !isNaN(parsed) && parsed >= 0 ? parsed : 0;
}

export function getUsername(user) {
  return (user?.profile?.username || user?.username || '').toLowerCase();
}

/**
 * Sorts friends and self based on the active ranking criteria.
 *
 * Ranking criteria:
 * - 'total' (Solved): highest total problems solved first (descending).
 * - 'streak': longest current personal streak first (descending).
 * - 'rating': highest contest rating first (descending), unrated users (0) at bottom.
 *
 * Deterministic secondary tiebreakers:
 * Solved -> Streak -> Rating -> Username (A-Z)
 * Streak -> Solved -> Rating -> Username (A-Z)
 * Rating -> Solved -> Streak -> Username (A-Z)
 */
export function sortFriends(friendsList, sortBy = 'total') {
  if (!Array.isArray(friendsList)) return [];

  return [...friendsList].sort((a, b) => {
    if (sortBy === 'streak') {
      const streakDiff = getStreak(b) - getStreak(a);
      if (streakDiff !== 0) return streakDiff;
      const totalDiff = getTotalSolved(b) - getTotalSolved(a);
      if (totalDiff !== 0) return totalDiff;
      const ratingDiff = getRating(b) - getRating(a);
      if (ratingDiff !== 0) return ratingDiff;
      return getUsername(a).localeCompare(getUsername(b));
    }

    if (sortBy === 'rating') {
      const ratingDiff = getRating(b) - getRating(a);
      if (ratingDiff !== 0) return ratingDiff;
      const totalDiff = getTotalSolved(b) - getTotalSolved(a);
      if (totalDiff !== 0) return totalDiff;
      const streakDiff = getStreak(b) - getStreak(a);
      if (streakDiff !== 0) return streakDiff;
      return getUsername(a).localeCompare(getUsername(b));
    }

    // Default: 'total' (problems solved)
    const totalDiff = getTotalSolved(b) - getTotalSolved(a);
    if (totalDiff !== 0) return totalDiff;
    const streakDiff = getStreak(b) - getStreak(a);
    if (streakDiff !== 0) return streakDiff;
    const ratingDiff = getRating(b) - getRating(a);
    if (ratingDiff !== 0) return ratingDiff;
    return getUsername(a).localeCompare(getUsername(b));
  });
}

