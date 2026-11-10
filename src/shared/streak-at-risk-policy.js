/**
 * Streak At Risk Notification Policy
 *
 * Requirements:
 * - Send at most 2 times a day.
 * - Window 1: Before 12:00 PM (noon) — max 1 notification.
 * - Window 2: Between 9:00 PM and 3:00 AM (21:00 - 03:00) — max 1 notification.
 * - Outside these windows (12:00 PM to 8:59 PM): Never send.
 * - Condition: User has active streak (> 0) and has NOT solved a problem today.
 */

export function getStreakAtRiskSlot(date = new Date()) {
  const hour = date.getHours();
  // 1. Night slot: 9:00 PM to 3:00 AM (21:00 to 02:59)
  if (hour >= 21 || hour < 3) {
    return 'night';
  }
  // 2. Morning slot: before 12:00 PM (03:00 to 11:59)
  if (hour < 12) {
    return 'morning';
  }
  // 3. Afternoon / Evening (12:00 PM to 8:59 PM): No alerts
  return null;
}

export function getLocalDayKey(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function canDeliverStreakAtRisk({
  now = new Date(),
  deliveredState = null,
  hasSolvedToday = false,
  streak = 0
}) {
  if (streak <= 0 || hasSolvedToday) {
    return { allowed: false, reason: 'no_risk' };
  }

  const slot = getStreakAtRiskSlot(now);
  if (!slot) {
    return { allowed: false, reason: 'outside_allowed_hours' };
  }

  const dayKey = getLocalDayKey(now);
  const deliveredSlots = deliveredState?.date === dayKey && Array.isArray(deliveredState.slots)
    ? deliveredState.slots
    : [];

  if (deliveredSlots.includes(slot)) {
    return { allowed: false, reason: 'already_delivered_for_slot', slot };
  }

  return { allowed: true, slot, dayKey };
}

export function recordStreakAtRiskDelivery(deliveredState, dayKey, slot) {
  const existingSlots = deliveredState?.date === dayKey && Array.isArray(deliveredState.slots)
    ? deliveredState.slots
    : [];

  return {
    date: dayKey,
    slots: Array.from(new Set([...existingSlots, slot]))
  };
}
