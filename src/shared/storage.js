/**
 * Local-First Supabase Storage Manager
 *
 * Implements a resilient local-first architecture using chrome.storage.local
 * for instant offline reads, caching, and independent own-profile tracking,
 * with opportunistic synchronization to Supabase when authenticated.
 */

import {
  getProfile,
  getAcceptedFriends,
  removeFriendship,
  upsertProfile,
  getUserSettings,
  upsertUserSettings,
  sendRoast as supabaseSendRoast,
  clearRoasts as supabaseClearRoasts,
  getAuthState,
  getAuthSession,
  AUTH_STATES
} from './supabase-client.js';

export { getUserSettings, upsertUserSettings };

/**
 * Get the current user's configured LeetCode username
 */
export async function getMyUsername() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  const data = await chrome.storage.local.get('my_leetcode_username');
  return data.my_leetcode_username || null;
}

/**
 * Get the current user's own profile independently of friends
 */
export async function getOwnProfile() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  try {
    const data = await chrome.storage.local.get(['own_profile']);
    return data.own_profile || null;
  } catch (err) {
    console.error('Error reading own profile from storage:', err);
    return null;
  }
}

/**
 * Save the current user's own profile to local storage and sync to Supabase if authenticated
 */
export async function saveOwnProfile(data) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return false;
  try {
    await chrome.storage.local.set({
      own_profile: data,
      last_own_profile_sync: Date.now()
    });

    const myUsername = await getMyUsername();
    // Opportunistically sync to cloud if authenticated
    if (myUsername && getAuthState() === AUTH_STATES.AUTHENTICATED) {
      upsertProfile(myUsername, data).catch(err => {
        console.warn('[Storage] Cloud sync for own profile failed (non-blocking):', err);
      });
    }

    return true;
  } catch (err) {
    console.error('Error saving own profile to storage:', err);
    return false;
  }
}

/**
 * Get all friends data from local cache and opportunistically refresh from Supabase
 * @returns {Promise<Object>} Friends data object mapped by username
 */
export async function getAllFriends() {
  try {
    const myUsername = await getMyUsername();
    const stored = (typeof chrome !== 'undefined' && chrome.storage?.local)
      ? await chrome.storage.local.get(['friends_cache', 'own_profile', 'friends_account_id'])
      : {};

    const authenticated = getAuthState() === AUTH_STATES.AUTHENTICATED;
    const session = authenticated ? await getAuthSession() : null;
    const accountId = session?.user_id || null;
    const cacheBelongsToCurrentUser = accountId
      ? stored.friends_account_id === accountId
      : !stored.friends_account_id;
    const localCache = cacheBelongsToCurrentUser ? (stored.friends_cache || {}) : {};
    const ownData = stored.own_profile || null;
    const result = { ...localCache };

    // Always include own profile if available
    if (myUsername && ownData) {
      result[myUsername] = ownData;
    }

    // If unauthenticated or no cloud connection, return local cache immediately
    if (!authenticated || !accountId) {
      return result;
    }

    // Opportunistically restore and refresh friend profiles from Supabase if authenticated
    try {
      const accepted = await getAcceptedFriends({ throwOnError: true });
      if (Array.isArray(accepted)) {
        const acceptedNames = new Set(
          accepted.map(friend => (friend.leetcode_username || '').toLowerCase()).filter(Boolean)
        );

        // Tracked friends in user_settings.saved_friends are also valid friends for this account
        try {
          const userSettings = await getUserSettings();
          if (Array.isArray(userSettings?.saved_friends)) {
            userSettings.saved_friends.forEach(name => {
              const lower = (name || '').toLowerCase().trim();
              if (lower) acceptedNames.add(lower);
            });
          }
        } catch {}

        // A user's accepted cloud relationships and saved friends define their friend set. Keep
        // cached profile details only for that set, never entries left by a
        // previous account or a friendship that is no longer accepted.
        for (const username of Object.keys(result)) {
          if (username.toLowerCase() !== myUsername?.toLowerCase() && !acceptedNames.has(username.toLowerCase())) {
            delete result[username];
          }
        }

        accepted.forEach(friend => {
          const username = (friend.leetcode_username || '').toLowerCase();
          if (!username) return;
          const existing = result[username] || {};
          const existingProfile = existing.profile || {};
          const hasRichData = !!(existing.submissionCalendar && (existingProfile.ranking || existingProfile.ranking === 0));

          result[username] = {
            ...existing,
            username,
            profile: {
              ...existingProfile,
              username,
              realName: existingProfile.realName || friend.display_name || username,
              avatar: existingProfile.avatar || friend.avatar_url || '',
              ranking: existingProfile.ranking || 0
            },
            stats: {
              ...(existing.stats || {}),
              total: existing.stats?.total ?? friend.total_solved ?? 0,
              easy: existing.stats?.easy ?? friend.easy_solved ?? 0,
              medium: existing.stats?.medium ?? friend.medium_solved ?? 0,
              hard: existing.stats?.hard ?? friend.hard_solved ?? 0,
              streak: existing.stats?.streak ?? friend.current_streak ?? 0,
              longestStreak: existing.stats?.longestStreak ?? friend.longest_streak ?? 0
            },
            contest: { rating: existing.contest?.rating ?? friend.contest_rating ?? 0 },
            friend_id: friend.friend_id,
            friendship_id: friend.friendship_id,
            submissionCalendar: existing.submissionCalendar || null,
            lastUpdated: hasRichData
              ? (existing.lastUpdated || (friend.last_synced_at ? new Date(friend.last_synced_at).getTime() : Date.now()))
              : 0
          };
        });

        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          const finalFriendList = Object.keys(result).filter(name => name.toLowerCase() !== myUsername?.toLowerCase());
          const userSection = {
            accountId,
            friendIds: finalFriendList,
            friendUsernames: finalFriendList,
            friends: result,
            updatedAt: Date.now()
          };
          await chrome.storage.local.set({
            friends_cache: result,
            friends_list: finalFriendList,
            friends_account_id: accountId,
            [`user_friends_${accountId}`]: userSection
          });
        }
      }
    } catch (cloudErr) {
      console.warn('[Storage] Permanent friends refresh skipped/failed:', cloudErr.message);
    }

    return result;
  } catch (error) {
    console.error('Error getting friends:', error);
    return {};
  }
}

/**
 * Get a single friend's data (checks local cache first, then cloud)
 */
export async function getFriend(username) {
  if (!username) return null;
  try {
    const myUsername = await getMyUsername();
    if (myUsername && username.toLowerCase() === myUsername.toLowerCase()) {
      return await getOwnProfile();
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(['friends_cache', 'friends_account_id']);
      const authenticated = getAuthState() === AUTH_STATES.AUTHENTICATED;
      const session = authenticated ? await getAuthSession() : null;
      const accountId = session?.user_id || null;
      const cacheBelongsToCurrentUser = accountId
        ? stored.friends_account_id === accountId
        : !stored.friends_account_id;
      const cached = cacheBelongsToCurrentUser
        ? Object.entries(stored.friends_cache || {}).find(([key]) => key.toLowerCase() === username.toLowerCase())?.[1]
        : null;
      if (cached) {
        return cached;
      }
    }

    const profile = await getProfile(username);
    if (!profile) return null;

    const data = profile.leetcode_data || {};
    data.lastUpdated = profile.last_synced_at ? new Date(profile.last_synced_at).getTime() : Date.now();
    return data;
  } catch (error) {
    console.error('Error getting single friend:', error);
    return null;
  }
}

/**
 * Save or update a friend's data locally and in Supabase
 */
export async function saveFriend(username, data) {
  if (!username || !data) return { success: false };
  try {
    const myUsername = await getMyUsername();
    const isSelf = myUsername && username.toLowerCase() === myUsername.toLowerCase();

    if (isSelf) {
      await saveOwnProfile(data);
      return { success: true };
    }

    const session = await getAuthSession();
    const accountId = session?.user_id || null;

    // Save to local storage
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(['friends_cache', 'friends_list']);
      const cache = stored.friends_cache || {};
      const list = stored.friends_list || [];

      const prior = cache[username] || {};
      cache[username] = {
        ...data,
        friend_id: data.friend_id || prior.friend_id || null,
        friendship_id: data.friendship_id || prior.friendship_id || null
      };
      const updatedList = list.some(u => u.toLowerCase() === username.toLowerCase())
        ? list
        : [...list, username];

      const toSet = {
        friends_cache: cache,
        friends_list: updatedList
      };

      if (accountId) {
        toSet.friends_account_id = accountId;
        toSet[`user_friends_${accountId}`] = {
          accountId,
          friendIds: updatedList,
          friendUsernames: updatedList,
          friends: cache,
          updatedAt: Date.now()
        };
      }

      await chrome.storage.local.set(toSet);
    }

    // Sync to Supabase if authenticated
    if (getAuthState() === AUTH_STATES.AUTHENTICATED && accountId) {
      upsertProfile(username, data).catch(() => {});
      getUserSettings().then(settings => {
        const currentSaved = Array.isArray(settings?.saved_friends) ? settings.saved_friends : [];
        if (!currentSaved.map(s => (s || '').toLowerCase()).includes(username.toLowerCase())) {
          upsertUserSettings({ saved_friends: [...currentSaved, username] }).catch(() => {});
        }
      }).catch(() => {});
    }

    return { success: true };
  } catch (error) {
    console.error('Error saving friend:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove a friend from the local friends list and Supabase
 */
export async function removeFriend(username) {
  if (!username) return false;
  try {
    const session = await getAuthSession();
    const accountId = session?.user_id || null;

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(['friends_cache', 'friends_list']);
      const cache = stored.friends_cache || {};
      const list = stored.friends_list || [];

      delete cache[username];
      const updatedList = list.filter(u => u.toLowerCase() !== username.toLowerCase());

      const toSet = {
        friends_cache: cache,
        friends_list: updatedList
      };

      if (accountId) {
        toSet.friends_account_id = accountId;
        toSet[`user_friends_${accountId}`] = {
          accountId,
          friendIds: updatedList,
          friendUsernames: updatedList,
          friends: cache,
          updatedAt: Date.now()
        };
      }

      await chrome.storage.local.set(toSet);
    }

    if (getAuthState() === AUTH_STATES.AUTHENTICATED && accountId) {
      removeFriendship(username).catch(() => {});
      getUserSettings().then(settings => {
        if (Array.isArray(settings?.saved_friends)) {
          const updated = settings.saved_friends.filter(u => (u || '').toLowerCase() !== username.toLowerCase());
          upsertUserSettings({ saved_friends: updated }).catch(() => {});
        }
      }).catch(() => {});
    }

    return true;
  } catch (error) {
    console.error('Error removing friend:', error);
    return false;
  }
}

/**
 * Get list of friend usernames
 */
export async function getFriendsList() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(['friends_list', 'friends_account_id']);
      const authenticated = getAuthState() === AUTH_STATES.AUTHENTICATED;
      const session = authenticated ? await getAuthSession() : null;
      const accountId = session?.user_id || null;
      const cacheBelongsToCurrentUser = accountId
        ? stored.friends_account_id === accountId
        : !stored.friends_account_id;
      if (cacheBelongsToCurrentUser && Array.isArray(stored.friends_list)) return stored.friends_list;

      // Do not expose a prior account's locally cached list while signed into
      // another account or while an account-owned cache cannot be identified.
      if (stored.friends_account_id && !accountId) return [];

      if (authenticated && accountId) {
        const all = await getAllFriends();
        const myUsername = await getMyUsername();
        return Object.keys(all).filter(u => u.toLowerCase() !== myUsername?.toLowerCase());
      }
    }

    if (getAuthState() === AUTH_STATES.AUTHENTICATED) {
      const all = await getAllFriends();
      const myUsername = await getMyUsername();
      return Object.keys(all).filter(u => u.toLowerCase() !== myUsername?.toLowerCase());
    }

    return [];
  } catch (error) {
    console.error('Error getting friends list:', error);
    return [];
  }
}

/**
 * Get the distinct friend section for a specific user ID
 * @param {string} [userId]
 * @returns {Promise<{ accountId: string|null, friendIds: string[], friends: Object }>}
 */
export async function getUserFriendSection(userId = null) {
  try {
    let targetId = userId;
    if (!targetId) {
      const session = await getAuthSession();
      targetId = session?.user_id || null;
    }

    if (targetId && typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(`user_friends_${targetId}`);
      if (stored[`user_friends_${targetId}`]) {
        return stored[`user_friends_${targetId}`];
      }
    }

    const all = await getAllFriends();
    const friendIds = Object.values(all)
      .map(f => f.friend_id || f.username)
      .filter(Boolean);

    return {
      accountId: targetId,
      friendIds,
      friends: all
    };
  } catch (err) {
    console.error('Error in getUserFriendSection:', err);
    return { accountId: null, friendIds: [], friends: {} };
  }
}

/**
 * Check if a username is already added
 */
export async function friendExists(username) {
  if (!username) return false;
  const friends = await getFriendsList();
  return friends.some(f => f.toLowerCase() === username.toLowerCase());
}

/**
 * Get last update timestamp for a friend
 */
export async function getLastUpdated(username) {
  const friend = await getFriend(username);
  return friend?.lastUpdated || null;
}

/**
 * Check storage health & quota usage
 */
export async function checkStorageHealth() {
  const info = await getStorageInfo();
  const atLimit = info.bytesUsed >= info.quota * 0.95;
  const nearLimit = info.bytesUsed >= info.quota * 0.8;
  return {
    bytes: info.bytesUsed,
    megabytes: (info.bytesUsed / (1024 * 1024)).toFixed(2),
    percent: info.percentUsed,
    nearLimit,
    atLimit
  };
}

/**
 * Get detailed storage usage information
 */
export async function getStorageInfo() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const bytesInUse = await new Promise(resolve => {
        chrome.storage.local.getBytesInUse(null, bytes => resolve(bytes || 0));
      });
      const quota = chrome.storage.local.QUOTA_BYTES || 5242880; // 5MB default quota
      const percentUsed = ((bytesInUse / quota) * 100).toFixed(1);
      return {
        bytesUsed: bytesInUse,
        quota,
        percentUsed
      };
    }
  } catch (err) {
    console.warn('Error reading storage usage:', err);
  }
  return { bytesUsed: 0, quota: 5242880, percentUsed: '0.0' };
}

/**
 * Update a friend's specific field
 */
export async function updateFriendField(username, field, value) {
  try {
    const friend = await getFriend(username);
    if (!friend) return false;

    friend[field] = value;
    await saveFriend(username, friend);
    return true;
  } catch (error) {
    console.error('Error updating friend field:', error);
    return false;
  }
}

/**
 * Clear all local data (Reset)
 */
export async function clearAllData() {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.clear();
  }
  return true;
}

/**
 * Send a roast to a friend
 */
export async function sendRoast(targetUsername, fromUsername, message) {
  return await supabaseSendRoast(targetUsername, fromUsername, message);
}

/**
 * Clear pending roasts for current user
 */
export async function clearRoasts() {
  const myUsername = await getMyUsername();
  if (myUsername) {
    return await supabaseClearRoasts(myUsername);
  }
  return false;
}
