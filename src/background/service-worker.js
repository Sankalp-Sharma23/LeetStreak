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
  syncFriendships,
  removeFriendship,
  restoreAccountSocialData,
  upsertProfile
} from '../shared/supabase-client.js';
import {
  createBattle,
  getActiveBattle,
  getBattleResults,
  getBattleHistory,
  respondToBattle,
  submitProblemPick,
  confirmReady,
  submitBattleResult,
  forfeitBattle,
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
import { calculateStreak, getProblemsSolved, needsRefresh, timestampToDateString, hasSolvedToday } from '../shared/streak-calculator.js';
import {
  getNotificationState,
  batchNotify,
  isNotificationMuted,
  setNotificationMuted
} from '../shared/notification-manager.js';
import {
  detectMilestone,
  isStreakAtRisk,
  buildNotificationMessage
} from '../shared/activity-detector.js';
import {
  getCurrentInterval,
  getNextAlarmConfig,
  getScheduleDescription
} from '../shared/schedule-manager.js';
import { initializeTabMonitor } from './tab-monitor.js';
import { syncBlockerRules, isBlockerActive } from './blocker-manager.js';

const ALARM_NAME = 'leetfriends_sync';
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

// Install listener - set up dynamic alarms & storage cleanup
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[ServiceWorker] Installed - setting up sync alarm and cleaning legacy keys');
  setupDynamicAlarm();
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
  }
});

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
      handleBattleGetStatus(message.username).then(sendResponse);
      return true;

    case 'BATTLE_CHALLENGE_V2':
      handleBattleChallengeV2(message).then(sendResponse);
      return true;

    case 'BATTLE_ACCEPT_V2':
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

    case 'SYNC_FRIENDSHIPS':
      (async () => {
        if (!Array.isArray(message.usernames)) {
          return sendResponse({ success: true, count: 0 });
        }
        const results = await Promise.all(
          message.usernames.map(u => syncFriendship(u).catch(() => ({ success: false })))
        );
        sendResponse({ success: true, count: results.filter(r => r?.success).length });
      })().catch(err => sendResponse({ success: false, error: err.message }));
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

    default:
      sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
  }
});

// Notification click router
chrome.notifications.onClicked.addListener((notifId) => {
  if (notifId.includes('streak') || notifId.includes('roast') || notifId.includes('solve')) {
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
    const storageData = await chrome.storage.local.get(['my_leetcode_username', 'user_timezone']);
    const myUsername = storageData.my_leetcode_username;

    if (!myUsername) {
      return { success: false, error: 'No LeetCode username configured. Please enter your username.' };
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

    // Check if any friends need refresh
    let friendsNeedSync = forceRefresh;
    if (!friendsNeedSync && friendUsernames.length > 0) {
      for (const u of friendUsernames) {
        if (!friends[u] || needsRefresh(friends[u]?.lastUpdated)) {
          friendsNeedSync = true;
          break;
        }
      }
    }

    if (friendsNeedSync && friendUsernames.length > 0) {
      console.log('[ServiceWorker] Syncing friends data...');
      for (const friendUser of friendUsernames) {
        if (friendUser.toLowerCase() === myUsername.toLowerCase()) continue;
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

    const existing = await getFriend(normalized);
    if (existing) {
      return { success: false, error: `${original} is already in your friends list` };
    }

    const rawData = await fetchUserData(original);
    const processed = await processUserData(rawData);
    await saveFriend(normalized, processed);

    // If authenticated in Supabase, sync friendship permanently to server
    if (getAuthState() === AUTH_STATES.AUTHENTICATED) {
      syncFriendship(normalized).catch(err => {
        console.warn('[ServiceWorker] Cloud syncFriendship failed:', err);
      });
    }

    return { success: true, message: `${original} added successfully`, data: processed };
  } catch (error) {
    console.error('[ServiceWorker] handleAddFriend error:', error);
    return { success: false, error: error.message || 'User not found or profile is private' };
  }
}

/**
 * Handle REMOVE_FRIEND request
 */
async function handleRemoveFriend(username) {
  try {
    await removeFriend(username);
    if (getAuthState() === AUTH_STATES.AUTHENTICATED) {
      removeFriendship(username).catch(err => {
        console.warn('[ServiceWorker] Cloud removeFriendship failed:', err);
      });
    }
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
    let friends = await getAllFriends();
    // If user is authenticated and local friend cache is empty (e.g. after reinstall),
    // restore permanent friendships from Supabase
    if (getAuthState() === AUTH_STATES.AUTHENTICATED && (!friends || Object.keys(friends).length === 0)) {
      await restoreAccountSocialData();
      friends = await getAllFriends();
    }
    return { success: true, friends };
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
    await chrome.storage.local.set({ last_solve_date: todayStr });
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
  try {
    const storageData = await chrome.storage.local.get(['my_leetcode_username', 'user_timezone']);
    const myUsername = storageData.my_leetcode_username;
    const timezone = storageData.user_timezone;

    const friendUsernames = await getFriendsList();
    const usernamesToSync = myUsername
      ? [...new Set([myUsername, ...friendUsernames])]
      : friendUsernames;

    console.log(`[ServiceWorker] Syncing ${usernamesToSync.length} profile(s): ${usernamesToSync.join(', ')}`);

    const notificationEvents = [];

    // Check for received roasts for current user via durable messages
    if (myUsername) {
      try {
        const unreadRoasts = await fetchUnreadRoasts(myUsername);
        if (unreadRoasts && unreadRoasts.length > 0) {
          const idsToDeliver = [];
          for (const roast of unreadRoasts) {
            notificationEvents.push({
              type: 'roast',
              username: roast.sender_username,
              message: `${roast.sender_username} roasted you: "${roast.content}" 🔥`,
              priority: 2
            });
            if (roast.status === 'sent') {
              idsToDeliver.push(roast.id);
            }
          }
          if (idsToDeliver.length > 0) {
            await markRoastsDelivered(idsToDeliver);
          }
        }

        // Also check local pending roasts as fallback
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
          if (hasSolvedToday(processed.allAcceptedSubmissions, processed.submissionCalendar, timezone)) {
            const todayStr = timestampToDateString(Math.floor(Date.now() / 1000), timezone);
            await chrome.storage.local.set({ last_solve_date: todayStr });
          }
          await syncBlockerRules();
        }

        if (!(await isNotificationMuted())) {
          const events = await detectEvents(username, oldData, processed, myUsername);
          notificationEvents.push(...events);

          // Check if current user streak is at risk
          if (myUsername && username.toLowerCase() === myUsername.toLowerCase()) {
            if (isStreakAtRisk(processed.allAcceptedSubmissions, processed.stats.streak)) {
              notificationEvents.push({
                username: 'You',
                type: 'streak_at_risk',
                message: buildNotificationMessage('You', 'streak_at_risk', { streak: processed.stats.streak }),
                priority: 3
              });
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
  }
}

/**
 * Detect significant social events for a friend
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
      if (newData.recentSubmissions && newData.recentSubmissions.length > 0) {
        problemTitle = newData.recentSubmissions[0].title || problemTitle;
      }

      events.push({
        username,
        type: 'new_submission',
        message: `${username} just solved ${count === 1 ? `"${problemTitle}"` : `${count} problems`}! 🎯`,
        priority: 1
      });
    }
  }

  // Milestones
  if (newData.stats?.streak && detectMilestone(newData.stats.streak)) {
    const oldStreak = oldData?.stats?.streak || 0;
    if (newData.stats.streak > oldStreak) {
      events.push({
        username,
        type: 'milestone',
        message: `${username} reached a ${newData.stats.streak}-day streak! 🔥`,
        priority: 2
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
    submissionCalendar: submissionCalendar || {},
    lastUpdated: Date.now()
  };
}

// ===== 1v1 Battle Handlers =====

async function handleBattleGetStatus(usernameOverride) {
  try {
    const stored = await chrome.storage.local.get('my_leetcode_username');
    const username = usernameOverride || stored.my_leetcode_username;
    if (!username) return { success: false, error: 'No username configured' };

    const [battle, history] = await Promise.all([
      getActiveBattle(username),
      getBattleHistory(username, 10)
    ]);

    if (!battle) return { success: true, battle: null, history };
    const results = await getBattleResults(battle.id);
    return { success: true, battle, results, history };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattleChallengeV2(message) {
  try {
    const stored = await chrome.storage.local.get(['my_leetcode_username', 'own_profile']);
    const challenger = message.challenger || stored.my_leetcode_username;
    if (challenger && stored.own_profile) {
      upsertProfile(challenger, stored.own_profile).catch(() => {});
    }
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

    if (res?.bothReady) {
      scheduleBattleStart(battleId);
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
    return await forfeitBattleV2(battleId, username);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function scheduleBattleStart(battleId) {
  setTimeout(async () => {
    try {
      const state = await getBattleStateV2(battleId);
      if (!state?.problems?.length) return;
      const firstProblem = state.problems[0];
      const targetUrl = firstProblem.problem_url || `https://leetcode.com/problems/${firstProblem.problem_slug}/`;

      const tabs = await chrome.tabs.query({ url: '*://leetcode.com/*' });
      if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { url: targetUrl, active: true });
        if (tabs[0].windowId) {
          await chrome.windows.update(tabs[0].windowId, { focused: true });
        }
      } else {
        await chrome.tabs.create({ url: targetUrl, active: true });
      }

      if (chrome.notifications) {
        chrome.notifications.create(`battle_start_${battleId}`, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: '⚔️ Battle Started!',
          message: `Duel is live! First problem: ${firstProblem.problem_title}`,
          priority: 2
        });
      }
    } catch (e) {
      console.warn('[ServiceWorker] scheduleBattleStart error:', e);
    }
  }, 10000);
}

async function handleBattleChallenge(challengerOverride, challenged, language) {
  try {
    const stored = await chrome.storage.local.get(['my_leetcode_username', 'own_profile']);
    const challenger = challengerOverride || stored.my_leetcode_username;
    if (challenger && stored.own_profile) {
      upsertProfile(challenger, stored.own_profile).catch(() => {});
    }
    return await createBattle(challenger, challenged, language);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattleRespond(battleId, usernameOverride, accept) {
  try {
    const stored = await chrome.storage.local.get('my_leetcode_username');
    const username = usernameOverride || stored.my_leetcode_username;
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
    return await confirmReady(battleId, username);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattleSubmission(message) {
  try {
    const stored = await chrome.storage.local.get('my_leetcode_username');
    const username = stored.my_leetcode_username;
    if (!username) return { success: false, error: 'No username configured' };

    const battle = await getActiveBattle(username);
    if (!battle) return { success: false, error: 'No active battle in progress' };

    return await submitBattleResult(battle.id, username, {
      submissionId: message.submissionId,
      accepted: message.accepted,
      runtime_ms: message.runtime_ms,
      memory_mb: message.memory_mb,
      language: message.language,
      attempts: message.attempts,
      problemSlug: message.problemSlug
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleBattleForfeit(battleId, usernameOverride) {
  try {
    const stored = await chrome.storage.local.get('my_leetcode_username');
    const username = usernameOverride || stored.my_leetcode_username;
    return await forfeitBattle(battleId, username);
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
    const stored = await chrome.storage.local.get('my_leetcode_username');
    const username = stored.my_leetcode_username;
    if (username) {
      await updatePresence(username, 'online');
    }
  } catch (err) {
    console.warn('[ServiceWorker] handlePresenceHeartbeat error:', err);
  }
}

async function handleBattlePingPresence(usernameOverride) {
  try {
    const stored = await chrome.storage.local.get(['my_leetcode_username', 'own_profile']);
    const username = usernameOverride || stored.my_leetcode_username;
    if (username) {
      // Proactively ensure profile is populated on Supabase whenever battle presence is pinged
      upsertProfile(username, stored.own_profile || { profile: { realName: username } }).catch(() => {});
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
