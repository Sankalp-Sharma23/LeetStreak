/**
 * Canonical Personal Streak Engine
 *
 * Responsibilities:
 * - Calculate strictly personal current streak and longest streak.
 * - Normalize timestamps into user-configured or device IANA timezone.
 * - Deduplicate multiple accepted solves on the same calendar day into a single day.
 * - Preserve current streak throughout today if yesterday was solved.
 * - Support both allAcceptedSubmissions list and submissionCalendar for full historical coverage.
 * - Calculate unique problem breakdown by difficulty from submitStats.
 */

/**
 * Convert a Unix timestamp (in seconds) to a YYYY-MM-DD date string in the target timezone.
 * @param {number|string} tsSeconds
 * @param {string} [timezone] - Valid IANA timezone identifier (e.g., 'America/New_York', 'Asia/Kolkata', 'UTC')
 * @returns {string} YYYY-MM-DD
 */
export function timestampToDateString(tsSeconds, timezone) {
  const ts = typeof tsSeconds === 'string' ? parseInt(tsSeconds, 10) : tsSeconds;
  if (isNaN(ts) || ts <= 0) return '';

  const tz = timezone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC') || 'UTC';
  
  try {
    const date = new Date(ts * 1000);
    // 'en-CA' outputs ISO standard YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  } catch {
    // Fallback to UTC if timezone is invalid
    return new Date(ts * 1000).toISOString().split('T')[0];
  }
}

/**
 * Get unique sorted ascending calendar dates on which at least one problem was solved.
 * Combines accepted submissions list with submissionCalendar for complete coverage.
 *
 * @param {Array} [allAcceptedSubmissions] - Array of { timestamp, titleSlug }
 * @param {Object|string} [submissionCalendar] - LeetCode submissionCalendar object or JSON string
 * @param {string} [timezone] - Target IANA timezone
 * @returns {string[]} Sorted array of unique YYYY-MM-DD date strings
 */
export function getAcceptedSolveDates(allAcceptedSubmissions = [], submissionCalendar = null, timezone = null) {
  const dateSet = new Set();

  // 1. Ingest accepted submissions array (verifiably accepted)
  if (Array.isArray(allAcceptedSubmissions)) {
    for (const sub of allAcceptedSubmissions) {
      if (sub && sub.timestamp) {
        const dStr = timestampToDateString(sub.timestamp, timezone);
        if (dStr) dateSet.add(dStr);
      }
    }
  }

  // 2. Ingest submission calendar (handles long historical multi-year records beyond the limit)
  if (submissionCalendar) {
    try {
      const cal = typeof submissionCalendar === 'string' ? JSON.parse(submissionCalendar) : submissionCalendar;
      if (cal && typeof cal === 'object') {
        for (const [tsStr, count] of Object.entries(cal)) {
          if (parseInt(count, 10) > 0) {
            const dStr = timestampToDateString(tsStr, timezone);
            if (dStr) dateSet.add(dStr);
          }
        }
      }
    } catch (e) {
      console.warn('[StreakCalculator] Error parsing submissionCalendar:', e);
    }
  }

  return Array.from(dateSet).sort();
}

/**
 * Calculate current streak, longest streak, and streak risk status.
 *
 * @param {Array|Object} submissionsOrCalendar - Either allAcceptedSubmissions array or submissionCalendar
 * @param {Object|string|null} [optionalCalendar] - submissionCalendar if first param was array
 * @param {string|null} [timezone] - User's IANA timezone
 * @returns {{ currentStreak: number, longestStreak: number, isAtRisk: boolean, solvedToday: boolean, solveDates: string[] }}
 */
export function calculateStreak(submissionsOrCalendar, optionalCalendar = null, timezone = null) {
  let acceptedList = [];
  let calendarObj = null;

  // Polymorphic input handling for backwards compatibility with tests
  if (Array.isArray(submissionsOrCalendar)) {
    acceptedList = submissionsOrCalendar;
    calendarObj = optionalCalendar;
  } else if (submissionsOrCalendar && typeof submissionsOrCalendar === 'object') {
    calendarObj = submissionsOrCalendar;
    if (typeof optionalCalendar === 'string') {
      timezone = optionalCalendar;
    }
  }

  const sortedDates = getAcceptedSolveDates(acceptedList, calendarObj, timezone);

  if (sortedDates.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      isAtRisk: false,
      solvedToday: false,
      solveDates: []
    };
  }

  // Calculate day difference between two YYYY-MM-DD dates in UTC day terms
  function dayDiff(dateStrEarlier, dateStrLater) {
    const d1 = new Date(dateStrEarlier + 'T00:00:00Z');
    const d2 = new Date(dateStrLater + 'T00:00:00Z');
    return Math.round((d2 - d1) / 86400000);
  }

  // 1. Compute Longest Streak (Full ascending scan)
  let longestStreak = 1;
  let currentRun = 1;

  for (let i = 1; i < sortedDates.length; i++) {
    const diff = dayDiff(sortedDates[i - 1], sortedDates[i]);
    if (diff === 1) {
      currentRun++;
      if (currentRun > longestStreak) {
        longestStreak = currentRun;
      }
    } else if (diff > 1) {
      currentRun = 1;
    }
  }

  // 2. Compute Current Streak relative to today in target timezone
  const nowTs = Math.floor(Date.now() / 1000);
  const todayStr = timestampToDateString(nowTs, timezone);
  const yesterdayTs = Math.floor((Date.now() - 86400000) / 1000);
  const yesterdayStr = timestampToDateString(yesterdayTs, timezone);

  const solvedToday = sortedDates.includes(todayStr);
  const mostRecentDate = sortedDates[sortedDates.length - 1];

  // If the user has not solved today AND has not solved yesterday, streak is broken (0)
  if (mostRecentDate !== todayStr && mostRecentDate !== yesterdayStr) {
    return {
      currentStreak: 0,
      longestStreak,
      isAtRisk: false,
      solvedToday: false,
      solveDates: sortedDates
    };
  }

  // Walk backward from mostRecentDate to count consecutive days
  let currentStreak = 0;
  let expectedDate = new Date(mostRecentDate + 'T00:00:00Z');

  for (let i = sortedDates.length - 1; i >= 0; i--) {
    const expectedStr = expectedDate.toISOString().split('T')[0];
    if (sortedDates[i] === expectedStr) {
      currentStreak++;
      expectedDate.setUTCDate(expectedDate.getUTCDate() - 1);
    } else if (sortedDates[i] < expectedStr) {
      // Gap detected; streak walk terminates
      break;
    }
  }

  // If currentStreak exceeds historical longestStreak, update longestStreak
  if (currentStreak > longestStreak) {
    longestStreak = currentStreak;
  }

  // Streak is at risk if user has an active streak (>0) but has not yet solved today
  const isAtRisk = currentStreak > 0 && !solvedToday;

  return {
    currentStreak,
    longestStreak,
    isAtRisk,
    solvedToday,
    solveDates: sortedDates
  };
}

/**
 * Check if the user has solved at least one problem today.
 * @param {Array} allAcceptedSubmissions
 * @param {Object} [submissionCalendar]
 * @param {string} [timezone]
 * @returns {boolean}
 */
export function hasSolvedToday(allAcceptedSubmissions, submissionCalendar = null, timezone = null) {
  const dates = getAcceptedSolveDates(allAcceptedSubmissions, submissionCalendar, timezone);
  const nowTs = Math.floor(Date.now() / 1000);
  const todayStr = timestampToDateString(nowTs, timezone);
  return dates.includes(todayStr);
}

/**
 * Extract canonical unique solved problem counts from submitStats.acSubmissionNum.
 * @param {Array} acSubmissionNum - Array of { difficulty, count }
 * @returns {{ easy: number, medium: number, hard: number, total: number }}
 */
export function getProblemsSolved(acSubmissionNum) {
  const stats = { easy: 0, medium: 0, hard: 0, total: 0 };
  if (!Array.isArray(acSubmissionNum)) return stats;

  for (const item of acSubmissionNum) {
    const count = typeof item.count === 'number' ? item.count : parseInt(item.count, 10) || 0;
    switch (item.difficulty) {
      case 'Easy': stats.easy = count; break;
      case 'Medium': stats.medium = count; break;
      case 'Hard': stats.hard = count; break;
      case 'All': stats.total = count; break;
    }
  }

  // If total is 0 but individual counts exist, sum them
  if (stats.total === 0 && (stats.easy > 0 || stats.medium > 0 || stats.hard > 0)) {
    stats.total = stats.easy + stats.medium + stats.hard;
  }

  return stats;
}

/**
 * Format relative time since last update.
 * @param {number} lastUpdated - Timestamp in ms
 * @returns {string}
 */
export function getTimeSinceUpdate(lastUpdated) {
  if (!lastUpdated) return 'Never';
  const diffMs = Date.now() - lastUpdated;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

/**
 * Check if data needs refresh (older than 15 minutes).
 * @param {number} lastUpdated - Timestamp in ms
 * @returns {boolean}
 */
export function needsRefresh(lastUpdated) {
  if (!lastUpdated) return true;
  return (Date.now() - lastUpdated) > 15 * 60 * 1000;
}
