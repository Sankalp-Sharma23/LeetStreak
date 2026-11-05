/**
 * Activity Detector - Detects significant events for notifications
 * Uses UTC dates and idempotent logic
 */

const getTodayUTC = () => new Date().toISOString().split('T')[0];
const getYesterdayUTC = () => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().split('T')[0];
};

/**
 * Check if the user has at least one ACCEPTED solve today (UTC).
 * Uses allAcceptedSubmissions so that wrong answers / TLE don't count.
 * @param {Array} allAcceptedSubmissions - Array of {timestamp, titleSlug} objects
 * @returns {boolean}
 */
export function detectSolvedToday(allAcceptedSubmissions) {
  if (!Array.isArray(allAcceptedSubmissions) || allAcceptedSubmissions.length === 0) {
    return false;
  }

  const todayUTC = getTodayUTC();

  return allAcceptedSubmissions.some(sub => {
    const ts = parseInt(sub.timestamp, 10);
    if (isNaN(ts) || ts <= 0) return false;
    return new Date(ts * 1000).toISOString().split('T')[0] === todayUTC;
  });
}

export function hasNewActivity(currentData, previousData) {
  const accepted = currentData.allAcceptedSubmissions || [];
  if (!previousData) return detectSolvedToday(accepted);

  const solvedToday = detectSolvedToday(accepted);
  const totalIncreased = (currentData.stats?.total || 0) > (previousData.stats?.total || 0);

  return solvedToday || totalIncreased;
}

export function detectMilestone(streak) {
  return [7, 30, 100].includes(streak);
}

/**
 * Check if the user's streak is at risk (has a streak but hasn't solved today
 * or yesterday with an ACCEPTED solution).
 * @param {Array} allAcceptedSubmissions - Array of accepted submission objects
 * @param {number} streak - Current streak value
 * @returns {boolean}
 */
export function isStreakAtRisk(allAcceptedSubmissions, streak) {
  if (streak === 0) return false;

  const yesterdayUTC = getYesterdayUTC();
  const todayUTC = getTodayUTC();

  const accepted = Array.isArray(allAcceptedSubmissions) ? allAcceptedSubmissions : [];

  const solvedTodayOrYesterday = accepted.some(sub => {
    const ts = parseInt(sub.timestamp, 10);
    if (isNaN(ts) || ts <= 0) return false;
    const d = new Date(ts * 1000).toISOString().split('T')[0];
    return d === todayUTC || d === yesterdayUTC;
  });

  return !solvedTodayOrYesterday;
}

export function buildNotificationMessage(username, eventType, data) {
  switch (eventType) {
    case 'solved_today':
      return `${username} solved today! 🎯`;
    case 'milestone':
      return `${username} hit ${data.streak} day streak! 🔥`;
    case 'streak_at_risk':
      return `Your ${data.streak} day streak needs attention! ⚠️`;
    default:
      return `${username} updated their progress`;
  }
}
