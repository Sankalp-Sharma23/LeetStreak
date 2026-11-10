/**
 * Centralized Notification Manager
 *
 * Responsibilities:
 * - Validate user settings before delivery (notifications_enabled, quiet hours, snooze).
 * - Deduplicate notifications using rolling event hashes.
 * - Guarantee dual delivery: always store in unread_notifications for in-app fallback toasts,
 *   and conditionally dispatch native Chrome desktop notifications.
 * - Track delivery states: QUEUED, DISPLAY_REQUESTED, FAILED, DISMISSED, CLICKED.
 * - Support notification clicks and routing.
 */

const NOTIFICATION_STORAGE_KEY = 'leetfriends_notifications';
let notificationQueue = Promise.resolve();

export const DELIVERY_STATES = {
  QUEUED: 'QUEUED',
  DISPLAY_REQUESTED: 'DISPLAY_REQUESTED',
  FAILED: 'FAILED',
  IN_APP_ONLY: 'IN_APP_ONLY',
  DISMISSED: 'DISMISSED',
  CLICKED: 'CLICKED'
};

/**
 * Retrieve notification state from storage
 */
export async function getNotificationState() {
  try {
    const result = await chrome.storage.local.get(NOTIFICATION_STORAGE_KEY);
    return result[NOTIFICATION_STORAGE_KEY] || {
      mutedUntilUTC: null,
      snoozedUntil: null,
      quietHours: { enabled: false, start: '22:00', end: '08:00' },
      lastNotified: {},
      recentHashes: {}
    };
  } catch (error) {
    console.error('[NotificationManager] Error getting notification state:', error);
    return {
      mutedUntilUTC: null,
      snoozedUntil: null,
      quietHours: { enabled: false, start: '22:00', end: '08:00' },
      lastNotified: {},
      recentHashes: {}
    };
  }
}

/**
 * Check if notifications are currently silenced (by settings, snooze, or quiet hours)
 */
export async function isNotificationMuted() {
  try {
    const settings = await chrome.storage.local.get([
      'notifications_enabled',
      NOTIFICATION_STORAGE_KEY
    ]);

    // 1. Explicit user toggle
    if (settings.notifications_enabled === false) {
      return true;
    }

    const state = settings[NOTIFICATION_STORAGE_KEY];
    if (!state) return false;

    const now = Date.now();

    // 2. Snooze active
    if (state.snoozedUntil && now < state.snoozedUntil) {
      return true;
    }

    // 3. Muted until UTC date
    if (state.mutedUntilUTC) {
      const todayUTC = new Date().toISOString().split('T')[0];
      if (state.mutedUntilUTC >= todayUTC) return true;
    }

    // 4. Quiet hours check
    if (state.quietHours && state.quietHours.enabled) {
      const currentMinutes = new Date().getHours() * 60 + new Date().getMinutes();
      const [startH, startM] = (state.quietHours.start || '22:00').split(':').map(Number);
      const [endH, endM] = (state.quietHours.end || '08:00').split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      if (startMinutes > endMinutes) {
        // Over midnight (e.g. 22:00 to 08:00)
        if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
          return true;
        }
      } else {
        if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
          return true;
        }
      }
    }

    return false;
  } catch (err) {
    console.warn('[NotificationManager] isNotificationMuted error:', err);
    return false;
  }
}

export async function setNotificationMuted(untilUTC) {
  const state = await getNotificationState();
  state.mutedUntilUTC = untilUTC;
  await chrome.storage.local.set({ [NOTIFICATION_STORAGE_KEY]: state });
}

export async function setSnooze(hours = 1) {
  const state = await getNotificationState();
  state.snoozedUntil = Date.now() + (hours * 3600 * 1000);
  await chrome.storage.local.set({ [NOTIFICATION_STORAGE_KEY]: state });
}

/**
 * Centralized batch notification dispatcher
 * @param {Array<Object>} events - Array of notification event objects
 */
export function batchNotify(events) {
  const result = notificationQueue.then(() => dispatchNotificationBatch(events));
  notificationQueue = result.catch(() => false);
  return result;
}

async function dispatchNotificationBatch(events) {
  if (!Array.isArray(events) || events.length === 0) return false;

  try {
    const muted = await isNotificationMuted();
    const timestamp = Date.now();

    // 1. Process & persist to in-app notification toasts (always accessible in popup)
    const stored = await chrome.storage.local.get('unread_notifications');
    const existing = stored.unread_notifications || [];

    const knownIds = new Set(existing.map(notification => notification.id));
    const freshEvents = [];
    events.forEach((event, idx) => {
      const id = event.id || `${timestamp}-${idx}`;
      if (knownIds.has(id)) return;
      knownIds.add(id);
      freshEvents.push({ ...event, id });
    });
    if (freshEvents.length === 0) return true;
    const notificationsWithMeta = freshEvents.map(event => ({
      ...event,
      timestamp,
      deliveryState: muted ? DELIVERY_STATES.IN_APP_ONLY : DELIVERY_STATES.DISPLAY_REQUESTED
    }));

    const oneDayAgo = timestamp - (24 * 60 * 60 * 1000);
    const updated = [...existing, ...notificationsWithMeta]
      .filter(n => n.timestamp > oneDayAgo)
      .slice(-30);

    await chrome.storage.local.set({ unread_notifications: updated });

    // If notifications are muted by user preference, skip native desktop popups
    if (muted) {
      console.log('[NotificationManager] Notifications muted; recorded for in-app display only.');
      return true;
    }

    // 2. Dispatch native Chrome desktop notifications
    for (const event of freshEvents) {
      try {
        let title = 'LeetStreak';
        if (event.type === 'new_submission') title = '🎯 Friend Solved a Problem!';
        else if (event.type === 'milestone') title = '🔥 Streak Milestone Reached!';
        else if (event.type === 'streak_at_risk') title = '⚠️ Streak At Risk!';
        else if (event.type === 'battle_invite') title = '⚔️ 1v1 Battle Challenge!';
        else if (event.type === 'battle_opponent_solved') title = '⚔️ Opponent Solved a Problem!';
        else if (event.type === 'roast') title = '🔥 Motivation Roast Received!';
        else if (event.type === 'daily_problem_reminder') title = 'ENO: DSA Check-in ☕';

        const notifId = event.nativeNotificationId || `leetstreak-${event.type}-${timestamp}-${Math.floor(Math.random() * 1000)}`;

        await chrome.notifications.create(notifId, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title,
          message: event.message || '',
          priority: event.priority || 2,
          requireInteraction: event.type === 'streak_at_risk' || event.type === 'battle_invite'
        });
      } catch (dispErr) {
        console.warn('[NotificationManager] chrome.notifications.create failed:', dispErr);
      }
    }
    return true;
  } catch (error) {
    console.error('[NotificationManager] Error in batchNotify:', error);
    return false;
  }
}
