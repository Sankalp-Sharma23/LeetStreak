/**
 * LeetStreak Background Service Worker (Manifest V3)
 * - Orchestrates background synchronization alarms
 * - Canonical streak calculation and friend caching
 * - Dispatches notifications with dual in-app fallback
 * - 1v1 Battle match synchronization
 * - Hardcore Mode tab monitor & website blocker
 */

import { fetchUserData } from './leetcode-api.js';
import {
  getAllFriends,
  saveFriend,
  getFriendsList,
  getFriend,
  removeFriend,
  getUserSettings,
  clearRoasts,
  sendRoast as storageSendRoast,
  getOwnProfile,
  saveOwnProfile
} from '../shared/storage.js';
import {
  fetchUnreadRoasts,
  markRoastsDelivered,
  markRoastsRead,
  sendRoast as supabaseSendRoast,
  clearRoasts as supabaseClearRoasts,
  restoreSession,
  getAuthState,
  AUTH_STATES,
  getAuthSession,
  isAuthRateLimited,
  getAuthCooldownSeconds,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  getOnlineFriends,
  setPresenceOffline,
  syncFriendship,
  getFriendRequests,
  respondToFriendRequest,
  removeFriendship,
  restoreAccountSocialData,
  upsertProfile,
  getUserSettings as getSupabaseUserSettings,
  upsertUserSettings
} from '../shared/supabase-client.js';
import {
  createBattle,
  getActiveBattle,
  getBattleHistory,
  getBattleHistoryScoreboard,
  getBattleHistoryDetails,
  respondToBattle,
  submitProblemPick,
  cancelBattle,
  validateLeetCodeProblem,
  updatePresence,
  getPresence,
  createBattleV2,
  acceptBattleV2,
  confirmReadyV2,
  submitBattleSolveV2,
  getBattleStateV2,
  forfeitBattleV2
} from '../shared/battle-manager.js';
import { validateUsername } from '../shared/validation.js';
import {
  calculateStreak,
  getProblemsSolved,
  needsRefresh,
  timestampToDateString,
  getConfirmedAcceptedSolveToday
} from '../shared/streak-calculator.js';
import {
  getNotificationState,
  batchNotify,
  isNotificationMuted,
  setNotificationMuted
} from '../shared/notification-manager.js';
import {
  isStreakAtRisk
} from '../shared/activity-detector.js';
import {
  canDeliverStreakAtRisk,
  recordStreakAtRiskDelivery
} from '../shared/streak-at-risk-policy.js';
import {
  getCurrentInterval,
  getNextAlarmConfig,
  getScheduleDescription
} from '../shared/schedule-manager.js';
import { initializeTabMonitor } from './tab-monitor.js';
import { syncBlockerRules, isBlockerActive } from './blocker-manager.js';
import {
  canDeliverDailyReminder,
  getDueReminderSlot,
  getCompletedLocalDays,
  getDeliveredReminderSlots,
  getLocalDateKey,
  getNextReminderTime,
  normalizeReminderFrequency,
  recordDailyReminderSlot,
  selectDailyReminderQuote
} from '../shared/daily-reminders.js';

const ALARM_NAME = 'leetfriends_sync';
const ROAST_DELIVERY_ALARM = 'leetstreak_roast_delivery';
const DAILY_REMINDER_ALARM = 'leetstreak_daily_problem_reminder';
let roastDeliveryInProgress = false;
let dailyReminderInProgress = false;
let friendSyncInProgress = false;
const SCHEDULE_CHECK_ALARM = 'schedule_transition_check';
const PRESENCE_HEARTBEAT_ALARM = 'presence_heartbeat_alarm';
const REQUEST_DELAY_MS = 500;

// Global error handlers
self.addEventListener('error', (event) => {
  console.error('[ServiceWorker] Uncaught error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[ServiceWorker] Uncaught promise rejection:', event.reason);
});

// Initialize Tab Monitor for Hardcore Mode
initializeTabMonitor();

// Restore existing authentication session on service worker wake
restoreSession().catch(err => {
  console.warn('[ServiceWorker] Session restoration (non-blocking):', err.message);
});
setupDailyReminderAlarm();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && ['notification_frequency', 'notifications_enabled', 'my_leetcode_username', 'daily_problem_completed_date'].some(key => key in changes)) {
    setupDailyReminderAlarm();
  }
});

// Install listener - set up dynamic alarms & storage cleanup
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[ServiceWorker] Installed - setting up sync alarm and cleaning legacy keys');
  setupDynamicAlarm();
  setupRoastDeliveryAlarm();
  cleanupLegacyData();
  await syncBlockerRules();
  // Register recurring presence heartbeat alarm (MV3 compliant)
  try {
    await chrome.alarms.clear(PRESENCE_HEARTBEAT_ALARM);
    chrome.alarms.create(PRESENCE_HEARTBEAT_ALARM, {
      delayInMinutes: 0.1,
      periodInMinutes: 1
    });
  } catch {}
});

// Browser startup listener - reconcile network blocker rules & presence
chrome.runtime.onStartup.addListener(async () => {
  console.log('[ServiceWorker] Browser startup - reconciling blocker rules & presence');
  await syncBlockerRules();
  try {
    setupRoastDeliveryAlarm();
    await chrome.alarms.clear(PRESENCE_HEARTBEAT_ALARM);
    chrome.alarms.create(PRESENCE_HEARTBEAT_ALARM, {
      delayInMinutes: 0.1,
      periodInMinutes: 1
    });
    await handlePresenceHeartbeat();
  } catch {}
});

/**
 * Remove deprecated storage keys (such as legacy GitHub keys)
 */
async function cleanupLegacyData() {
  try {
    const keysToRemove = [
      'github_token',
      'github_token_encrypted',
      'github_token_key',
      'github_username',
      'github_repo',
      'github_sync_enabled',
      'synced_problems'
    ];
    await chrome.storage.local.remove(keysToRemove);
    console.log('[ServiceWorker] Legacy keys cleaned successfully');
  } catch (err) {
    console.warn('[ServiceWorker] Error cleaning legacy storage:', err);
  }
}

/**
 * Setup dynamic alarm based on time of day
 */
async function setupDynamicAlarm() {
  const config = getNextAlarmConfig();
  const interval = config?.intervalMinutes || 30;

  try {
    await chrome.alarms.clear(ALARM_NAME);
    await chrome.alarms.clear(SCHEDULE_CHECK_ALARM);

    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: interval,
      periodInMinutes: interval
    });

    await chrome.storage.local.set({
      current_schedule: {
        interval,
        description: config?.description || 'Standard sync',
        updatedAt: Date.now()
      }
    });
  } catch (e) {
    console.warn('[ServiceWorker] setupDynamicAlarm error:', e);
  }
}

function setupRoastDeliveryAlarm() {
  chrome.alarms.create(ROAST_DELIVERY_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
}

async function deliverPendingRoasts() {
  if (roastDeliveryInProgress) return { success: true, delivered: 0 };
  roastDeliveryInProgress = true;
  try {
    const stored = await chrome.storage.local.get(['my_leetcode_username', 'delivered_roast_ids']);
    const myUsername = stored.my_leetcode_username;
    if (!myUsername) return { success: false, error: 'No LeetCode username configured' };

    const roasts = await fetchUnreadRoasts(myUsername);
    const alreadyDelivered = new Set(stored.delivered_roast_ids || []);
    const pending = roasts.filter(roast => !alreadyDelivered.has(roast.id));
    if (!pending.length) return { success: true, delivered: 0 };

    const events = pending.map(roast => ({
      id: `roast-${roast.id}`,
      type: 'roast',
      roastId: roast.id,
      username: roast.sender_username,
      senderUsername: roast.sender_username,
      roastContent: roast.content,
      message: `${roast.sender_username} roasted you: "${roast.content}" 🔥`,
      timestamp: roast.created_at ? new Date(roast.created_at).getTime() : Date.now(),
      priority: 2
    }));
    if (!await batchNotify(events)) return { success: false, error: 'Could not save roast notifications' };

    const deliveredIds = pending.map(roast => roast.id);
    await chrome.storage.local.set({
      delivered_roast_ids: [...alreadyDelivered, ...deliveredIds].slice(-200)
    });
    await markRoastsDelivered(deliveredIds);
    return { success: true, delivered: deliveredIds.length };
  } catch (error) {
    console.warn('[ServiceWorker] Roast delivery check failed:', error);
    return { success: false, error: error.message };
  } finally {
    roastDeliveryInProgress = false;
  }
}

/**
 * Check if schedule needs transition (active vs quiet hours)
 */
async function checkScheduleTransition() {
  try {
    const result = await chrome.storage.local.get('current_schedule');
    const currentSchedule = result.current_schedule;
    const newInterval = getCurrentInterval();

    if (!currentSchedule || Math.abs(currentSchedule.interval - newInterval) > 0.1) {
      console.log(`[ServiceWorker] Transitioning schedule: ${getScheduleDescription()}`);
      await setupDynamicAlarm();
    }
  } catch (e) {
    console.warn('[ServiceWorker] checkScheduleTransition error:', e);
  }
}

// Background sync alarm listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log(`[ServiceWorker] Background sync triggered - ${getScheduleDescription()}`);
    await checkScheduleTransition();
    await syncAllFriends();
    // Daily rollover reconciliation for Hardcore Mode blocker
    await syncBlockerRules();
  } else if (alarm.name === PRESENCE_HEARTBEAT_ALARM) {
    await handlePresenceHeartbeat();
  } else if (alarm.name === ROAST_DELIVERY_ALARM) {
    await deliverPendingRoasts();
  } else if (alarm.name === DAILY_REMINDER_ALARM) {
    await deliverDailyProblemReminder(alarm.scheduledTime);
  } else if (alarm.name && alarm.name.startsWith('battle_start_')) {
    const battleId = alarm.name.replace('battle_start_', '');
    await startBattleAndRedirect(battleId);
  }
});

async function setupDailyReminderAlarm() {
  try {
    const settings = await chrome.storage.local.get(['notification_frequency', 'notifications_enabled', 'my_leetcode_username', 'daily_problem_completed_date', 'daily_problem_completed_dates']);
    await chrome.alarms.clear(DAILY_REMINDER_ALARM);
    if (settings.notifications_enabled === false || !settings.my_leetcode_username) return;
    let now = new Date();
    if (getCompletedLocalDays(settings.daily_problem_completed_dates, settings.daily_problem_completed_date).includes(getLocalDateKey(now))) {
      now = new Date(now);
      now.setDate(now.getDate() + 1);
      now.setHours(0, 0, 0, 0);
    }
    const when = getNextReminderTime(now, normalizeReminderFrequency(settings.notification_frequency));
    if (when) chrome.alarms.create(DAILY_REMINDER_ALARM, { when: when.getTime() });
  } catch (error) {
    console.error('[ServiceWorker] Could not schedule daily reminder:', error);
  }
}

async function deliverDailyProblemReminder(scheduledTime) {
  if (dailyReminderInProgress) return;
  dailyReminderInProgress = true;
  try {
    const now = new Date();
    const scheduledDate = new Date(scheduledTime || now);
    const dayKey = getLocalDateKey(scheduledDate);
    const currentDay = getLocalDateKey(now);
    const slot = getDueReminderSlot(scheduledDate);
    const settings = await chrome.storage.local.get([
      'my_leetcode_username', 'notification_frequency', 'notifications_enabled',
      'daily_problem_completed_date', 'daily_problem_completed_dates', 'daily_problem_reminder_state'
    ]);
    const priorState = settings.daily_problem_reminder_state || {};
    const deliveredSlots = getDeliveredReminderSlots(priorState, dayKey);
    const completedDates = getCompletedLocalDays(settings.daily_problem_completed_dates, settings.daily_problem_completed_date);
    const frequency = normalizeReminderFrequency(settings.notification_frequency);
    if (dayKey !== currentDay || !canDeliverDailyReminder({
      date: now,
      slot,
      frequency,
      enabled: settings.notifications_enabled !== false,
      solved: completedDates.includes(currentDay),
      deliveredSlots
    })) return;

    const username = settings.my_leetcode_username;
    if (!username) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const profile = await fetchUserData(username);
    const solved = getConfirmedAcceptedSolveToday(profile, timezone);
    // LeetCode's activity calendar includes attempts, so it cannot substitute
    // for a verified Accepted submission. When that query is unavailable,
    // skip this reminder rather than risk a false nag after a successful solve.
    if (solved === null) return;
    if (solved) {
      await chrome.storage.local.set({ daily_problem_completed_dates: getCompletedLocalDays([...completedDates, currentDay]) });
      return;
    }

    const latestSettings = await chrome.storage.local.get([
      'notification_frequency', 'notifications_enabled', 'daily_problem_completed_date',
      'daily_problem_completed_dates', 'daily_problem_reminder_state'
    ]);
    const latestState = latestSettings.daily_problem_reminder_state || {};
    const latestDeliveredSlots = getDeliveredReminderSlots(latestState, dayKey);
    const latestCompletedDates = getCompletedLocalDays(latestSettings.daily_problem_completed_dates, latestSettings.daily_problem_completed_date);
    if (!canDeliverDailyReminder({
      date: new Date(),
      slot,
      frequency: normalizeReminderFrequency(latestSettings.notification_frequency),
      enabled: latestSettings.notifications_enabled !== false,
      solved: latestCompletedDates.includes(currentDay),
      deliveredSlots: latestDeliveredSlots
    })) return;

    const quote = selectDailyReminderQuote(latestState.lastQuoteId || priorState.lastQuoteId);
    const eventId = `daily-problem-${dayKey}-${slot}`;
    const saved = await batchNotify([{
      id: eventId,
      nativeNotificationId: `leetstreak-${eventId}`,
      type: 'daily_problem_reminder',
      quoteId: quote.id,
      message: quote.text,
      priority: 1
    }]);
    if (saved) {
      await chrome.storage.local.set({
        daily_problem_reminder_state: recordDailyReminderSlot(latestState, dayKey, slot, quote.id)
      });
    }
  } catch (error) {
    console.error('[ServiceWorker] Daily reminder delivery failed:', error);
  } finally {
    dailyReminderInProgress = false;
    await setupDailyReminderAlarm();
  }
}

// Central message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ pong: true });
    return;
  }

  switch (message.type) {
    case 'FETCH_STATS':
      handleFetchStats(message.forceRefresh).then(sendResponse);
      return true;

    case 'ADD_FRIEND':
      handleAddFriend(message.username).then(sendResponse);
      return true;

    case 'SET_OWN_USERNAME':
      handleSetOwnUsername(message.username).then(sendResponse);
      return true;

    case 'REMOVE_FRIEND':
      handleRemoveFriend(message.username).then(sendResponse);
      return true;

    case 'GET_FRIENDS':
      handleGetFriends().then(sendResponse);
      return true;

    case 'MUTE_NOTIFICATIONS':
      setNotificationMuted(message.untilUTC).then(() => sendResponse({ success: true }));
      return true;

    case 'GET_NOTIFICATION_STATE':
      getNotificationState().then(state => sendResponse({ success: true, state }));
      return true;

    case 'ADD_TO_QUEUE':
      handleAddToQueue(message.problemData).then(sendResponse);
      return true;

    case 'SUBMISSION_ACCEPTED':
      handleSubmissionAccepted(message.problemSlug, message.title).then(sendResponse);
      return true;

    case 'SYNC_BLOCKER_RULES':
      syncBlockerRules().then(sendResponse);
      return true;

    case 'GET_BLOCKER_STATUS':
      isBlockerActive().then(sendResponse);
      return true;

    case 'SHOW_NOTIFICATION':
      batchNotify([{
        type: 'custom',
        message: message.message || '',
        title: message.title || 'LeetStreak',
        priority: 2
      }]).then(() => sendResponse({ success: true }));
      return true;

    case 'GET_STORAGE_STATUS':
      chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
        sendResponse({ bytesInUse: bytesInUse || 0, quota: 5242880 });
      });
      return true;

    case 'RESCHEDULE_ALARMS':
      setupDynamicAlarm().then(() => sendResponse({ success: true }));
      return true;

    // ===== 1v1 Battle System =====
    case 'BATTLE_GET_STATUS':
      handleBattleGetStatus(message.username, message.includeHistory).then(sendResponse);
      return true;

    case 'BATTLE_GET_HISTORY_SCOREBOARD':
      getBattleHistoryScoreboard(message.filters || {}, message.limit || 12, message.offset || 0).then(sendResponse);
      return true;

    case 'BATTLE_GET_HISTORY_DETAILS':
      getBattleHistoryDetails(message.opponentId, message.filters || {}, message.limit || 10, message.offset || 0).then(sendResponse);
      return true;

    case 'BATTLE_CHALLENGE_V2':
      handleBattleChallengeV2(message).then(sendResponse);
      return true;

    case 'BATTLE_ACCEPT_V2':
    case 'BATTLE_ACCEPT':
      handleBattleAcceptV2(message.battleId).then(sendResponse);
      return true;

    case 'BATTLE_READY_V2':
      handleBattleReadyV2(message.battleId, message.username).then(sendResponse);
      return true;

    case 'BATTLE_SOLVED_V2':
      handleBattleSolvedV2(message).then(sendResponse);
      return true;

    case 'BATTLE_GET_STATE_V2':
      handleBattleGetStateV2(message.battleId).then(sendResponse);
      return true;

    case 'BATTLE_FORFEIT_V2':
      handleBattleForfeitV2(message.battleId, message.username).then(sendResponse);
      return true;

    case 'BATTLE_OPEN_PROBLEM':
      redirectToBattleProblem(message.url).then(sendResponse);
      return true;

    case 'BATTLE_CHALLENGE':
      handleBattleChallenge(message.challenger, message.challenged, message.language).then(sendResponse);
      return true;

    case 'BATTLE_RESPOND':
      handleBattleRespond(message.battleId, message.username, message.accept).then(sendResponse);
      return true;

    case 'BATTLE_PICK_PROBLEM':
      handleBattlePickProblem(message.battleId, message.username, message.slug, message.title).then(sendResponse);
      return true;

    case 'BATTLE_READY':
      handleBattleReady(message.battleId, message.username).then(sendResponse);
      return true;

    case 'BATTLE_SUBMISSION':
      handleBattleSubmission(message).then(sendResponse);
      return true;

    case 'BATTLE_FORFEIT':
      handleBattleForfeit(message.battleId, message.username).then(sendResponse);
      return true;

    case 'BATTLE_CANCEL':
      handleBattleCancel(message.battleId, message.username).then(sendResponse);
      return true;

    case 'BATTLE_VALIDATE_PROBLEM':
      validateLeetCodeProblem(message.slugOrUrl).then(sendResponse);
      return true;

    case 'BATTLE_PING_PRESENCE':
      handleBattlePingPresence(message.username).then(sendResponse);
      return true;

    case 'BATTLE_GET_PRESENCE':
      handleBattleGetPresence(message.usernames).then(sendResponse);
      return true;

    case 'BATTLE_GET_ONLINE_FRIENDS':
      getOnlineFriends()
        .then(friends => sendResponse({ success: true, friends }))
        .catch(err => sendResponse({ success: false, error: err.message, friends: [] }));
      return true;

    case 'GET_FRIEND_REQUESTS':
      getFriendRequests().then(requests => sendResponse({ success: true, requests }))
        .catch(err => sendResponse({ success: false, error: err.message, requests: [] }));
      return true;

    case 'RESPOND_FRIEND_REQUEST':
      respondToFriendRequest(message.friendshipId, message.accept).then(async result => {
        if (result?.success) await restoreAccountSocialData();
        sendResponse(result);
      }).catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_LOGGED_IN_USER':
      handleGetLoggedInUser().then(sendResponse);
      return true;

    case 'FETCH_OWN_PROFILE':
      handleFetchOwnProfile(message.forceRefresh).then(sendResponse);
      return true;

    // ===== Cloud Authentication & Account =====
    case 'GET_AUTH_STATE':
      (async () => {
        const session = await getAuthSession();
        sendResponse({
          success: true,
          state: getAuthState(),
          session: session ? { user_id: session.user_id, email: session.email, expires_at: session.expires_at } : null,
          isRateLimited: isAuthRateLimited(),
          cooldownSeconds: getAuthCooldownSeconds()
        });
      })().catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'SIGN_IN_EMAIL':
      signInWithEmail(message.email, message.password)
        .then(async session => {
          try {
            // Restore entire social account: own profile + all accepted friendships from Supabase!
            // Survives extension uninstall, browser change, or local cache clearing.
            await restoreAccountSocialData();

            if (message.username) {
              await chrome.storage.local.set({ my_leetcode_username: message.username });
            }

            const stored = await chrome.storage.local.get(['my_leetcode_username', 'own_profile']);
            const effectiveUser = message.username || stored.my_leetcode_username;
            if (effectiveUser) {
              await upsertProfile(effectiveUser, stored.own_profile || { profile: { realName: effectiveUser } });
              await updatePresence(effectiveUser, 'online');
            }
          } catch (restoreErr) {
            console.warn('[ServiceWorker] Social account restore error:', restoreErr);
          }
          sendResponse({ success: true, session: { user_id: session.user_id, email: session.email } });
        })
        .catch(err => sendResponse({ success: false, error: err.message, isRateLimited: isAuthRateLimited() }));
      return true;

    case 'RESTORE_ACCOUNT_DATA':
      restoreAccountSocialData()
        .then(res => sendResponse(res))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'SIGN_UP_EMAIL':
      signUpWithEmail(message.email, message.password)
        .then(async result => {
          if (message.username) {
            await chrome.storage.local.set({ my_leetcode_username: message.username });
          }
          if (result?.session && result.session.user_id) {
            try {
              const stored = await chrome.storage.local.get(['my_leetcode_username', 'own_profile']);
              const effectiveUser = message.username || stored.my_leetcode_username;
              if (effectiveUser) {
                await upsertProfile(effectiveUser, stored.own_profile || { profile: { realName: effectiveUser } });
                await updatePresence(effectiveUser, 'online');
              }
            } catch (syncErr) {
              console.warn('[ServiceWorker] Sign up profile sync error:', syncErr);
            }
          }
          sendResponse(result);
        })
        .catch(err => sendResponse({ success: false, error: err.message, isRateLimited: isAuthRateLimited() }));
      return true;

    case 'SIGN_OUT':
      signOut()
        .then(async res => {
          try {
            await setPresenceOffline();
          } catch {}
          await chrome.storage.local.remove(['friends_cache', 'friends_list', 'friends_account_id']);
          sendResponse(res);
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    // ===== Roasts =====
    case 'SEND_ROAST':
      handleSendRoast(message.targetUsername, message.fromUsername, message.message).then(sendResponse);
      return true;

    case 'CLEAR_ROASTS':
      (async () => {
        const stored = await chrome.storage.local.get('my_leetcode_username');
        if (stored.my_leetcode_username) {
          await supabaseClearRoasts(stored.my_leetcode_username);
        }
        const success = await clearRoasts();
        return { success };
      })().then(sendResponse);
      return true;

    case 'MARK_ROAST_READ':
      (async () => {
        if (message.roastId) {
          await markRoastsRead([message.roastId]);
        }
        return { success: true };
      })().then(sendResponse);
      return true;

    case 'POLL_ROASTS':
      deliverPendingRoasts().then(sendResponse);
      return true;

    default:
      sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
  }
});

// Notification click router
chrome.notifications.onClicked.addListener((notifId) => {
  if (notifId.includes('battle')) {
    try {
      chrome.action?.openPopup?.().catch(() => {});
    } catch {}
    chrome.notifications.clear(notifId);
  } else if (notifId.includes('streak') || notifId.includes('roast') || notifId.includes('solve')) {
    chrome.tabs.create({ url: 'https://leetcode.com/problemset/' });
    chrome.notifications.clear(notifId);
  }
});

/**
 * Handle FETCH_STATS request
 * Fetches the current user's profile independently of the friends list.
 * Works even when friends count is zero, or Supabase is rate limited or unavailable.
 */
async function handleFetchStats(forceRefresh = false) {
  try {
    let storageData = await chrome.storage.local.get(['my_leetcode_username', 'user_timezone', 'friends_account_id']);
    let myUsername = storageData.my_leetcode_username;

    if (!myUsername) {
      return { success: false, error: 'No LeetCode username configured. Please enter your username.' };
    }

    const session = await getAuthSession();
    if (session?.user_id && storageData.friends_account_id !== session.user_id) {
      const restored = await restoreAccountSocialData();
      if (restored?.success) {
        storageData = await chrome.storage.local.get(['my_leetcode_username', 'user_timezone', 'friends_account_id']);
        myUsername = storageData.my_leetcode_username || myUsername;
      } else {
        await chrome.storage.local.remove(['friends_cache', 'friends_list', 'friends_account_id']);
      }
    }

    // 1. Fetch / Retrieve Own Profile Independently
    let ownData = await getOwnProfile();
    let ownRefreshed = false;

    const shouldRefreshOwn = forceRefresh || !ownData || needsRefresh(ownData.lastUpdated);
    if (shouldRefreshOwn) {
      console.log(`[ServiceWorker] Fetching own LeetCode data for: ${myUsername}`);
      try {
        const rawData = await fetchUserData(myUsername);
        ownData = await processUserData(rawData, storageData.user_timezone);
        await saveOwnProfile(ownData);
        ownRefreshed = true;
      } catch (err) {
        console.error(`[ServiceWorker] Error fetching own LeetCode profile for ${myUsername}:`, err);
        // Fall back to cached ownData if available
        if (!ownData) {
          return {
            success: false,
            error: `Failed to fetch LeetCode data for ${myUsername}: ${err.message}`,
            isLeetCodeError: true
          };
        }
      }
    }

    // 2. Fetch / Retrieve Friends
    let friends = await getAllFriends();
    const friendUsernames = await getFriendsList();

    // Check if any friends need refresh (stale or missing rich LeetCode profile data)
    let friendsNeedSync = forceRefresh;
    if (!friendsNeedSync && friendUsernames.length > 0) {
      for (const u of friendUsernames) {
        const f = friends[u];
        if (!f || needsRefresh(f?.lastUpdated) || !f.submissionCalendar || !f.profile?.ranking) {
          friendsNeedSync = true;
          break;
        }
      }
    }

    if (friendsNeedSync && friendUsernames.length > 0) {
      console.log('[ServiceWorker] Syncing friends data...');
      for (const friendUser of friendUsernames) {
        if (friendUser.toLowerCase() === myUsername.toLowerCase()) continue;
        const currentFriend = friends[friendUser];
        const needsThisFriend = forceRefresh || !currentFriend || needsRefresh(currentFriend?.lastUpdated) || !currentFriend.submissionCalendar || !currentFriend.profile?.ranking;
        if (!needsThisFriend) continue;
        try {
          const rawFriendData = await fetchUserData(friendUser);
          const processedFriend = await processUserData(rawFriendData, storageData.user_timezone);
          await saveFriend(friendUser, processedFriend);
          await sleep(REQUEST_DELAY_MS);
        } catch (fErr) {
          console.warn(`[ServiceWorker] Error updating friend ${friendUser}:`, fErr.message);
        }
      }
      friends = await getAllFriends();
    }

    // 3. Assemble complete response: guarantee ownData is present in both ownProfile and friends map
    const combinedFriends = { ...friends };
    if (ownData) {
      combinedFriends[myUsername] = ownData;
    }

    return {
      success: true,
      ownProfile: ownData,
      friends: combinedFriends,
      refreshed: ownRefreshed || friendsNeedSync
    };
  } catch (error) {
    console.error('[ServiceWorker] handleFetchStats error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle direct request to fetch own profile only
 */
async function handleFetchOwnProfile(forceRefresh = false) {
  try {
    const storageData = await chrome.storage.local.get(['my_leetcode_username', 'user_timezone']);
    const myUsername = storageData.my_leetcode_username;
    if (!myUsername) {
      return { success: false, error: 'No LeetCode username configured' };
    }

    let ownData = await getOwnProfile();
    const shouldRefresh = forceRefresh || !ownData || needsRefresh(ownData.lastUpdated);

    if (shouldRefresh) {
      const rawData = await fetchUserData(myUsername);
      ownData = await processUserData(rawData, storageData.user_timezone);
      await saveOwnProfile(ownData);
    }

    return { success: true, ownProfile: ownData };
  } catch (err) {
    console.error('[ServiceWorker] handleFetchOwnProfile error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Handle ADD_FRIEND request
 */
async function handleAddFriend(username) {
  try {
    const original = username;
    let normalized;
    try {
      normalized = validateUsername(username);
    } catch (valErr) {
      return { success: false, error: valErr.message };
    }

    // 1. Fetch fresh LeetCode stats for this friend
    const rawData = await fetchUserData(original);
    const processed = await processUserData(rawData);

    // 2. Save locally so friend is immediately visible in the active Friends section
    await saveFriend(normalized, processed);

    // 3. If authenticated, persist to user's permanent cloud account!
    const session = await getAuthSession();
    if (session?.user_id) {
      // Save to user_settings.saved_friends so friendships survive reinstallation
      try {
        const userSettings = await getSupabaseUserSettings();
        const currentSaved = Array.isArray(userSettings?.saved_friends) ? userSettings.saved_friends : [];
        if (!currentSaved.map(s => s.toLowerCase()).includes(normalized.toLowerCase())) {
          await upsertUserSettings({
            saved_friends: [...currentSaved, normalized]
          });
        }
      } catch (settingsErr) {
        console.warn('[ServiceWorker] Cloud settings save friend warning:', settingsErr);
      }

      // If friend is also registered on LeetStreak, send mutual friendship request
      try {
        const result = await syncFriendship(normalized);
        if (result?.status === 'accepted') {
          await restoreAccountSocialData();
        }
      } catch (syncErr) {
        console.warn('[ServiceWorker] Cloud friendship sync warning:', syncErr);
      }

      // Re-hydrate the isolated user friend section
      await getAllFriends();
    }

    return { success: true, message: `${original} added successfully`, data: processed };
  } catch (error) {
    console.error('[ServiceWorker] handleAddFriend error:', error);
    return { success: false, error: error.message || 'User not found or profile is private' };
  }
}

async function handleSetOwnUsername(username) {
  try {
    const normalized = validateUsername(username);
    const rawData = await fetchUserData(normalized);
    const profile = await processUserData(rawData);
    const session = await getAuthSession();
    if (session?.user_id) {
      const saved = await upsertProfile(normalized, profile);
      if (!saved) return { success: false, error: 'Could not link this LeetCode profile to your signed-in account' };
    }
    await saveOwnProfile(profile);
    await chrome.storage.local.set({ my_leetcode_username: normalized, hardcore_mode_enabled: false });
    return { success: true, username: normalized, data: profile };
  } catch (error) {
    console.error('[ServiceWorker] handleSetOwnUsername error:', error);
    return { success: false, error: error.message || 'Could not verify LeetCode username' };
  }
}

/**
 * Handle REMOVE_FRIEND request
 */
async function handleRemoveFriend(username) {
  try {
    const normalized = username.toLowerCase();
    const session = await getAuthSession();
    if (session?.user_id) {
      // Remove from cloud settings
      try {
        const userSettings = await getSupabaseUserSettings();
        if (Array.isArray(userSettings?.saved_friends) && userSettings.saved_friends.length > 0) {
          const updated = userSettings.saved_friends.filter(f => f.toLowerCase() !== normalized);
          await upsertUserSettings({ saved_friends: updated });
        }
      } catch (err) {
        console.warn('[ServiceWorker] Could not remove friend from cloud settings:', err);
      }

      try {
        await removeFriendship(username);
      } catch (err) {
        console.warn('[ServiceWorker] Cloud friendship remove warning:', err);
      }
    }
    await removeFriend(username);
    return { success: true, message: `${username} removed` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Handle GET_FRIENDS request
 */
async function handleGetFriends() {
  try {
    const session = await getAuthSession();
    const accountId = session?.user_id || null;
    let friends = await getAllFriends();

    if (accountId && (typeof chrome !== 'undefined' && chrome.storage?.local)) {
      const userStore = await chrome.storage.local.get(`user_friends_${accountId}`);
      const userSection = userStore[`user_friends_${accountId}`];
      if (userSection?.friends && Object.keys(userSection.friends).length > 0) {
        friends = { ...friends, ...userSection.friends };
      } else {
        const ownership = await chrome.storage.local.get('friends_account_id');
        if (ownership.friends_account_id !== accountId || !friends || Object.keys(friends).length === 0) {
          const restored = await restoreAccountSocialData();
          if (!restored?.success) {
            await chrome.storage.local.remove(['friends_cache', 'friends_list', 'friends_account_id']);
          }
          friends = await getAllFriends();
        }
      }
    }

    const friendIds = Object.values(friends || {})
      .map(f => f.friend_id || f.username)
      .filter(Boolean);

    return {
      success: true,
      accountId,
      friendIds,
      friends: friends || {},
      count: Object.keys(friends || {}).length
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Handle ADD_TO_QUEUE request
 */
async function handleAddToQueue(problemData) {
  try {
    if (!problemData) return { success: false, error: 'Problem data required' };

    const result = await chrome.storage.local.get('problem_queue');
    const queue = result.problem_queue || [];

    const exists = queue.some(p => p.slug === problemData.slug || p.id === problemData.slug);
    if (exists) {
      return { success: false, error: 'Problem already in queue', alreadyExists: true };
    }

    const newProblem = {
      ...problemData,
      id: problemData.slug || `problem-${Date.now()}`,
      addedAt: Date.now(),
      status: problemData.status || 'pending'
    };

    queue.push(newProblem);
    await chrome.storage.local.set({ problem_queue: queue });
    return { success: true, message: 'Added to problem queue' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Handle SUBMISSION_ACCEPTED from content script
 * Automatically updates Problem Queue, lifts Hardcore Mode restriction, and triggers refresh
 */
async function handleSubmissionAccepted(problemSlug, title) {
  try {
    const settings = await chrome.storage.local.get(['my_leetcode_username', 'user_timezone', 'problem_queue']);
    const todayStr = timestampToDateString(Math.floor(Date.now() / 1000), settings.user_timezone);

    // 1. Lift Hardcore Mode restriction for today
    await chrome.storage.local.set({
      last_solve_date: todayStr,
      daily_problem_completed_date: getLocalDateKey(new Date()),
      daily_problem_completed_dates: getCompletedLocalDays([
        ...(settings.daily_problem_completed_dates || []),
        settings.daily_problem_completed_date,
        getLocalDateKey(new Date())
      ])
    });
    console.log(`[ServiceWorker] Solve recorded today (${todayStr}) — Hardcore Mode unlocked!`);
    await syncBlockerRules();

    // 2. Mark problem as completed in Problem Queue if present
    if (settings.problem_queue && Array.isArray(settings.problem_queue)) {
      const updatedQueue = settings.problem_queue.map(p => {
        if (p.slug === problemSlug || p.id === problemSlug || (title && p.title === title)) {
          return { ...p, status: 'completed' };
        }
        return p;
      });
      await chrome.storage.local.set({ problem_queue: updatedQueue });
    }

    // 3. Trigger background sync to refresh stats
    syncAllFriends().catch(console.error);

    return { success: true };
  } catch (err) {
    console.error('[ServiceWorker] handleSubmissionAccepted error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Detect logged-in LeetCode user via active session cookie
 */
async function handleGetLoggedInUser() {
  try {
    const res = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `query globalData { userStatus { isSignedIn username } }` })
    });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    if (data.data?.userStatus?.isSignedIn && data.data?.userStatus?.username) {
      return { success: true, username: data.data.userStatus.username };
    }
    return { success: false, error: 'Not logged in to LeetCode' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Sync all friends and self sequentially
 */
async function syncAllFriends() {
  if (friendSyncInProgress) return;
  friendSyncInProgress = true;
  try {
    let storageData = await chrome.storage.local.get(['my_leetcode_username', 'user_timezone', 'friends_account_id']);
    const session = await getAuthSession();
    if (session?.user_id && storageData.friends_account_id !== session.user_id) {
      const restored = await restoreAccountSocialData();
      if (!restored?.success) await chrome.storage.local.remove(['friends_cache', 'friends_list', 'friends_account_id']);
      storageData = await chrome.storage.local.get(['my_leetcode_username', 'user_timezone', 'friends_account_id']);
    }
    const myUsername = storageData.my_leetcode_username;
    const timezone = storageData.user_timezone;

    const friendUsernames = await getFriendsList();
    const usernamesToSync = myUsername
      ? [...new Set([myUsername, ...friendUsernames])]
      : friendUsernames;

    console.log(`[ServiceWorker] Syncing ${usernamesToSync.length} profile(s): ${usernamesToSync.join(', ')}`);

    const notificationEvents = [];

    await deliverPendingRoasts();

    // Retain migration support for legacy local pending roasts.
    if (myUsername) {
      try {
        const mySettings = await getUserSettings(myUsername);
        if (mySettings?.pending_roasts && mySettings.pending_roasts.length > 0) {
          for (const roast of mySettings.pending_roasts) {
            notificationEvents.push({
              type: 'roast',
              username: roast.from,
              message: `${roast.from} roasted you: "${roast.message}" 🔥`,
              priority: 2
            });
          }
          await clearRoasts();
        }
      } catch (roastErr) {
        console.warn('[ServiceWorker] Error checking pending roasts:', roastErr);
      }
    }

    for (const username of usernamesToSync) {
      try {
        const oldData = await getFriend(username);
        const rawData = await fetchUserData(username);
        const processed = await processUserData(rawData, timezone);
        await saveFriend(username, processed);
        if (myUsername && username.toLowerCase() === myUsername.toLowerCase()) {
          await saveOwnProfile(processed);
          // Check if user solved today to unlock blocker
          if (getConfirmedAcceptedSolveToday(processed, timezone) === true) {
            const todayStr = timestampToDateString(Math.floor(Date.now() / 1000), timezone);
            await chrome.storage.local.set({ last_solve_date: todayStr });
          }
          await syncBlockerRules();
        }

        if (!(await isNotificationMuted())) {
          const events = await detectEvents(username, oldData, processed, myUsername);
          notificationEvents.push(...events);

          // Check if current user streak is at risk (strict policy: max 2/day, <12pm and 9pm-3am)
          if (myUsername && username.toLowerCase() === myUsername.toLowerCase()) {
            const hasRisk = isStreakAtRisk(processed.allAcceptedSubmissions, processed.stats.streak);
            if (hasRisk && processed.stats.streak > 0) {
              const streakStorage = await chrome.storage.local.get('streak_at_risk_delivered_state');
              const streakCheck = canDeliverStreakAtRisk({
                now: new Date(),
                deliveredState: streakStorage.streak_at_risk_delivered_state,
                hasSolvedToday: false,
                streak: processed.stats.streak
              });

              if (streakCheck.allowed) {
                const updatedState = recordStreakAtRiskDelivery(
                  streakStorage.streak_at_risk_delivered_state,
                  streakCheck.dayKey,
                  streakCheck.slot
                );
                await chrome.storage.local.set({ streak_at_risk_delivered_state: updatedState });

                notificationEvents.push({
                  id: `streak-at-risk-${myUsername.toLowerCase()}-${streakCheck.dayKey}-${streakCheck.slot}`,
                  username: 'You',
                  type: 'streak_at_risk',
                  title: '🔥 Streak at Risk!',
                  message: `Your ${processed.stats.streak}-day streak will reset at midnight.`,
                  streak: processed.stats.streak,
                  priority: 3
                });
              }
            }
          }
        }

        await sleep(REQUEST_DELAY_MS);
      } catch (err) {
        console.warn(`[ServiceWorker] Error syncing ${username}:`, err);
      }
    }

    if (notificationEvents.length > 0) {
      await batchNotify(notificationEvents);
    }
  } catch (err) {
    console.error('[ServiceWorker] syncAllFriends error:', err);
  } finally {
    friendSyncInProgress = false;
  }
}

/**
 * Detect significant social events for a friend (streak milestones removed per user spec)
 */
async function detectEvents(username, oldData, newData, myUsername) {
  const events = [];
  if (myUsername && username.toLowerCase() === myUsername.toLowerCase()) {
    return events; // Skip friend solve notifications for self
  }

  if (oldData?.stats && newData?.stats) {
    const oldTotal = oldData.stats.total || 0;
    const newTotal = newData.stats.total || 0;

    if (newTotal > oldTotal) {
      const count = newTotal - oldTotal;
      let problemTitle = 'a problem';
      let problemSlug = null;
      if (newData.recentSubmissions && newData.recentSubmissions.length > 0) {
        problemTitle = newData.recentSubmissions[0].title || problemTitle;
        problemSlug = newData.recentSubmissions[0].titleSlug || null;
      }

      events.push({
        id: `friend-solved-${username.toLowerCase()}-${newTotal}`,
        username,
        type: 'new_submission',
        problemSlug,
        message: `${username} just solved ${count === 1 ? `"${problemTitle}"` : `${count} problems`}! 🎯`,
        priority: 1
      });
    }
  }

  return events;
}

/**
 * Process raw LeetCode GraphQL data into canonical storage format
 */
async function processUserData(data, timezone = null) {
  const { profile, contestRanking, submissionCalendar, allAcceptedSubmissions } = data;

  // Canonical personal streak engine calculation
  const { currentStreak, longestStreak } = calculateStreak(
    allAcceptedSubmissions || [],
    submissionCalendar || {},
    timezone
  );

  const problemsSolved = getProblemsSolved(profile.submitStats?.acSubmissionNum);

  return {
    profile: {
      username: profile.username,
      realName: profile.profile?.realName || '',
      avatar: profile.profile?.userAvatar || '',
      ranking: profile.profile?.ranking || 0
    },
    stats: {
      ...problemsSolved,
      streak: currentStreak,
      longestStreak: longestStreak
    },
    contest: {
      rating: Math.round(contestRanking?.rating || 0),
      attended: contestRanking?.attendedContestsCount || 0,
      ranking: contestRanking?.globalRanking || 0
    },
    badges: profile.badges || [],
    recentSubmissions: profile.recentSubmissions || [],
    allAcceptedSubmissions: allAcceptedSubmissions || [],
    acceptedSubmissionsAvailable: data.acceptedSubmissionsAvailable === true,
    submissionCalendar: submissionCalendar || {},
    lastUpdated: Date.now()
  };
}

// ===== 1v1 Battle Handlers =====

async function handleBattleGetStatus(usernameOverride, includeHistory = false) {
  try {
    const stored = await chrome.storage.local.get('my_leetcode_username');
    const username = usernameOverride || stored.my_leetcode_username;
    if (!username) return { success: false, error: 'No username configured' };

    const battle = await getActiveBattle(username);
    if (!battle) {
      await chrome.storage.local.remove('active_battle_data');
      const history = includeHistory ? await getBattleHistory(username, 1) : [];
      return { success: true, battle: null, history };
    }

    const state = await getBattleStateV2(battle.id);

    // Sync active_battle_data to local storage so content scripts have immediate access
    if (['countdown', 'ready_check', 'in_progress'].includes(battle.status)) {
      await chrome.storage.local.set({
        active_battle_data: {
          battleId: battle.id,
          status: battle.status,
          match_starts_at: battle.match_starts_at || battle.start_at,
          match_deadline: battle.match_deadline || battle.end_at,
          duration_minutes: battle.duration_minutes || 30,
          problems: state?.problems || [],
          participants: state?.participants || [],
          results: state?.results || [],
          updated_at: Date.now()
        }
      });

      // Ensure both players have the countdown alarm scheduled
      if (battle.status === 'countdown') {
        scheduleBattleStart(battle.id, battle.match_starts_at || battle.start_at);
      }
    } else {
      await chrome.storage.local.remove('active_battle_data');
    }

    return { success: true, battle, results: state?.results || [], state, history: [] };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattleChallengeV2(message) {
  try {
    const stored = await chrome.storage.local.get(['my_leetcode_username']);
    const challenger = stored.my_leetcode_username;
    if (!challenger) return { success: false, error: 'Set up your LeetCode username before creating a battle' };
    return await createBattleV2(challenger, message.challenged, {
      topics: message.topics,
      difficulty: message.difficulty,
      durationMinutes: message.durationMinutes,
      problemCount: message.problemCount,
      language: message.language || 'javascript'
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattleAcceptV2(battleId) {
  try {
    return await acceptBattleV2(battleId);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattleReadyV2(battleId, usernameOverride) {
  try {
    const stored = await chrome.storage.local.get('my_leetcode_username');
    const username = usernameOverride || stored.my_leetcode_username;
    const res = await confirmReadyV2(battleId, username);

    if (res?.bothReady || res?.status === 'countdown') {
      const startsAt = res.battle?.match_starts_at || res.battle?.start_at;
      scheduleBattleStart(battleId, startsAt);
    }
    return res;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattleSolvedV2(message) {
  try {
    const stored = await chrome.storage.local.get('my_leetcode_username');
    const username = stored.my_leetcode_username;
    return await submitBattleSolveV2(message.battleId, message.problemSlug, {
      submissionId: message.submissionId,
      timeTakenMs: message.timeTakenMs,
      runtimeMs: message.runtimeMs,
      memoryMb: message.memoryMb,
      language: message.language,
      username
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattleGetStateV2(battleId) {
  try {
    const state = await getBattleStateV2(battleId);
    return { success: !!state, state };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattleForfeitV2(battleId, usernameOverride) {
  try {
    const stored = await chrome.storage.local.get('my_leetcode_username');
    const username = usernameOverride || stored.my_leetcode_username;
    await chrome.storage.local.remove('active_battle_data');
    return await forfeitBattleV2(battleId, username);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function redirectToBattleProblem(targetUrl) {
  try {
    const url = targetUrl || 'https://leetcode.com/problemset/';
    const tabs = await chrome.tabs.query({ url: ['*://*.leetcode.com/*', '*://leetcode.com/*'] });
    if (tabs && tabs.length > 0) {
      const targetTab = tabs.find(t => t.active) || tabs[0];
      await chrome.tabs.update(targetTab.id, { url, active: true });
      if (targetTab.windowId) {
        try {
          await chrome.windows.update(targetTab.windowId, { focused: true });
        } catch {}
      }
      return { success: true, updated: true, tabId: targetTab.id };
    } else {
      const newTab = await chrome.tabs.create({ url, active: true });
      return { success: true, created: true, tabId: newTab.id };
    }
  } catch (err) {
    console.warn('[ServiceWorker] redirectToBattleProblem error:', err);
    return { success: false, error: err.message };
  }
}

async function startBattleAndRedirect(battleId) {
  try {
    const state = await getBattleStateV2(battleId);
    if (!state?.problems?.length) return { success: false, error: 'No problems in battle' };
    const firstProblem = state.problems[0];
    const targetUrl = firstProblem.problem_url || `https://leetcode.com/problems/${firstProblem.problem_slug}/`;

    // Persist live battle state so all tabs pick it up immediately
    await chrome.storage.local.set({
      active_battle_data: {
        battleId,
        status: 'in_progress',
        match_starts_at: state.battle?.match_starts_at || state.battle?.start_at,
        match_deadline: state.battle?.match_deadline || state.battle?.end_at,
        duration_minutes: state.battle?.duration_minutes || 30,
        problems: state.problems,
        participants: state.participants || [],
        results: state.results || [],
        updated_at: Date.now()
      }
    });

    const redirectResult = await redirectToBattleProblem(targetUrl);

    if (chrome.notifications) {
      chrome.notifications.create(`battle_start_${battleId}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '⚔️ Battle Started!',
        message: `Duel is live! First problem: ${firstProblem.problem_title}`,
        priority: 2
      });
    }

    return { success: true, targetUrl, redirectResult };
  } catch (e) {
    console.warn('[ServiceWorker] startBattleAndRedirect error:', e);
    return { success: false, error: e.message };
  }
}

function scheduleBattleStart(battleId, matchStartsAtIso) {
  if (!battleId) return;
  const when = matchStartsAtIso ? Date.parse(matchStartsAtIso) : Date.now() + 10000;
  const now = Date.now();
  const delayMs = Math.max(0, when - now);

  if (delayMs <= 500) {
    startBattleAndRedirect(battleId).catch(console.warn);
    return;
  }

  // 1. Alarm scheduling (reliable across service worker sleep in Chrome, Brave, Edge)
  try {
    chrome.alarms.create(`battle_start_${battleId}`, { when });
  } catch (err) {
    console.warn('[ServiceWorker] Could not create battle_start alarm:', err);
  }

  // 2. In-memory timer fallback
  setTimeout(() => {
    startBattleAndRedirect(battleId).catch(console.warn);
  }, delayMs);
}

async function handleBattleChallenge(challengerOverride, challenged, language) {
  try {
    const stored = await chrome.storage.local.get(['my_leetcode_username']);
    const challenger = stored.my_leetcode_username;
    return await createBattle(challenger, challenged, language);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattleRespond(battleId, usernameOverride, accept) {
  try {
    const stored = await chrome.storage.local.get('my_leetcode_username');
    const username = usernameOverride || stored.my_leetcode_username;
    if (accept) return await handleBattleAcceptV2(battleId);
    return await respondToBattle(battleId, username, accept);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattlePickProblem(battleId, usernameOverride, slug, title) {
  try {
    const stored = await chrome.storage.local.get('my_leetcode_username');
    const username = usernameOverride || stored.my_leetcode_username;
    return await submitProblemPick(battleId, username, slug, title);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattleReady(battleId, usernameOverride) {
  try {
    const stored = await chrome.storage.local.get('my_leetcode_username');
    const username = usernameOverride || stored.my_leetcode_username;
    return await handleBattleReadyV2(battleId, username);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattleSubmission(message) {
  try {
    const stored = await chrome.storage.local.get('my_leetcode_username');
    const username = stored.my_leetcode_username;
    if (!username) return { success: false, error: 'No username configured' };
    if (message.accepted !== true || typeof message.problemSlug !== 'string') {
      return { success: false, error: 'Only a confirmed Accepted result can be recorded' };
    }

    const battle = await getActiveBattle(username);
    if (!battle) return { success: false, error: 'No active battle in progress' };

    return await submitBattleSolveV2(battle.id, message.problemSlug, {
      submissionId: message.submissionId,
      runtimeMs: message.runtime_ms,
      memoryMb: message.memory_mb,
      language: message.language
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattleForfeit(battleId, usernameOverride) {
  try {
    const stored = await chrome.storage.local.get('my_leetcode_username');
    const username = usernameOverride || stored.my_leetcode_username;
    return await forfeitBattleV2(battleId, username);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattleCancel(battleId, usernameOverride) {
  try {
    const stored = await chrome.storage.local.get('my_leetcode_username');
    const username = usernameOverride || stored.my_leetcode_username;
    return await cancelBattle(battleId, username);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handlePresenceHeartbeat() {
  try {
    const session = await getAuthSession();
    if (!session?.user_id) return;
    const stored = await chrome.storage.local.get(['my_leetcode_username', 'notified_battle_invites']);
    const username = stored.my_leetcode_username;
    if (username) {
      await updatePresence(username, 'online');

      // Check for incoming battle challenge requests
      const battle = await getActiveBattle(username);
      if (battle && battle.status === 'pending' && battle.challenged_username?.toLowerCase() === username.toLowerCase()) {
        const notified = new Set(stored.notified_battle_invites || []);
        if (!notified.has(battle.id)) {
          notified.add(battle.id);
          await chrome.storage.local.set({ notified_battle_invites: [...notified].slice(-50) });
          await batchNotify([{
            id: `battle_invite_${battle.id}`,
            type: 'battle_invite',
            battleId: battle.id,
            challenger: battle.challenger_username,
            title: `⚔️ Battle Request from @${battle.challenger_username}`,
            message: `Ranked 1v1 • ${battle.duration_minutes || 15} min • ${battle.difficulty || 'Medium'}${battle.topics?.length ? ` • ${battle.topics.join(', ')}` : ''}`,
            priority: 3,
            data: {
              battleId: battle.id,
              challenger: battle.challenger_username,
              difficulty: battle.difficulty || 'Medium',
              durationMinutes: battle.duration_minutes || 15,
              topics: battle.topics || []
            }
          }]);
        }
      }
    }
  } catch (err) {
    console.warn('[ServiceWorker] handlePresenceHeartbeat error:', err);
  }
}

async function handleBattlePingPresence(_usernameOverride) {
  try {
    const stored = await chrome.storage.local.get(['my_leetcode_username']);
    const username = stored.my_leetcode_username;
    if (username) {
      await updatePresence(username);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattleGetPresence(usernames) {
  try {
    if (!usernames?.length) return { success: true, presenceMap: {} };
    const presenceData = await getPresence(usernames);
    return { success: true, presenceMap: Object.fromEntries(presenceData) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleSendRoast(targetUsername, fromUsername, message) {
  try {
    // Attempt durable Supabase message first
    const supSuccess = await supabaseSendRoast(targetUsername, fromUsername, message);
    if (supSuccess) return { success: true };

    // Fallback to local storage
    const success = await storageSendRoast(targetUsername, fromUsername, message);
    return { success };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
